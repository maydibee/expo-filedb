import type { Document } from '../types'

/**
 * In-memory document cache. All reads after initial load are served from here.
 * Tracks which collections have been fully loaded from disk to avoid redundant reads.
 */
export class MemoryCache {
  private cache = new Map<string, Map<string, Document>>()
  private fullyLoaded = new Set<string>()

  get(collection: string, id: string): Document | undefined {
    return this.cache.get(collection)?.get(id)
  }

  getAll(collection: string): Map<string, Document> | undefined {
    return this.cache.get(collection)
  }

  isFullyLoaded(collection: string): boolean {
    return this.fullyLoaded.has(collection)
  }

  set(collection: string, id: string, doc: Document): void {
    if (!this.cache.has(collection)) {
      this.cache.set(collection, new Map())
    }
    this.cache.get(collection)!.set(id, doc)
  }

  markFullyLoaded(collection: string): void {
    this.fullyLoaded.add(collection)
  }

  delete(collection: string, id: string): void {
    this.cache.get(collection)?.delete(id)
  }

  clear(collection?: string): void {
    if (collection) {
      this.cache.delete(collection)
      this.fullyLoaded.delete(collection)
    } else {
      this.cache.clear()
      this.fullyLoaded.clear()
    }
  }

  /** Returns all document values for a collection (empty array if not loaded). */
  values(collection: string): Document[] {
    const map = this.cache.get(collection)
    return map ? Array.from(map.values()) : []
  }
}
