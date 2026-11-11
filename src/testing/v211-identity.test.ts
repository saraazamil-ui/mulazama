import { describe, expect, it } from 'vitest';
import { v211DatabaseIdentity } from './v211-identity';

describe('V2.1.1 preview database identity', () => {
  const id = '12345678-1234-1234-1234-123456789abc';
  it('keeps the database after a browser session ends', () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    const name = v211DatabaseIdentity(storage, () => id);
    expect(v211DatabaseIdentity(storage, () => { throw Error('must reuse'); })).toBe(name);
  });
  it('never opens an injected legacy or production database', () => {
    let saved = 'mulazama-production';
    expect(v211DatabaseIdentity({ getItem: () => saved, setItem: (_key, value) => { saved = value; } }, () => id)).toBe('mulazama-v211-synthetic-' + id);
  });
});
