import { validateDocument, applyDefaults } from '../src/schema'
import type { CollectionSchema } from '../src/types'

const schema: CollectionSchema = {
  name: { type: 'string', required: true },
  email: { type: 'string' },
  age: { type: 'number' },
  active: { type: 'boolean' },
  tags: { type: 'array' },
  meta: { type: 'object' },
  createdAt: { type: 'date', default: () => '2024-01-01' },
}

describe('validateDocument', () => {
  it('passes valid document', () => {
    const errors = validateDocument({ name: 'John', age: 30 }, schema)
    expect(errors).toEqual([])
  })

  it('fails on missing required field', () => {
    const errors = validateDocument({ age: 30 }, schema)
    expect(errors).toContain('Field "name" is required')
  })

  it('fails on wrong type', () => {
    const errors = validateDocument({ name: 123 }, schema)
    expect(errors).toContain('Field "name" must be a string')
  })

  it('validates number type', () => {
    const errors = validateDocument({ name: 'John', age: 'thirty' }, schema)
    expect(errors).toContain('Field "age" must be a number')
  })

  it('validates boolean type', () => {
    const errors = validateDocument({ name: 'John', active: 'yes' }, schema)
    expect(errors).toContain('Field "active" must be a boolean')
  })

  it('validates array type', () => {
    const errors = validateDocument({ name: 'John', tags: 'not-array' }, schema)
    expect(errors).toContain('Field "tags" must be an array')
  })

  it('validates object type', () => {
    const errors = validateDocument({ name: 'John', meta: [1, 2] }, schema)
    expect(errors).toContain('Field "meta" must be an object')
  })

  it('allows null/undefined for optional fields', () => {
    const errors = validateDocument({ name: 'John' }, schema)
    expect(errors).toEqual([])
  })

  it('runs custom validator', () => {
    const customSchema: CollectionSchema = {
      score: { type: 'number', validate: (v) => (v >= 0 && v <= 100) || 'Score must be 0-100' },
    }
    expect(validateDocument({ score: 150 }, customSchema)).toContain('Score must be 0-100')
    expect(validateDocument({ score: 50 }, customSchema)).toEqual([])
  })
})

describe('applyDefaults', () => {
  it('applies default values', () => {
    const result = applyDefaults({ name: 'John' }, schema)
    expect(result.createdAt).toBe('2024-01-01')
  })

  it('does not override existing values', () => {
    const result = applyDefaults({ name: 'John', createdAt: '2025-01-01' }, schema)
    expect(result.createdAt).toBe('2025-01-01')
  })
})
