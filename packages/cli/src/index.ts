import { cac } from 'cac';
import pc from 'picocolors';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VERSION, APP_NAME, runDoctor } from '@tendril/core';

export function createCli() {
  const cli = cac(APP_NAME);

  cli
    .command('doctor', 'Check environment, Node version, and SQLite support')
    .action(async () => {
      console.log(pc.bold(`\n${pc.cyan('Tendril')} Doctor (v${VERSION})\n`));
      const result = await runDoctor();

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

  // If no args provided, show help
  if (argv.length <= 2) {
    cli.outputHelp();
    return;
  }

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
    const isMain = resolve(process.argv[1]) === fileURLToPath(import.meta.url);
    if (isMain) {
      runCli();
    }
  } catch {
    // Ignore resolution errors if non-file
  }
}
