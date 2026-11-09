import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import { createId } from './ids.js';

export const CURRENT_SCHEMA_VERSION = 1;

export type SessionMode = 'plan' | 'ask' | 'auto-edit' | 'yolo';
export type SessionStatus = 'idle' | 'running' | 'awaiting_permission' | 'interrupted' | 'error';

export interface SessionRow {
  id: string;
  title: string;
  workspace_path: string;
  provider_id: string;
  model: string;
  mode: SessionMode;
  status: SessionStatus;
  summary: string | null;
  summary_upto_seq: number | null;
  input_tokens: number;
  output_tokens: number;
  context_tokens: number;
  next_event_seq: number;
  created_at: string;
  updated_at: string;
}

export type MessageRole = 'user' | 'assistant';
export type MessageOrigin = 'cli' | 'web' | 'system';

export interface MessageRow {
  id: string;
  session_id: string;
  seq: number;
  role: MessageRole;
  content_json: string;
  origin: MessageOrigin;
  stop_reason: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  created_at: string;
}

export type ToolClass = 'read' | 'edit' | 'exec' | 'net' | 'system';
export type ToolRunStatus = 'pending' | 'awaiting_permission' | 'running' | 'ok' | 'error' | 'denied' | 'aborted';
export type ToolDecision =
  | 'allow_once'
  | 'allow_always'
  | 'deny'
  | 'auto_mode'
  | 'auto_rule'
  | 'blocked_guard'
  | 'blocked_path'
  | null;

export interface ToolRunRow {
  id: string;
  session_id: string;
  message_id: string;
  tool_use_id: string;
  name: string;
  class: ToolClass;
  input_json: string;
  status: ToolRunStatus;
  decision: ToolDecision;
  decided_by: string | null;
  decision_note: string | null;
  result_preview: string | null;
  exit_code: number | null;
  duration_ms: number | null;
  created_at: string;
  finished_at: string | null;
}

export interface SnapshotRow {
  id: string;
  session_id: string;
  tool_run_id: string;
  path: string;
  existed_before: number; // 0 | 1
  content_before: Uint8Array | null;
  sha256_before: string | null;
  sha256_after: string;
  diff_unified: string;
  added_lines: number;
  removed_lines: number;
  skipped_reason: 'too_large' | 'binary' | null;
  undone_at: string | null;
  created_at: string;
}

export interface PermissionRuleRow {
  id: string;
  workspace_path: string;
  tool: string;
  pattern: string;
  decision: 'allow' | 'deny';
  created_at: string;
}

export interface WebClientRow {
  id: string;
  token_hash: string;
  label: string;
  user_agent: string | null;
  created_at: string;
  last_seen_at: string;
  revoked_at: string | null;
}

