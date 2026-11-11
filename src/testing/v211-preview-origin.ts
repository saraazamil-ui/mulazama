/**
 * Boundary for the synthetic preview artifact only. The hosted origin is embedded
 * at build time from the selected private Site, never read from URL/storage flags.
 * Sites' owner-only access policy is the authentication boundary; this check does
 * not grant Quran access, open a production database, or authenticate a visitor.
 */
export function assertV211PreviewOrigin(input: {
  mode: string;
  currentOrigin: string;
  hostedOrigin?: string;
}): void {
  const reject = (): never => { throw Error('PRIVATE_PREVIEW_ONLY'); };
  if (input.mode !== 'test') reject();

  let hosted: URL | undefined;
  if (input.hostedOrigin) {
    try { hosted = new URL(input.hostedOrigin); }
    catch { reject(); }
    // Canonical origin equality also rejects explicit default ports, trailing
    // slashes, paths, credentials, query strings, fragments and Unicode aliases.
    if (!hosted || hosted.protocol !== 'https:' || hosted.origin !== input.hostedOrigin ||
        hosted.port !== '' || !hosted.hostname.endsWith('.chatgpt.site')) reject();
  }

  let current: URL;
  try { current = new URL(input.currentOrigin); }
  catch { return reject(); }
  if (current.origin !== input.currentOrigin) reject();
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(current.hostname) &&
    ['http:', 'https:'].includes(current.protocol);
  if (!loopback && (!hosted || current.origin !== hosted.origin)) reject();
}
