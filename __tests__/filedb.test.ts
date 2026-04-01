import { createFileDB, FileDB } from '../src/filedb'
import { MockFileSystem } from './mock-fs'
import type { Document, FileDBConfig } from '../src/types'

interface User extends Document {
  name: string
  age: number
}

interface Post extends Document {
  title: string
  authorId: string
}

const config: FileDBConfig = {
  name: 'testdb',
  version: 1,
  collections: {
    users: {
      schema: {
        name: { type: 'string', required: true },
        age: { type: 'number', required: true },
      },
      relationships: {
        posts: { type: 'has-many', collection: 'posts', foreignKey: 'authorId' },
      },
    },
    posts: {
      schema: {
        title: { type: 'string', required: true },
        authorId: { type: 'string', required: true },
      },
      relationships: {
        author: { type: 'belongs-to', collection: 'users', localKey: 'authorId' },
      },
    },
  },
}

describe('FileDB', () => {
  let db: FileDB
  let mockFs: MockFileSystem

  beforeEach(async () => {
    mockFs = new MockFileSystem()
    db = await createFileDB(config, mockFs, '/root')
  })

  afterEach(async () => {
    await db.close()
  })

  it('creates database with configured collections', () => {
    expect(db.collections.users).toBeDefined()
    expect(db.collections.posts).toBeDefined()
  })

  it('performs full CRUD cycle', async () => {
    const user = await db.collections.users.insert({ name: 'Alice', age: 25 })
    expect(user.name).toBe('Alice')

    const updated = await db.collections.users.update(user.id, { age: 26 })
    expect(updated.age).toBe(26)

    const found = await db.collections.users.findById(user.id)
    expect(found?.age).toBe(26)

    await db.collections.users.delete(user.id)
    const deleted = await db.collections.users.findById(user.id)
    expect(deleted).toBeNull()
  })

  describe('transactions', () => {
    it('commits all writes atomically', async () => {
      const result = await db.transaction(async (tx) => {
        const user = await tx.collections.users.insert({ name: 'John', age: 30 })
        const post = await tx.collections.posts.insert({ title: 'Hello', authorId: user.id })
        return { user, post }
      })

      expect(result.user.name).toBe('John')
      expect(result.post.title).toBe('Hello')

      const users = await db.collections.users.find()
      expect(users).toHaveLength(1)
    })

    it('rolls back on error', async () => {
      await db.collections.users.insert({ name: 'Existing', age: 25 })

      await expect(
        db.transaction(async (tx) => {
          await tx.collections.users.insert({ name: 'New', age: 30 })
          throw new Error('Simulated failure')
        }),
      ).rejects.toThrow('Simulated failure')

      const users = await db.collections.users.find()
      expect(users).toHaveLength(1)
      expect(users[0].name).toBe('Existing')
    })
  })

  describe('relationships', () => {
    it('resolves has-many via include', async () => {
      const user = await db.collections.users.insert({ name: 'Alice', age: 25 })
      await db.collections.posts.insert({ title: 'Post 1', authorId: user.id })
      await db.collections.posts.insert({ title: 'Post 2', authorId: user.id })

      const usersWithPosts = await db.collections.users.find({ include: ['posts'] })
      expect(usersWithPosts[0].posts).toHaveLength(2)
    })

    it('resolves belongs-to via include', async () => {
      const user = await db.collections.users.insert({ name: 'Alice', age: 25 })
      await db.collections.posts.insert({ title: 'Post 1', authorId: user.id })

      const postsWithAuthor = await db.collections.posts.find({ include: ['author'] })
      expect(postsWithAuthor[0].author.name).toBe('Alice')
    })
  })

  describe('export / import', () => {
    it('exports and imports data', async () => {
      await db.collections.users.insert({ name: 'Alice', age: 25 })
      await db.collections.users.insert({ name: 'Bob', age: 30 })

      const dump = await db.exportJSON()
      expect(dump.collections.users).toHaveLength(2)

      const db2 = await createFileDB(config, new MockFileSystem(), '/root2')
      await db2.importJSON(dump)

      const imported = await db2.collections.users.find()
      expect(imported).toHaveLength(2)
      await db2.close()
    })
  })

  describe('observables', () => {
    it('notifies subscribers on insert', async () => {
      const results: any[][] = []
      const sub = db.collections.users.observe().subscribe((data) => {
        results.push([...data])
      })

      await db.collections.users.insert({ name: 'Alice', age: 25 })
      await new Promise((r) => setTimeout(r, 50))

      expect(results.length).toBeGreaterThanOrEqual(2)
      sub.unsubscribe()
    })

    it('observeOne tracks a single document', async () => {
      const user = await db.collections.users.insert({ name: 'Alice', age: 25 })
      const snapshots: any[] = []

      const sub = db.collections.users.observeOne(user.id).subscribe((doc) => {
        snapshots.push(doc ? { ...doc } : null)
      })

      await db.collections.users.update(user.id, { age: 26 })
      await new Promise((r) => setTimeout(r, 50))

      expect(snapshots.length).toBeGreaterThanOrEqual(2)
      expect(snapshots[snapshots.length - 1]?.age).toBe(26)
      sub.unsubscribe()
    })
  })

  describe('event log', () => {
    it('records events for all mutations', async () => {
      await db.collections.users.insert({ name: 'Alice', age: 25 })
      const user = await db.collections.users.insert({ name: 'Bob', age: 30 })
      await db.collections.users.update(user.id, { age: 31 })
      await db.collections.users.delete(user.id)

      const events = await db.loadEvents()
      expect(events.length).toBeGreaterThanOrEqual(4)
    })

    it('clears events', async () => {
      await db.collections.users.insert({ name: 'Alice', age: 25 })
      await db.clearEvents()

      const events = await db.loadEvents()
      expect(events).toHaveLength(0)
    })
  })

  describe('destroy', () => {
    it('removes all data', async () => {
      await db.collections.users.insert({ name: 'Alice', age: 25 })
      await db.destroy()

      const db2 = await createFileDB(config, mockFs, '/root')
      const users = await db2.collections.users.find()
      expect(users).toHaveLength(0)
      await db2.close()
    })
  })
})
