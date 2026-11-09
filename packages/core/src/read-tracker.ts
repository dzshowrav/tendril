export interface ReadRecord {
  path: string;
  sha256: string;
  mtimeMs: number;
  readAt: string;
}

export class ReadTracker {
  private sessions = new Map<string, Map<string, ReadRecord>>();

  /**
   * Records that a file was read during a session, along with its content SHA-256 hash and modification time.
   */
  public recordRead(sessionId: string, filePath: string, sha256: string, mtimeMs: number): ReadRecord {
    let sessionMap = this.sessions.get(sessionId);
    if (!sessionMap) {
      sessionMap = new Map();
      this.sessions.set(sessionId, sessionMap);
    }

    const record: ReadRecord = {
      path: filePath,
      sha256,
      mtimeMs,
      readAt: new Date().toISOString(),
    };

    sessionMap.set(filePath, record);
    return record;
  }

  /**
   * Retrieves the read record for a file within a session, or null if not yet read.
   */
  public getRead(sessionId: string, filePath: string): ReadRecord | null {
    const sessionMap = this.sessions.get(sessionId);
    if (!sessionMap) return null;
    return sessionMap.get(filePath) || null;
  }

  /**
   * Checks whether a file has been read in the given session.
   */
  public hasRead(sessionId: string, filePath: string): boolean {
    return this.getRead(sessionId, filePath) !== null;
  }

  /**
   * Clears all tracked reads for a session.
   */
  public clearSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }
}
