import type { DatabaseEvent, Document, IFileSystem } from '../types'
import { TransactionManager } from '../transaction'
import { EventLog } from './event-log'
import { FileSystemAdapter } from './fs-adapter'
import { MemoryCache } from './memory-cache'
import { ViewStore } from './view-store'
import { WriteQueue } from './write-queue'

/**
 * Core orchestrator that coordinates cache, event log, view store,
 * write queue, and transactions into a single coherent engine.
 */
export interface StorageEngineOptions {
  viewsBasePath?: string
  eventLogBasePath?: string
  /** When true, skip writing to the internal event log on every mutation. */
  skipEventLog?: boolean
}

export class StorageEngine {
  readonly cache: MemoryCache
  readonly eventLog: EventLog
  readonly viewStore: ViewStore
  readonly writeQueue: WriteQueue
  readonly transaction: TransactionManager
  readonly fs: FileSystemAdapter
  readonly skipEventLog: boolean

  private readonly dbRoot: string

  constructor(
    rootPath: string,
    dbName: string,
    fileSystem: IFileSystem,
    batchSize: number = 10,
    options?: StorageEngineOptions,
  ) {
    this.dbRoot = `${rootPath}/expo-filedb/${dbName}`
    this.fs = new FileSystemAdapter(fileSystem)
    this.cache = new MemoryCache()
    this.eventLog = new EventLog(options?.eventLogBasePath ?? `${this.dbRoot}/event_log`, this.fs)
    this.viewStore = new ViewStore(options?.viewsBasePath ?? `${this.dbRoot}/views`, this.fs)
    this.writeQueue = new WriteQueue(batchSize)
    this.transaction = new TransactionManager()
    this.skipEventLog = options?.skipEventLog ?? false
  }

  /**
   * Ensures a collection is fully loaded into the cache.
   * No-op if already loaded.
   */
  async ensureLoaded(collection: string): Promise<void> {
    if (this.cache.isFullyLoaded(collection)) return
    const records = await this.viewStore.loadAll(collection)
    for (const [id, doc] of Object.entries(records)) {
      this.cache.set(collection, id, doc)
    }
    this.cache.markFullyLoaded(collection)
  }

  /**
   * Writes a document: updates cache immediately, persists event + view
   * either directly or via the active transaction.
   */
  async writeDocument(
    eventType: DatabaseEvent['type'],
    collection: string,
    doc: Document,
  ): Promise<void> {
    const previousData = this.cache.get(collection, doc.id)
    this.cache.set(collection, doc.id, doc)

    if (this.transaction.isActive()) {
      if (!this.skipEventLog) {
        this.transaction.bufferEvent({
          id: generateEventId(), type: eventType, collection,
          documentId: doc.id, data: doc, timestamp: new Date().toISOString(),
        })
      }
      this.transaction.bufferView(collection, doc.id, doc, previousData)
      return
    }

    if (!this.skipEventLog) {
      await this.eventLog.append([{
        id: generateEventId(), type: eventType, collection,
        documentId: doc.id, data: doc, timestamp: new Date().toISOString(),
      }])
    }
    this.writeQueue.enqueue(
      `${collection}/${doc.id}`,
      () => this.viewStore.write(collection, doc.id, doc),
    )
  }

  /**
   * Deletes a document from cache and enqueues file deletion.
   */
  async deleteDocument(collection: string, id: string): Promise<Document | undefined> {
    const existing = this.cache.get(collection, id)
    if (!existing) return undefined

    this.cache.delete(collection, id)

    if (this.transaction.isActive()) {
      if (!this.skipEventLog) {
        this.transaction.bufferEvent({
          id: generateEventId(), type: 'delete', collection,
          documentId: id, data: null, timestamp: new Date().toISOString(),
        })
      }
      this.transaction.bufferView(collection, id, null as any, existing)
      return existing
    }

    if (!this.skipEventLog) {
      await this.eventLog.append([{
        id: generateEventId(), type: 'delete', collection,
        documentId: id, data: null, timestamp: new Date().toISOString(),
      }])
    }
    this.writeQueue.enqueue(
      `${collection}/${id}`,
      () => this.viewStore.delete(collection, id),
    )
    return existing
  }

  async flush(): Promise<void> {
    await this.writeQueue.flush()
  }

  /**
   * Invalidates the in-process directory creation cache.
   * Must be called after any external operation that moves or deletes
   * directories managed by this engine (e.g. backup/restore moves).
   */
  clearFsCache(): void {
    this.fs.clearDirCache()
  }

  async destroy(): Promise<void> {
    this.cache.clear()
    this.writeQueue.enqueue('__destroy__', async () => {
      await this.eventLog.clear()
      await this.viewStore.deleteAll()
      await this.fs.deleteDir(this.dbRoot)
    })
    await this.writeQueue.flush()
    this.fs.clearDirCache()
  }

  async readMeta(): Promise<Record<string, any> | null> {
    const metaPath = `${this.dbRoot}/meta.json`
    if (!(await this.fs.exists(metaPath))) return null
    const content = await this.fs.readFile(metaPath)
    return JSON.parse(content)
  }

  async writeMeta(meta: Record<string, any>): Promise<void> {
    const metaPath = `${this.dbRoot}/meta.json`
    await this.fs.writeFile(metaPath, JSON.stringify(meta))
  }
}

let eventCounter = 0
function generateEventId(): string {
  return `${Date.now()}_${++eventCounter}_${Math.random().toString(36).slice(2, 6)}`
}
