import { Collection } from './collection'
import { FileDB, createFileDB } from './filedb'
import type { ModelDef } from './model'
import { modelToConfig } from './model'
import type { StorageEngineOptions } from './storage/storage-engine'
import type { Document, IFileSystem, MigrationStep } from './types'

/**
 * A typed database store. Each model passed to `createStore()` becomes
 * a property on the store, providing full CRUD, queries, and observables
 * with zero boilerplate.
 *
 * ```ts
 * const store = await createStore({ models: [User, Post] })
 *
 * await store.users.insert({ name: 'Alice', age: 25 })
 * const adults = await store.users.find({ where: { age: { $gte: 18 } } })
 * ```
 */
export type Store<M extends Record<string, ModelDef>> = {
  /** Typed collection accessor for each model. */
  [K in keyof M]: Collection<M[K] extends ModelDef<infer T> ? T & Document : Document>
} & StoreOperations

interface StoreOperations {
  /** Execute `fn` in a transaction. Rolls back automatically on error. */
  transaction<R>(fn: (store: any) => Promise<R>): Promise<R>

  /** Start an imperative transaction. */
  beginTransaction(): void

  /** Commit an imperative transaction. */
  commitTransaction(): Promise<void>

  /** Rollback an imperative transaction, reverting all cached writes. */
  rollbackTransaction(): void

  /**
   * Get or create a collection by name. Returns the pre-created collection
   * for known models, or creates a dynamic unvalidated collection for
   * runtime-determined names (e.g. per-entity metadata).
   */
  collection(name: string): Collection<any>

  /** Flush all pending background writes to disk. */
  flush(): Promise<void>

  /** Flush pending writes and release all in-memory resources. */
  close(): Promise<void>

  /** Delete all data and remove the database from disk. */
  destroy(): Promise<void>

  /** Clear all persisted data but keep the store operational. */
  purge(): Promise<void>

  /** Export the entire database as a JSON-serializable object. */
  exportJSON(): ReturnType<FileDB['exportJSON']>

  /** Import data from a previously exported dump. */
  importJSON: FileDB['importJSON']

  /** Load all events from the internal event log. */
  loadEvents: FileDB['loadEvents']

  /** Clear the internal event log. */
  clearEvents: FileDB['clearEvents']

  /** Invalidate the directory-creation cache after external directory moves. */
  clearFsCache: FileDB['clearFsCache']
}

interface CreateStoreOptions<M extends Record<string, ModelDef>> {
  /** Database name — used as the root directory name on disk. */
  name: string

  /** Map of model definitions. Keys become the collection accessor names. */
  models: M

  /** Database schema version. Increment when schema changes. */
  version?: number

  /** Migration steps for upgrading between schema versions. */
  migrations?: MigrationStep[]

  /** How many writes to flush at once. Default: 10. */
  writeQueueBatchSize?: number

  /**
   * The file system implementation. Defaults to `expo-file-system`.
   * Pass a mock for testing.
   */
  fileSystem?: IFileSystem

  /**
   * Root directory for database storage.
   * Defaults to `FileSystem.documentDirectory` (stripped trailing slash).
   */
  rootPath?: string

  /**
   * Override the default views and event log base paths.
   * Useful when integrating with existing data that lives
   * outside the standard `expo-filedb/<name>/` directory.
   */
  engineOptions?: StorageEngineOptions
}

/**
 * Create a fully typed database store from model definitions.
 *
 * This is the **recommended entry point** for using expo-filedb.
 * It provides a clean, declarative API where you define models once
 * and get typed CRUD operations for free.
 *
 * ```ts
 * import { createStore, defineModel, field } from 'expo-filedb'
 *
 * const User = defineModel<User>('users', {
 *   name: field('string').required(),
 *   age: field('number'),
 * })
 *
 * const store = await createStore({
 *   name: 'myapp',
 *   models: { users: User },
 * })
 *
 * // Typed CRUD — no boilerplate
 * await store.users.insert({ name: 'Alice', age: 25 })
 * const user = await store.users.findById('some-id')
 * ```
 */
export async function createStore<M extends Record<string, ModelDef>>(
  options: CreateStoreOptions<M>,
): Promise<Store<M>> {
  const collections: Record<string, any> = {}
  for (const [key, model] of Object.entries(options.models)) {
    collections[model.collectionName] = modelToConfig(model)
  }

  let fileSystem = options.fileSystem
  let rootPath = options.rootPath

  if (!fileSystem || !rootPath) {
    const ExpoFS = require('expo-file-system')
    if (!fileSystem) {
      fileSystem = {
        readAsStringAsync: (p: string, o: any) => ExpoFS.readAsStringAsync(p, o),
        writeAsStringAsync: (p: string, c: string, o: any) => ExpoFS.writeAsStringAsync(p, c, o),
        deleteAsync: (p: string, o: any) => ExpoFS.deleteAsync(p, o),
        getInfoAsync: (p: string) => ExpoFS.getInfoAsync(p),
        makeDirectoryAsync: (p: string, o: any) => ExpoFS.makeDirectoryAsync(p, o),
        readDirectoryAsync: (p: string) => ExpoFS.readDirectoryAsync(p),
      }
    }
    if (!rootPath) {
      rootPath = ExpoFS.documentDirectory ? ExpoFS.documentDirectory.replace(/\/$/, '') : ''
    }
  }

  const db = await createFileDB(
    {
      name: options.name,
      version: options.version,
      collections,
      migrations: options.migrations,
      writeQueueBatchSize: options.writeQueueBatchSize,
    },
    fileSystem!,
    rootPath!,
    options.engineOptions,
  )

  const keyToCollectionName = new Map<string, string>()
  for (const [key, model] of Object.entries(options.models)) {
    keyToCollectionName.set(key, model.collectionName)
  }

  const store: any = {
    transaction: <R>(fn: (s: any) => Promise<R>) => db.transaction(() => fn(store)),
    beginTransaction: () => db.beginTransaction(),
    commitTransaction: () => db.commitTransaction(),
    rollbackTransaction: () => db.rollbackTransaction(),
    collection: (name: string) => db.collection(name),
    flush: () => db.flush(),
    close: () => db.close(),
    destroy: () => db.destroy(),
    purge: () => db.purge(),
    exportJSON: () => db.exportJSON(),
    importJSON: (dump: any) => db.importJSON(dump),
    loadEvents: () => db.loadEvents(),
    clearEvents: () => db.clearEvents(),
    clearFsCache: () => db.clearFsCache(),
  }

  for (const [key, collectionName] of keyToCollectionName) {
    store[key] = db.collections[collectionName]
  }

  return store as Store<M>
}
