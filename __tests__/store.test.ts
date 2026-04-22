import { createStore } from '../src/store'
import { defineModel, field } from '../src/model'
import { MockFileSystem } from './mock-fs'
import type { Document } from '../src/types'

interface User extends Document {
  name: string
  age: number
  email?: string
}

interface Post extends Document {
  title: string
  authorId: string
}

const UserModel = defineModel<User>('users', {
  name: field('string').required(),
  age: field('number').required(),
  email: field('string'),
})

const PostModel = defineModel<Post>('posts', {
  title: field('string').required(),
  authorId: field('string').required().indexed(),
}, {
  relationships: {
    author: { type: 'belongs-to', collection: 'users', localKey: 'authorId' },
  },
})

describe('createStore (declarative API)', () => {
  async function makeStore() {
    return createStore({
      name: 'testdb',
      models: { users: UserModel, posts: PostModel },
      fileSystem: new MockFileSystem(),
      rootPath: '/root',
    })
  }

  it('creates a store with typed collection accessors', async () => {
    const store = await makeStore()
    expect(store.users).toBeDefined()
    expect(store.posts).toBeDefined()
    await store.close()
  })

  it('performs CRUD through the store', async () => {
    const store = await makeStore()

    const user = await store.users.insert({ name: 'Alice', age: 25 })
    expect(user.name).toBe('Alice')

    const found = await store.users.findById(user.id)
    expect(found?.age).toBe(25)

    const updated = await store.users.update(user.id, { age: 26 })
    expect(updated.age).toBe(26)

    await store.users.delete(user.id)
    expect(await store.users.findById(user.id)).toBeNull()

    await store.close()
  })

  it('supports transactions via store.transaction()', async () => {
    const store = await makeStore()

    const result = await store.transaction(async (s) => {
      const user = await s.users.insert({ name: 'Bob', age: 30 })
      const post = await s.posts.insert({ title: 'Hello', authorId: user.id })
      return { user, post }
    })

    expect(result.user.name).toBe('Bob')
    expect(result.post.title).toBe('Hello')

    const users = await store.users.find()
    expect(users).toHaveLength(1)

    await store.close()
  })

  it('rolls back transactions on error', async () => {
    const store = await makeStore()
    await store.users.insert({ name: 'Existing', age: 25 })

    await expect(
      store.transaction(async (s) => {
        await s.users.insert({ name: 'New', age: 30 })
        throw new Error('Boom')
      }),
    ).rejects.toThrow('Boom')

    const users = await store.users.find()
    expect(users).toHaveLength(1)
    expect(users[0].name).toBe('Existing')

    await store.close()
  })

  it('supports queries with operators', async () => {
    const store = await makeStore()

    await store.users.insert({ name: 'Alice', age: 20 })
    await store.users.insert({ name: 'Bob', age: 30 })
    await store.users.insert({ name: 'Charlie', age: 40 })

    const adults = await store.users.find({
      where: { age: { $gte: 25 } },
      orderBy: { age: 'asc' },
    })

    expect(adults.map((u) => u.name)).toEqual(['Bob', 'Charlie'])

    await store.close()
  })

  it('supports relationships via include', async () => {
    const store = await makeStore()

    const user = await store.users.insert({ name: 'Alice', age: 25 })
    await store.posts.insert({ title: 'Post 1', authorId: user.id })

    const posts = await store.posts.find({ include: ['author'] })
    expect((posts[0] as any).author.name).toBe('Alice')

    await store.close()
  })

  it('delete inside transaction removes document from disk', async () => {
    const sharedFs = new MockFileSystem()
    const store = await createStore({
      name: 'testdb', models: { users: UserModel, posts: PostModel },
      fileSystem: sharedFs, rootPath: '/root',
    })
    const user = await store.users.insert({ name: 'Alice', age: 25 })
    await store.flush()

    await store.transaction(async (s) => {
      await s.users.delete(user.id)
    })
    await store.flush()
    await store.close()

    const store2 = await createStore({
      name: 'testdb', models: { users: UserModel, posts: PostModel },
      fileSystem: sharedFs, rootPath: '/root',
    })
    expect(await store2.users.findById(user.id)).toBeNull()
    expect(await store2.users.find()).toHaveLength(0)
    await store2.close()
  })

  it('insert+delete in same transaction results in no document on disk', async () => {
    const sharedFs = new MockFileSystem()
    const store = await createStore({
      name: 'testdb', models: { users: UserModel, posts: PostModel },
      fileSystem: sharedFs, rootPath: '/root',
    })

    await store.transaction(async (s) => {
      await s.users.insert({ id: 'temp-1', name: 'Temp', age: 99 } as any)
      await s.users.delete('temp-1')
    })
    await store.flush()
    await store.close()

    const store2 = await createStore({
      name: 'testdb', models: { users: UserModel, posts: PostModel },
      fileSystem: sharedFs, rootPath: '/root',
    })
    expect(await store2.users.findById('temp-1')).toBeNull()
    expect(await store2.users.find()).toHaveLength(0)
    await store2.close()
  })

  it('rolls back delete inside transaction correctly', async () => {
    const store = await makeStore()
    await store.users.insert({ id: 'keep-1', name: 'Keep', age: 40 } as any)

    await expect(
      store.transaction(async (s) => {
        await s.users.delete('keep-1')
        throw new Error('Abort')
      }),
    ).rejects.toThrow('Abort')

    const found = await store.users.findById('keep-1')
    expect(found?.name).toBe('Keep')

    await store.close()
  })

  it('supports flush, export, and destroy', async () => {
    const store = await makeStore()
    await store.users.insert({ name: 'Alice', age: 25 })

    await store.flush()

    const dump = await store.exportJSON()
    expect(dump.collections.users).toHaveLength(1)

    await store.destroy()
    await store.close()
  })
})

describe('defineModel + field builder', () => {
  it('builds schema from field builders', () => {
    const model = defineModel('test', {
      name: field('string').required(),
      age: field('number').default(0),
      email: field('string').indexed(),
    })

    expect(model.collectionName).toBe('test')
    expect(model.schema.name).toEqual({ type: 'string', required: true })
    expect(model.schema.age).toEqual({ type: 'number', default: 0 })
    expect(model.schema.email).toEqual({ type: 'string', indexed: true })
  })

  it('supports custom validators', () => {
    const model = defineModel('test', {
      score: field('number').validate((v) => v >= 0 || 'Must be positive'),
    })

    expect(model.schema.score.validate).toBeDefined()
    expect(model.schema.score.validate!(5)).toBe(true)
    expect(model.schema.score.validate!(-1)).toBe('Must be positive')
  })

  it('accepts raw FieldSchema objects', () => {
    const model = defineModel('test', {
      name: { type: 'string', required: true },
    })

    expect(model.schema.name).toEqual({ type: 'string', required: true })
  })
})
