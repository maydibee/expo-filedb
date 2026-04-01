import type { CollectionConfig, CollectionSchema, FieldSchema, FieldType, RelationshipDef } from './types'

/**
 * Fluent builder for defining a field's schema.
 *
 * ```ts
 * field('string').required().default('untitled')
 * field('number').validate(v => v >= 0 || 'Must be positive')
 * ```
 */
export class FieldBuilder {
  private _schema: FieldSchema

  constructor(type: FieldType) {
    this._schema = { type }
  }

  required(): this {
    this._schema.required = true
    return this
  }

  indexed(): this {
    this._schema.indexed = true
    return this
  }

  default(value: any | (() => any)): this {
    this._schema.default = value
    return this
  }

  validate(fn: (value: any) => boolean | string): this {
    this._schema.validate = fn
    return this
  }

  /** @internal */
  build(): FieldSchema {
    return { ...this._schema }
  }
}

/**
 * Create a field definition. Entry point for the fluent field builder.
 *
 * ```ts
 * const User = defineModel('users', {
 *   name: field('string').required(),
 *   age: field('number'),
 *   email: field('string').indexed(),
 *   createdAt: field('date').default(() => new Date()),
 * })
 * ```
 */
export function field(type: FieldType): FieldBuilder {
  return new FieldBuilder(type)
}

interface ModelRelationships {
  [name: string]: RelationshipDef
}

/**
 * A model definition produced by `defineModel()`.
 * Carries the collection name, schema, and relationships at both
 * the type level and runtime level.
 */
export interface ModelDef<T = any> {
  /** Collection name used as the storage key. */
  collectionName: string
  /** Compiled schema for validation. */
  schema: CollectionSchema
  /** Relationship definitions. */
  relationships: Record<string, RelationshipDef>
  /** Phantom type marker — not used at runtime. */
  _type?: T
}

type FieldDefs = Record<string, FieldBuilder | FieldSchema>

interface DefineModelOptions {
  relationships?: ModelRelationships
}

/**
 * Define a data model declaratively.
 *
 * This is the primary entry point for users. It produces a `ModelDef`
 * that can be passed to `createStore()` to get a fully typed database.
 *
 * ```ts
 * interface User { id: string; name: string; age: number }
 *
 * const User = defineModel<User>('users', {
 *   name: field('string').required(),
 *   age: field('number'),
 * })
 *
 * const Post = defineModel<Post>('posts', {
 *   title: field('string').required(),
 *   authorId: field('string').required().indexed(),
 * }, {
 *   relationships: {
 *     author: { type: 'belongs-to', collection: 'users', localKey: 'authorId' },
 *   },
 * })
 * ```
 */
export function defineModel<T = any>(
  collectionName: string,
  fields: FieldDefs,
  options?: DefineModelOptions,
): ModelDef<T> {
  const schema: CollectionSchema = {}
  for (const [name, def] of Object.entries(fields)) {
    schema[name] = def instanceof FieldBuilder ? def.build() : def
  }
  return {
    collectionName,
    schema,
    relationships: options?.relationships ?? {},
  }
}

/** @internal Convert a ModelDef to the internal CollectionConfig format. */
export function modelToConfig(model: ModelDef): CollectionConfig {
  return {
    schema: model.schema,
    relationships: Object.keys(model.relationships).length > 0 ? model.relationships : undefined,
  }
}
