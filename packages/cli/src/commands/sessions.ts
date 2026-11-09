import { TendrilClient } from '../client.js';
import { theme } from '../ui/theme.js';
import { startRepl } from '../repl.js';

export interface SessionsOptions {
  home?: string;
  workspace?: string;
}

export async function listSessionsCommand(options: SessionsOptions = {}): Promise<void> {
  const client = new TendrilClient({ customHome: options.home });
  await client.ensureDaemon(true);

  const { sessions } = await client.listSessions(options.workspace);

  if (!sessions || sessions.length === 0) {
    console.log(theme.muted('No sessions found. Start a new session with `tendril`.'));
    return;
  }

  console.log(theme.bold('\nRecent Sessions:'));
  console.log(
    theme.muted(
      `${'ID'.padEnd(20)} ${'MODE'.padEnd(12)} ${'STATUS'.padEnd(14)} ${'MODEL'.padEnd(22)} TITLE`,
    ),
  );
  console.log(theme.muted('─'.repeat(80)));

  for (const s of sessions) {
    const id = s.id.slice(0, 18).padEnd(20);
    const mode = theme.mode(s.mode).padEnd(12);
    const status = (s.status || 'idle').padEnd(14);
    const model = (s.model || '').slice(0, 20).padEnd(22);
    const title = s.title || 'Untitled';

    console.log(`${id} ${mode} ${status} ${model} ${title}`);
  }
  console.log();
}

export async function deleteSessionCommand(id: string, options: SessionsOptions = {}): Promise<void> {
  const client = new TendrilClient({ customHome: options.home });
  await client.ensureDaemon(true);

  await client.deleteSession(id);
  console.log(theme.success(`Deleted session '${id}'.`));
}

export async function renameSessionCommand(
  id: string,
  newTitle: string,
  options: SessionsOptions = {},
): Promise<void> {
  const client = new TendrilClient({ customHome: options.home });
  await client.ensureDaemon(true);

  await client.updateSession(id, { title: newTitle });
  console.log(theme.success(`Renamed session '${id}' to "${newTitle}".`));
}

export async function resumeCommand(idArg: string | undefined, options: SessionsOptions = {}): Promise<void> {
  const client = new TendrilClient({ customHome: options.home });
  await client.ensureDaemon(true);

  let sessionId = idArg ? idArg.trim() : '';

  if (!sessionId) {
    // List recent sessions to choose from
    const { sessions } = await client.listSessions();
    if (!sessions || sessions.length === 0) {
      console.log(theme.muted('No existing sessions to resume. Starting a fresh session...'));
      await startRepl({ home: options.home });
      return;
    }

    sessionId = sessions[0].id;
  }

  await startRepl({
    sessionId,
    home: options.home,
  });
}
