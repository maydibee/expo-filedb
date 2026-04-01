import { createStore } from '../src/store'
import { defineModel, field } from '../src/model'
import { migrate } from '../src/migration'
import { MockFileSystem } from './mock-fs'
import type { Document } from '../src/types'

interface UserV1 extends Document {
  name: string
  age: number
}

interface UserV2 extends Document {
  name: string
  age: number
  role: string
}

interface UserV3 extends Document {
  fullName: string
  age: number
  role: string
}

describe('Migration system', () => {
  it('runs addField migration', async () => {
    const mockFs = new MockFileSystem()

    const UserV1Model = defineModel<UserV1>('users', {
      name: field('string').required(),
      age: field('number').required(),
    })

    const storeV1 = await createStore({
      name: 'testdb',
      version: 1,
      models: { users: UserV1Model },
      fileSystem: mockFs,
      rootPath: '/root',
    })

    await storeV1.users.insert({ name: 'Alice', age: 25 })
    await storeV1.users.insert({ name: 'Bob', age: 30 })
    await storeV1.flush()
    await storeV1.close()

    const UserV2Model = defineModel<UserV2>('users', {
      name: field('string').required(),
      age: field('number').required(),
      role: field('string'),
    })

    const storeV2 = await createStore({
      name: 'testdb',
      version: 2,
      models: { users: UserV2Model },
      migrations: [
        migrate(1, 2).addField('users', 'role', 'member').build(),
      ],
      fileSystem: mockFs,
      rootPath: '/root',
    })

    const users = await storeV2.users.find()
    expect(users).toHaveLength(2)
    expect(users.every((u) => (u as any).role === 'member')).toBe(true)

    await storeV2.close()
  })

  it('runs renameField migration', async () => {
    const mockFs = new MockFileSystem()

    const ModelV1 = defineModel('items', {
      name: field('string').required(),
    })

    const s1 = await createStore({
      name: 'testdb',
      version: 1,
      models: { items: ModelV1 },
      fileSystem: mockFs,
      rootPath: '/root',
    })

    await s1.items.insert({ name: 'Widget' })
    await s1.flush()
    await s1.close()

    const ModelV2 = defineModel('items', {
      title: field('string').required(),
    })

    const s2 = await createStore({
      name: 'testdb',
      version: 2,
      models: { items: ModelV2 },
      migrations: [
        migrate(1, 2).renameField('items', 'name', 'title').build(),
      ],
      fileSystem: mockFs,
      rootPath: '/root',
    })

    const items = await s2.items.find()
    expect(items).toHaveLength(1)
    expect((items[0] as any).title).toBe('Widget')
    expect((items[0] as any).name).toBeUndefined()

    await s2.close()
  })

  it('runs transformField migration', async () => {
    const mockFs = new MockFileSystem()

    const Model = defineModel('items', {
      price: field('number').required(),
    })

    const s1 = await createStore({
      name: 'testdb',
      version: 1,
      models: { items: Model },
      fileSystem: mockFs,
      rootPath: '/root',
    })

    await s1.items.insert({ price: 100 })
    await s1.items.insert({ price: 200 })
    await s1.flush()
    await s1.close()

    const s2 = await createStore({
      name: 'testdb',
      version: 2,
      models: { items: Model },
      migrations: [
        migrate(1, 2).transformField('items', 'price', (v) => v * 1.1).build(),
      ],
      fileSystem: mockFs,
      rootPath: '/root',
    })

    const items = await s2.items.find({ orderBy: { price: 'asc' } })
    expect(items[0].price).toBeCloseTo(110)
    expect(items[1].price).toBeCloseTo(220)

    await s2.close()
  })

  it('chains multiple migrations (v1 → v2 → v3)', async () => {
    const mockFs = new MockFileSystem()

    const ModelV1 = defineModel<UserV1>('users', {
      name: field('string').required(),
      age: field('number').required(),
    })

    const s1 = await createStore({
      name: 'testdb',
      version: 1,
      models: { users: ModelV1 },
      fileSystem: mockFs,
      rootPath: '/root',
    })

    await s1.users.insert({ name: 'Alice', age: 25 })
    await s1.flush()
    await s1.close()

    const ModelV3 = defineModel<UserV3>('users', {
      fullName: field('string').required(),
      age: field('number').required(),
      role: field('string'),
    })

    const s3 = await createStore({
      name: 'testdb',
      version: 3,
      models: { users: ModelV3 },
      migrations: [
        migrate(1, 2).addField('users', 'role', 'member').build(),
        migrate(2, 3).renameField('users', 'name', 'fullName').build(),
      ],
      fileSystem: mockFs,
      rootPath: '/root',
    })

    const users = await s3.users.find()
    expect(users).toHaveLength(1)
    expect((users[0] as any).fullName).toBe('Alice')
    expect((users[0] as any).role).toBe('member')
    expect((users[0] as any).name).toBeUndefined()

    await s3.close()
  })

  it('handles removeField migration', async () => {
    const mockFs = new MockFileSystem()

    const ModelV1 = defineModel('items', {
      name: field('string').required(),
      deprecated: field('string'),
    })

    const s1 = await createStore({
      name: 'testdb',
      version: 1,
      models: { items: ModelV1 },
      fileSystem: mockFs,
      rootPath: '/root',
    })

    await s1.items.insert({ name: 'Widget', deprecated: 'old-value' })
    await s1.flush()
    await s1.close()

    const ModelV2 = defineModel('items', {
      name: field('string').required(),
    })

    const s2 = await createStore({
      name: 'testdb',
      version: 2,
      models: { items: ModelV2 },
      migrations: [
        migrate(1, 2).removeField('items', 'deprecated').build(),
      ],
      fileSystem: mockFs,
      rootPath: '/root',
    })

    const items = await s2.items.find()
    expect(items).toHaveLength(1)
    expect((items[0] as any).deprecated).toBeUndefined()

    await s2.close()
  })

  it('custom migration function', async () => {
    const mockFs = new MockFileSystem()

    const Model = defineModel('items', {
      name: field('string').required(),
      tags: field('array'),
    })

    const s1 = await createStore({
      name: 'testdb',
      version: 1,
      models: { items: Model },
      fileSystem: mockFs,
      rootPath: '/root',
    })

    await s1.items.insert({ name: 'Widget', tags: ['a', 'b'] })
    await s1.flush()
    await s1.close()

    const s2 = await createStore({
      name: 'testdb',
      version: 2,
      models: { items: Model },
      migrations: [
        migrate(1, 2).custom(async (db) => {
          const items = await db.collections.items.find()
          for (const item of items) {
            await db.collections.items.update(item.id, {
              tags: [...(item.tags ?? []), 'migrated'],
            })
          }
        }).build(),
      ],
      fileSystem: mockFs,
      rootPath: '/root',
    })

    const items = await s2.items.find()
    expect(items[0].tags).toContain('migrated')

    await s2.close()
  })

  it('skips migration when versions match', async () => {
    const mockFs = new MockFileSystem()
    let migrationRan = false

    const Model = defineModel('items', {
      name: field('string').required(),
    })

    const s1 = await createStore({
      name: 'testdb',
      version: 1,
      models: { items: Model },
      fileSystem: mockFs,
      rootPath: '/root',
    })
    await s1.flush()
    await s1.close()

    const s2 = await createStore({
      name: 'testdb',
      version: 1,
      models: { items: Model },
      migrations: [
        migrate(1, 2).custom(async () => { migrationRan = true }).build(),
      ],
      fileSystem: mockFs,
      rootPath: '/root',
    })

    expect(migrationRan).toBe(false)
    await s2.close()
  })

  it('persists version after successful migration', async () => {
    const mockFs = new MockFileSystem()

    const Model = defineModel('items', {
      name: field('string').required(),
    })

    const s1 = await createStore({
      name: 'testdb',
      version: 1,
      models: { items: Model },
      fileSystem: mockFs,
      rootPath: '/root',
    })
    await s1.items.insert({ name: 'Test' })
    await s1.flush()
    await s1.close()

    let migrationCount = 0
    const s2 = await createStore({
      name: 'testdb',
      version: 2,
      models: { items: Model },
      migrations: [
        migrate(1, 2).custom(async () => { migrationCount++ }).build(),
      ],
      fileSystem: mockFs,
      rootPath: '/root',
    })
    await s2.flush()
    await s2.close()

    expect(migrationCount).toBe(1)

    const s3 = await createStore({
      name: 'testdb',
      version: 2,
      models: { items: Model },
      migrations: [
        migrate(1, 2).custom(async () => { migrationCount++ }).build(),
      ],
      fileSystem: mockFs,
      rootPath: '/root',
    })
    await s3.close()

    expect(migrationCount).toBe(1)
  })
})

describe('MigrationBuilder', () => {
  it('chains multiple operations in a single step', async () => {
    const step = migrate(1, 2)
      .addField('users', 'role', 'member')
      .transformField('users', 'age', (v) => v + 1)
      .build()

    expect(step.fromVersion).toBe(1)
    expect(step.toVersion).toBe(2)
    expect(typeof step.migrate).toBe('function')
  })
})
