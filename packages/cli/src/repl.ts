import { basename, resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { SessionMode, SessionRow, loadAuth, getTendrilPaths, VERSION as TENDRIL_VERSION } from '@tendril/core';
import { TendrilClient } from './client.js';
import { EventRenderer } from './render.js';
import { theme } from './ui/theme.js';
import { InputQueue } from './components/input/queue.js';
import { PromptHistory } from './components/input/history.js';
import { PasteChipManager } from './components/input/chips.js';
import { executeShellEscape } from './components/input/shell-escape.js';
import { loginCommand } from './commands/login.js';
import { createDefaultCommandRegistry } from './commands/defaults.js';
import { CommandContext } from './commands/registry.js';
import { resolveActiveTheme } from './theme/loader.js';
import { InteractivePrompt } from './ui/interactive-prompt.js';

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

  const renderer = new EventRenderer();
  const inputQueue = new InputQueue();
  const promptHistory = new PromptHistory({ mode: 'session' });
  const pasteChipManager = new PasteChipManager();
  let isTurnRunning = false;
  let lastCtrlCTime = 0;

  const activeTheme = resolveActiveTheme();
  const commandRegistry = createDefaultCommandRegistry();

  // Initialize Dynamic Interactive Prompt Controller
  const interactivePrompt = new InteractivePrompt({
    theme: activeTheme,
    history: promptHistory,
    chipManager: pasteChipManager,
    slashCommands: commandRegistry.list().map((c) => ({ name: c.name, description: c.description })),
    getMode: () => currentSession.mode,
    getModel: () => currentSession.model,
    getContextPercent: () => 14,
  });

  // 4. Print Initial Header Banner (Zone A - scrolls into scrollback)
  const printHeader = () => {
    const wsDisplay = currentSession.workspace_path.replace(process.env.HOME || '', '~');
    const branch = getGitBranch(currentSession.workspace_path);
    const banner = interactivePrompt.getOrchestrator().renderBanner({
      version: TENDRIL_VERSION,
      model: currentSession.model,
      cwd: branch ? `${wsDisplay} (${branch})` : wsDisplay,
      permissionMode: currentSession.mode,
      accountLabel: 'Local Session',
      width: process.stdout.columns || 76,
    });
    console.log(banner);
  };

  printHeader();

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
            const toolName = (event.data as any).name || (event.data as any).tool || 'tool';
            const canAllowAlways = (event.data as any).options?.canAllowAlways !== false;
            const disallowReason = (event.data as any).options?.disallowAlwaysReason;

            let decision: 'allow_once' | 'allow_always' | 'deny' = 'allow_once';
            let denialNote: string | undefined;

            if (process.stdin.isTTY) {
              const perm = await interactivePrompt.promptPermission({
                type: toolName === 'bash' ? 'command' : (toolName.includes('file') ? 'file' : 'trust_all'),
                target: event.data.summary || (toolName === 'bash' ? (event.data as any).command || '' : toolName),
                description: disallowReason,
                canAllowAlways,
              });
              decision = perm.decision;
              denialNote = perm.note;
            }

            try {
              const res = await client.resolvePermission(
                currentSession.id,
                event.data.requestId,
                decision,
                denialNote,
              );
              if ((res as any)?.downgraded) {
                console.log(
                  theme.warning(
                    `\n  ⚠ ${(res as any).warning || 'Cannot save permanent rule for compound command. Allowed once.'}`,
                  ),
                );
              }
              if (decision !== 'deny') {
                renderer.startSpinner('Executing tool...');
              }
            } catch (err: any) {
              renderer.stopSpinner();
              console.error(theme.fail(`Failed to resolve permission: ${err.message}`));
            }
            break;
          }

          case 'session.status':
            if (event.data.status === 'idle') {
              renderer.stopSpinner();
              isTurnRunning = false;
              interactivePrompt.setTurnRunning(false);
              if (!inputQueue.isEmpty()) {
                const nextMsg = inputQueue.dequeue();
                if (nextMsg) {
                  console.log(theme.secondary(`\n▶ Dispatching queued message: "${nextMsg.text}"\n`));
                  isTurnRunning = true;
                  interactivePrompt.setTurnRunning(true);
                  renderer.startTurn();
                  client.sendMessage(currentSession.id, nextMsg.text).catch((err: any) => {
                    renderer.stopSpinner();
                    console.error(theme.fail(`Failed to send queued message: ${err.message}`));
                    isTurnRunning = false;
                    interactivePrompt.setTurnRunning(false);
                  });
                  return;
                }
              }
              interactivePrompt.redraw();
            }
            break;

          case 'error':
            renderer.stopSpinner();
            console.error(`\n${theme.fail(event.data.message || 'Error occurred')}`);
            isTurnRunning = false;
            interactivePrompt.setTurnRunning(false);
            interactivePrompt.redraw();
            break;
        }
      },
      (_err) => {
        // SSE disconnected / reconnected
      },
    );
  };

  connectStream();

  // 6. Interactive Prompt Loop
  const runReplLoop = async () => {
    while (true) {
      interactivePrompt.redraw();
      const res = await interactivePrompt.prompt();
      if (res === null) {
        // Handle Ctrl+C
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
          interactivePrompt.setTurnRunning(false);
          continue;
        }

        const now = Date.now();
        if (now - lastCtrlCTime < 2000) {
          if (activeUnsubscribe) activeUnsubscribe();
          console.log('\nGoodbye!');
          process.exit(0);
        } else {
          lastCtrlCTime = now;
          console.log(theme.muted('\nPress Ctrl-C again within 2s to exit.'));
        }
        continue;
      }

      const fullMessage = res.text.trim();
      if (!fullMessage) continue;

      // Direct Shell Escape (!cmd)
      if (fullMessage.startsWith('!')) {
        promptHistory.add(fullMessage);
        await executeShellEscape(fullMessage);
        continue;
      }

      // Slash commands
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
          promptLine: async (_query: string) => {
            const r = await interactivePrompt.prompt();
            return r ? r.text : '';
          },
          printHeader,
          exit: () => {
            if (activeUnsubscribe) activeUnsubscribe();
            process.exit(0);
          },
          output: (text) => process.stdout.write(text),
        };

        await commandRegistry.execute(fullMessage, commandContext);
        continue;
      }

      // Append user message to conversation history via TurnLayout (Zone B)
      const userLines = interactivePrompt.getTurnLayout().formatUserTurn(fullMessage);
      interactivePrompt.getOrchestrator().appendHistory(userLines);

      // Non-blocking Input Queuing or Immediate Send
      if (isTurnRunning) {
        inputQueue.enqueue(fullMessage);
        const preview = fullMessage.slice(0, 40) + (fullMessage.length > 40 ? '...' : '');
        console.log(theme.muted(`\n  ↳ [Queued message #${inputQueue.size()}: "${preview}" · Esc to clear queue]\n`));
        continue;
      }

      promptHistory.add(fullMessage);
      isTurnRunning = true;
      interactivePrompt.setTurnRunning(true);
      renderer.startTurn();

      try {
        await client.sendMessage(currentSession.id, fullMessage);
      } catch (err: any) {
        renderer.stopSpinner();
        console.error(theme.fail(`Failed to send message: ${err.message}`));
        isTurnRunning = false;
        interactivePrompt.setTurnRunning(false);
      }
    }
  };

  runReplLoop().catch((err) => {
    console.error('REPL loop error:', err);
  });
}
