import { describe, expect, it } from 'vitest';
import {
  formatDiasporaId,
  InvalidDiasporaIdError,
  isValidDiasporaId,
  normalizeDiasporaId,
  parseDiasporaId,
} from '../src/index.ts';

describe('DiasporaId', () => {
  it('accepts valid IDs (from the reference validator spec)', () => {
    for (const id of [
      'alice@example.org',
      'bob@example.com:3000',
      'some_user.name-1@sub.domain.example.org',
      'alice@localhost',
      'alice@localhost:3000',
      'alice@127.0.0.1',
      'alice@127.0.0.1:3000',
      'alice@[2001:db8::1]',
      'alice@[2001:db8::1]:3000',
      'äüö@ëxample.org',
    ]) {
      expect(isValidDiasporaId(id), id).toBe(true);
    }
  });

  it('rejects invalid IDs', () => {
    for (const id of [
      '',
      'alice',
      '@example.org',
      'alice@',
      'Alice@example.org',
      'alice@Example.org',
      'alice@exam ple.org',
      'alice@example.org:port',
      'al;ice@example.org',
      `${'a'.repeat(250)}@example.org`,
    ]) {
      expect(isValidDiasporaId(id), id).toBe(false);
    }
    expect(isValidDiasporaId(42)).toBe(false);
  });

  it('normalises like the reference discovery code', () => {
    expect(normalizeDiasporaId('  acct:Alice@Example.ORG ')).toBe('alice@example.org');
  });

  it('parses into parts', () => {
    expect(parseDiasporaId('acct:Bob@Example.com:3000')).toEqual({
      username: 'bob',
      host: 'example.com:3000',
      hostname: 'example.com',
      port: 3000,
      id: 'bob@example.com:3000',
    });
    expect(parseDiasporaId('alice@example.org').port).toBeUndefined();
    expect(formatDiasporaId('Alice', 'example.org')).toBe('alice@example.org');
  });

  it('throws on malformed input', () => {
    expect(() => parseDiasporaId('not an id')).toThrow(InvalidDiasporaIdError);
  });
});
