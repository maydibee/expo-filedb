import { TransactionManager } from '../src/transaction'
import { EventLog } from '../src/storage/event-log'
import { FileSystemAdapter } from '../src/storage/fs-adapter'
import { MemoryCache } from '../src/storage/memory-cache'
import { ViewStore } from '../src/storage/view-store'
import { WriteQueue } from '../src/storage/write-queue'
import { MockFileSystem } from './mock-fs'
import type { DatabaseEvent } from '../src/types'

function makeEvent(overrides: Partial<DatabaseEvent> = {}): DatabaseEvent {
  return {
    id: 'evt-1',
    type: 'insert',
    collection: 'users',
    documentId: 'doc-1',
    data: { id: 'doc-1', name: 'Test' },
    timestamp: new Date().toISOString(),
    ...overrides,
  }
}

describe('TransactionManager', () => {
  let tx: TransactionManager
  let cache: MemoryCache
  let eventLog: EventLog
  let viewStore: ViewStore
  let writeQueue: WriteQueue
  let fs: FileSystemAdapter

  beforeEach(() => {
    const mockFs = new MockFileSystem()
    fs = new FileSystemAdapter(mockFs)
    tx = new TransactionManager()
    cache = new MemoryCache()
    eventLog = new EventLog('/db/event_log', fs)
    viewStore = new ViewStore('/db/views', fs)
    writeQueue = new WriteQueue(10)
  })

  it('starts inactive', () => {
    expect(tx.isActive()).toBe(false)
  })

  it('becomes active after begin', () => {
    tx.begin()
    expect(tx.isActive()).toBe(true)
  })

  it('becomes inactive after commit', async () => {
    tx.begin()
    await tx.commit(eventLog, writeQueue, viewStore)
    expect(tx.isActive()).toBe(false)
  })

  it('becomes inactive after rollback', () => {
    tx.begin()
    tx.rollback(cache)
    expect(tx.isActive()).toBe(false)
  })

  it('commit writes buffered events as one segment', async () => {
    tx.begin()
    tx.bufferEvent(makeEvent({ documentId: 'a' }))
    tx.bufferEvent(makeEvent({ documentId: 'b' }))
    await tx.commit(eventLog, writeQueue, viewStore)
    await writeQueue.flush()

    const events = await eventLog.loadAll()
    expect(events).toHaveLength(2)
  })

  it('commit enqueues view writes', async () => {
    tx.begin()
    tx.bufferView('users', 'doc-1', { id: 'doc-1', name: 'John' }, undefined)
    await tx.commit(eventLog, writeQueue, viewStore)
    await writeQueue.flush()

    const doc = await viewStore.loadOne('users', 'doc-1')
    expect(doc).toEqual({ id: 'doc-1', name: 'John' })
  })

  it('rollback reverts cache to previous state', () => {
    cache.set('users', 'doc-1', { id: 'doc-1', name: 'Original' })

    tx.begin()
    cache.set('users', 'doc-1', { id: 'doc-1', name: 'Changed' })
    tx.bufferView('users', 'doc-1', { id: 'doc-1', name: 'Changed' }, { id: 'doc-1', name: 'Original' })
    tx.rollback(cache)

    expect(cache.get('users', 'doc-1')).toEqual({ id: 'doc-1', name: 'Original' })
  })

  it('rollback removes newly inserted documents from cache', () => {
    tx.begin()
    cache.set('users', 'new-1', { id: 'new-1', name: 'New' })
    tx.bufferView('users', 'new-1', { id: 'new-1', name: 'New' }, undefined)
    tx.rollback(cache)

    expect(cache.get('users', 'new-1')).toBeUndefined()
  })

  it('commit deletes view file when data is null', async () => {
    const doc = { id: 'doc-1', name: 'Test' }
    await viewStore.write('users', 'doc-1', doc)

    tx.begin()
    tx.bufferView('users', 'doc-1', null, doc)
    await tx.commit(eventLog, writeQueue, viewStore)
    await writeQueue.flush()

    const loaded = await viewStore.loadOne('users', 'doc-1')
    expect(loaded).toBeNull()
  })

  it('commit writes document when data is present', async () => {
    const doc = { id: 'doc-1', name: 'Updated' }

    tx.begin()
    tx.bufferView('users', 'doc-1', doc, undefined)
    await tx.commit(eventLog, writeQueue, viewStore)
    await writeQueue.flush()

    const loaded = await viewStore.loadOne('users', 'doc-1')
    expect(loaded).toEqual(doc)
  })

  it('commit handles mixed writes and deletes', async () => {
    const existing = { id: 'del-1', name: 'ToDelete' }
    await viewStore.write('users', 'del-1', existing)

    tx.begin()
    tx.bufferView('users', 'del-1', null, existing)
    tx.bufferView('users', 'new-1', { id: 'new-1', name: 'Created' }, undefined)
    await tx.commit(eventLog, writeQueue, viewStore)
    await writeQueue.flush()

    expect(await viewStore.loadOne('users', 'del-1')).toBeNull()
    expect(await viewStore.loadOne('users', 'new-1')).toEqual({ id: 'new-1', name: 'Created' })
  })

  it('commit settles insert+delete of same doc to deletion via WriteQueue dedup', async () => {
    tx.begin()
    tx.bufferView('users', 'tmp-1', { id: 'tmp-1', name: 'Temp' }, undefined)
    tx.bufferView('users', 'tmp-1', null, { id: 'tmp-1', name: 'Temp' })
    await tx.commit(eventLog, writeQueue, viewStore)
    await writeQueue.flush()

    expect(await viewStore.loadOne('users', 'tmp-1')).toBeNull()
  })

  it('rollback correctly reverts insert+delete of same document', () => {
    tx.begin()
    cache.set('users', 'tmp-1', { id: 'tmp-1', name: 'Temp' })
    tx.bufferView('users', 'tmp-1', { id: 'tmp-1', name: 'Temp' }, undefined)
    cache.delete('users', 'tmp-1')
    tx.bufferView('users', 'tmp-1', null, { id: 'tmp-1', name: 'Temp' })
    tx.rollback(cache)

    expect(cache.get('users', 'tmp-1')).toBeUndefined()
  })

  it('rollback correctly reverts update+delete of same document', () => {
    cache.set('users', 'doc-1', { id: 'doc-1', name: 'Original' })

    tx.begin()
    cache.set('users', 'doc-1', { id: 'doc-1', name: 'Updated' })
    tx.bufferView('users', 'doc-1', { id: 'doc-1', name: 'Updated' }, { id: 'doc-1', name: 'Original' })
    cache.delete('users', 'doc-1')
    tx.bufferView('users', 'doc-1', null, { id: 'doc-1', name: 'Updated' })
    tx.rollback(cache)

    expect(cache.get('users', 'doc-1')).toEqual({ id: 'doc-1', name: 'Original' })
  })
})
