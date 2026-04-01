import type { IFileSystem } from '../src/types'

/**
 * In-memory IFileSystem implementation for unit tests.
 * No actual disk I/O — everything lives in a Map.
 */
export class MockFileSystem implements IFileSystem {
  private files = new Map<string, string>()
  private dirs = new Set<string>()

  async readAsStringAsync(path: string): Promise<string> {
    const content = this.files.get(path)
    if (content === undefined) throw new Error(`File not found: ${path}`)
    return content
  }

  async writeAsStringAsync(path: string, content: string): Promise<void> {
    this.files.set(path, content)
  }

  async deleteAsync(path: string): Promise<void> {
    this.files.delete(path)
    for (const key of this.files.keys()) {
      if (key.startsWith(path + '/')) this.files.delete(key)
    }
    this.dirs.delete(path)
    for (const key of this.dirs) {
      if (key.startsWith(path + '/')) this.dirs.delete(key)
    }
  }

  async getInfoAsync(path: string): Promise<{ exists: boolean; isDirectory?: boolean; size?: number }> {
    if (this.files.has(path)) return { exists: true, isDirectory: false, size: this.files.get(path)!.length }
    if (this.dirs.has(path)) return { exists: true, isDirectory: true }
    for (const key of this.files.keys()) {
      if (key.startsWith(path + '/')) return { exists: true, isDirectory: true }
    }
    for (const key of this.dirs) {
      if (key.startsWith(path + '/') || key === path) return { exists: true, isDirectory: true }
    }
    return { exists: false }
  }

  async makeDirectoryAsync(path: string): Promise<void> {
    this.dirs.add(path.replace(/\/$/, ''))
  }

  async readDirectoryAsync(path: string): Promise<string[]> {
    const normalizedPath = path.replace(/\/$/, '')
    const entries = new Set<string>()
    for (const key of this.files.keys()) {
      if (key.startsWith(normalizedPath + '/')) {
        const rest = key.slice(normalizedPath.length + 1)
        const firstSegment = rest.split('/')[0]
        entries.add(firstSegment)
      }
    }
    return Array.from(entries)
  }

  /** Test helper: get raw file content */
  _getFile(path: string): string | undefined {
    return this.files.get(path)
  }

  /** Test helper: list all files */
  _allFiles(): string[] {
    return Array.from(this.files.keys())
  }
}
