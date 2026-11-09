import { randomBytes } from 'node:crypto';

const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CROCKFORD_MAP: Record<string, number> = {};
for (let i = 0; i < CROCKFORD_ALPHABET.length; i++) {
  CROCKFORD_MAP[CROCKFORD_ALPHABET[i]] = i;
}

/**
 * Encodes a 48-bit timestamp into 10 Crockford Base32 characters.
 */
function encodeTime(timeMs: number): string {
  let time = BigInt(timeMs);
  let result = '';
  for (let i = 9; i >= 0; i--) {
    const mod = Number(time % 32n);
    result = CROCKFORD_ALPHABET[mod] + result;
    time = time / 32n;
  }
  return result;
}

/**
 * Encodes 16 random characters using Crockford Base32.
 */
function encodeRandom(length = 16): string {
  const bytes = randomBytes(length);
  let result = '';
  for (let i = 0; i < length; i++) {
    result += CROCKFORD_ALPHABET[bytes[i] % 32];
  }
  return result;
}

/**
 * Creates a 26-character time-sortable ID (10 chars timestamp + 16 chars randomness).
 */
export function createId(timestampMs = Date.now()): string {
  return encodeTime(timestampMs) + encodeRandom(16);
}

/**
 * Extracts the timestamp (in milliseconds) from a 26-character ID.
 */
export function getTimestampFromId(id: string): number | null {
  if (typeof id !== 'string' || id.length !== 26) {
    return null;
  }
  const timePart = id.slice(0, 10).toUpperCase();
  let time = 0n;
  for (const char of timePart) {
    const val = CROCKFORD_MAP[char];
    if (val === undefined) return null;
    time = time * 32n + BigInt(val);
  }
  return Number(time);
}

/**
 * Validates whether a string is a valid 26-character Crockford Base32 ID.
 */
export function isValidId(id: string): boolean {
  if (typeof id !== 'string' || id.length !== 26) {
    return false;
  }
  const upper = id.toUpperCase();
  for (let i = 0; i < 26; i++) {
    if (CROCKFORD_MAP[upper[i]] === undefined) {
      return false;
    }
  }
  return true;
}
