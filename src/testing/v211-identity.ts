const KEY = 'mulazama-v211-synthetic-db';
const valid = (value: string | null): value is string =>
  !!value && /^mulazama-v211-synthetic-[a-f0-9-]{36}$/.test(value);

/** Identity only. This key cannot approve content, authenticate, or select a legacy database. */
export function v211DatabaseIdentity(storage: Pick<Storage, 'getItem' | 'setItem'>, createId = () => crypto.randomUUID()): string {
  const saved = storage.getItem(KEY);
  if (valid(saved)) return saved;
  const name = 'mulazama-v211-synthetic-' + createId();
  if (!valid(name)) throw Error('INVALID_SYNTHETIC_DATABASE_IDENTITY');
  storage.setItem(KEY, name);
  return name;
}
