import { EventLog } from '../src/storage/event-log'
import { FileSystemAdapter } from '../src/storage/fs-adapter'
import { MockFileSystem } from './mock-fs'
import type { DatabaseEvent } from '../src/types'

function makeEvent(overrides: Partial<DatabaseEvent> = {}): DatabaseEvent {
  return {
    id: `evt-${Math.random().toString(36).slice(2, 8)}`,
    type: 'insert',
    collection: 'users',
    documentId: 'doc-1',
    data: { name: 'Test' },
    timestamp: new Date().toISOString(),
    ...overrides,
  }
}

describe('EventLog', () => {
  let mockFs: MockFileSystem
  let fs: FileSystemAdapter
  let log: EventLog

  beforeEach(() => {
    mockFs = new MockFileSystem()
    fs = new FileSystemAdapter(mockFs)
    log = new EventLog('/db/event_log', fs)
  })

  it('appends events and loads them back', async () => {
    const events = [makeEvent({ documentId: 'a' }), makeEvent({ documentId: 'b' })]
    await log.append(events)

    const loaded = await log.loadAll()
    expect(loaded).toHaveLength(2)
    expect(loaded.map((e) => e.documentId).sort()).toEqual(['a', 'b'])
  })

  it('creates separate segment files per append', async () => {
    await log.append([makeEvent({ documentId: '1' })])
    await new Promise((r) => setTimeout(r, 5))
    await log.append([makeEvent({ documentId: '2' })])

    const loaded = await log.loadAll()
    expect(loaded).toHaveLength(2)
  })

  it('returns empty array when no segments exist', async () => {
    const loaded = await log.loadAll()
    expect(loaded).toEqual([])
  })

  it('clears all segments', async () => {
    await log.append([makeEvent()])
    await log.clear()

    const loaded = await log.loadAll()
    expect(loaded).toEqual([])
  })

  it('skips empty append', async () => {
    await log.append([])
    const files = mockFs._allFiles()
    expect(files.filter((f) => f.startsWith('/db/event_log/'))).toHaveLength(0)
  })
})