export const MIGRATIONS: Record<number, string> = {
  1: `
    CREATE TABLE schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );

    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT 'New session',
      workspace_path TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      model TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'ask' CHECK (mode IN ('plan','ask','auto-edit','yolo')),
      status TEXT NOT NULL DEFAULT 'idle' CHECK (status IN ('idle','running','awaiting_permission','interrupted','error')),
      summary TEXT,
      summary_upto_seq INTEGER,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      context_tokens INTEGER NOT NULL DEFAULT 0,
      next_event_seq INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX idx_sessions_workspace ON sessions(workspace_path, updated_at DESC);
    CREATE INDEX idx_sessions_updated ON sessions(updated_at DESC);

    CREATE TABLE messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      seq INTEGER NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('user','assistant')),
      content_json TEXT NOT NULL,
      origin TEXT NOT NULL DEFAULT 'cli' CHECK (origin IN ('cli','web','system')),
      stop_reason TEXT,
      input_tokens INTEGER,
      output_tokens INTEGER,
      created_at TEXT NOT NULL,
      UNIQUE (session_id, seq)
    );

    CREATE TABLE tool_runs (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      tool_use_id TEXT NOT NULL,
      name TEXT NOT NULL,
      class TEXT NOT NULL CHECK (class IN ('read','edit','exec','net','system')),
      input_json TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending','awaiting_permission','running','ok','error','denied','aborted')),
      decision TEXT CHECK (decision IN ('allow_once','allow_always','deny','auto_mode','auto_rule','blocked_guard','blocked_path')),
      decided_by TEXT,
      decision_note TEXT,
      result_preview TEXT,
      exit_code INTEGER,
      duration_ms INTEGER,
      created_at TEXT NOT NULL,
      finished_at TEXT
    );
    CREATE INDEX idx_tool_runs_session ON tool_runs(session_id, created_at);

    CREATE TABLE snapshots (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      tool_run_id TEXT NOT NULL UNIQUE REFERENCES tool_runs(id) ON DELETE CASCADE,
      path TEXT NOT NULL,
      existed_before INTEGER NOT NULL CHECK (existed_before IN (0,1)),
      content_before BLOB,
      sha256_before TEXT,
      sha256_after TEXT NOT NULL,
      diff_unified TEXT NOT NULL,
      added_lines INTEGER NOT NULL,
      removed_lines INTEGER NOT NULL,
      skipped_reason TEXT CHECK (skipped_reason IN ('too_large','binary')),
      undone_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX idx_snapshots_session ON snapshots(session_id, created_at DESC);

    CREATE TABLE permission_rules (
      id TEXT PRIMARY KEY,
      workspace_path TEXT NOT NULL,
      tool TEXT NOT NULL,
      pattern TEXT NOT NULL,
      decision TEXT NOT NULL DEFAULT 'allow' CHECK (decision IN ('allow','deny')),
      created_at TEXT NOT NULL,
      UNIQUE (workspace_path, tool, pattern)
    );

    CREATE TABLE web_clients (
      id TEXT PRIMARY KEY,
      token_hash TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL,
      user_agent TEXT,
      created_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      revoked_at TEXT
    );
  `,
};

export class DatabaseStore {
  public db: DatabaseSync;
  public readonly dbPath: string;

