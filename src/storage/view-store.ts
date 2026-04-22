import type { Document } from '../types'
import type { FileSystemAdapter } from './fs-adapter'

/**
 * Materialized view store — one JSON file per document.
 * Directory layout: {viewsRoot}/{collectionName}/{documentId}
 */
export class ViewStore {
  constructor(
    private readonly viewsRoot: string,
    private readonly fs: FileSystemAdapter,
  ) {}

  async loadAll(collection: string): Promise<Record<string, Document>> {
    const dirPath = `${this.viewsRoot}/${collection}`
    const files = await this.fs.readDir(dirPath)
    const result: Record<string, Document> = {}

    for (const file of files) {
      const content = await this.fs.readFile(`${dirPath}/${file}`)
      const doc = JSON.parse(content) as Document
      if (doc == null) {
        await this.fs.deleteFile(`${dirPath}/${file}`)
        continue
      }
      result[doc.id ?? file] = doc
    }
    return result
  }

  async loadOne(collection: string, id: string): Promise<Document | null> {
    const filePath = `${this.viewsRoot}/${collection}/${id}`
    if (!(await this.fs.exists(filePath))) return null
    const content = await this.fs.readFile(filePath)
    const doc = JSON.parse(content) as Document
    if (doc == null) {
      await this.fs.deleteFile(filePath)
      return null
    }
    return doc
  }

  async write(collection: string, id: string, data: Document): Promise<void> {
    const filePath = `${this.viewsRoot}/${collection}/${id}`
    await this.fs.writeFile(filePath, JSON.stringify(data))
  }

  async delete(collection: string, id: string): Promise<void> {
    const filePath = `${this.viewsRoot}/${collection}/${id}`
    await this.fs.deleteFile(filePath)
  }

  async deleteCollection(collection: string): Promise<void> {
    await this.fs.deleteDir(`${this.viewsRoot}/${collection}`)
  }

  async deleteAll(): Promise<void> {
    await this.fs.deleteDir(this.viewsRoot)
  }
}
