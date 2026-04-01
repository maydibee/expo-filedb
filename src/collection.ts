import type {
  CollectionConfig,
  CollectionSchema,
  Document,
  Identifier,
  Observable,
  QueryOptions,
  RelationshipDef,
} from './types'
import { CollectionObservable } from './observable'
import { evaluateQuery } from './query'
import { applyDefaults, validateDocument } from './schema'
import type { StorageEngine } from './storage/storage-engine'

/**
 * Typed collection providing CRUD, querying, and reactive subscriptions.
 *
 * All reads are served from the in-memory cache after first load.
 * Writes update the cache synchronously and persist to disk in the background.
 */
export class Collection<T extends Document = Document> {
  readonly name: string
  private readonly schema: CollectionSchema
  private readonly relationships: Record<string, RelationshipDef>
  private readonly engine: StorageEngine
  private readonly observable: CollectionObservable<T>
  private readonly generateId: () => string
  private allCollections: () => Record<string, Collection<any>>
  private skipValidation = false

  constructor(
    name: string,
    config: CollectionConfig,
    engine: StorageEngine,
    generateId: () => string,
    allCollections: () => Record<string, Collection<any>>,
  ) {
    this.name = name
    this.schema = config.schema
    this.relationships = config.relationships ?? {}
    this.engine = engine
    this.generateId = generateId
    this.allCollections = allCollections
    this.observable = new CollectionObservable<T>(
      (q) => this.find(q),
      (id) => this.findById(id),
    )
  }

  /**
   * Insert a new document. An `id` is auto-generated if not provided.
   * Schema defaults are applied and the document is validated before insertion.
   */
  async insert(data: Omit<T, 'id'> & { id?: Identifier }): Promise<T> {
    await this.engine.ensureLoaded(this.name)
    const doc = applyDefaults({ id: data.id ?? this.generateId(), ...data }, this.schema) as T
    if (!this.skipValidation) this.validate(doc)
    await this.engine.writeDocument('insert', this.name, doc)
    this.observable.notifyChange()
    return doc
  }

  /**
   * Insert multiple documents in a single operation.
   * Automatically wrapped in a transaction for atomicity.
   */
  async insertMany(items: Array<Omit<T, 'id'> & { id?: Identifier }>): Promise<T[]> {
    await this.engine.ensureLoaded(this.name)
    const docs: T[] = []

    this.engine.transaction.begin()
    try {
      for (const data of items) {
        const doc = applyDefaults({ id: data.id ?? this.generateId(), ...data }, this.schema) as T
        if (!this.skipValidation) this.validate(doc)
        await this.engine.writeDocument('insert', this.name, doc)
        docs.push(doc)
      }
      await this.engine.transaction.commit(this.engine.eventLog, this.engine.writeQueue, this.engine.viewStore)
    } catch (e) {
      this.engine.transaction.rollback(this.engine.cache)
      throw e
    }

    this.observable.notifyChange()
    return docs
  }

  /**
   * Update an existing document by id. Only the provided fields are changed;
   * all other fields are preserved.
   * @throws if the document does not exist.
   */
  async update(id: Identifier, changes: Partial<T>): Promise<T> {
    await this.engine.ensureLoaded(this.name)
    const existing = this.engine.cache.get(this.name, id) as T | undefined
    if (!existing) throw new Error(`[expo-filedb] Document "${id}" not found in "${this.name}"`)

    const updated = { ...existing, ...changes, id } as T
    if (!this.skipValidation) this.validate(updated)
    await this.engine.writeDocument('update', this.name, updated)
    this.observable.notifyChange()
    return updated
  }

  /**
   * Replace an existing document entirely. Unlike `update`, this does NOT
   * merge with the existing document — the new data replaces it completely.
   * Useful for migrations that rename or remove fields.
   * @throws if the document does not exist.
   */
  async replace(id: Identifier, data: T): Promise<T> {
    await this.engine.ensureLoaded(this.name)
    const existing = this.engine.cache.get(this.name, id) as T | undefined
    if (!existing) throw new Error(`[expo-filedb] Document "${id}" not found in "${this.name}"`)

    const doc = { ...data, id } as T
    if (!this.skipValidation) this.validate(doc)
    await this.engine.writeDocument('update', this.name, doc)
    this.observable.notifyChange()
    return doc
  }

