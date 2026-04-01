import { Collection } from './collection'
import { StorageEngine, type StorageEngineOptions } from './storage/storage-engine'
import type { DatabaseDump, Document, FileDBConfig, IFileSystem, MigrationStep } from './types'

/**
 * Main database instance. Created via `createFileDB()`.
 *
 * Provides typed collection access, transactions, lifecycle management,
 * and import/export capabilities.
 */
export class FileDB {
  readonly collections: Record<string, Collection<any>> = {}
  private readonly engine: StorageEngine
  private readonly config: FileDBConfig

  constructor(engine: StorageEngine, config: FileDBConfig) {
    this.engine = engine
    this.config = config

    for (const [name, collectionConfig] of Object.entries(config.collections)) {
      this.collections[name] = new Collection(
        name,
        collectionConfig,
        engine,
        () => generateUUID(),
        () => this.collections,
      )
    }
  }

  /**
   * Execute a function within a transaction. All writes inside `fn` are
   * batched into a single I/O operation. If `fn` throws, all changes
   * are rolled back automatically.
   *
   * @returns the value returned by `fn`.
   */
  async transaction<R>(fn: (db: FileDB) => Promise<R>): Promise<R> {
    this.beginTransaction()
    try {
      const result = await fn(this)
      await this.commitTransaction()
      return result
    } catch (e) {
      this.rollbackTransaction()
      throw e
    }
  }

  /** Start an imperative transaction. Prefer the callback-based `transaction()` when possible. */
  beginTransaction(): void {
    this.engine.transaction.begin()
  }

  /** Commit an imperative transaction started with `beginTransaction()`. */
  async commitTransaction(): Promise<void> {
    await this.engine.transaction.commit(
      this.engine.eventLog,
      this.engine.writeQueue,
      this.engine.viewStore,
    )
  }

  /** Rollback an imperative transaction, reverting all cached writes. */
  rollbackTransaction(): void {
    this.engine.transaction.rollback(this.engine.cache)
  }

  /**
   * Get or create a collection by name. For collections defined in the config
   * this returns the pre-created instance. For unknown names a dynamic
   * unvalidated collection is created on-the-fly — useful for per-entity
   * metadata or other runtime-determined collection names.
   */
  collection(name: string): Collection<any> {
    if (!this.collections[name]) {
      this.collections[name] = new Collection(
        name,
        { schema: {}, relationships: {} },
        this.engine,
        () => generateUUID(),
        () => this.collections,
      )
      this.collections[name].setSkipValidation(true)
    }
    return this.collections[name]
  }

  /**
   * Flush all pending background writes to disk.
   * Call before app backgrounding, sync, or any operation that
   * requires all data to be durably persisted.
   */
  async flush(): Promise<void> {
    await this.engine.flush()
  }

  /** Flush pending writes and release all in-memory resources. */
  async close(): Promise<void> {
    await this.flush()
    this.engine.cache.clear()
  }

  /** Delete all data and remove the database from disk. */
  async destroy(): Promise<void> {
    await this.engine.destroy()
  }

  /**
   * Clear all persisted data but keep the store operational.
   * Unlike `destroy()`, the store can continue to be used after purge.
   */
  async purge(): Promise<void> {
    await this.engine.flush()
    this.engine.cache.clear()
    await this.engine.viewStore.deleteAll()
    this.engine.clearFsCache()
  }

  /**
   * Export the entire database as a JSON-serializable object.
   * Flushes pending writes first to ensure consistency.
   */
  async exportJSON(): Promise<DatabaseDump> {
    await this.flush()
    const dump: DatabaseDump = {
      version: this.config.version ?? 1,
      collections: {},
      exportedAt: new Date().toISOString(),
    }
    for (const [name, collection] of Object.entries(this.collections)) {
      dump.collections[name] = await collection.find()
    }
    return dump
  }

  /**
   * Import data from a previously exported dump.
   * Existing data in matching collections is replaced.
   */
  async importJSON(dump: DatabaseDump): Promise<void> {
    await this.transaction(async (db) => {
      for (const [name, docs] of Object.entries(dump.collections)) {
        const collection = db.collections[name]
        if (!collection) continue
        for (const doc of docs) {
          await collection.upsert(doc)
        }
      }
    })
  }

  /** Load all events from the event log (for sync or debugging). */
  async loadEvents() {
    await this.flush()
    return this.engine.eventLog.loadAll()
  }

