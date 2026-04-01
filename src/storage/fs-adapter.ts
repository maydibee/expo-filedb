import type { IFileSystem } from '../types'

const ENCODING = { encoding: 'utf8' as const }

/**
 * Thin wrapper over expo-file-system that caches directory creation
 * to avoid redundant mkdir syscalls.
 */
export class FileSystemAdapter {
  private knownDirs = new Set<string>()

  constructor(private readonly fs: IFileSystem) {}

  async writeFile(path: string, content: string): Promise<void> {
    await this.ensureParentDir(path)
    await this.fs.writeAsStringAsync(path, content, ENCODING)
  }

  async readFile(path: string): Promise<string> {
    return this.fs.readAsStringAsync(path, ENCODING)
  }

  async deleteFile(path: string): Promise<void> {
    try {
      await this.fs.deleteAsync(path, { idempotent: true })
    } catch {
      // File may not exist — safe to ignore
    }
  }

  async exists(path: string): Promise<boolean> {
    const info = await this.fs.getInfoAsync(path)
    return info.exists === true
  }

  async readDir(path: string): Promise<string[]> {
    if (!(await this.exists(path))) return []
    return this.fs.readDirectoryAsync(path)
  }

  async ensureDir(path: string): Promise<void> {
    if (this.knownDirs.has(path)) return
    await this.fs.makeDirectoryAsync(path, { intermediates: true })
    this.knownDirs.add(path)
  }

  async deleteDir(path: string): Promise<void> {
    await this.deleteFile(path)
    for (const key of this.knownDirs) {
      if (key.startsWith(path)) this.knownDirs.delete(key)
    }
  }

  clearDirCache(): void {
    this.knownDirs.clear()
  }

  private async ensureParentDir(filePath: string): Promise<void> {
    const parent = filePath.substring(0, filePath.lastIndexOf('/'))
    if (!parent) return
    await this.ensureDir(parent)
  }
}
