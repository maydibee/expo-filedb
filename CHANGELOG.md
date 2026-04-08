# Changelog

## 0.2.0

### Added

- **`upsertMany(items)`** — bulk insert-or-update on `Collection`. For each document, if `doc.id` exists in the collection it is updated (merged); otherwise it is inserted with schema defaults applied. Wrapped in a transaction for atomicity; participates in an external transaction when one is active.

### Fixed

- **`insertMany` nested transaction safety** — `insertMany` no longer unconditionally commits/rollbacks the transaction. When called inside a parent transaction (e.g. `store.beginTransaction()` or `store.transaction()`), it now participates in the parent instead of resetting it.
- **`deleteMany` nested transaction safety** — same fix applied to `deleteMany`.

## 0.1.1

- Initial public release.
