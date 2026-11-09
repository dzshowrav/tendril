import { cac } from 'cac';
import pc from 'picocolors';
import { resolve } from 'node:path';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { VERSION, APP_NAME, runDoctor } from '@tendril/core';
import { askCommand } from './commands/ask.js';
import { loginCommand } from './commands/login.js';
import { listSessionsCommand, deleteSessionCommand, renameSessionCommand, resumeCommand } from './commands/sessions.js';
import { pairCommand, uiCommand } from './commands/pair-ui.js';
import { serveCommand, stopCommand, statusCommand, logsCommand } from './commands/daemon.js';
import { startRepl } from './repl.js';

export function createCli() {
  const cli = cac(APP_NAME);

  // Default interactive REPL: `tendril [dir]`
  cli
    .command('[dir]', 'Start interactive REPL in the current or specified directory')
    .option('--mode <mode>', 'Session mode (plan, ask, auto-edit, yolo)')
    .option('--model <model>', 'Model name override')
    .option('--home <path>', 'Custom TENDRIL_HOME directory')
    .action(async (dir, options) => {
      await startRepl({
        workspace: dir,
        mode: options.mode,
        model: options.model,
        home: options.home,
      });
    });

  // `tendril ask <prompt>`
  cli
    .command('ask [prompt]', 'Run a single turn non-interactively and stream response')
    .option('--mode <mode>', 'Session mode (plan, ask, auto-edit, yolo)', { default: 'ask' })
    .option('--model <model>', 'Model name override')
    .option('--json', 'Output newline-delimited JSON events stream')
    .option('--dir <path>', 'Workspace directory')
    .option('--home <path>', 'Custom TENDRIL_HOME directory')
    .action(async (prompt, options) => {
      await askCommand(prompt, options);
    });

  // `tendril login`
  cli
    .command('login', 'Configure model provider credentials')
    .option('--home <path>', 'Custom TENDRIL_HOME directory')
    .action(async (options) => {
      await loginCommand(options);
    });

  // `tendril sessions`
  cli
    .command('sessions [subcommand] [id] [extra]', 'List or manage active sessions')
    .option('--workspace <path>', 'Filter by workspace path')
    .option('--home <path>', 'Custom TENDRIL_HOME directory')
    .action(async (subcommand, id, extra, options) => {
      if (subcommand === 'rm' || subcommand === 'delete') {
        if (!id) {
          console.error(pc.red('Error: Session ID is required for `tendril sessions rm <id>`'));
          process.exitCode = 1;
          return;
        }
        await deleteSessionCommand(id, options);
      } else if (subcommand === 'rename') {
        if (!id || !extra) {
          console.error(pc.red('Error: Usage: `tendril sessions rename <id> <new_title>`'));
          process.exitCode = 1;
          return;
        }
        await renameSessionCommand(id, extra, options);
      } else {
        await listSessionsCommand(options);
      }
    });

  // `tendril resume [id]`
  cli
    .command('resume [id]', 'Resume an existing session in interactive REPL')
    .option('--home <path>', 'Custom TENDRIL_HOME directory')
    .action(async (id, options) => {
      await resumeCommand(id, options);
    });

  // `tendril pair`
  cli
    .command('pair', 'Generate a one-time pairing code for web clients')
    .option('--json', 'Output machine-readable JSON {url, code, port}')
    .option('--home <path>', 'Custom TENDRIL_HOME directory')
    .action(async (options) => {
      await pairCommand(options);
    });

  // `tendril ui`
  cli
    .command('ui', 'Pair and open the Tendril Web UI in browser')
    .option('--home <path>', 'Custom TENDRIL_HOME directory')
    .action(async (options) => {
      await uiCommand(options);
    });

  // `tendril serve`
  cli
    .command('serve', 'Start the Tendril background daemon')
    .option('--detach', 'Run daemon detached in background')
    .option('--port <port>', 'Custom port (default: 7421)', { type: [Number] })
    .option('--home <path>', 'Custom TENDRIL_HOME directory')
    .action(async (options) => {
      await serveCommand(options);
    });

  // `tendril stop`
  cli
    .command('stop', 'Stop the running Tendril daemon')
    .option('--home <path>', 'Custom TENDRIL_HOME directory')
    .action(async (options) => {
      await stopCommand(options);
    });

  // `tendril status`
  cli
    .command('status', 'Show status of the Tendril daemon')
    .option('--home <path>', 'Custom TENDRIL_HOME directory')
    .action(async (options) => {
      await statusCommand(options);
    });

  // `tendril logs`
  cli
    .command('logs', 'View daemon output logs')
    .option('-f, --follow', 'Follow log output in real time')
    .option('-n, --lines <number>', 'Number of lines to show (default: 50)')
    .option('--home <path>', 'Custom TENDRIL_HOME directory')
    .action(async (options) => {
      await logsCommand(options);
    });

  // `tendril doctor`
  cli
    .command('doctor', 'Check environment, Node version, and SQLite support')
    .option('--json', 'Output results as JSON')
    .option('--home <path>', 'Custom TENDRIL_HOME directory')
    .action(async (options) => {
      const result = await runDoctor();

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        if (!result.ok) process.exitCode = 1;
        return;
      }

      console.log(pc.bold(`\n${pc.cyan('Tendril')} Doctor (v${VERSION})\n`));

      for (const check of result.checks) {
        let tag = '';
        if (check.status === 'PASS') {
          tag = pc.bgGreen(pc.black(' PASS '));
        } else if (check.status === 'WARN') {
          tag = pc.bgYellow(pc.black(' WARN '));
        } else {
          tag = pc.bgRed(pc.white(' FAIL '));
        }

        console.log(`${tag} ${pc.bold(check.name)}: ${check.message}`);
        if (check.fix && check.status !== 'PASS') {
          console.log(`       ${pc.dim('Fix:')} ${pc.yellow(check.fix)}`);
        }
      }

      console.log();
      if (!result.ok) {
        console.error(pc.red('Doctor found critical failures. Please resolve them before proceeding.\n'));
        process.exitCode = 1;
      } else {
        console.log(pc.green('All critical checks passed successfully.\n'));
      }
    });

  cli.version(VERSION);
  cli.help();

  return cli;
}

export async function runCli(argv = process.argv): Promise<void> {
  const cli = createCli();

  try {
    cli.parse(argv, { run: false });
    await cli.runMatchedCommand();
  } catch (error) {
    console.error(pc.red(`Error: ${(error as Error).message}`));
    process.exitCode = 1;
  }
}

// When executed directly as script
if (process.argv[1]) {
  try {
    const currentUrl = fileURLToPath(import.meta.url);
    const resolvedArgv = resolve(process.argv[1]);
    let realArgv = resolvedArgv;
    try {
      realArgv = realpathSync(process.argv[1]);
    } catch {
      // Ignore realpath error
    }

    const isMain =
      realArgv === currentUrl ||
      resolvedArgv === currentUrl ||
      process.argv[1].endsWith('tendril.mjs') ||
      process.argv[1].endsWith('/tendril');

    if (isMain) {
      runCli();
    }
  } catch {
    // Ignore resolution errors if non-file
  }
}
