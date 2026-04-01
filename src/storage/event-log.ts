import type { DatabaseEvent } from '../types'
import type { FileSystemAdapter } from './fs-adapter'

/**
 * Append-only segmented JSONL event log.
 *
 * Each `append()` creates a new small segment file (O(1) write).
 * `loadAll()` reads and concatenates all segments (used only during sync/export).
 */
export class EventLog {
  private segmentsDirReady = false

  constructor(
    private readonly segmentsDir: string,
    private readonly fs: FileSystemAdapter,
  ) {}

  async append(events: DatabaseEvent[]): Promise<void> {
    if (events.length === 0) return
    await this.ensureDir()
    const lines = events.map((e) => JSON.stringify(e)).join('\n')
    const name = `${Date.now()}_${randomSuffix()}`
    await this.fs.writeFile(`${this.segmentsDir}/${name}`, lines)
  }

  async loadAll(): Promise<DatabaseEvent[]> {
    const files = await this.fs.readDir(this.segmentsDir)
    if (files.length === 0) return []

    const events: DatabaseEvent[] = []
    for (const file of files.sort().reverse()) {
      const content = await this.fs.readFile(`${this.segmentsDir}/${file}`)
      for (const line of content.split('\n')) {
        if (!line.trim()) continue
        events.push(JSON.parse(line))
      }
    }
    return events
  }

  async clear(): Promise<void> {
    await this.fs.deleteDir(this.segmentsDir)
    this.segmentsDirReady = false
  }

  private async ensureDir(): Promise<void> {
    if (this.segmentsDirReady) return
    await this.fs.ensureDir(this.segmentsDir)
    this.segmentsDirReady = true
  }
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 8)
}