  constructor(dbPath: string = ':memory:') {
    this.dbPath = dbPath;

    if (dbPath !== ':memory:') {
      const dir = dirname(dbPath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true, mode: 0o700 });
      }
    }

    this.db = new DatabaseSync(dbPath);

    // Run connection pragmas
    if (dbPath !== ':memory:') {
      this.db.exec('PRAGMA journal_mode = WAL;');
      try {
        chmodSync(dbPath, 0o600);
      } catch {
        // Ignore chmod errors
      }
    }

    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec('PRAGMA busy_timeout = 5000;');

    this.runMigrations();
  }

  public runMigrations(): void {
    const tableExists = this.db
      .prepare("SELECT count(*) as count FROM sqlite_master WHERE type='table' AND name='schema_migrations'")
      .get() as { count: number };

    let currentVersion = 0;
    if (tableExists.count > 0) {
      const row = this.db.prepare('SELECT MAX(version) as max_version FROM schema_migrations').get() as {
        max_version: number | null;
      };
      if (row && row.max_version !== null) {
        currentVersion = row.max_version;
      }
    }

    if (currentVersion > CURRENT_SCHEMA_VERSION) {
      throw new Error(
        `Database schema version (${currentVersion}) is newer than application version (${CURRENT_SCHEMA_VERSION})`,
      );
    }

    for (let v = currentVersion + 1; v <= CURRENT_SCHEMA_VERSION; v++) {
      const sql = MIGRATIONS[v];
      if (sql) {
        this.db.exec('BEGIN TRANSACTION;');
        try {
          this.db.exec(sql);
          this.db
            .prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?);')
            .run(v, new Date().toISOString());
          this.db.exec('COMMIT;');
        } catch (err) {
          this.db.exec('ROLLBACK;');
          throw err;
        }
      }
    }

    if (this.dbPath !== ':memory:') {
      try {
        chmodSync(this.dbPath, 0o600);
      } catch {}
    }
  }

  public close(): void {
    this.db.close();
  }

  // ==========================================
  // Sessions Repository
  // ==========================================

  public createSession(input: {
    id?: string;
    title?: string;
    workspace_path: string;
    provider_id: string;
    model: string;
    mode?: SessionMode;
    status?: SessionStatus;
    summary?: string | null;
    summary_upto_seq?: number | null;
    input_tokens?: number;
    output_tokens?: number;
    context_tokens?: number;
    next_event_seq?: number;
    created_at?: string;
    updated_at?: string;
  }): SessionRow {
    const now = new Date().toISOString();
    const id = input.id || createId();
    const row: SessionRow = {
      id,
      title: input.title ?? 'New session',
      workspace_path: input.workspace_path,
      provider_id: input.provider_id,
      model: input.model,
      mode: input.mode ?? 'ask',
      status: input.status ?? 'idle',
      summary: input.summary ?? null,
      summary_upto_seq: input.summary_upto_seq ?? null,
      input_tokens: input.input_tokens ?? 0,
      output_tokens: input.output_tokens ?? 0,
      context_tokens: input.context_tokens ?? 0,
      next_event_seq: input.next_event_seq ?? 1,
      created_at: input.created_at ?? now,
      updated_at: input.updated_at ?? now,
    };

    const stmt = this.db.prepare(`
      INSERT INTO sessions (
        id, title, workspace_path, provider_id, model, mode, status,
        summary, summary_upto_seq, input_tokens, output_tokens,
        context_tokens, next_event_seq, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      row.id,
      row.title,
      row.workspace_path,
      row.provider_id,
      row.model,
      row.mode,
      row.status,
      row.summary,
      row.summary_upto_seq,
      row.input_tokens,
      row.output_tokens,
      row.context_tokens,
      row.next_event_seq,
      row.created_at,
      row.updated_at,
    );

    return row;
  }

  public getSession(id: string): SessionRow | null {
    const stmt = this.db.prepare('SELECT * FROM sessions WHERE id = ?');
    const result = stmt.get(id);
    return (result as unknown as SessionRow) || null;
  }

  public updateSession(id: string, updates: Partial<Omit<SessionRow, 'id' | 'created_at'>>): SessionRow | null {
    const existing = this.getSession(id);
    if (!existing) return null;

    const updated = {
      ...existing,
      ...updates,
      updated_at: updates.updated_at ?? new Date().toISOString(),
    };

    const stmt = this.db.prepare(`
      UPDATE sessions SET
        title = ?, workspace_path = ?, provider_id = ?, model = ?,
        mode = ?, status = ?, summary = ?, summary_upto_seq = ?,
        input_tokens = ?, output_tokens = ?, context_tokens = ?,
        next_event_seq = ?, updated_at = ?
      WHERE id = ?
    `);

    stmt.run(
      updated.title,
      updated.workspace_path,
      updated.provider_id,
      updated.model,
      updated.mode,
      updated.status,
      updated.summary,
      updated.summary_upto_seq,
      updated.input_tokens,
      updated.output_tokens,
      updated.context_tokens,
      updated.next_event_seq,
      updated.updated_at,
      id,
    );

    return updated;
  }

  public listSessions(options?: { workspace_path?: string; limit?: number; cursor?: string }): SessionRow[] {
    const limit = options?.limit ?? 50;
    if (options?.workspace_path) {
      const stmt = this.db.prepare(
        'SELECT * FROM sessions WHERE workspace_path = ? ORDER BY updated_at DESC LIMIT ?',
      );
      return stmt.all(options.workspace_path, limit) as unknown as SessionRow[];
    }

    const stmt = this.db.prepare('SELECT * FROM sessions ORDER BY updated_at DESC LIMIT ?');
    return stmt.all(limit) as unknown as SessionRow[];
  }

  public deleteSession(id: string): boolean {
    const stmt = this.db.prepare('DELETE FROM sessions WHERE id = ?');
    const result = stmt.run(id);
    return result.changes > 0;
  }

  // ==========================================
  // Messages Repository
  // ==========================================

  public getNextMessageSeq(sessionId: string): number {
    const stmt = this.db.prepare('SELECT COALESCE(MAX(seq), 0) + 1 as next_seq FROM messages WHERE session_id = ?');
    const row = stmt.get(sessionId) as { next_seq: number };
    return row.next_seq;
  }

  public createMessage(input: {
    id?: string;
    session_id: string;
    seq?: number;
    role: MessageRole;
    content_json: string;
    origin?: MessageOrigin;
    stop_reason?: string | null;
    input_tokens?: number | null;
    output_tokens?: number | null;
    created_at?: string;
  }): MessageRow {
    const now = new Date().toISOString();
    const id = input.id || createId();
    const seq = input.seq ?? this.getNextMessageSeq(input.session_id);

    const row: MessageRow = {
      id,
      session_id: input.session_id,
      seq,
      role: input.role,
      content_json: input.content_json,
      origin: input.origin ?? 'cli',
      stop_reason: input.stop_reason ?? null,
      input_tokens: input.input_tokens ?? null,
      output_tokens: input.output_tokens ?? null,
      created_at: input.created_at ?? now,
    };

    const stmt = this.db.prepare(`
      INSERT INTO messages (
        id, session_id, seq, role, content_json, origin,
        stop_reason, input_tokens, output_tokens, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      row.id,
      row.session_id,
      row.seq,
      row.role,
      row.content_json,
      row.origin,
      row.stop_reason,
      row.input_tokens,
      row.output_tokens,
      row.created_at,
    );

    return row;
  }

  public getMessage(id: string): MessageRow | null {
    const stmt = this.db.prepare('SELECT * FROM messages WHERE id = ?');
    return (stmt.get(id) as unknown as MessageRow) || null;
  }

  public listMessages(sessionId: string): MessageRow[] {
    const stmt = this.db.prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY seq ASC');
    return stmt.all(sessionId) as unknown as MessageRow[];
  }

  // ==========================================
  // Tool Runs Repository
  // ==========================================

  public createToolRun(input: {
    id?: string;
    session_id: string;
    message_id: string;
    tool_use_id: string;
    name: string;
    class: ToolClass;
    input_json: string;
    status?: ToolRunStatus;
    decision?: ToolDecision;
    decided_by?: string | null;
    decision_note?: string | null;
    result_preview?: string | null;
    exit_code?: number | null;
    duration_ms?: number | null;
    created_at?: string;
    finished_at?: string | null;
  }): ToolRunRow {
    const now = new Date().toISOString();
    const id = input.id || createId();

    const row: ToolRunRow = {
      id,
      session_id: input.session_id,
      message_id: input.message_id,
      tool_use_id: input.tool_use_id,
      name: input.name,
      class: input.class,
      input_json: input.input_json,
      status: input.status ?? 'pending',
      decision: input.decision ?? null,
      decided_by: input.decided_by ?? null,
      decision_note: input.decision_note ?? null,
      result_preview: input.result_preview ?? null,
      exit_code: input.exit_code ?? null,
      duration_ms: input.duration_ms ?? null,
      created_at: input.created_at ?? now,
      finished_at: input.finished_at ?? null,
    };

    const stmt = this.db.prepare(`
      INSERT INTO tool_runs (
        id, session_id, message_id, tool_use_id, name, class,
        input_json, status, decision, decided_by, decision_note,
        result_preview, exit_code, duration_ms, created_at, finished_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      row.id,
      row.session_id,
      row.message_id,
      row.tool_use_id,
      row.name,
      row.class,
      row.input_json,
      row.status,
      row.decision,
      row.decided_by,
      row.decision_note,
      row.result_preview,
      row.exit_code,
      row.duration_ms,
      row.created_at,
      row.finished_at,
    );

    return row;
  }

  public getToolRun(id: string): ToolRunRow | null {
    const stmt = this.db.prepare('SELECT * FROM tool_runs WHERE id = ?');
    return (stmt.get(id) as unknown as ToolRunRow) || null;
  }

  public updateToolRun(id: string, updates: Partial<Omit<ToolRunRow, 'id' | 'created_at'>>): ToolRunRow | null {
    const existing = this.getToolRun(id);
    if (!existing) return null;

    const updated = { ...existing, ...updates };

    const stmt = this.db.prepare(`
      UPDATE tool_runs SET
        status = ?, decision = ?, decided_by = ?, decision_note = ?,
        result_preview = ?, exit_code = ?, duration_ms = ?, finished_at = ?
      WHERE id = ?
    `);

    stmt.run(
      updated.status,
      updated.decision,
      updated.decided_by,
      updated.decision_note,
      updated.result_preview,
      updated.exit_code,
      updated.duration_ms,
      updated.finished_at,
      id,
    );

    return updated;
  }

  public listToolRuns(sessionId: string): ToolRunRow[] {
    const stmt = this.db.prepare('SELECT * FROM tool_runs WHERE session_id = ? ORDER BY created_at ASC');
    return stmt.all(sessionId) as unknown as ToolRunRow[];
  }

  // ==========================================
  // Snapshots Repository
  // ==========================================

  public createSnapshot(input: {
    id?: string;
    session_id: string;
    tool_run_id: string;
    path: string;
    existed_before: number; // 0 | 1
    content_before?: Uint8Array | null;
    sha256_before?: string | null;
    sha256_after: string;
    diff_unified: string;
    added_lines: number;
    removed_lines: number;
    skipped_reason?: 'too_large' | 'binary' | null;
    undone_at?: string | null;
    created_at?: string;
  }): SnapshotRow {
    const now = new Date().toISOString();
    const id = input.id || createId();

    const row: SnapshotRow = {
      id,
      session_id: input.session_id,
      tool_run_id: input.tool_run_id,
      path: input.path,
      existed_before: input.existed_before,
      content_before: input.content_before ?? null,
      sha256_before: input.sha256_before ?? null,
      sha256_after: input.sha256_after,
      diff_unified: input.diff_unified,
      added_lines: input.added_lines,
      removed_lines: input.removed_lines,
      skipped_reason: input.skipped_reason ?? null,
      undone_at: input.undone_at ?? null,
      created_at: input.created_at ?? now,
    };

    const stmt = this.db.prepare(`
      INSERT INTO snapshots (
        id, session_id, tool_run_id, path, existed_before,
        content_before, sha256_before, sha256_after, diff_unified,
        added_lines, removed_lines, skipped_reason, undone_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      row.id,
      row.session_id,
      row.tool_run_id,
      row.path,
      row.existed_before,
      row.content_before,
      row.sha256_before,
      row.sha256_after,
      row.diff_unified,
      row.added_lines,
      row.removed_lines,
      row.skipped_reason,
      row.undone_at,
      row.created_at,
    );

    return row;
  }

  public getSnapshot(id: string): SnapshotRow | null {
    const stmt = this.db.prepare('SELECT * FROM snapshots WHERE id = ?');
    return (stmt.get(id) as unknown as SnapshotRow) || null;
  }

  public getSnapshotByToolRun(toolRunId: string): SnapshotRow | null {
    const stmt = this.db.prepare('SELECT * FROM snapshots WHERE tool_run_id = ?');
    return (stmt.get(toolRunId) as unknown as SnapshotRow) || null;
  }

  public listSnapshots(sessionId: string): SnapshotRow[] {
    const stmt = this.db.prepare('SELECT * FROM snapshots WHERE session_id = ? ORDER BY created_at DESC');
    return stmt.all(sessionId) as unknown as SnapshotRow[];
  }

  public updateSnapshot(id: string, updates: Partial<Omit<SnapshotRow, 'id' | 'created_at'>>): SnapshotRow | null {
    const existing = this.getSnapshot(id);
    if (!existing) return null;

    const updated = { ...existing, ...updates };

    const stmt = this.db.prepare(`
      UPDATE snapshots SET
        undone_at = ?
      WHERE id = ?
    `);

    stmt.run(updated.undone_at, id);
    return updated;
  }

  // ==========================================
  // Permission Rules Repository
  // ==========================================

  public createPermissionRule(input: {
    id?: string;
    workspace_path: string;
    tool: string;
    pattern: string;
    decision?: 'allow' | 'deny';
    created_at?: string;
  }): PermissionRuleRow {
    const now = new Date().toISOString();
    const id = input.id || createId();

    const row: PermissionRuleRow = {
      id,
      workspace_path: input.workspace_path,
      tool: input.tool,
      pattern: input.pattern,
      decision: input.decision ?? 'allow',
      created_at: input.created_at ?? now,
    };

    const stmt = this.db.prepare(`
      INSERT INTO permission_rules (id, workspace_path, tool, pattern, decision, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    stmt.run(row.id, row.workspace_path, row.tool, row.pattern, row.decision, row.created_at);
    return row;
  }

  public getPermissionRule(id: string): PermissionRuleRow | null {
    const stmt = this.db.prepare('SELECT * FROM permission_rules WHERE id = ?');
    return (stmt.get(id) as unknown as PermissionRuleRow) || null;
  }

  public findPermissionRule(workspacePath: string, tool: string, pattern: string): PermissionRuleRow | null {
    const stmt = this.db.prepare(
      'SELECT * FROM permission_rules WHERE workspace_path = ? AND tool = ? AND pattern = ?',
    );
    return (stmt.get(workspacePath, tool, pattern) as unknown as PermissionRuleRow) || null;
  }

  public listPermissionRules(workspacePath?: string): PermissionRuleRow[] {
    if (workspacePath) {
      const stmt = this.db.prepare('SELECT * FROM permission_rules WHERE workspace_path = ? ORDER BY created_at ASC');
      return stmt.all(workspacePath) as unknown as PermissionRuleRow[];
    }
    const stmt = this.db.prepare('SELECT * FROM permission_rules ORDER BY created_at ASC');
    return stmt.all() as unknown as PermissionRuleRow[];
  }

  public deletePermissionRule(id: string): boolean {
    const stmt = this.db.prepare('DELETE FROM permission_rules WHERE id = ?');
    const result = stmt.run(id);
    return result.changes > 0;
  }

  // ==========================================
  // Web Clients Repository
  // ==========================================

  public createWebClient(input: {
    id?: string;
    token_hash: string;
    label: string;
    user_agent?: string | null;
    created_at?: string;
    last_seen_at?: string;
    revoked_at?: string | null;
  }): WebClientRow {
    const now = new Date().toISOString();
    const id = input.id || createId();

    const row: WebClientRow = {
      id,
      token_hash: input.token_hash,
      label: input.label,
      user_agent: input.user_agent ?? null,
      created_at: input.created_at ?? now,
      last_seen_at: input.last_seen_at ?? now,
      revoked_at: input.revoked_at ?? null,
    };

    const stmt = this.db.prepare(`
      INSERT INTO web_clients (id, token_hash, label, user_agent, created_at, last_seen_at, revoked_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      row.id,
      row.token_hash,
      row.label,
      row.user_agent,
      row.created_at,
      row.last_seen_at,
      row.revoked_at,
    );

    return row;
  }

  public getWebClient(id: string): WebClientRow | null {
    const stmt = this.db.prepare('SELECT * FROM web_clients WHERE id = ?');
    return (stmt.get(id) as unknown as WebClientRow) || null;
  }

  public getWebClientByTokenHash(tokenHash: string): WebClientRow | null {
    const stmt = this.db.prepare('SELECT * FROM web_clients WHERE token_hash = ?');
    return (stmt.get(tokenHash) as unknown as WebClientRow) || null;
  }

  public updateWebClient(id: string, updates: Partial<Omit<WebClientRow, 'id' | 'created_at'>>): WebClientRow | null {
    const existing = this.getWebClient(id);
    if (!existing) return null;

    const updated = { ...existing, ...updates };

    const stmt = this.db.prepare(`
      UPDATE web_clients SET
        label = ?, user_agent = ?, last_seen_at = ?, revoked_at = ?
      WHERE id = ?
    `);

    stmt.run(updated.label, updated.user_agent, updated.last_seen_at, updated.revoked_at, id);
    return updated;
  }

  public listWebClients(): WebClientRow[] {
    const stmt = this.db.prepare('SELECT * FROM web_clients ORDER BY created_at DESC');
    return stmt.all() as unknown as WebClientRow[];
  }

  public revokeWebClient(id: string): boolean {
    const now = new Date().toISOString();
    const stmt = this.db.prepare('UPDATE web_clients SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL');
    const result = stmt.run(now, id);
    return result.changes > 0;
  }
}
