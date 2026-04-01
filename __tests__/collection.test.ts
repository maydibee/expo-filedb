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
})
