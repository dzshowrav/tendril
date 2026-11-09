import readline from 'node:readline';
import { basename, resolve } from 'node:path';
import { SessionMode, SessionRow, loadAuth, getTendrilPaths } from '@tendril/core';
import { TendrilClient } from './client.js';
import { EventRenderer } from './render.js';
import { theme, getSymbols } from './ui/theme.js';
import { loginCommand } from './commands/login.js';
import { uiCommand } from './commands/pair-ui.js';

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

  // 4. Print Initial Header
  const printHeader = () => {
    const wsTail = basename(currentSession.workspace_path);
    console.log(theme.header(wsTail, currentSession.mode, currentSession.model));
    console.log();
  };

  printHeader();

  const renderer = new EventRenderer();
  let isTurnRunning = false;
  let lastCtrlCTime = 0;
  let multilineBuffer = '';

  const s = getSymbols();
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

          case 'tool.start':
            renderer.renderToolStart(event.data.tool, event.data.input || {});
            break;

          case 'tool.output':
            renderer.renderToolOutput(event.data.chunk || '');
            break;

          case 'tool.end':
            renderer.renderToolEnd(event.data.tool, event.data.success, event.data.summary);
            break;

          case 'usage':
            renderer.renderUsage(event.data.inputTokens, event.data.outputTokens);
            break;

          case 'tool.permission': {
            rl.pause();
            process.stdout.write(
              renderer.renderPermissionPrompt(event.data.tool, event.data.summary || ''),
            );

            const answer = await readSingleKey(['y', 'a', 'n']);
            process.stdout.write(`${answer}\n`);

            if (answer === 'y') {
              await client.resolvePermission(currentSession.id, event.data.requestId, 'allow_once');
            } else if (answer === 'a') {
              await client.resolvePermission(currentSession.id, event.data.requestId, 'allow_always');
            } else {
              // Optional note prompt for denial
              const note = await promptLine('Denial note (optional, Enter to skip): ');
              await client.resolvePermission(
                currentSession.id,
                event.data.requestId,
                'deny',
                note.trim() || undefined,
              );
            }

            rl.resume();
            break;
          }

          case 'session.status':
            if (event.data.status === 'idle') {
              isTurnRunning = false;
              rl.prompt();
            }
            break;

          case 'error':
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

    // 7. Slash Commands
    if (fullMessage.startsWith('/')) {
      const parts = fullMessage.trim().split(/\s+/);
      const cmd = parts[0].toLowerCase();
      const arg = parts.slice(1).join(' ');

      switch (cmd) {
        case '/help':
          console.log(theme.bold('\nAvailable Slash Commands:'));
          console.log(`  /help                 ${theme.muted('Show this help text')}`);
          console.log(`  /model <name>         ${theme.muted('Change model for this session')}`);
          console.log(`  /mode <plan|ask|auto-edit|yolo> ${theme.muted('Change execution mode')}`);
          console.log(`  /new                  ${theme.muted('Start a fresh session in the same folder')}`);
          console.log(`  /sessions             ${theme.muted('List all sessions')}`);
          console.log(`  /resume <id>          ${theme.muted('Switch to an existing session')}`);
          console.log(`  /undo [--force]       ${theme.muted('Undo the last file modification')}`);
          console.log(`  /diff                 ${theme.muted('Re-print the latest change diff')}`);
          console.log(`  /compact              ${theme.muted('Summarize and compact session history')}`);
          console.log(`  /ui                   ${theme.muted('Open Web UI in browser')}`);
          console.log(`  /rules                ${theme.muted('View and manage saved permissions')}`);
          console.log(`  /clear                ${theme.muted('Clear the screen and re-print header')}`);
          console.log(`  /exit                 ${theme.muted('Exit REPL (session is saved)\n')}`);
          rl.prompt();
          return;

        case '/model': {
          if (!arg) {
            console.log(theme.muted(`Current model: ${currentSession.model}`));
          } else {
            const updated = await client.updateSession(currentSession.id, { model: arg });
            currentSession = updated.session;
            console.log(theme.success(`Model updated to ${arg}`));
            printHeader();
          }
          rl.prompt();
          return;
        }

        case '/mode': {
          const modeVal = arg.toLowerCase() as SessionMode;
          if (!['plan', 'ask', 'auto-edit', 'yolo'].includes(modeVal)) {
            console.log(theme.warn("Valid modes: 'plan', 'ask', 'auto-edit', 'yolo'"));
            rl.prompt();
            return;
          }

          if (modeVal === 'yolo') {
            const confirm = await promptLine("Type 'yolo' to confirm unrestricted auto-execution mode: ");
            if (confirm.trim() !== 'yolo') {
              console.log(theme.muted('Mode change cancelled.'));
              rl.prompt();
              return;
            }
          }

          const updated = await client.updateSession(currentSession.id, { mode: modeVal });
          currentSession = updated.session;
          console.log(theme.success(`Mode changed to ${theme.mode(modeVal)}`));
          printHeader();
          rl.prompt();
          return;
        }

        case '/new': {
          const res = await client.createSession({
            workspace: currentSession.workspace_path,
            mode: currentSession.mode,
            model: currentSession.model,
            title: `CLI Session: ${basename(currentSession.workspace_path)}`,
          });
          currentSession = res.session;
          connectStream();
          console.log(theme.success(`Started new session ${currentSession.id}`));
          printHeader();
          rl.prompt();
          return;
        }

        case '/sessions': {
          const { sessions } = await client.listSessions();
          for (const sess of sessions.slice(0, 10)) {
            const marker = sess.id === currentSession.id ? theme.primary('*') : ' ';
            console.log(`${marker} ${sess.id.slice(0, 16)}  ${theme.mode(sess.mode).padEnd(12)}  ${sess.title}`);
          }
          console.log();
          rl.prompt();
          return;
        }

        case '/resume': {
          if (!arg) {
            console.log(theme.warn('Usage: /resume <session-id>'));
            rl.prompt();
            return;
          }
          try {
            const res = await client.getSession(arg.trim());
            currentSession = res.session;
            connectStream();
            console.log(theme.success(`Switched to session ${currentSession.id}`));
            printHeader();
          } catch (err: any) {
            console.error(theme.fail(`Could not switch session: ${err.message}`));
          }
          rl.prompt();
          return;
        }

        case '/undo': {
          const force = arg.includes('--force');
          const { changes } = await client.listChanges(currentSession.id);
          if (changes.length === 0) {
            console.log(theme.muted('No changes recorded in this session to undo.'));
          } else {
            const latest = changes[0];
            try {
              const res = await client.undoChange(currentSession.id, latest.tool_run_id, force);
              console.log(theme.success(`Restored file '${res.restoredPath}'.`));
            } catch (err: any) {
              console.error(theme.fail(`Undo failed: ${err.message}`));
            }
          }
          rl.prompt();
          return;
        }

        case '/diff': {
          const { changes } = await client.listChanges(currentSession.id);
          if (changes.length === 0) {
            console.log(theme.muted('No diffs available for this session.'));
          } else {
            console.log(theme.bold(`\nLatest change (${changes[0].path}):`));
            renderer.renderDiff(changes[0].diff_unified);
            console.log();
          }
          rl.prompt();
          return;
        }

        case '/compact': {
          console.log(theme.muted('Compacting session context...'));
          try {
            const res = await client.compactSession(currentSession.id);
            console.log(theme.success(`Compacted: ${res.droppedMessages || 0} messages summarized.`));
          } catch (err: any) {
            console.error(theme.fail(`Compaction failed: ${err.message}`));
          }
          rl.prompt();
          return;
        }

        case '/ui': {
          await uiCommand({ home: options.home });
          rl.prompt();
          return;
        }

        case '/rules': {
          const { rules } = await client.listRules();
          if (rules.length === 0) {
            console.log(theme.muted('No saved "allow_always" permission rules.'));
          } else {
            console.log(theme.bold('\nSaved Rules:'));
            for (let i = 0; i < rules.length; i++) {
              console.log(`[${i + 1}] ${rules[i].tool}: ${rules[i].pattern}`);
            }
            console.log();
          }
          rl.prompt();
          return;
        }

        case '/clear': {
          console.clear();
          printHeader();
          rl.prompt();
          return;
        }

        case '/exit': {
          if (activeUnsubscribe) activeUnsubscribe();
          rl.close();
          process.exit(0);
          return;
        }

        default:
          console.log(theme.warn(`Unknown slash command '${cmd}'. Type /help for available commands.`));
          rl.prompt();
          return;
      }
    }

    // 8. Send User Prompt Turn
    isTurnRunning = true;
    try {
      await client.sendMessage(currentSession.id, fullMessage);
    } catch (err: any) {
      console.error(theme.fail(`Failed to send message: ${err.message}`));
      isTurnRunning = false;
      rl.prompt();
    }
  });

  // 9. Handle SIGINT (Ctrl-C)
  rl.on('SIGINT', async () => {
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
      const char = buffer.toString().toLowerCase();
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
