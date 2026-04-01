/**
 * Background write-behind queue. Disk writes are enqueued and flushed
 * in batches so the calling code never blocks on I/O.
 *
 * Deduplication: if the same key is enqueued again before the previous
 * write reaches disk, only the latest version is kept.
 */
export class WriteQueue {
  private queue: Array<{ key: string; fn: () => Promise<void> }> = []
  private flushing = false
  private scheduled = false
  private flushResolvers: Array<() => void> = []

  constructor(private readonly batchSize: number = 10) {}

  enqueue(key: string, writeFn: () => Promise<void>): void {
    const idx = this.queue.findIndex((w) => w.key === key)
    if (idx >= 0) this.queue.splice(idx, 1)
    this.queue.push({ key, fn: writeFn })

    if (!this.flushing && !this.scheduled) {
      this.scheduled = true
      Promise.resolve().then(() => {
        this.scheduled = false
        if (!this.flushing && this.queue.length > 0) {
          this.startFlush()
        }
      })
    }
  }

  /**
   * Returns a promise that resolves once every currently-queued write
   * has been persisted to disk. Call before sync, export, or close.
   */
  async flush(): Promise<void> {
    if (!this.flushing && this.queue.length === 0) return
    return new Promise<void>((resolve) => {
      this.flushResolvers.push(resolve)
      if (!this.flushing && this.queue.length > 0) {
        this.startFlush()
      }
    })
  }

  get pending(): number {
    return this.queue.length
  }

  private async startFlush(): Promise<void> {
    this.flushing = true
    while (this.queue.length > 0) {
      const batch = this.queue.splice(0, this.batchSize)
      try {
        await Promise.all(batch.map((w) => w.fn()))
      } catch (e) {
        console.warn('[expo-filedb] write-queue flush error:', e)
      }
    }
    this.flushing = false
    const resolvers = this.flushResolvers
    this.flushResolvers = []
    for (const r of resolvers) r()
  }
}
