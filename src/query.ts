import type { QueryOperators, QueryOptions, WhereClause } from './types'

export function evaluateQuery<T extends Record<string, any>>(documents: T[], query: QueryOptions): T[] {
  let results = documents

  if (query.where) {
    results = results.filter((doc) => matchesWhere(doc, query.where!))
  }

  if (query.orderBy) {
    results = sortDocuments(results, query.orderBy)
  }

  if (query.offset) {
    results = results.slice(query.offset)
  }

  if (query.limit !== undefined) {
    results = results.slice(0, query.limit)
  }

  return results
}

export function matchesWhere(doc: Record<string, any>, where: WhereClause): boolean {
  if (where.$and) {
    return where.$and.every((clause) => matchesWhere(doc, clause))
  }
  if (where.$or) {
    return where.$or.some((clause) => matchesWhere(doc, clause))
  }

  return Object.entries(where).every(([field, condition]) => {
    if (field === '$and' || field === '$or') return true
    const value = getNestedValue(doc, field)

    if (isOperatorObject(condition)) {
      return evaluateOperators(value, condition as QueryOperators)
    }
    return value === condition
  })
}

function isOperatorObject(condition: any): boolean {
  if (condition === null || condition === undefined || typeof condition !== 'object' || Array.isArray(condition)) {
    return false
  }
  return Object.keys(condition).some((k) => k.startsWith('$'))
}

export function evaluateOperators(value: any, operators: QueryOperators): boolean {
  for (const [op, target] of Object.entries(operators)) {
    if (target === undefined) continue
    switch (op) {
      case '$eq':
        if (value !== target) return false
        break
      case '$ne':
        if (value === target) return false
        break
      case '$gt':
        if (!(comparableValue(value) > comparableValue(target))) return false
        break
      case '$gte':
        if (!(comparableValue(value) >= comparableValue(target))) return false
        break
      case '$lt':
        if (!(comparableValue(value) < comparableValue(target))) return false
        break
      case '$lte':
        if (!(comparableValue(value) <= comparableValue(target))) return false
        break
      case '$in':
        if (!Array.isArray(target) || !target.includes(value)) return false
        break
      case '$nin':
        if (!Array.isArray(target) || target.includes(value)) return false
        break
      case '$contains':
        if (!String(value ?? '').toLowerCase().includes(String(target).toLowerCase())) return false
        break
      case '$startsWith':
        if (!String(value ?? '').toLowerCase().startsWith(String(target).toLowerCase())) return false
        break
      case '$endsWith':
        if (!String(value ?? '').toLowerCase().endsWith(String(target).toLowerCase())) return false
        break
      case '$exists':
        if ((value !== undefined && value !== null) !== target) return false
        break
      case '$regex':
        if (!new RegExp(target as string).test(String(value ?? ''))) return false
        break
    }
  }
  return true
}

function comparableValue(v: any): number {
  if (v instanceof Date) return v.getTime()
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) return new Date(v).getTime()
  return v
}

function sortDocuments<T extends Record<string, any>>(
  docs: T[],
  orderBy: Record<string, 'asc' | 'desc'>,
): T[] {
  const entries = Object.entries(orderBy)
  return [...docs].sort((a, b) => {
    for (const [field, direction] of entries) {
      const aVal = comparableValue(getNestedValue(a, field))
      const bVal = comparableValue(getNestedValue(b, field))
      if (aVal < bVal) return direction === 'asc' ? -1 : 1
      if (aVal > bVal) return direction === 'asc' ? 1 : -1
    }
    return 0
  })
}

export function getNestedValue(obj: Record<string, any>, path: string): any {
  return path.split('.').reduce((current, key) => current?.[key], obj)
}
