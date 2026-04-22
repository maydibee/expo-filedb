import { Collection } from '../src/collection'
import { StorageEngine } from '../src/storage/storage-engine'
import { MockFileSystem } from './mock-fs'
import type { CollectionConfig, Document } from '../src/types'

interface User extends Document {
  name: string
  age: number
  email?: string
}

const userConfig: CollectionConfig = {
  schema: {
    name: { type: 'string', required: true },
    age: { type: 'number', required: true },
    email: { type: 'string' },
  },
}

let idCounter = 0
function makeId() {
  return `test-${++idCounter}`
}

describe('Collection', () => {
  let engine: StorageEngine
  let collection: Collection<User>

  beforeEach(() => {
    idCounter = 0
    const mockFs = new MockFileSystem()
    engine = new StorageEngine('/root', 'testdb', mockFs, 10)
    const collections: Record<string, Collection<any>> = {}
    collection = new Collection<User>('users', userConfig, engine, makeId, () => collections)
    collections.users = collection
  })

  afterEach(async () => {
    await engine.flush()
  })

  describe('insert', () => {
    it('inserts a document and returns it with id', async () => {
      const user = await collection.insert({ name: 'Alice', age: 25 })
      expect(user.id).toBe('test-1')
      expect(user.name).toBe('Alice')
      expect(user.age).toBe(25)
    })

    it('inserts with custom id', async () => {
      const user = await collection.insert({ id: 'custom-id', name: 'Bob', age: 30 } as any)
      expect(user.id).toBe('custom-id')
    })

    it('rejects invalid document', async () => {
      await expect(collection.insert({ name: 123 as any, age: 25 })).rejects.toThrow('Validation failed')
    })

    it('rejects missing required field', async () => {
      await expect(collection.insert({ age: 25 } as any)).rejects.toThrow('required')
    })
  })

  describe('findById', () => {
    it('finds existing document', async () => {
      const inserted = await collection.insert({ name: 'Alice', age: 25 })
      const found = await collection.findById(inserted.id)
      expect(found).toEqual(inserted)
    })

    it('returns null for missing document', async () => {
      const found = await collection.findById('nonexistent')
      expect(found).toBeNull()
    })
  })

  describe('find', () => {
    beforeEach(async () => {
      await collection.insert({ name: 'Alice', age: 25 })
      await collection.insert({ name: 'Bob', age: 35 })
      await collection.insert({ name: 'Charlie', age: 20 })
    })

    it('returns all documents without query', async () => {
      const all = await collection.find()
      expect(all).toHaveLength(3)
    })

    it('filters with where', async () => {
      const result = await collection.find({ where: { age: { $gte: 25 } } })
      expect(result).toHaveLength(2)
    })

    it('sorts with orderBy', async () => {
      const result = await collection.find({ orderBy: { age: 'asc' } })
      expect(result.map((u) => u.name)).toEqual(['Charlie', 'Alice', 'Bob'])
    })

    it('applies limit and offset', async () => {
      const result = await collection.find({ orderBy: { age: 'asc' }, limit: 1, offset: 1 })
      expect(result).toHaveLength(1)
      expect(result[0].name).toBe('Alice')
    })
  })

  describe('findOne', () => {
    it('returns first matching document', async () => {
      await collection.insert({ name: 'Alice', age: 25 })
      await collection.insert({ name: 'Bob', age: 35 })

      const result = await collection.findOne({ where: { name: 'Bob' } })
      expect(result?.name).toBe('Bob')
    })

    it('returns null when nothing matches', async () => {
      const result = await collection.findOne({ where: { name: 'Nobody' } })
      expect(result).toBeNull()
    })
  })

  describe('update', () => {
    it('updates existing document', async () => {
      const user = await collection.insert({ name: 'Alice', age: 25 })
      const updated = await collection.update(user.id, { age: 26 })
      expect(updated.age).toBe(26)
      expect(updated.name).toBe('Alice')
    })

    it('throws for nonexistent document', async () => {
      await expect(collection.update('nonexistent', { age: 30 })).rejects.toThrow('not found')
    })
  })

  describe('upsert', () => {
    it('inserts when document does not exist', async () => {
      const result = await collection.upsert({ id: 'new-1', name: 'New', age: 40 })
      expect(result.id).toBe('new-1')
      expect(result.name).toBe('New')
    })

    it('updates when document exists', async () => {
      const user = await collection.insert({ name: 'Alice', age: 25 })
      const result = await collection.upsert({ id: user.id, name: 'Alice Updated', age: 26 })
      expect(result.name).toBe('Alice Updated')
      expect(result.age).toBe(26)
    })
  })

  describe('delete', () => {
    it('deletes existing document', async () => {
      const user = await collection.insert({ name: 'Alice', age: 25 })
      const result = await collection.delete(user.id)
      expect(result).toBe(true)

      const found = await collection.findById(user.id)
      expect(found).toBeNull()
    })

    it('returns false for nonexistent document', async () => {
      const result = await collection.delete('nonexistent')
      expect(result).toBe(false)
    })
  })

  describe('count', () => {
    it('counts all documents', async () => {
      await collection.insert({ name: 'Alice', age: 25 })
      await collection.insert({ name: 'Bob', age: 35 })
      expect(await collection.count()).toBe(2)
    })

    it('counts with filter', async () => {
      await collection.insert({ name: 'Alice', age: 25 })
      await collection.insert({ name: 'Bob', age: 35 })
      expect(await collection.count({ where: { age: { $gte: 30 } } })).toBe(1)
    })
  })

  describe('insertMany', () => {
    it('inserts multiple documents atomically', async () => {
      const users = await collection.insertMany([
        { name: 'Alice', age: 25 },
        { name: 'Bob', age: 30 },
      ])
      expect(users).toHaveLength(2)
      expect(await collection.count()).toBe(2)
    })

    it('rolls back all on validation error', async () => {
      await expect(
        collection.insertMany([
          { name: 'Alice', age: 25 },
          { name: 123 as any, age: 30 },
        ]),
      ).rejects.toThrow('Validation failed')

      expect(await collection.count()).toBe(0)
    })
  })

  describe('deleteMany', () => {
    it('deletes matching documents', async () => {
      await collection.insert({ name: 'Alice', age: 25 })
      await collection.insert({ name: 'Bob', age: 35 })
      await collection.insert({ name: 'Charlie', age: 20 })

      const count = await collection.deleteMany({ where: { age: { $lt: 30 } } })
      expect(count).toBe(2)
      expect(await collection.count()).toBe(1)
    })
  })

  describe('upsertMany', () => {
    it('inserts new documents', async () => {
      const docs = await collection.upsertMany([
        { id: 'u1', name: 'Alice', age: 25 },
        { id: 'u2', name: 'Bob', age: 30 },
      ])
      expect(docs).toHaveLength(2)
      expect(await collection.findById('u1')).toMatchObject({ name: 'Alice' })
      expect(await collection.findById('u2')).toMatchObject({ name: 'Bob' })
    })

    it('updates existing documents preserving unmentioned fields', async () => {
      await collection.insert({ id: 'u1', name: 'Alice', age: 25, email: 'alice@test.com' } as any)
      const [updated] = await collection.upsertMany([{ id: 'u1', name: 'Alice Updated' }])
      expect(updated.name).toBe('Alice Updated')
      expect(updated.age).toBe(25)
      expect((updated as any).email).toBe('alice@test.com')
    })

    it('handles mix of inserts and updates', async () => {
      await collection.insert({ id: 'u1', name: 'Alice', age: 25 } as any)
      const docs = await collection.upsertMany([
        { id: 'u1', name: 'Alice Updated', age: 26 },
        { id: 'u2', name: 'Bob', age: 30 },
      ])
      expect(docs).toHaveLength(2)
      expect(docs[0].name).toBe('Alice Updated')
      expect(docs[0].age).toBe(26)
      expect(docs[1].name).toBe('Bob')
      expect(await collection.count()).toBe(2)
    })

    it('auto-generates ids when not provided', async () => {
      const docs = await collection.upsertMany([{ name: 'NoId', age: 40 }])
      expect(docs[0].id).toBeDefined()
      expect(docs[0].id).toBe('test-1')
      expect(await collection.findById('test-1')).toMatchObject({ name: 'NoId' })
    })

    it('applies schema defaults on insert', async () => {
      const configWithDefaults: CollectionConfig = {
        schema: {
          name: { type: 'string', required: true },
          age: { type: 'number', required: true },
          role: { type: 'string', default: 'member' },
        },
      }
      const collections2: Record<string, Collection<any>> = {}
      const col2 = new Collection<User & { role: string }>(
        'users2', configWithDefaults, engine, makeId, () => collections2,
      )
      collections2.users2 = col2

      const docs = await col2.upsertMany([{ id: 'u1', name: 'Alice', age: 25 }])
      expect((docs[0] as any).role).toBe('member')
    })

    it('rolls back all changes on error when managing own transaction', async () => {
      await expect(
        collection.upsertMany([
          { id: 'u1', name: 'Alice', age: 25 },
          { id: 'u2', name: 123 as any, age: 30 },
        ]),
      ).rejects.toThrow('Validation failed')

      expect(await collection.findById('u1')).toBeNull()
      expect(await collection.count()).toBe(0)
    })

    it('participates in external transaction', async () => {
      engine.transaction.begin()
      await collection.upsertMany([{ id: 'u1', name: 'Alice', age: 25 }])
      expect(engine.transaction.isActive()).toBe(true)
      await engine.transaction.commit(engine.eventLog, engine.writeQueue, engine.viewStore)

      expect(await collection.findById('u1')).toMatchObject({ name: 'Alice' })
    })

    it('does not commit external transaction on error', async () => {
      engine.transaction.begin()
      await collection.insert({ id: 'u0', name: 'Valid', age: 20 } as any)

      await expect(
        collection.upsertMany([{ id: 'u1', name: 123 as any, age: 30 }]),
      ).rejects.toThrow('Validation failed')

      expect(engine.transaction.isActive()).toBe(true)
      engine.transaction.rollback(engine.cache)
      expect(await collection.findById('u0')).toBeNull()
    })

    it('does not rollback external transaction on error', async () => {
      engine.transaction.begin()
      await collection.insert({ id: 'u0', name: 'Valid', age: 20 } as any)

      await expect(
        collection.upsertMany([{ id: 'u1', name: 123 as any, age: 30 }]),
      ).rejects.toThrow('Validation failed')

      expect(engine.transaction.isActive()).toBe(true)

      await engine.transaction.commit(engine.eventLog, engine.writeQueue, engine.viewStore)
      expect(await collection.findById('u0')).toMatchObject({ name: 'Valid' })
    })

    it('returns empty array for empty input', async () => {
      const docs = await collection.upsertMany([])
      expect(docs).toEqual([])
    })

    it('handles large batch', async () => {
      const items = Array.from({ length: 100 }, (_, i) => ({
        id: `bulk-${i}`,
        name: `User ${i}`,
        age: 20 + (i % 50),
      }))

      const docs = await collection.upsertMany(items)
      expect(docs).toHaveLength(100)
      expect(await collection.count()).toBe(100)
    })
  })

  describe('insertMany with external transaction', () => {
    it('does not commit parent transaction', async () => {
      engine.transaction.begin()
      await collection.insertMany([{ name: 'Alice', age: 25 }])
      expect(engine.transaction.isActive()).toBe(true)
      await collection.insertMany([{ name: 'Bob', age: 30 }])
      expect(engine.transaction.isActive()).toBe(true)
      await engine.transaction.commit(engine.eventLog, engine.writeQueue, engine.viewStore)

      expect(await collection.count()).toBe(2)
    })

    it('does not rollback parent transaction on error', async () => {
      engine.transaction.begin()
      await collection.insertMany([{ name: 'Alice', age: 25 }])

      await expect(
        collection.insertMany([{ name: 123 as any, age: 30 }]),
      ).rejects.toThrow('Validation failed')

      expect(engine.transaction.isActive()).toBe(true)
    })

    it('still manages own transaction when no parent', async () => {
      await collection.insertMany([{ name: 'Alice', age: 25 }])
      expect(engine.transaction.isActive()).toBe(false)
      expect(await collection.count()).toBe(1)
    })

    it('writes from later operations are buffered within parent transaction', async () => {
      engine.transaction.begin()
      await collection.insertMany([{ id: 'a', name: 'Alice', age: 25 } as any])
      await collection.insert({ id: 'b', name: 'Bob', age: 30 } as any)

      engine.transaction.rollback(engine.cache)

      expect(await collection.findById('a')).toBeNull()
      expect(await collection.findById('b')).toBeNull()
    })
  })

  describe('delete inside transaction', () => {
    it('removes view file from disk on commit', async () => {
      const user = await collection.insert({ id: 'del-1', name: 'Alice', age: 25 } as any)
      await engine.flush()

      engine.transaction.begin()
      await collection.delete(user.id)
      await engine.transaction.commit(engine.eventLog, engine.writeQueue, engine.viewStore)
      await engine.flush()

      expect(await collection.findById('del-1')).toBeNull()
      expect(await engine.viewStore.loadOne('users', 'del-1')).toBeNull()
    })

    it('does not leave null file on disk after commit', async () => {
      await collection.insert({ id: 'del-2', name: 'Bob', age: 30 } as any)
      await engine.flush()

      engine.transaction.begin()
      await collection.delete('del-2')
      await engine.transaction.commit(engine.eventLog, engine.writeQueue, engine.viewStore)
      await engine.flush()

      const allDocs = await engine.viewStore.loadAll('users')
      expect(allDocs['del-2']).toBeUndefined()
    })
  })

  describe('deleteMany with external transaction', () => {
    it('does not commit parent transaction', async () => {
      await collection.insert({ id: 'a', name: 'Alice', age: 25 } as any)
      await collection.insert({ id: 'b', name: 'Bob', age: 35 } as any)

      engine.transaction.begin()
      await collection.deleteMany({ where: { name: 'Alice' } })
      expect(engine.transaction.isActive()).toBe(true)
      await engine.transaction.commit(engine.eventLog, engine.writeQueue, engine.viewStore)

      expect(await collection.findById('a')).toBeNull()
      expect(await collection.findById('b')).toMatchObject({ name: 'Bob' })
    })

    it('still manages own transaction when no parent', async () => {
      await collection.insert({ id: 'a', name: 'Alice', age: 25 } as any)
      await collection.deleteMany({ where: { name: 'Alice' } })
      expect(engine.transaction.isActive()).toBe(false)
      expect(await collection.findById('a')).toBeNull()
    })
  })
})
