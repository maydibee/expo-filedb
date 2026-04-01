import { evaluateQuery, matchesWhere, evaluateOperators } from '../src/query'

describe('evaluateOperators', () => {
  it('$eq matches equal values', () => {
    expect(evaluateOperators(5, { $eq: 5 })).toBe(true)
    expect(evaluateOperators(5, { $eq: 6 })).toBe(false)
  })

  it('$ne matches non-equal values', () => {
    expect(evaluateOperators(5, { $ne: 6 })).toBe(true)
    expect(evaluateOperators(5, { $ne: 5 })).toBe(false)
  })

  it('$gt / $gte / $lt / $lte work with numbers', () => {
    expect(evaluateOperators(10, { $gt: 5 })).toBe(true)
    expect(evaluateOperators(5, { $gt: 5 })).toBe(false)
    expect(evaluateOperators(5, { $gte: 5 })).toBe(true)
    expect(evaluateOperators(3, { $lt: 5 })).toBe(true)
    expect(evaluateOperators(5, { $lte: 5 })).toBe(true)
  })

  it('$in / $nin match array membership', () => {
    expect(evaluateOperators('a', { $in: ['a', 'b', 'c'] })).toBe(true)
    expect(evaluateOperators('d', { $in: ['a', 'b', 'c'] })).toBe(false)
    expect(evaluateOperators('d', { $nin: ['a', 'b', 'c'] })).toBe(true)
    expect(evaluateOperators('a', { $nin: ['a', 'b', 'c'] })).toBe(false)
  })

  it('$contains is case-insensitive', () => {
    expect(evaluateOperators('Hello World', { $contains: 'hello' })).toBe(true)
    expect(evaluateOperators('Hello World', { $contains: 'xyz' })).toBe(false)
  })

  it('$startsWith / $endsWith work', () => {
    expect(evaluateOperators('Hello World', { $startsWith: 'hello' })).toBe(true)
    expect(evaluateOperators('Hello World', { $endsWith: 'world' })).toBe(true)
    expect(evaluateOperators('Hello World', { $startsWith: 'world' })).toBe(false)
  })

  it('$exists checks presence', () => {
    expect(evaluateOperators('something', { $exists: true })).toBe(true)
    expect(evaluateOperators(undefined, { $exists: false })).toBe(true)
    expect(evaluateOperators(undefined, { $exists: true })).toBe(false)
  })

  it('$regex matches patterns', () => {
    expect(evaluateOperators('abc123', { $regex: '^abc\\d+$' })).toBe(true)
    expect(evaluateOperators('xyz', { $regex: '^abc' })).toBe(false)
  })

  it('combines multiple operators with AND semantics', () => {
    expect(evaluateOperators(10, { $gte: 5, $lte: 15 })).toBe(true)
    expect(evaluateOperators(20, { $gte: 5, $lte: 15 })).toBe(false)
  })
})

describe('matchesWhere', () => {
  const doc = { id: '1', name: 'John', age: 30, email: 'john@test.com' }

  it('matches direct equality', () => {
    expect(matchesWhere(doc, { name: 'John' })).toBe(true)
    expect(matchesWhere(doc, { name: 'Jane' })).toBe(false)
  })

  it('matches operator conditions', () => {
    expect(matchesWhere(doc, { age: { $gte: 18 } })).toBe(true)
    expect(matchesWhere(doc, { age: { $lt: 18 } })).toBe(false)
  })

  it('$and requires all clauses', () => {
    expect(matchesWhere(doc, { $and: [{ name: 'John' }, { age: { $gte: 18 } }] })).toBe(true)
    expect(matchesWhere(doc, { $and: [{ name: 'John' }, { age: { $lt: 18 } }] })).toBe(false)
  })

  it('$or requires at least one clause', () => {
    expect(matchesWhere(doc, { $or: [{ name: 'Jane' }, { age: { $gte: 18 } }] })).toBe(true)
    expect(matchesWhere(doc, { $or: [{ name: 'Jane' }, { age: { $lt: 18 } }] })).toBe(false)
  })
})

describe('evaluateQuery', () => {
  const docs = [
    { id: '1', name: 'Alice', age: 25 },
    { id: '2', name: 'Bob', age: 35 },
    { id: '3', name: 'Charlie', age: 20 },
    { id: '4', name: 'Diana', age: 30 },
  ]

  it('filters with where clause', () => {
    const result = evaluateQuery(docs, { where: { age: { $gte: 30 } } })
    expect(result.map((d) => d.name)).toEqual(['Bob', 'Diana'])
  })

  it('sorts with orderBy', () => {
    const result = evaluateQuery(docs, { orderBy: { age: 'asc' } })
    expect(result.map((d) => d.name)).toEqual(['Charlie', 'Alice', 'Diana', 'Bob'])
  })

  it('sorts descending', () => {
    const result = evaluateQuery(docs, { orderBy: { age: 'desc' } })
    expect(result.map((d) => d.name)).toEqual(['Bob', 'Diana', 'Alice', 'Charlie'])
  })

  it('applies limit', () => {
    const result = evaluateQuery(docs, { limit: 2 })
    expect(result).toHaveLength(2)
  })

  it('applies offset', () => {
    const result = evaluateQuery(docs, { offset: 2 })
    expect(result).toHaveLength(2)
  })

  it('combines where + orderBy + limit + offset', () => {
    const result = evaluateQuery(docs, {
      where: { age: { $gte: 20 } },
      orderBy: { age: 'asc' },
      offset: 1,
      limit: 2,
    })
    expect(result.map((d) => d.name)).toEqual(['Alice', 'Diana'])
  })
})
