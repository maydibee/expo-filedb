import type { DatabaseEvent, Document } from './types'
import type { EventLog } from './storage/event-log'
import type { MemoryCache } from './storage/memory-cache'
import type { ViewStore } from './storage/view-store'
import type { WriteQueue } from './storage/write-queue'

interface BufferedView {
  collection: string
  id: string
  data: Document
  previousData: Document | undefined
}

/**
 * Batches all writes within a transaction into a single I/O operation.
 *
 * While active, events and view writes are buffered in memory.
 * On commit: events are written as one segment, views are enqueued.
 * On rollback: cache is reverted, buffers are discarded.
 */
export class TransactionManager {
  private bufferedEvents: DatabaseEvent[] = []
  private bufferedViews: BufferedView[] = []
  private active = false

  isActive(): boolean {
    return this.active
  }

  begin(): void {
    if (this.active) return
    this.active = true
    this.bufferedEvents = []
    this.bufferedViews = []
  }

  bufferEvent(event: DatabaseEvent): void {
    this.bufferedEvents.push(event)
  }

  bufferView(collection: string, id: string, data: Document, previousData: Document | undefined): void {
    this.bufferedViews.push({ collection, id, data, previousData })
  }

  async commit(
    eventLog: EventLog,
    writeQueue: WriteQueue,
    viewStore: ViewStore,
  ): Promise<void> {
    const events = this.bufferedEvents
    const views = this.bufferedViews

    this.reset()

    if (events.length > 0) {
      await eventLog.append(events)
    }

    for (const v of views) {
      writeQueue.enqueue(`${v.collection}/${v.id}`, () => viewStore.write(v.collection, v.id, v.data))
    }
  }

  rollback(cache: MemoryCache): void {
    for (const v of this.bufferedViews) {
      if (v.previousData) {
        cache.set(v.collection, v.id, v.previousData)
      } else {
        cache.delete(v.collection, v.id)
      }
    }
    this.reset()
  }

  private reset(): void {
    this.active = false
    this.bufferedEvents = []
    this.bufferedViews = []
  }
}