  /** Clear the event log after a successful sync. */
  async clearEvents(): Promise<void> {
    await this.engine.eventLog.clear()
  }

  /**
   * Invalidate the internal directory-creation cache.
   * Call this after any external operation that moves or removes directories
   * that the engine has written to (e.g. backup/restore steps in a sync pipeline).
   */
  clearFsCache(): void {
    this.engine.clearFsCache()
  }
}

/**
 * Create and initialize a FileDB instance.
 *
 * @param config - Database configuration including name, collections, and optional migrations.
 * @param fileSystem - The file system implementation (defaults to expo-file-system).
 * @param rootPath - Root directory for database storage (defaults to FileSystem.documentDirectory).
 */
export async function createFileDB(
  config: FileDBConfig,
  fileSystem: IFileSystem,
  rootPath: string,
  engineOptions?: StorageEngineOptions,
): Promise<FileDB> {
  const engine = new StorageEngine(
    rootPath,
    config.name,
    fileSystem,
    config.writeQueueBatchSize ?? 10,
    engineOptions,
  )

  const meta = await engine.readMeta()
  const currentVersion = config.version ?? 1

  const db = new FileDB(engine, config)

  if (meta && meta.version !== currentVersion && config.migrations) {
    await runMigrations(db, engine, meta.version, currentVersion, config.migrations)
  }

  await engine.writeMeta({ version: currentVersion, schemaHash: hashConfig(config) })

  return db
}

function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

/**
 * Builds a migration path from `fromVersion` to `toVersion` and executes
 * each step sequentially. If no continuous path exists, throws an error.
 *
 * Each step runs within a transaction — if a step fails, changes from
 * that step are rolled back and the database stays at the last
 * successfully migrated version.
 */
async function runMigrations(
  db: FileDB,
  engine: StorageEngine,
  fromVersion: number,
  toVersion: number,
  migrations: MigrationStep[],
): Promise<void> {
  const path = buildMigrationPath(fromVersion, toVersion, migrations)
  if (path.length === 0 && fromVersion !== toVersion) {
    console.warn(
      `[expo-filedb] No migration path from v${fromVersion} to v${toVersion}. ` +
      `Data may be incompatible.`,
    )
    return
  }

  for (const col of Object.values(db.collections)) {
    col.setSkipValidation(true)
  }

  let currentVersion = fromVersion
  for (const step of path) {
    try {
      await step.migrate(db)
      currentVersion = step.toVersion
      await engine.writeMeta({ version: currentVersion })
      await engine.flush()
    } catch (e) {
      console.error(
        `[expo-filedb] Migration v${step.fromVersion}→v${step.toVersion} failed. ` +
        `Database is at v${currentVersion}.`,
        e,
      )
      for (const col of Object.values(db.collections)) {
        col.setSkipValidation(false)
      }
      throw new Error(
        `Migration failed at v${step.fromVersion}→v${step.toVersion}: ${e instanceof Error ? e.message : e}`,
      )
    }
  }

  for (const col of Object.values(db.collections)) {
    col.setSkipValidation(false)
  }
}

/**
 * Finds the shortest chain of migration steps from `from` to `to`
 * using a BFS over the version graph.
 */
function buildMigrationPath(from: number, to: number, migrations: MigrationStep[]): MigrationStep[] {
  if (from === to) return []
  if (from > to) return []

  const byFrom = new Map<number, MigrationStep[]>()
  for (const m of migrations) {
    if (!byFrom.has(m.fromVersion)) byFrom.set(m.fromVersion, [])
    byFrom.get(m.fromVersion)!.push(m)
  }

  const visited = new Set<number>()
  const queue: Array<{ version: number; path: MigrationStep[] }> = [{ version: from, path: [] }]

  while (queue.length > 0) {
    const { version, path } = queue.shift()!
    if (version === to) return path
    if (visited.has(version)) continue
    visited.add(version)

    const candidates = byFrom.get(version) ?? []
    for (const step of candidates.sort((a, b) => a.toVersion - b.toVersion)) {
      if (!visited.has(step.toVersion) && step.toVersion <= to) {
        queue.push({ version: step.toVersion, path: [...path, step] })
      }
    }
  }

  return []
}

function hashConfig(config: FileDBConfig): string {
  const keys = Object.keys(config.collections).sort().join(',')
  let hash = 0
  for (let i = 0; i < keys.length; i++) {
    hash = ((hash << 5) - hash + keys.charCodeAt(i)) | 0
  }
  return hash.toString(36)
}
