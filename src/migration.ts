import type { FileDB } from './filedb'
import type { MigrationStep } from './types'

/**
 * Fluent builder for defining a single migration step.
 *
 * ```ts
 * migrate(1, 2)
 *   .addField('users', 'role', 'member')
 *   .renameField('users', 'name', 'fullName')
 *   .transformField('users', 'age', age => age + 1)
 *   .addCollection('settings')
 *   .custom(async (db) => { ... })
 * ```
 */
export class MigrationBuilder {
  readonly fromVersion: number
  readonly toVersion: number
  private operations: Array<(db: FileDB) => Promise<void>> = []

  constructor(from: number, to: number) {
    this.fromVersion = from
    this.toVersion = to
  }

  /**
   * Add a new field to all documents in a collection.
   * Existing documents get the specified default value.
   */
  addField(collection: string, fieldName: string, defaultValue: any): this {
    this.operations.push(async (db) => {
      const col = db.collections[collection]
      if (!col) return
      const docs = await col.find()
      for (const doc of docs) {
        if (doc[fieldName] === undefined) {
          await col.update(doc.id, { [fieldName]: defaultValue } as any)
        }
      }
    })
    return this
  }

  /**
   * Remove a field from all documents in a collection.
   * The field is deleted from the stored data.
   */
  removeField(collection: string, fieldName: string): this {
    this.operations.push(async (db) => {
      const col = db.collections[collection]
      if (!col) return
      const docs = await col.find()
      for (const doc of docs) {
        if (fieldName in doc) {
          const updated = { ...doc }
          delete updated[fieldName]
          await col.replace(doc.id, updated)
        }
      }
    })
    return this
  }

  /**
   * Rename a field across all documents in a collection.
   * Data is copied from the old field to the new field, then the old field is removed.
   */
  renameField(collection: string, oldName: string, newName: string): this {
    this.operations.push(async (db) => {
      const col = db.collections[collection]
      if (!col) return
      const docs = await col.find()
      for (const doc of docs) {
        if (oldName in doc && !(newName in doc)) {
          const updated = { ...doc, [newName]: doc[oldName] }
          delete updated[oldName]
          await col.replace(doc.id, updated)
        }
      }
    })
    return this
  }

  /**
   * Transform a field's value using a mapping function.
   * Useful for type conversions, normalization, or data cleanup.
   */
  transformField(collection: string, fieldName: string, transform: (value: any, doc: any) => any): this {
    this.operations.push(async (db) => {
      const col = db.collections[collection]
      if (!col) return
      const docs = await col.find()
      for (const doc of docs) {
        if (fieldName in doc) {
          await col.update(doc.id, { [fieldName]: transform(doc[fieldName], doc) } as any)
        }
      }
    })
    return this
  }

  /**
   * Run a fully custom migration function.
   * Use for complex migrations that can't be expressed with the built-in helpers.
   */
  custom(fn: (db: FileDB) => Promise<void>): this {
    this.operations.push(fn)
    return this
  }

  /** @internal Compile into a MigrationStep for the engine. */
  build(): MigrationStep {
    const ops = [...this.operations]
    return {
      fromVersion: this.fromVersion,
      toVersion: this.toVersion,
      migrate: async (db: FileDB) => {
        for (const op of ops) {
          await op(db)
        }
      },
    }
  }
}

/**
 * Define a migration from one schema version to another.
 *
 * ```ts
 * const store = await createStore({
 *   name: 'myapp',
 *   version: 3,
 *   models: { users: User },
 *   migrations: [
 *     migrate(1, 2).addField('users', 'role', 'member').build(),
 *     migrate(2, 3).renameField('users', 'name', 'fullName').build(),
 *   ],
 * })
 * ```
 */
export function migrate(fromVersion: number, toVersion: number): MigrationBuilder {
  return new MigrationBuilder(fromVersion, toVersion)
}
