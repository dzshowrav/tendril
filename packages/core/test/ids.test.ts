import { describe, it, expect } from 'vitest';
import { createId, getTimestampFromId, isValidId } from '../src/ids.js';

describe('ids module', () => {
  it('generates 26-character strings', () => {
    const id = createId();
    expect(id).toHaveLength(26);
    expect(isValidId(id)).toBe(true);
  });

  it('generates time-sortable identifiers', () => {
    const t1 = 1700000000000;
    const t2 = 1700000010000;

    const id1 = createId(t1);
    const id2 = createId(t2);

    expect(id1 < id2).toBe(true);
  });

  it('extracts timestamp accurately from ID', () => {
    const now = Date.now();
    const id = createId(now);
    const extracted = getTimestampFromId(id);

    expect(extracted).toBe(now);
  });

  it('validates IDs correctly', () => {
    const valid = createId();
    expect(isValidId(valid)).toBe(true);

    expect(isValidId('')).toBe(false);
    expect(isValidId('abc')).toBe(false);
    expect(isValidId('0123456789ABCDEFGHJKMNPQRS')).toBe(true);
    // 'I', 'L', 'O', 'U' are invalid in Crockford Base32
    expect(isValidId('0123456789ABCDEFGHIJKMNPQR')).toBe(false);
  });
});
