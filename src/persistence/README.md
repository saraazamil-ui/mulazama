# Web event-store adapter

`IndexedDbEventStore.open()` selects the persistent browser implementation.
`MemoryEventStore` is an explicit reference/test dependency; no code silently
falls back to it when persistent storage fails.

The public interface is `load`, `append`, `replace`, `clear`, and `close` from
`src/core/types.ts`. Receipts resolve after a completed IndexedDB transaction.
Append performs compare-and-swap against the stream revision within the write
transaction. A byte-equivalent retry of an entire committed command is a no-op;
reusing its identifier for another batch is a conflict. Multiple event records
may belong to one command. Event identifiers and stream sequence numbers are
unique. There is no per-event edit or delete API.

Every key/event write requests `{durability:'strict'}` and checks the browser's
reported transaction durability. Browsers that cannot provide that option fail
explicitly; they do not silently acknowledge a relaxed-durability write. This
is a browser API guarantee request, not a completed physical power-loss test.

Raw records are AES-256-GCM encrypted with random 96-bit nonces, 128-bit tags,
and authenticated event identifier/stream sequence metadata. The idempotency
index contains SHA-256 fingerprints rather than event plaintext. The generated
CryptoKey is non-extractable and stored as a browser-managed IndexedDB key.
This is **not an OS keystore** and does not protect against script execution in
the same origin, a compromised browser, deletion of browser data, or a person
with access to an unlocked browser profile. This adapter makes no claim about
native iOS/Android storage, secure deletion from storage-media journals, or
browser durable-storage grants. The browser may evict its data. Portable
encrypted backups remain necessary.

Schema version 2 supports one explicit structural migration from version 1:
`events(eventId)` contains `{eventId,sequence,event}` and `meta(key)` contains
`{key:'head',format:1,revision,nextSequence}`. Upgrade adds the command and key
stores, then encrypts the unchanged raw records in an atomic write guarded by
the original revision. No prototype LocalStorage data is silently imported.
Unknown future schema versions and malformed/corrupt records are rejected.
Corruption never triggers an automatic reset. A durable pending marker created
by the structural v1 upgrade permits resuming its exact supported encryption
migration after interruption. Encryption and marker removal commit atomically.
If encrypted rows remain but the data key is missing, opening fails and preserves
the rows. A new key is created only for an empty store or the explicitly supported
plaintext v1 migration; key loss is not treated as a new installation.

Phase 05-B upgrades the browser database to version 3. The encrypted row format
remains `aes-gcm-v1` (`head.format:2`); `head.commandIndexFormat:'utf16-v1'` versions
the derived command index independently. New hashes use deterministic UTF-16
ordering, never locale collation. A durable `migration-command-index` marker
guards the explicit v2 migration. It first authenticates raw rows and proves the
old locale-based index with the current collation. Only then does a CAS transaction
replace the index and marker, without rewriting ciphertext or advancing revision.
Unproven collation outside the baseline lowercase-UUID domain fails as `INDEX_MIGRATION_REVIEW_REQUIRED` and preserves
the rows for a documented shadow review. It never silently rebuilds an unproven
index. The detailed review process is in `docs/05b/Persistence-Recovery-Report.md`.

Full restore is a single atomic clear-and-replace transaction: validation,
encryption, and memory allocation happen before the transaction, so failures
leave the live dataset untouched. A failed database write aborts both event
and index changes. No restore merge is implemented. `clear` erases learning
records and indexes with revision protection; the device encryption key remains
without learning ciphertext. Application services own the new local identity,
preserved user preferences, and notification cancellation after deletion.

Verification in Phase 05-B: **33 unit tests passed** for the reference
store, shared envelope validation, deterministic ordering, and pure migration
decisions. Twenty-one real IndexedDB checks are implemented across
`browser-tests.ts` and `browser-tests05b.ts`, covering reopen, idempotency, concurrency, authenticated
encryption, transaction rollback, replacement, corruption, migration, version
compatibility, and deletion. They were **not executed successfully** here:
loopback binding failed with `EPERM`, and headless Chrome aborted while starting
under the execution sandbox. To run on a supported Vite/Chrome environment:

```js
const checks = await page.evaluate(async () => {
  const qa = await import('/src/persistence/browser-tests05b.ts');
  return qa.runPersistence05BChecks();
});
```

This file is an engineering QA module; the product entrypoint never imports it.
Browser verification and native adapters remain acceptance gates.
