import readline from 'node:readline';
import { basename, resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { SessionMode, SessionRow, loadAuth, getTendrilPaths, VERSION as TENDRIL_VERSION } from '@tendril/core';
import { TendrilClient } from './client.js';
import { EventRenderer } from './render.js';
import { theme, getSymbols } from './ui/theme.js';
import { InputQueue } from './components/input/queue.js';
import { PromptHistory } from './components/input/history.js';
import { PasteChipManager } from './components/input/chips.js';
import { executeShellEscape } from './components/input/shell-escape.js';
import { loginCommand } from './commands/login.js';
import { uiCommand } from './commands/pair-ui.js';
import { createDefaultCommandRegistry } from './commands/defaults.js';
import { CommandContext } from './commands/registry.js';
import { resolveActiveTheme } from './theme/loader.js';

function getGitBranch(cwd: string): string | undefined {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', {
      cwd,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
  } catch {
    return undefined;
  }
}

export interface ReplOptions {
  sessionId?: string;
  workspace?: string;
  home?: string;
  mode?: SessionMode;
  model?: string;
}

export async function startRepl(options: ReplOptions = {}): Promise<void> {
  const workspace = resolve(options.workspace || process.cwd());
  const paths = getTendrilPaths(options.home);
  const client = new TendrilClient({ customHome: options.home });

  // 1. Ensure Daemon is running
  await client.ensureDaemon(true);

  // 2. Ensure Provider is configured (if not, run login wizard)
  const auth = loadAuth(paths.authPath);
  const configuredProviders = Object.keys(auth.providers);
  if (configuredProviders.length === 0 && !process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY) {
    console.log(theme.muted('No provider configured yet. Starting login wizard...\n'));
    await loginCommand({ home: options.home });
  }

  // 3. Create or Resume Session
  let currentSession: SessionRow;
  if (options.sessionId) {
    const res = await client.getSession(options.sessionId);
    currentSession = res.session;
    console.log(theme.muted(`Resumed session ${currentSession.id} (${res.messages.length} messages in history)`));
  } else {
    const res = await client.createSession({
      workspace,
      mode: options.mode || 'ask',
      model: options.model,
      title: `CLI Session: ${basename(workspace)}`,
    });
    currentSession = res.session;
  }

  // 4. Print Initial Header Banner (Antigravity-style)
  const printHeader = () => {
    const wsDisplay = currentSession.workspace_path.replace(process.env.HOME || '', '~');
    const branch = getGitBranch(currentSession.workspace_path);
    let port = 7421;
    try {
      if (client.baseUrl) {
        port = parseInt(new URL(client.baseUrl).port, 10) || 7421;
      }
    } catch {}

    console.log(
      theme.banner({
        version: TENDRIL_VERSION,
        workspace: wsDisplay,
        gitBranch: branch,
        model: currentSession.model,
        mode: currentSession.mode,
        port,
      }),
    );
  };

  printHeader();

  const renderer = new EventRenderer();
  const inputQueue = new InputQueue();
  const promptHistory = new PromptHistory({ mode: 'session' });
  const pasteChipManager = new PasteChipManager();
  let isTurnRunning = false;
  let lastCtrlCTime = 0;
  let multilineBuffer = '';

  const s = getSymbols();
  const activeTheme = resolveActiveTheme();
  const commandRegistry = createDefaultCommandRegistry();
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: `${theme.primary(s.prompt)} `,
  });

  // 5. Connect SSE Event Stream for Live Streaming
  let activeUnsubscribe: (() => void) | null = null;

  const connectStream = () => {
    if (activeUnsubscribe) {
      activeUnsubscribe();
    }

    activeUnsubscribe = client.subscribeEvents(
      currentSession.id,
      async (event) => {
        switch (event.type) {
          case 'text.delta':
            renderer.renderTextDelta(event.data.text || '');
            break;

          case 'tool.start': {
            const toolName = (event.data as any).name || (event.data as any).tool || 'tool';
            renderer.renderToolStart(toolName, event.data.input || {});
            break;
          }

          case 'tool.output':
            renderer.renderToolOutput(event.data.chunk || '');
            break;

          case 'tool.end': {
            const toolName = (event.data as any).name || (event.data as any).tool || 'tool';
            const isSuccess = (event.data as any).status === 'ok' || (event.data as any).success === true;
            const summary = (event.data as any).summary || (event.data as any).resultPreview;
            renderer.renderToolEnd(toolName, isSuccess, summary);
            break;
          }

          case 'usage':
            renderer.renderUsage(event.data.inputTokens, event.data.outputTokens);
            break;

          case 'tool.permission': {
            renderer.stopSpinner();
            rl.pause();
            const toolName = (event.data as any).name || (event.data as any).tool || 'tool';
            const canAllowAlways = (event.data as any).options?.canAllowAlways !== false;
            const disallowReason = (event.data as any).options?.disallowAlwaysReason;

            process.stdout.write(
              renderer.renderPermissionPrompt(toolName, event.data.summary || '', {
                canAllowAlways,
                reason: disallowReason,
              }),
            );

            const allowedKeys = canAllowAlways ? ['y', 'a', 'n', 'd'] : ['y', 'n', 'd'];
            const answer = await readSingleKey(allowedKeys);
            process.stdout.write(`${answer}\n`);

            const resolveSafe = async (
              decision: 'allow_once' | 'allow_always' | 'deny',
              note?: string,
            ) => {
              try {
                const res = await client.resolvePermission(
                  currentSession.id,
                  event.data.requestId,
                  decision,
                  note,
                );
                if ((res as any)?.downgraded) {
                  renderer.stopSpinner();
                  console.log(
                    theme.warning(
                      `\n  ⚠ ${(res as any).warning || 'Cannot save permanent rule for compound command. Allowed once.'}`,
                    ),
                  );
                  renderer.startSpinner('Executing tool...');
                }
              } catch (err: any) {
                renderer.stopSpinner();
                console.error(theme.fail(`Failed to resolve permission: ${err.message}`));
              }
            };

            if (answer === 'y') {
              renderer.startSpinner('Executing tool...');
              await resolveSafe('allow_once');
            } else if (answer === 'a') {
              renderer.startSpinner('Executing tool...');
              await resolveSafe('allow_always');
            } else if (answer === 'd') {
              try {
                const diffs = await client.listChanges(currentSession.id);
                if (diffs.changes.length > 0) {
                  renderer.renderDiff(diffs.changes[0].diff_unified);
                } else {
                  console.log(theme.muted('No diff available yet.'));
                }
              } catch {}
              process.stdout.write(theme.warning(`Decision [y/a/n] › `));
              const nextKeys = canAllowAlways ? ['y', 'a', 'n'] : ['y', 'n'];
              const nextAns = await readSingleKey(nextKeys);
              process.stdout.write(`${nextAns}\n`);
              if (nextAns === 'y') {
                renderer.startSpinner('Executing tool...');
                await resolveSafe('allow_once');
              } else if (nextAns === 'a') {
                renderer.startSpinner('Executing tool...');
                await resolveSafe('allow_always');
              } else {
                await resolveSafe('deny');
              }
            } else {
              // Optional note prompt for denial
              const note = await promptLine('Denial note (optional, Enter to skip): ');
              await resolveSafe('deny', note.trim() || undefined);
            }

            rl.resume();
            break;
          }

          case 'session.status':
            if (event.data.status === 'idle') {
              renderer.stopSpinner();
              isTurnRunning = false;
              if (!inputQueue.isEmpty()) {
                const nextMsg = inputQueue.dequeue();
                if (nextMsg) {
                  console.log(theme.secondary(`\n▶ Dispatching queued message: "${nextMsg.text}"\n`));
                  isTurnRunning = true;
                  renderer.startTurn();
                  client.sendMessage(currentSession.id, nextMsg.text).catch((err: any) => {
                    renderer.stopSpinner();
                    console.error(theme.fail(`Failed to send queued message: ${err.message}`));
                    isTurnRunning = false;
                    rl.prompt();
                  });
                  return;
                }
              }
              rl.prompt();
            }
            break;

          case 'error':
            renderer.stopSpinner();
            console.error(`\n${theme.fail(event.data.message || 'Error occurred')}`);
            isTurnRunning = false;
            rl.prompt();
            break;
        }
      },
      (err) => {
        // SSE disconnected / reconnected
      },
    );
  };

  connectStream();

  // Helper for single line prompt during permission denial note
  function promptLine(query: string): Promise<string> {
    return new Promise((resolve) => {
      rl.question(theme.muted(query), (ans) => {
        resolve(ans);
      });
    });
  }

  // 6. Readline Line Listener
  rl.prompt();

  rl.on('line', async (line) => {
    const trimmed = line.trim();

    // Check multiline continuation with trailing backslash
    if (line.endsWith('\\')) {
      multilineBuffer += line.slice(0, -1) + '\n';
      rl.setPrompt(`${theme.muted(s.continuation)} `);
      rl.prompt();
      return;
    }

    const fullMessage = multilineBuffer ? multilineBuffer + line : line;
    multilineBuffer = '';
    rl.setPrompt(`${theme.primary(s.prompt)} `);

    if (!fullMessage.trim()) {
      rl.prompt();
      return;
    }

    // Direct Shell Escape (!cmd)
    if (fullMessage.startsWith('!')) {
      promptHistory.add(fullMessage);
      await executeShellEscape(fullMessage);
      rl.prompt();
      return;
    }

    // Long paste chip detection
    if (pasteChipManager.isLongPaste(fullMessage)) {
      const chip = pasteChipManager.createChip(fullMessage);
      console.log(theme.muted(`  ↳ ${pasteChipManager.renderChip(chip)}`));
    }

    // 7. Slash Commands
    if (fullMessage.startsWith('/')) {
      promptHistory.add(fullMessage);
      const commandContext: CommandContext = {
        client,
        currentSession,
        setSession: (sess) => {
          currentSession = sess;
        },
        theme: activeTheme,
        reconnectStream: () => {
          connectStream();
        },
        promptLine,
        printHeader,
        exit: () => {
          if (activeUnsubscribe) activeUnsubscribe();
          rl.close();
          process.exit(0);
        },
        output: (text) => process.stdout.write(text),
      };

      await commandRegistry.execute(fullMessage, commandContext);
      rl.prompt();
      return;
    }

    // 8. Non-blocking Input Queuing or Immediate Send
    if (isTurnRunning) {
      const q = inputQueue.enqueue(fullMessage);
      const preview = q.text.slice(0, 40) + (q.text.length > 40 ? '...' : '');
      console.log(theme.muted(`\n  ↳ [Queued message #${inputQueue.size()}: "${preview}" · Esc to clear queue]\n`));
      rl.prompt();
      return;
    }

    promptHistory.add(fullMessage);
    isTurnRunning = true;
    renderer.startTurn();
    try {
      await client.sendMessage(currentSession.id, fullMessage);
    } catch (err: any) {
      renderer.stopSpinner();
      console.error(theme.fail(`Failed to send message: ${err.message}`));
      isTurnRunning = false;
      rl.prompt();
    }
  });

  // 9. Handle SIGINT (Ctrl-C)
  rl.on('SIGINT', async () => {
    renderer.stopSpinner();
    if (inputQueue.size() > 0) {
      console.log(theme.warn(`\nCleared ${inputQueue.size()} queued message(s).`));
      inputQueue.clear();
    }

    if (isTurnRunning) {
      console.log(theme.warn('\nAborting current turn...'));
      try {
        await client.abortSession(currentSession.id);
      } catch {
        // ignore
      }
      isTurnRunning = false;
      rl.prompt();
      return;
    }

    const now = Date.now();
    if (now - lastCtrlCTime < 2000) {
      // Exiting
      if (activeUnsubscribe) activeUnsubscribe();
      console.log('\nGoodbye!');
      rl.close();
      process.exit(0);
    } else {
      lastCtrlCTime = now;
      console.log(theme.muted('\nPress Ctrl-C again within 2s to exit.'));
      rl.prompt();
    }
  });

  rl.on('close', () => {
    if (activeUnsubscribe) activeUnsubscribe();
  });
}

/**
 * Reads a single keypress in raw mode.
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
