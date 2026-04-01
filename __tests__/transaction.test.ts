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
})
