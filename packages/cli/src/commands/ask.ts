import { resolve } from 'node:path';
import { SessionMode } from '@tendril/core';
import { TendrilClient } from '../client.js';
import { EventRenderer } from '../render.js';
import { theme } from '../ui/theme.js';

export interface AskOptions {
  mode?: string;
  model?: string;
  json?: boolean;
  dir?: string;
  home?: string;
}

export async function askCommand(promptArg: string | undefined, options: AskOptions): Promise<void> {
  let prompt = promptArg ? String(promptArg).trim() : '';

  // 1. Handle Stdin when piped
  if (!process.stdin.isTTY && (!prompt || prompt === '-')) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    }
    prompt = Buffer.concat(chunks).toString('utf8').trim();
  }

  if (!prompt) {
    console.error(theme.fail('Error: Prompt is required for `tendril ask`.'));
    process.exitCode = 2;
    return;
  }

  const workspace = resolve(options.dir || process.cwd());
  const client = new TendrilClient({ customHome: options.home });

  try {
    // 2. Connect to Daemon (exit code 3 if daemon unreachable)
    try {
      await client.ensureDaemon(true);
    } catch (err: any) {
      if (options.json) {
        console.log(JSON.stringify({ type: 'error', error: { code: 'daemon_failure', message: err.message } }));
      } else {
        console.error(theme.fail(`Daemon failure: ${err.message}`));
      }
      process.exitCode = 3;
      return;
    }

    // 3. Create Session
    const mode = (options.mode as SessionMode) || 'ask';
    const { session } = await client.createSession({
      workspace,
      mode,
      model: options.model,
      title: `ask: ${prompt.slice(0, 30)}`,
    });

    const isJson = Boolean(options.json);
    const renderer = new EventRenderer();

    let exitCode = 0;
    let turnFinished = false;

    // 4. Subscribe to Events
    const unsubscribe = client.subscribeEvents(
      session.id,
      async (event) => {
        if (isJson) {
          console.log(JSON.stringify(event));
        }

        switch (event.type) {
          case 'text.delta':
            if (!isJson) {
              renderer.renderTextDelta(event.data.text || '');
            }
            break;

          case 'tool.start':
            if (!isJson) {
              const toolName = (event.data as any).name || (event.data as any).tool || 'tool';
              renderer.renderToolStart(toolName, event.data.input || {});
            }
            break;

          case 'tool.output':
            if (!isJson) {
              renderer.renderToolOutput(event.data.chunk || '');
            }
            break;

          case 'tool.end':
            if (!isJson) {
              const toolName = (event.data as any).name || (event.data as any).tool || 'tool';
              const isSuccess = (event.data as any).status === 'ok' || (event.data as any).success === true;
              const summary = (event.data as any).summary || (event.data as any).resultPreview;
              renderer.renderToolEnd(toolName, isSuccess, summary);
            }
            break;

          case 'usage':
            if (!isJson) {
              renderer.renderUsage(event.data.inputTokens, event.data.outputTokens);
            }
            break;

          case 'tool.permission': {
            const toolName = (event.data as any).name || (event.data as any).tool || 'tool';
            const canAllowAlways = (event.data as any).options?.canAllowAlways !== false;
            const disallowReason = (event.data as any).options?.disallowAlwaysReason;

            // When stdin is not TTY, automatically deny to prevent hanging
            if (!process.stdin.isTTY) {
              await client.resolvePermission(
                session.id,
                event.data.requestId,
                'deny',
                'Non-interactive mode (auto-denied)',
              );
              exitCode = 2;
            } else {
              // Interactive prompt
              process.stdout.write(
                renderer.renderPermissionPrompt(toolName, event.data.summary || '', {
                  canAllowAlways,
                  reason: disallowReason,
                }),
              );

              // Single keypress in raw mode
              const allowedKeys = canAllowAlways ? ['y', 'a', 'n'] : ['y', 'n'];
              const answer = await readSingleKey(allowedKeys);
              process.stdout.write(`${answer}\n`);

              const resolveSafe = async (
                decision: 'allow_once' | 'allow_always' | 'deny',
                note?: string,
              ) => {
                try {
                  const res = await client.resolvePermission(
                    session.id,
                    event.data.requestId,
                    decision,
                    note,
                  );
                  if ((res as any)?.downgraded) {
                    console.log(
                      theme.warning(
                        `  ⚠ ${(res as any).warning || 'Cannot save permanent rule for compound command. Allowed once.'}`,
                      ),
                    );
                  }
                } catch (err: any) {
                  console.error(theme.fail(`Failed to resolve permission: ${err.message}`));
                }
              };

              if (answer === 'y') {
                await resolveSafe('allow_once');
              } else if (answer === 'a') {
                await resolveSafe('allow_always');
              } else {
                await resolveSafe('deny', 'Denied by user');
                exitCode = 2;
              }
            }
            break;
          }

          case 'error': {
            if (!isJson) {
              console.error(`\n${theme.fail(event.data.message || 'Agent error')}`);
            }
            if (event.data.code === 'provider_error' || event.data.code === 'auth_error') {
              exitCode = 3;
            } else {
              exitCode = 1;
            }
            break;
          }

          case 'session.status':
            if (event.data.status === 'idle') {
              turnFinished = true;
            } else if (event.data.status === 'error') {
              exitCode = 1;
              turnFinished = true;
            }
            break;
        }
      },
      (streamErr) => {
        if (!turnFinished) {
          if (!isJson) {
            console.error(`\n${theme.fail(`Stream error: ${streamErr.message}`)}`);
          }
          exitCode = 3;
          turnFinished = true;
        }
      },
    );

    // 5. Send Prompt Turn
    if (!isJson && process.stdout.isTTY) {
      renderer.startTurn();
    }
    try {
      await client.sendMessage(session.id, prompt);
    } catch (err: any) {
      renderer.stopSpinner();
      unsubscribe();
      if (isJson) {
        console.log(JSON.stringify({ type: 'error', error: { code: 'send_error', message: err.message } }));
      } else {
        console.error(theme.fail(`Failed to send prompt: ${err.message}`));
      }
      process.exitCode = 3;
      return;
    }

    // 6. Wait for turn to finish
    const start = Date.now();
    while (!turnFinished) {
      await new Promise((r) => setTimeout(r, 100));

      // Periodic check if session reached idle in DB
      if (Date.now() - start > 1000) {
        try {
          const s = await client.getSession(session.id);
          if (s.session.status === 'idle') {
            turnFinished = true;
            break;
          }
        } catch {
          // ignore
        }
      }
    }

    renderer.stopSpinner();
    unsubscribe();
    if (!isJson) {
      console.log();
    }
    process.exitCode = exitCode;
  } catch (err: any) {
    if (options.json) {
      console.log(JSON.stringify({ type: 'error', error: { code: 'fatal', message: err.message } }));
    } else {
      console.error(theme.fail(`Unexpected error: ${err.message}`));
    }
    process.exitCode = 3;
  }
}

/**
 * Reads a single keypress from stdin in raw mode.
 */
function readSingleKey(validKeys: string[]): Promise<string> {
  return new Promise((resolve) => {
    const wasRaw = process.stdin.isRaw;
    if (process.stdin.setRawMode) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();

    const onData = (buffer: Buffer) => {
      const text = buffer.toString().trim().toLowerCase();
      const char = text.charAt(0);
      if (validKeys.includes(char)) {
        process.stdin.removeListener('data', onData);
        if (process.stdin.setRawMode) {
          process.stdin.setRawMode(wasRaw || false);
        }
        resolve(char);
      } else if (buffer[0] === 3) {
        // Ctrl-C
        process.stdin.removeListener('data', onData);
        if (process.stdin.setRawMode) {
          process.stdin.setRawMode(wasRaw || false);
        }
        resolve('n');
      }
    };

    process.stdin.on('data', onData);
  });
}
