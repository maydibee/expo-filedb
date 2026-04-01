import type { Document, Observable, QueryOptions, Subscription } from './types'
import { evaluateQuery } from './query'

interface SubscriberEntry<T> {
  query: QueryOptions
  callback: (results: T[]) => void
}

interface SingleSubscriberEntry<T> {
  id: string
  callback: (result: T | null) => void
}

/**
 * Manages reactive subscriptions for a collection.
 * Subscribers are notified whenever the underlying data changes.
 */
export class CollectionObservable<T extends Document> {
  private subscribers = new Set<SubscriberEntry<T>>()
  private singleSubscribers = new Set<SingleSubscriberEntry<T>>()
  private dataProvider: (query: QueryOptions) => Promise<T[]>
  private singleProvider: (id: string) => Promise<T | null>

  constructor(
    dataProvider: (query: QueryOptions) => Promise<T[]>,
    singleProvider: (id: string) => Promise<T | null>,
  ) {
    this.dataProvider = dataProvider
    this.singleProvider = singleProvider
  }

  /**
   * Subscribe to query results. The callback fires immediately with current
   * data, then again whenever a mutation occurs in this collection.
   */
  observe(query: QueryOptions): Observable<T[]> {
    return {
      subscribe: (callback: (value: T[]) => void): Subscription => {
        const entry: SubscriberEntry<T> = { query, callback }
        this.subscribers.add(entry)
        this.emitQuery(entry)
        return { unsubscribe: () => this.subscribers.delete(entry) }
      },
    }
  }

  /**
   * Subscribe to a single document by id. Fires immediately, then on every
   * mutation that could affect this document.
   */
  observeOne(id: string): Observable<T | null> {
    return {
      subscribe: (callback: (value: T | null) => void): Subscription => {
        const entry: SingleSubscriberEntry<T> = { id, callback }
        this.singleSubscribers.add(entry)
        this.emitSingle(entry)
        return { unsubscribe: () => this.singleSubscribers.delete(entry) }
      },
    }
  }

  /** Called by Collection after any insert/update/delete. */
  async notifyChange(): Promise<void> {
    const promises: Promise<void>[] = []
    for (const entry of this.subscribers) {
      promises.push(this.emitQuery(entry))
    }
    for (const entry of this.singleSubscribers) {
      promises.push(this.emitSingle(entry))
    }
    await Promise.all(promises)
  }

  private async emitQuery(entry: SubscriberEntry<T>): Promise<void> {
    try {
      const results = await this.dataProvider(entry.query)
      entry.callback(results)
    } catch {
      // Subscriber errors should not crash the engine
    }
  }

  private async emitSingle(entry: SingleSubscriberEntry<T>): Promise<void> {
    try {
      const result = await this.singleProvider(entry.id)
      entry.callback(result)
    } catch {
      // Subscriber errors should not crash the engine
    }
  }
}
