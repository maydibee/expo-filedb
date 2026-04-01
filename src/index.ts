export { FileDB, createFileDB } from './filedb'
export { Collection } from './collection'
export { createStore } from './store'
export type { Store } from './store'
export { defineModel, field } from './model'
export type { ModelDef } from './model'
export { migrate, MigrationBuilder } from './migration'

export type {
  CollectionConfig,
  CollectionSchema,
  DatabaseDump,
  DatabaseEvent,
  Document,
  FieldSchema,
  FieldType,
  FileDBConfig,
  IFileSystem,
  Identifier,
  MigrationStep,
  Observable,
  QueryOperators,
  QueryOptions,
  RelationshipDef,
  Subscription,
  WhereClause,
} from './types'

export { StorageEngine } from './storage/storage-engine'
export type { StorageEngineOptions } from './storage/storage-engine'
export { MemoryCache } from './storage/memory-cache'
export { WriteQueue } from './storage/write-queue'
export { EventLog } from './storage/event-log'
export { ViewStore } from './storage/view-store'
export { FileSystemAdapter } from './storage/fs-adapter'
export { TransactionManager } from './transaction'
export { CollectionObservable } from './observable'
export { evaluateQuery, matchesWhere, evaluateOperators } from './query'
export { validateDocument, applyDefaults } from './schema'
