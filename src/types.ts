export type Identifier = string

export interface Document {
  id: Identifier
  [key: string]: any
}

export type FieldType = 'string' | 'number' | 'boolean' | 'date' | 'array' | 'object'

export interface FieldSchema {
  type: FieldType
  required?: boolean
  indexed?: boolean
  default?: any | (() => any)
  validate?: (value: any) => boolean | string
}

export type CollectionSchema = Record<string, FieldSchema>

export interface RelationshipDef {
  type: 'has-many' | 'belongs-to'
  collection: string
  foreignKey?: string
  localKey?: string
}

export interface CollectionConfig {
  schema: CollectionSchema
  relationships?: Record<string, RelationshipDef>
}

export interface QueryOperators {
  $eq?: any
  $ne?: any
  $gt?: number | Date
  $gte?: number | Date
  $lt?: number | Date
  $lte?: number | Date
  $in?: any[]
  $nin?: any[]
  $contains?: string
  $startsWith?: string
  $endsWith?: string
  $exists?: boolean
  $regex?: string
}

export type WhereValue = any | QueryOperators

export interface WhereClause {
  $and?: WhereClause[]
  $or?: WhereClause[]
  [field: string]: WhereValue
}

export interface QueryOptions {
  where?: WhereClause
  orderBy?: Record<string, 'asc' | 'desc'>
  limit?: number
  offset?: number
  include?: string[]
}

export interface DatabaseEvent {
  id: string
  type: 'insert' | 'update' | 'delete'
  collection: string
  documentId: string
  data: any
  timestamp: string
}

export interface MigrationStep {
  fromVersion: number
  toVersion: number
  migrate: (db: any) => Promise<void>
}

export interface FileDBConfig {
  name: string
  version?: number
  collections: Record<string, CollectionConfig>
  migrations?: MigrationStep[]
  writeQueueBatchSize?: number
}

export interface Subscription {
  unsubscribe: () => void
}

export interface Observable<T> {
  subscribe: (callback: (value: T) => void) => Subscription
}

export interface DatabaseDump {
  version: number
  collections: Record<string, Document[]>
  exportedAt: string
}

/**
 * Abstraction over the file system to allow swapping implementations
 * (e.g. expo-file-system in production, in-memory for tests).
 */
export interface IFileSystem {
  readAsStringAsync(path: string, options?: { encoding: string }): Promise<string>
  writeAsStringAsync(path: string, content: string, options?: { encoding: string }): Promise<void>
  deleteAsync(path: string, options?: { idempotent?: boolean }): Promise<void>
  getInfoAsync(path: string): Promise<{ exists: boolean; isDirectory?: boolean; size?: number }>
  makeDirectoryAsync(path: string, options?: { intermediates?: boolean }): Promise<void>
  readDirectoryAsync(path: string): Promise<string[]>
}
