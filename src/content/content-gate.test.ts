// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { canonical } from '../core/types';
import { ContentGate, contentApprovalPayload, contentHash, TRUSTED_CONTENT_AUTHORITIES,
  type ContentApproval, type ContentAuthority, type ContentPackage, type ContentToken } from './content-gate';

/** Synthetic non-Quran data exercises mechanics only; its ephemeral key is never a production trust anchor. */
async function fixture(): Promise<ContentPackage> {
  const tokens: ContentToken[] = [], texts: string[] = [], ayahs = new Map<number, number>();
  let offset = 0;
  for (let i = 0; i < 240; i++) {
    const text = `SYNTHETIC_TOKEN_${i}`, surah = Math.floor(i * 114 / 240) + 1;
    const ayah = (ayahs.get(surah) ?? 0) + 1; ayahs.set(surah, ayah);
    tokens.push({ surah, ayah, tokenIndex: 0, sourceStart: offset, sourceEnd: offset + text.length,
      page: Math.floor(i / 120) + 1, juz: Math.floor(i / 8) + 1, hizb: Math.floor(i / 4) + 1, rub: i + 1 });
    texts.push(text); offset += text.length + 1;
  }
  const text = texts.join(' '), fontBytes = new Uint8Array([83, 89, 78, 84, 72]);
  return { text, tokens, fontBytes, manifest: { schemaVersion: 1, product: 'MULAZAMA', editionId: 'synthetic-test-edition', contentVersion: 'fixture-1',
    riwaya: 'Hafs an Asim', tariq: null, script: 'SYNTHETIC-NON-QURAN', diacritics: 'test-only', verseNumbering: 'synthetic-index',
    tokenizationVersion: 'synthetic-1', layoutId: 'synthetic-layout', layoutVersion: '1',
    source: { name: 'SYNTHETIC TEST DATA', version: '1', url: 'https://example.invalid/test-fixture', licenseId: 'test-only', licenseNotice: 'Not Quran content', attribution: 'Synthetic automated fixture' },
    font: { name: 'SYNTHETIC-BYTES', version: '1', licenseNotice: 'test only' },
    totals: { surahs: 114, ayahs: 240, tokens: 240, pages: 2, juz: 30, hizb: 60, rub: 240 },
    hashes: { algorithm: 'SHA-256', text: await contentHash(text), mapping: await contentHash(canonical(tokens)), font: await contentHash(fontBytes) } } };
}
let pkg: ContentPackage, keypair: CryptoKeyPair, authority: ContentAuthority;
async function approval(candidate = pkg): Promise<ContentApproval> {
  const signed: Omit<ContentApproval, 'signature'> = { authorityId: authority.id, reviewer: 'Synthetic test reviewer', reviewedAt: '2026-11-05T10:00:00.000Z',
    manifestHash: await contentHash(canonical(candidate.manifest)), reviewed: ['text', 'riwaya', 'script', 'diacritics', 'numbering', 'segmentation', 'layout', 'license', 'font', 'boundaries'] };
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keypair.privateKey, new TextEncoder().encode(contentApprovalPayload(signed)));
  return { ...signed, signature: btoa(String.fromCharCode(...new Uint8Array(signature))) };
}
beforeAll(async () => {
  pkg = await fixture();
  keypair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  authority = { id: 'ephemeral-test-only', publicKey: await crypto.subtle.exportKey('jwk', keypair.publicKey) };
});
describe('C01 independently signed content release gate', () => {
  it('CG01 production defaults are closed and do not trust an approved boolean or self-signed upload', async () => {
    expect(TRUSTED_CONTENT_AUTHORITIES).toEqual([]);
    const gate = new ContentGate(); expect(gate.status()).toMatchObject({ available: false, quranText: null });
    await expect(gate.activate(pkg, { approved: true } as unknown as ContentApproval)).rejects.toMatchObject({ code: 'CONTENT_UNAVAILABLE' });
    await expect(gate.activate(pkg, await approval())).rejects.toMatchObject({ code: 'CONTENT_UNAVAILABLE' });
    expect(() => gate.assertAvailable()).toThrow();
  });
  it('CG02 verifies exact text, mapping and font hashes without changing source text', async () => {
    const gate = new ContentGate([authority]);
    expect(await gate.verifyCandidate(pkg)).toMatchObject({ tokenCount: 240 });
    for (const field of ['text', 'mapping', 'font'] as const) {
      const changed = structuredClone(pkg); changed.manifest.hashes[field] = '0'.repeat(64);
      await expect(gate.verifyCandidate(changed)).rejects.toMatchObject({ code: 'CONTENT_INTEGRITY_FAILURE' });
    }
    const changed = structuredClone(pkg); changed.text += 'x';
    await expect(gate.verifyCandidate(changed)).rejects.toMatchObject({ code: 'CONTENT_INTEGRITY_FAILURE' });
  });
  it('CG03 a trusted test signature opens only the signed edition and exact token spans', async () => {
    const gate = new ContentGate([authority]); await gate.activate(pkg, await approval());
    expect(gate.status()).toMatchObject({ status: 'approved', available: true, editionId: 'synthetic-test-edition' });
    expect(gate.resolve({ editionId: pkg.manifest.editionId, surah: 1, ayah: 1, fromToken: 0, toTokenExclusive: 1 })[0].text).toBe('SYNTHETIC_TOKEN_0');
    expect(() => gate.resolve({ editionId: 'different-edition', surah: 1, ayah: 1, fromToken: 0, toTokenExclusive: 1 })).toThrow();
    expect(() => gate.resolve({ editionId: pkg.manifest.editionId, surah: 1, ayah: 1, fromToken: 0, toTokenExclusive: 2 })).toThrow();
  });
  it('CG04 an invalid candidate never replaces the previously verified release', async () => {
    const gate = new ContentGate([authority]); await gate.activate(pkg, await approval()); const before = gate.status();
    const candidate = structuredClone(pkg); candidate.text += 'tampered';
    await expect(gate.activate(candidate, await approval())).rejects.toThrow(); expect(gate.status()).toEqual(before);
    const forged = await approval(); forged.signature = btoa('invalid-signature');
    await expect(gate.activate(pkg, forged)).rejects.toMatchObject({ code: 'CONTENT_INTEGRITY_FAILURE' }); expect(gate.status()).toEqual(before);
  });
  it('CG05 changing signed metadata or omitting scientific review dimensions fails closed', async () => {
    const gate = new ContentGate([authority]), signed = await approval();
    signed.reviewer = 'tampered-reviewer'; await expect(gate.activate(pkg, signed)).rejects.toMatchObject({ code: 'CONTENT_INTEGRITY_FAILURE' });
    const missing = await approval(); missing.reviewed = missing.reviewed.filter(x => x !== 'boundaries');
    await expect(gate.activate(pkg, missing)).rejects.toMatchObject({ code: 'CONTENT_UNAVAILABLE' });
  });
  it('CG06 map gaps, duplicate positions and missing source licensing are rejected', async () => {
    const gate = new ContentGate([authority]), invalid = structuredClone(pkg);
    invalid.tokens[1] = { ...invalid.tokens[0] }; invalid.manifest.hashes.mapping = await contentHash(canonical(invalid.tokens));
    await expect(gate.verifyCandidate(invalid)).rejects.toMatchObject({ code: 'CONTENT_INTEGRITY_FAILURE' });
    const missing = structuredClone(pkg); missing.manifest.source.licenseNotice = '';
    await expect(gate.verifyCandidate(missing)).rejects.toMatchObject({ code: 'CONTENT_UNAVAILABLE' });
  });
  it('CG07 callers cannot mutate activated data through input or returned metadata', async () => {
    const candidate = structuredClone(pkg), gate = new ContentGate([authority]); await gate.activate(candidate, await approval(candidate));
    candidate.text = 'changed'; const returned = gate.assertAvailable(); returned.hashes.text = '0'.repeat(64);
    expect(gate.assertAvailable().hashes.text).toBe(pkg.manifest.hashes.text);
    expect(gate.resolve({ editionId: pkg.manifest.editionId, surah: 1, ayah: 1, fromToken: 0, toTokenExclusive: 1 })[0].text).toBe('SYNTHETIC_TOKEN_0');
  });
});
