/** Synthetic databases only. A malformed saved identity is never opened. */
export function engineeringDatabaseIdentity(storage: Pick<Storage, "getItem" | "setItem">, createId: () => string, previousSession: string | null = null): string {
 const key = 'mulazama-engineering-db-06l3';
 const valid = (value: string | null): value is string => !!value && /^mulazama-engineering-06l3-[a-f0-9-]{36}$/.test(value);
 const saved = storage.getItem(key);
 if (valid(saved)) return saved;
 const name = valid(previousSession) ? previousSession : 'mulazama-engineering-06l3-' + createId();
 if (!valid(name)) throw Error('INVALID_ENGINEERING_DATABASE_IDENTITY');
 storage.setItem(key, name);
 return name;
}
