import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, unlinkSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { createTwoFilesPatch } from 'diff';
import { DatabaseStore, SnapshotRow } from '../store.js';
import { WorkspaceGuard } from '../workspace.js';
import { ReadTracker } from '../read-tracker.js';

export const MAX_SNAPSHOT_FILE_SIZE = 1024 * 1024; // 1 MB cap

/**
 * Checks if a buffer contains binary data (NULL byte in first 8KB).
 */
export function isBinaryBuffer(buf: Buffer | Uint8Array): boolean {
  const checkLen = Math.min(buf.length, 8192);
  for (let i = 0; i < checkLen; i++) {
    if (buf[i] === 0x00) return true;
  }
  return false;
}

/**
 * Counts added and removed lines from a unified diff patch string.
 */
export function countDiffLines(patch: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  const lines = patch.split('\n');
  for (const line of lines) {
    if (line.startsWith('+') && !line.startsWith('+++')) {
      added++;
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      removed++;
    }
  }
  return { added, removed };
}

export interface CreateSnapshotOptions {
  sessionId: string;
  toolRunId: string;
  relPath: string;
  absPath: string;
  oldContent: Buffer | null;
  newContentText: string;
  db: DatabaseStore;
}

/**
 * Creates a snapshot record in the database for a file edit or creation.
 */
export function createSnapshotRecord(options: CreateSnapshotOptions): SnapshotRow {
  const { sessionId, toolRunId, relPath, oldContent, newContentText, db } = options;
  const existedBefore = oldContent !== null ? 1 : 0;
  const newContentBuf = Buffer.from(newContentText, 'utf8');
  const sha256After = createHash('sha256').update(newContentBuf).digest('hex');
  const sha256Before = oldContent ? createHash('sha256').update(oldContent).digest('hex') : null;

  // Check 1: Size limit (> 1 MB)
  const isOldTooLarge = oldContent !== null && oldContent.length > MAX_SNAPSHOT_FILE_SIZE;
  const isNewTooLarge = newContentBuf.length > MAX_SNAPSHOT_FILE_SIZE;
  if (isOldTooLarge || isNewTooLarge) {
    return db.createSnapshot({
      session_id: sessionId,
      tool_run_id: toolRunId,
      path: relPath,
      existed_before: existedBefore,
      content_before: null,
      sha256_before: sha256Before,
      sha256_after: sha256After,
      diff_unified: '[diff omitted: file exceeds 1 MB limit]',
      added_lines: 0,
      removed_lines: 0,
      skipped_reason: 'too_large',
    });
  }

  // Check 2: Binary file
  const isOldBinary = oldContent !== null && isBinaryBuffer(oldContent);
  const isNewBinary = isBinaryBuffer(newContentBuf);
  if (isOldBinary || isNewBinary) {
    return db.createSnapshot({
      session_id: sessionId,
      tool_run_id: toolRunId,
      path: relPath,
      existed_before: existedBefore,
      content_before: null,
      sha256_before: sha256Before,
      sha256_after: sha256After,
      diff_unified: '[diff omitted: binary file]',
      added_lines: 0,
      removed_lines: 0,
      skipped_reason: 'binary',
    });
  }

  // Normal text snapshot
  const oldText = oldContent ? oldContent.toString('utf8') : '';
  const diffUnified = createTwoFilesPatch(
    existedBefore ? `a/${relPath}` : '/dev/null',
    `b/${relPath}`,
    oldText,
    newContentText,
    existedBefore ? 'before' : '',
    'after',
  );

  const { added, removed } = countDiffLines(diffUnified);

  return db.createSnapshot({
    session_id: sessionId,
    tool_run_id: toolRunId,
    path: relPath,
    existed_before: existedBefore,
    content_before: oldContent,
    sha256_before: sha256Before,
    sha256_after: sha256After,
    diff_unified: diffUnified,
    added_lines: added,
    removed_lines: removed,
  });
}

export interface UndoOptions {
  sessionId: string;
  snapshotId?: string;
  workspace: WorkspaceGuard;
  db: DatabaseStore;
  readTracker?: ReadTracker;
  force?: boolean;
}

export interface UndoResult {
  snapshotId: string;
  path: string;
  undone_at: string;
  action: 'deleted' | 'restored';
}

/**
 * Undoes a snapshot, restoring the previous file state or removing a created file.
 */
export function undoSnapshot(options: UndoOptions): UndoResult {
  const { sessionId, snapshotId, workspace, db, readTracker, force = false } = options;

  let snapshot: SnapshotRow | null = null;
  if (snapshotId) {
    snapshot = db.getSnapshot(snapshotId);
  } else {
    // Find latest non-undone snapshot for the session
    const stmt = db.db.prepare(
      'SELECT * FROM snapshots WHERE session_id = ? AND undone_at IS NULL ORDER BY created_at DESC LIMIT 1',
    );
    snapshot = (stmt.get(sessionId) as unknown as SnapshotRow) || null;
  }

  if (!snapshot) {
    throw new Error(`No undoable snapshot found for session '${sessionId}'`);
  }

  if (snapshot.undone_at !== null) {
    throw new Error(`Snapshot '${snapshot.id}' has already been undone`);
  }

  if (snapshot.skipped_reason !== null) {
    throw new Error(`Snapshot '${snapshot.id}' cannot be undone: skipped due to ${snapshot.skipped_reason}`);
  }

  const absPath = workspace.resolvePath(snapshot.path);
  const existsOnDisk = existsSync(absPath);

  if (existsOnDisk) {
    const currentBuf = readFileSync(absPath);
    const currentSha = createHash('sha256').update(currentBuf).digest('hex');
    if (currentSha !== snapshot.sha256_after && !force) {
      throw new Error(
        `File '${snapshot.path}' has been modified since snapshot was created (expected SHA-256: ${snapshot.sha256_after}, current: ${currentSha}). Use --force to overwrite.`,
      );
    }
  } else {
    if (snapshot.existed_before === 1 && !force) {
      throw new Error(`File '${snapshot.path}' no longer exists on disk. Use --force to recreate it.`);
    }
  }

  let action: 'deleted' | 'restored';

  if (snapshot.existed_before === 0) {
    // File was created by the agent -> delete it
    if (existsOnDisk) {
      unlinkSync(absPath);
    }
    action = 'deleted';
  } else {
    // File existed before -> restore old content
    if (!snapshot.content_before) {
      throw new Error(`Snapshot '${snapshot.id}' is missing content_before for restoration`);
    }
    const dir = dirname(absPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(absPath, snapshot.content_before);
    action = 'restored';

    if (readTracker) {
      const stat = statSync(absPath);
      readTracker.recordRead(sessionId, absPath, snapshot.sha256_before!, stat.mtimeMs);
    }
  }

  const undoneAt = new Date().toISOString();
  db.updateSnapshot(snapshot.id, { undone_at: undoneAt });

  return {
    snapshotId: snapshot.id,
    path: snapshot.path,
    undone_at: undoneAt,
    action,
  };
}
