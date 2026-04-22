# Changelog

## 0.2.1

### Fixed

- **Transaction commit deletion bug** — deleting a document inside a transaction no longer writes `"null"` to the view file on disk. The commit path now correctly calls `viewStore.delete()` when buffered data is `null`, matching the non-transactional delete behavior.
- **Corrupted null file self-healing** — `ViewStore.loadAll()` and `ViewStore.loadOne()` now detect and delete view files containing `"null"` left by the previous bug, preventing `TypeError` crashes on cold start.
- **Transaction rollback ordering** — `TransactionManager.rollback()` now reverts buffered views in reverse order, correctly restoring the pre-transaction cache state when the same document is modified multiple times within a single transaction.
- **Type safety** — `BufferedView.data` and `bufferView()` parameter typed as `Document | null` instead of using `null as any` cast.

## 0.2.0

### Added

- **`upsertMany(items)`** — bulk insert-or-update on `Collection`. For each document, if `doc.id` exists in the collection it is updated (merged); otherwise it is inserted with schema defaults applied. Wrapped in a transaction for atomicity; participates in an external transaction when one is active.

### Fixed

- **`insertMany` nested transaction safety** — `insertMany` no longer unconditionally commits/rollbacks the transaction. When called inside a parent transaction (e.g. `store.beginTransaction()` or `store.transaction()`), it now participates in the parent instead of resetting it.
- **`deleteMany` nested transaction safety** — same fix applied to `deleteMany`.

## 0.1.1

- Initial public release.
