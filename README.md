# expo-filedb

High-performance embedded file-based database for React Native and Expo. Works with Expo managed workflow, no native modules required.

## Table of Contents

- [Features](#features)
- [Comparison](#comparison)
- [Quick Start](#quick-start)
- [Defining Models](#defining-models)
- [Creating a Store](#creating-a-store)
- [CRUD Operations](#crud-operations)
- [Querying](#querying)
- [Transactions](#transactions)
- [Relationships](#relationships)
- [Observables & React Hooks](#observables--react-hooks)
- [Migrations](#migrations)
- [Database Lifecycle](#database-lifecycle)
- [Architecture](#architecture)
- [Performance](#performance)
- [API Reference](#api-reference)

## Features

- Declarative model definitions with typed CRUD
- In-memory read cache (instant reads after first load)
- Write-behind queue with deduplication
- Transaction batching with automatic rollback
- Segmented JSONL event log, O(1) append
- Materialized views, one file per document
- Query engine: 12 operators, `$and`/`$or`, sorting, pagination
- Relationships: `has-many` and `belongs-to` with eager loading
- Observable queries and React hooks
- Schema migrations with version chaining and custom transforms
- Zero native dependencies

## Comparison

| Feature | expo-filedb | AsyncStorage | expo-sqlite | WatermelonDB | Realm |
|---|---|---|---|---|---|
| Expo managed workflow | Yes | Yes | Yes | No | No |
| No native modules | Yes | Yes | No | No | No |
| In-memory cache | Yes | No | No | Yes | Yes |
| Write-behind queue | Yes | No | No | No | No |
| Transactions | Yes | No | Yes | Yes | Yes |
| Reactive queries | Yes | No | No | Yes | Yes |
| Schema migrations | Yes | No | Manual | Yes | Yes |
| Relationships | Yes | No | Manual | Yes | Yes |

## Quick Start

### 1. Install

```bash
yarn add expo-filedb

npm install expo-filedb
```

Requires `expo-file-system` as a peer dependency (included in Expo projects by default).

### 2. Define your models

```typescript
import { defineModel, field } from 'expo-filedb'

interface User {
  id: string
  name: string
  email: string
  age: number
  createdAt: string
}

const UserModel = defineModel<User>('users', {
  name: field('string').required(),
  email: field('string').required().indexed(),
  age: field('number'),
  createdAt: field('date').default(() => new Date().toISOString()),
})
```

### 3. Create a store

```typescript
import { createStore } from 'expo-filedb'

const store = await createStore({
  name: 'myapp',
  models: { users: UserModel },
})
```

### 4. Use it

```typescript
const user = await store.users.insert({ name: 'Alice', email: 'alice@example.com', age: 25 })

const adults = await store.users.find({ where: { age: { $gte: 18 } } })

await store.users.update(user.id, { age: 26 })

await store.users.delete(user.id)
```

## Defining Models

```typescript
import { defineModel, field } from 'expo-filedb'

const Post = defineModel<Post>('posts', {
  title: field('string').required(),
  body: field('string'),
  authorId: field('string').required().indexed(),
  tags: field('array'),
  publishedAt: field('date'),
  viewCount: field('number').default(0),
  isDraft: field('boolean').default(true),
  metadata: field('object'),
})
```

### Field Types

| Type | TypeScript | Description |
|---|---|---|
| `'string'` | `string` | Text values |
| `'number'` | `number` | Numeric values |
| `'boolean'` | `boolean` | True/false |
| `'date'` | `Date \| string` | Date objects or ISO strings |
| `'array'` | `any[]` | Arrays of any type |
| `'object'` | `object` | Nested objects |

### Field Options

```typescript
field('string')
  .required()                                    // Must be present on insert
  .indexed()                                     // Marked for future index support
  .default('untitled')                           // Static default value
  .default(() => new Date().toISOString())       // Dynamic default (function)
  .validate(v => v.length > 0 || 'Cannot be empty')  // Custom validator
```

### Relationships

```typescript
const User = defineModel<User>('users', {
  name: field('string').required(),
}, {
  relationships: {
    posts: { type: 'has-many', collection: 'posts', foreignKey: 'authorId' },
  },
})

const Post = defineModel<Post>('posts', {
  title: field('string').required(),
  authorId: field('string').required(),
}, {
  relationships: {
    author: { type: 'belongs-to', collection: 'users', localKey: 'authorId' },
  },
})
```

## Creating a Store

```typescript
const store = await createStore({
  name: 'myapp',                    // Database name (directory on disk)
  version: 1,                       // Schema version (for migrations)
  models: {
    users: UserModel,
    posts: PostModel,
  },
  migrations: [],                   // Migration steps (see Migrations section)
  writeQueueBatchSize: 10,          // How many writes to flush at once
})
```

Each key in `models` becomes a typed property on the store:

```typescript
store.users   // Collection<User>
store.posts   // Collection<Post>
```

## CRUD Operations

### Insert

```typescript
const user = await store.users.insert({
  name: 'Alice',
  email: 'alice@example.com',
  age: 25,
})
// Returns: { id: 'auto-generated-uuid', name: 'Alice', ... }
```

### Insert Many (atomic)

```typescript
const users = await store.users.insertMany([
  { name: 'Alice', email: 'alice@example.com', age: 25 },
  { name: 'Bob', email: 'bob@example.com', age: 30 },
])
// All-or-nothing: if any fails, none are inserted
// Safe to call inside store.transaction(): participates in the parent transaction
```

### Find by ID

```typescript
const user = await store.users.findById('some-id')
// Returns the document or null
```

### Find with Query

```typescript
const users = await store.users.find({
  where: { age: { $gte: 18, $lte: 65 } },
  orderBy: { createdAt: 'desc' },
  limit: 10,
  offset: 0,
})
```

### Find One

```typescript
const admin = await store.users.findOne({
  where: { email: 'admin@example.com' },
})
```

### Update

```typescript
const updated = await store.users.update('some-id', { age: 26 })
```

### Replace (full document replacement)

```typescript
const replaced = await store.users.replace('some-id', {
  id: 'some-id',
  name: 'Alice Updated',
  email: 'new@example.com',
  age: 26,
})
```

### Upsert

```typescript
const user = await store.users.upsert({
  id: 'known-id',
  name: 'Jane',
  email: 'jane@example.com',
  age: 28,
})
// Inserts if not found, updates if exists
```

### Upsert Many (atomic)

```typescript
const users = await store.users.upsertMany([
  { id: 'existing-id', name: 'Alice Updated', age: 26 },  // update
  { id: 'new-id', name: 'Bob', email: 'bob@example.com', age: 30 },  // insert
])
// For each document: inserts if not found, updates (merges) if exists
// All-or-nothing: if any fails, none are applied
```

### Delete

```typescript
const deleted = await store.users.delete('some-id')
// Returns true if deleted, false if not found
```

### Delete Many

```typescript
const count = await store.users.deleteMany({
  where: { age: { $lt: 18 } },
})
// Safe to call inside store.transaction() — participates in the parent transaction
```

### Count

```typescript
const count = await store.users.count({
  where: { age: { $gte: 18 } },
})
```

## Querying

### Query Operators

| Operator | Description | Example |
|---|---|---|
| `$eq` | Equal | `{ status: { $eq: 'active' } }` |
| `$ne` | Not equal | `{ status: { $ne: 'deleted' } }` |
| `$gt` | Greater than | `{ age: { $gt: 18 } }` |
| `$gte` | Greater than or equal | `{ age: { $gte: 18 } }` |
| `$lt` | Less than | `{ age: { $lt: 65 } }` |
| `$lte` | Less than or equal | `{ age: { $lte: 65 } }` |
| `$in` | In array | `{ status: { $in: ['active', 'pending'] } }` |
| `$nin` | Not in array | `{ status: { $nin: ['deleted'] } }` |
| `$contains` | String contains (case-insensitive) | `{ name: { $contains: 'john' } }` |
| `$startsWith` | String starts with | `{ name: { $startsWith: 'A' } }` |
| `$endsWith` | String ends with | `{ email: { $endsWith: '.com' } }` |
| `$exists` | Field exists | `{ avatar: { $exists: true } }` |
| `$regex` | Regular expression | `{ code: { $regex: '^[A-Z]{3}' } }` |

### Logical Operators

```typescript
// AND
await store.users.find({
  where: {
    $and: [
      { age: { $gte: 18 } },
      { status: 'active' },
    ],
  },
})

// OR
await store.users.find({
  where: {
    $or: [
      { role: 'admin' },
      { role: 'moderator' },
    ],
  },
})
```

### Sorting and Pagination

```typescript
await store.users.find({
  orderBy: { lastName: 'asc', firstName: 'asc' },
  limit: 20,
  offset: 40,
})
```

## Transactions

Writes inside a transaction are batched into a single I/O operation. On failure, all changes roll back.

### Callback-based (recommended)

```typescript
const result = await store.transaction(async (tx) => {
  const user = await tx.users.insert({ name: 'John', age: 30 })
  const post = await tx.posts.insert({ title: 'Hello', authorId: user.id })
  return { user, post }
})
```

On error:

```typescript
try {
  await store.transaction(async (tx) => {
    await tx.users.insert({ name: 'Alice', age: 25 })
    throw new Error('Something went wrong')
    // Alice is NOT inserted, transaction rolled back
  })
} catch (e) {
  // Handle error
}
```

### Imperative

```typescript
store.beginTransaction()
try {
  await store.users.insert({ name: 'Alice', age: 25 })
  await store.posts.insert({ title: 'Hello', authorId: 'alice-id' })
  await store.commitTransaction()
} catch (e) {
  store.rollbackTransaction()
  throw e
}
```

## Relationships

### Eager Loading

```typescript
const usersWithPosts = await store.users.find({
  include: ['posts'],
})
// Each user object has a `posts` array

const postsWithAuthor = await store.posts.find({
  include: ['author'],
})
// Each post object has an `author` object
```

### Manual Traversal

```typescript
const user = await store.users.findById('user-id')
const posts = await store.posts.find({
  where: { authorId: user.id },
})
```

## Observables & React Hooks

### Subscribing to Queries

```typescript
const subscription = store.users.observe({
  where: { age: { $gte: 18 } },
  orderBy: { name: 'asc' },
}).subscribe((users) => {
  console.log('Adult users:', users)
})

subscription.unsubscribe()
```

### Subscribing to a Single Document

```typescript
const subscription = store.users.observeOne('user-id').subscribe((user) => {
  console.log('User changed:', user)
})
```

### React Hooks

```typescript
import { useQuery, useDocument } from 'expo-filedb/react'

function UserList() {
  const { data: users, loading } = useQuery(store.users, {
    where: { age: { $gte: 18 } },
  })

  if (loading) return <ActivityIndicator />
  return users.map(user => <UserCard key={user.id} user={user} />)
}

function UserProfile({ userId }: { userId: string }) {
  const { data: user, loading } = useDocument(store.users, userId)

  if (loading) return <ActivityIndicator />
  if (!user) return <Text>Not found</Text>
  return <Text>{user.name}</Text>
}
```

## Migrations

### Defining Migrations

```typescript
import { createStore, defineModel, field, migrate } from 'expo-filedb'

const store = await createStore({
  name: 'myapp',
  version: 3,
  models: { users: UserModelV3 },
  migrations: [
    migrate(1, 2)
      .addField('users', 'role', 'member')
      .build(),

    migrate(2, 3)
      .renameField('users', 'name', 'fullName')
      .build(),
  ],
})
```

### Migration Helpers

| Method | Description |
|---|---|
| `.addField(collection, field, default)` | Add a new field with a default value |
| `.removeField(collection, field)` | Remove a field from all documents |
| `.renameField(collection, old, new)` | Rename a field |
| `.transformField(collection, field, fn)` | Transform field values with a function |
| `.custom(async (db) => { ... })` | Arbitrary migration logic |

### How It Works

1. On startup, the stored schema version is read from `meta.json`
2. If it differs from the configured version, a migration path is built
3. Migrations execute sequentially (v1 -> v2 -> v3)
4. After each step the version is persisted; if step 2->3 fails, the database stays at v2
5. Schema validation is disabled during migration and re-enabled after
6. The migration runner uses BFS to find the shortest path through the version graph

### Custom Migrations

```typescript
migrate(2, 3).custom(async (db) => {
  const users = await db.collections.users.find()
  for (const user of users) {
    const fullName = `${user.firstName} ${user.lastName}`
    await db.collections.users.replace(user.id, {
      ...user,
      fullName,
    })
  }
}).build()
```

## Database Lifecycle

```typescript
await store.flush()     // Flush pending writes to disk
await store.close()     // Flush + release memory
await store.purge()     // Clear all data, keep store operational
await store.destroy()   // Delete all data and remove from disk

const dump = await store.exportJSON()
await store.importJSON(dump)

const events = await store.loadEvents()
await store.clearEvents()

store.clearFsCache()    // Invalidate FS cache after external directory moves
```

### Dynamic Collections

```typescript
const metadataCol = store.collection('snags-metadata-abc123')
const items = await metadataCol.find()
await metadataCol.upsert({ id: 'meta-1', lastSync: new Date().toISOString() })
```

Returns the pre-created collection for known models or creates a dynamic unvalidated collection for runtime-determined names.

### Engine Options

```typescript
const store = await createStore({
  name: 'myapp',
  models: { users: UserModel },
  engineOptions: {
    viewsBasePath: `${rootPath}/views`,    // Override views directory
    skipEventLog: true,                     // Disable internal event logging
  },
})
```

## Architecture

### Design Influences

The storage engine combines ideas from several established approaches:

- **CoreData** (Apple): in-memory object graph with background persistence to disk
- **LSM-Tree** (LevelDB, RocksDB): writes go to an in-memory structure first, then flush as immutable segments to disk in background
- **CQRS**: separate write path (event log) and read path (materialized views), each optimized independently
- **Write-behind caching**: cache is updated synchronously on write, disk persistence is deferred and batched

### Internal Components

```
┌─────────────────────────────────────────────────────┐
│                    Your App Code                     │
│                                                      │
│   store.users.insert({ name: "Alice", age: 25 })   │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────┐
│         Store (Declarative API Layer)                │
│                                                      │
│  defineModel() -> createStore() -> typed collections │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────┐
│              Collection<T>                           │
│                                                      │
│  insert · update · replace · upsert · upsertMany    │
│  delete · deleteMany · insertMany                   │
│  find · findOne · findById · count                  │
│  observe · observeOne                               │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────┐
│           StorageEngine (Internal)                   │
│                                                      │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────┐ │
│  │ MemoryCache  │  │ WriteQueue   │  │ EventLog   │ │
│  │ (read path)  │  │ (write-behind│  │ (JSONL     │ │
│  │              │  │  batching)   │  │  segments)  │ │
│  └─────────────┘  └──────────────┘  └────────────┘ │
│  ┌─────────────┐  ┌──────────────┐                  │
│  │ ViewStore    │  │ Transaction  │                  │
│  │ (1 file/doc) │  │ Manager      │                  │
│  └─────────────┘  └──────────────┘                  │
│  ┌─────────────────────────────────────────────────┐ │
│  │          FileSystemAdapter                      │ │
│  │          (expo-file-system wrapper)             │ │
│  └─────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

### Write Flow

1. **Cache update**: document is written to `MemoryCache` synchronously (instant read availability)
2. **Event log**: mutation event is appended to a JSONL segment file (O(1))
3. **View enqueue**: document file write is added to the `WriteQueue`
4. **Background flush**: `WriteQueue` processes writes in batches, deduplicating by key

### Read Flow

1. **Cache hit**: if the collection is loaded, return from `MemoryCache` (O(1) lookup)
2. **Cache miss**: load all documents from `ViewStore` (disk), populate cache, then query in memory

### Transaction Flow

1. **Begin**: buffer all events and view writes in memory
2. **Commit**: write all events as one segment, enqueue all views
3. **Rollback**: revert cache to pre-transaction state, discard buffers

## Performance

| Operation | Complexity | Notes |
|---|---|---|
| `insert` | O(1) amortized | Cache update + event segment + background view write |
| `findById` (cached) | O(1) | Direct Map lookup |
| `findById` (cold) | O(1) disk read | Single file read + cache population |
| `find` (cached) | O(N) | In-memory filter, N = collection size |
| `find` (cold) | O(N) disk reads | Load all files + cache + filter |
| `update` | O(1) amortized | Same as insert |
| `delete` | O(1) amortized | Cache delete + background file delete |
| `transaction commit` | O(K) | K = number of operations in the transaction |

## API Reference

### Top-Level

| Function | Description |
|---|---|
| `createStore(options)` | Create a typed database store from model definitions |
| `defineModel<T>(name, fields, options?)` | Define a data model |
| `field(type)` | Create a field definition (fluent builder) |
| `migrate(from, to)` | Create a migration step (fluent builder) |

### Store

| Method | Description |
|---|---|
| `store.transaction(fn)` | Execute writes atomically (callback-based) |
| `store.beginTransaction()` | Start an imperative transaction |
| `store.commitTransaction()` | Commit an imperative transaction |
| `store.rollbackTransaction()` | Rollback an imperative transaction |
| `store.collection(name)` | Get or create a collection by name |
| `store.flush()` | Flush pending writes to disk |
| `store.close()` | Flush + release memory |
| `store.purge()` | Clear all data, keep store operational |
| `store.destroy()` | Delete all data and remove from disk |
| `store.clearFsCache()` | Invalidate directory cache after external moves |
| `store.exportJSON()` | Export as JSON |
| `store.importJSON(dump)` | Import from JSON |

### Collection\<T\>

| Method | Returns | Description |
|---|---|---|
| `insert(data)` | `Promise<T>` | Insert a new document |
| `insertMany(items)` | `Promise<T[]>` | Insert multiple (atomic) |
| `update(id, changes)` | `Promise<T>` | Partial update |
| `replace(id, data)` | `Promise<T>` | Full replacement |
| `upsert(data)` | `Promise<T>` | Insert or update |
| `upsertMany(items)` | `Promise<T[]>` | Insert or update multiple (atomic) |
| `delete(id)` | `Promise<boolean>` | Delete by id |
| `deleteMany(query)` | `Promise<number>` | Delete matching |
| `findById(id)` | `Promise<T \| null>` | Find by id |
| `find(query?)` | `Promise<T[]>` | Find with query |
| `findOne(query?)` | `Promise<T \| null>` | Find first match |
| `count(query?)` | `Promise<number>` | Count matches |
| `observe(query?)` | `Observable<T[]>` | Live query |
| `observeOne(id)` | `Observable<T \| null>` | Live document |

### React Hooks

| Hook | Description |
|---|---|
| `useQuery(collection, query?)` | Subscribe to query results |
| `useDocument(collection, id)` | Subscribe to a single document |

## License

MIT
