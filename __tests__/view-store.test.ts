import { ViewStore } from '../src/storage/view-store'
import { FileSystemAdapter } from '../src/storage/fs-adapter'
import { MockFileSystem } from './mock-fs'

describe('ViewStore', () => {
  let mockFs: MockFileSystem
  let fs: FileSystemAdapter
  let viewStore: ViewStore

  beforeEach(() => {
    mockFs = new MockFileSystem()
    fs = new FileSystemAdapter(mockFs)
    viewStore = new ViewStore('/db/views', fs)
  })

  describe('loadAll', () => {
    it('loads all documents from a collection', async () => {
      await viewStore.write('users', 'u1', { id: 'u1', name: 'Alice' })
      await viewStore.write('users', 'u2', { id: 'u2', name: 'Bob' })

      const docs = await viewStore.loadAll('users')
      expect(Object.keys(docs)).toHaveLength(2)
      expect(docs['u1']).toEqual({ id: 'u1', name: 'Alice' })
      expect(docs['u2']).toEqual({ id: 'u2', name: 'Bob' })
    })

    it('returns empty record for nonexistent collection', async () => {
      const docs = await viewStore.loadAll('nonexistent')
      expect(Object.keys(docs)).toHaveLength(0)
    })

    it('skips and deletes corrupted null files', async () => {
      await viewStore.write('users', 'good', { id: 'good', name: 'Valid' })
      await fs.writeFile('/db/views/users/corrupted', 'null')

      const docs = await viewStore.loadAll('users')
      expect(Object.keys(docs)).toHaveLength(1)
      expect(docs['good']).toEqual({ id: 'good', name: 'Valid' })
      expect(await fs.exists('/db/views/users/corrupted')).toBe(false)
    })

    it('handles collection with only corrupted files', async () => {
      await fs.writeFile('/db/views/users/bad1', 'null')
      await fs.writeFile('/db/views/users/bad2', 'null')

      const docs = await viewStore.loadAll('users')
      expect(Object.keys(docs)).toHaveLength(0)
      expect(await fs.exists('/db/views/users/bad1')).toBe(false)
      expect(await fs.exists('/db/views/users/bad2')).toBe(false)
    })
  })

  describe('loadOne', () => {
    it('loads a single document', async () => {
      await viewStore.write('users', 'u1', { id: 'u1', name: 'Alice' })
      const doc = await viewStore.loadOne('users', 'u1')
      expect(doc).toEqual({ id: 'u1', name: 'Alice' })
    })

    it('returns null for nonexistent document', async () => {
      const doc = await viewStore.loadOne('users', 'missing')
      expect(doc).toBeNull()
    })

    it('returns null and deletes corrupted null file', async () => {
      await fs.writeFile('/db/views/users/corrupted', 'null')
      const doc = await viewStore.loadOne('users', 'corrupted')
      expect(doc).toBeNull()
      expect(await fs.exists('/db/views/users/corrupted')).toBe(false)
    })
  })

  describe('write and delete', () => {
    it('writes and reads back a document', async () => {
      await viewStore.write('users', 'u1', { id: 'u1', name: 'Alice' })
      const doc = await viewStore.loadOne('users', 'u1')
      expect(doc).toEqual({ id: 'u1', name: 'Alice' })
    })

    it('delete removes the file', async () => {
      await viewStore.write('users', 'u1', { id: 'u1', name: 'Alice' })
      await viewStore.delete('users', 'u1')
      const doc = await viewStore.loadOne('users', 'u1')
      expect(doc).toBeNull()
    })
  })
})