  /**
   * Insert if the document doesn't exist, update if it does.
   * When `doc.id` is provided and exists in the collection, it's an update.
   */
  async upsert(data: Partial<T> & { id?: Identifier }): Promise<T> {
    await this.engine.ensureLoaded(this.name)
    const id = data.id ?? this.generateId()
    const existing = this.engine.cache.get(this.name, id) as T | undefined

    if (existing) {
      return this.update(id, data as Partial<T>)
    }
    return this.insert({ ...data, id } as any)
  }

  /**
   * Delete a document by id.
   * @returns `true` if the document was found and deleted, `false` otherwise.
   */
  async delete(id: Identifier): Promise<boolean> {
    await this.engine.ensureLoaded(this.name)
    const deleted = await this.engine.deleteDocument(this.name, id)
    if (deleted) this.observable.notifyChange()
    return !!deleted
  }

  /**
   * Delete all documents matching a query.
   * @returns the number of deleted documents.
   */
  async deleteMany(query: QueryOptions): Promise<number> {
    const docs = await this.find(query)
    if (docs.length === 0) return 0

    this.engine.transaction.begin()
    try {
      for (const doc of docs) {
        await this.engine.deleteDocument(this.name, doc.id)
      }
      await this.engine.transaction.commit(this.engine.eventLog, this.engine.writeQueue, this.engine.viewStore)
    } catch (e) {
      this.engine.transaction.rollback(this.engine.cache)
      throw e
    }

    this.observable.notifyChange()
    return docs.length
  }

  /** Find a single document by its id. Returns `null` if not found. */
  async findById(id: Identifier): Promise<T | null> {
    await this.engine.ensureLoaded(this.name)
    return (this.engine.cache.get(this.name, id) as T) ?? null
  }

  /**
   * Find documents matching a query. Supports filtering, sorting,
   * pagination, and eager-loading of relationships via `include`.
   */
  async find(query: QueryOptions = {}): Promise<T[]> {
    await this.engine.ensureLoaded(this.name)
    const all = this.engine.cache.values(this.name) as T[]
    let results = evaluateQuery(all, query)

    if (query.include && query.include.length > 0) {
      results = await this.resolveIncludes(results, query.include)
    }
    return results
  }

  /** Find the first document matching a query, or `null`. */
  async findOne(query: QueryOptions = {}): Promise<T | null> {
    const results = await this.find({ ...query, limit: 1 })
    return results[0] ?? null
  }

  /** Count documents matching a query. */
  async count(query: QueryOptions = {}): Promise<number> {
    const results = await this.find({ ...query, limit: undefined, offset: undefined })
    return results.length
  }

  /**
   * Subscribe to live query results. The callback fires immediately
   * with current data and again after every mutation in this collection.
   */
  observe(query: QueryOptions = {}): Observable<T[]> {
    return this.observable.observe(query)
  }

  /** Subscribe to a single document. Fires on every change. */
  observeOne(id: Identifier): Observable<T | null> {
    return this.observable.observeOne(id)
  }

  /** @internal Used by the migration runner to temporarily disable schema validation. */
  setSkipValidation(skip: boolean): void {
    this.skipValidation = skip
  }

  private validate(doc: Document): void {
    const errors = validateDocument(doc, this.schema)
    if (errors.length > 0) {
      throw new Error(`[expo-filedb] Validation failed for "${this.name}": ${errors.join(', ')}`)
    }
  }

  private async resolveIncludes(docs: T[], includes: string[]): Promise<T[]> {
    const collections = this.allCollections()
    return Promise.all(
      docs.map(async (doc) => {
        const enriched = { ...doc }
        for (const relName of includes) {
          const rel = this.relationships[relName]
          if (!rel) continue
          const targetCollection = collections[rel.collection]
          if (!targetCollection) continue

          if (rel.type === 'has-many' && rel.foreignKey) {
            enriched[relName as keyof T] = (await targetCollection.find({
              where: { [rel.foreignKey]: doc.id },
            })) as any
          } else if (rel.type === 'belongs-to' && rel.localKey) {
            enriched[relName as keyof T] = (await targetCollection.findById(doc[rel.localKey])) as any
          }
        }
        return enriched
      }),
    )
  }
}
