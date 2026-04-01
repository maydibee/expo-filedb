import type { CollectionSchema, Document, FieldSchema } from './types'

export function validateDocument(doc: Record<string, any>, schema: CollectionSchema): string[] {
  const errors: string[] = []

  for (const [field, fieldSchema] of Object.entries(schema)) {
    const value = doc[field]

    if (value === undefined || value === null) {
      if (fieldSchema.required) {
        errors.push(`Field "${field}" is required`)
      }
      continue
    }

    const typeError = validateType(field, value, fieldSchema)
    if (typeError) errors.push(typeError)

    if (fieldSchema.validate) {
      const result = fieldSchema.validate(value)
      if (result !== true) {
        errors.push(typeof result === 'string' ? result : `Field "${field}" failed validation`)
      }
    }
  }

  return errors
}

function validateType(field: string, value: any, schema: FieldSchema): string | null {
  switch (schema.type) {
    case 'string':
      return typeof value !== 'string' ? `Field "${field}" must be a string` : null
    case 'number':
      return typeof value !== 'number' ? `Field "${field}" must be a number` : null
    case 'boolean':
      return typeof value !== 'boolean' ? `Field "${field}" must be a boolean` : null
    case 'date':
      return !(value instanceof Date) && typeof value !== 'string'
        ? `Field "${field}" must be a Date or ISO string`
        : null
    case 'array':
      return !Array.isArray(value) ? `Field "${field}" must be an array` : null
    case 'object':
      return typeof value !== 'object' || Array.isArray(value)
        ? `Field "${field}" must be an object`
        : null
    default:
      return null
  }
}

export function applyDefaults(doc: Record<string, any>, schema: CollectionSchema): Document {
  const result = { ...doc }
  for (const [field, fieldSchema] of Object.entries(schema)) {
    if (result[field] === undefined && fieldSchema.default !== undefined) {
      result[field] = typeof fieldSchema.default === 'function' ? fieldSchema.default() : fieldSchema.default
    }
  }
  return result as Document
}
