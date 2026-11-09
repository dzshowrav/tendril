import { randomBytes, createHash } from 'node:crypto';
import { DatabaseStore, WebClientRow, createId } from '@tendril/core';

export const PAIRING_CODE_TTL_MS = 5 * 60 * 1000; // 5 minutes
export const MAX_FAILED_ATTEMPTS = 5;
export const LOCKOUT_DURATION_MS = 60 * 1000; // 60 seconds

export interface PairingCodeEntry {
  code: string;
  expiresAt: number;
}

export interface PairResult {
  token: string;
  client: WebClientRow;
}

export class PairingManager {
  private activeCodes = new Map<string, PairingCodeEntry>();
  private failedAttempts = 0;
  private lockedUntil = 0;

  constructor(private db: DatabaseStore) {}

  /**
   * Generates a new 6-digit one-time pairing code valid for 5 minutes.
   */
  public createPairingCode(): { code: string; expiresAt: string } {
    // Generate 6-digit numeric or alphanumeric code
    const num = Math.floor(100000 + Math.random() * 900000);
    const code = String(num);
    const expiresAtMs = Date.now() + PAIRING_CODE_TTL_MS;

    this.activeCodes.set(code, {
      code,
      expiresAt: expiresAtMs,
    });

    // Auto cleanup after expiry
    setTimeout(() => {
      this.activeCodes.delete(code);
    }, PAIRING_CODE_TTL_MS + 1000);

    return {
      code,
      expiresAt: new Date(expiresAtMs).toISOString(),
    };
  }

  /**
   * Consumes a pairing code, enforces rate-limiting / lockout, and creates a web_clients session.
   */
  public exchangeCode(code: string, label: string, userAgent?: string): PairResult {
    const now = Date.now();

    // Check lockout
    if (now < this.lockedUntil) {
      const remainingSeconds = Math.ceil((this.lockedUntil - now) / 1000);
      throw new Error(
        `RATE_LIMIT: Too many failed pairing attempts. Locked for ${remainingSeconds} seconds.`,
      );
    }

    const entry = this.activeCodes.get(code);

    if (!entry || now > entry.expiresAt) {
      this.failedAttempts++;

      if (this.failedAttempts >= MAX_FAILED_ATTEMPTS) {
        this.lockedUntil = now + LOCKOUT_DURATION_MS;
        this.failedAttempts = 0;
        throw new Error('RATE_LIMIT: 5 failed pairing attempts. Locked for 60 seconds.');
      }

      throw new Error('INVALID_CODE: Invalid or expired pairing code.');
    }

    // Success! Consume code immediately (single use)
    this.activeCodes.delete(code);
    this.failedAttempts = 0;
    this.lockedUntil = 0;

    // Generate 32-byte cryptographically secure session cookie token
    const token = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(token).digest('hex');

    const client = this.db.createWebClient({
      id: createId(),
      token_hash: tokenHash,
      label: label.trim() || 'Web Client',
      user_agent: userAgent ? userAgent.slice(0, 200) : null,
    });

    return {
      token,
      client,
    };
  }

  /**
   * Checks if pairing is currently locked out.
   */
  public isLocked(): boolean {
    return Date.now() < this.lockedUntil;
  }

  /**
   * Cleans up all pairing state.
   */
  public clear(): void {
    this.activeCodes.clear();
    this.failedAttempts = 0;
    this.lockedUntil = 0;
  }
}
