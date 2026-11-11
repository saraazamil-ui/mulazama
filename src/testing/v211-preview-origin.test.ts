import { describe, expect, it } from 'vitest';
import { assertV211PreviewOrigin } from './v211-preview-origin';

const hostedOrigin = 'https://mulazama-preview-05a.sara-a-zamil.chatgpt.site';
const check = (currentOrigin: string, configured: string | undefined = hostedOrigin, mode = 'test') =>
  assertV211PreviewOrigin({ mode, currentOrigin, hostedOrigin: configured });

describe('V2.1.1 private preview origin boundary', () => {
  it('accepts the exact selected private Site origin in the test artifact', () => {
    expect(() => check(hostedOrigin)).not.toThrow();
  });

  it('keeps local engineering previews available without hosted configuration', () => {
    for (const origin of ['http://127.0.0.1:4182', 'http://localhost:4181', 'http://[::1]:4182']) {
      expect(() => assertV211PreviewOrigin({ mode: 'test', currentOrigin: origin })).not.toThrow();
    }
  });

  it('rejects production mode even at the correct origin or localhost', () => {
    expect(() => check(hostedOrigin, hostedOrigin, 'production')).toThrow('PRIVATE_PREVIEW_ONLY');
    expect(() => check('http://localhost:4182', hostedOrigin, 'production')).toThrow('PRIVATE_PREVIEW_ONLY');
  });

  it('rejects every other origin, including the official domain and lookalikes', () => {
    for (const origin of [
      'https://mulazama.com', 'https://www.mulazama.com',
      'https://other.sara-a-zamil.chatgpt.site',
      'https://mulazama-preview-05a.sara-a-zamil.chatgpt.site.evil.example',
      'http://mulazama-preview-05a.sara-a-zamil.chatgpt.site',
      hostedOrigin + ':8443', 'http://localhost.evil.example', 'null',
    ]) expect(() => check(origin), origin).toThrow('PRIVATE_PREVIEW_ONLY');
    expect(() => assertV211PreviewOrigin({ mode: 'test', currentOrigin: hostedOrigin })).toThrow('PRIVATE_PREVIEW_ONLY');
  });

  it('rejects URL and storage-style unlock flags instead of treating them as origin configuration', () => {
    for (const configured of [
      hostedOrigin + '/v211.html', hostedOrigin + '/', hostedOrigin + '?private=true',
      hostedOrigin + '#approved', hostedOrigin + ':443', hostedOrigin + ':8443',
      'https://owner@mulazama-preview-05a.sara-a-zamil.chatgpt.site',
      'http://mulazama-preview-05a.sara-a-zamil.chatgpt.site',
      'https://mulazama.com', 'https://preview.mulazama.com',
      'https://chatgpt.site', 'https://example.com', 'true',
    ]) expect(() => check(hostedOrigin, configured), configured).toThrow('PRIVATE_PREVIEW_ONLY');
  });

  it('fails closed on malformed configuration even during a local preview', () => {
    expect(() => check('http://localhost:4182', 'not-a-url')).toThrow('PRIVATE_PREVIEW_ONLY');
    expect(() => check(hostedOrigin + '/?preview=1')).toThrow('PRIVATE_PREVIEW_ONLY');
  });
});
