import { MemoryCache } from '../src/storage/memory-cache'

describe('MemoryCache', () => {
  let cache: MemoryCache

  beforeEach(() => {
    cache = new MemoryCache()
  })

  it('stores and retrieves documents', () => {
    cache.set('users', '1', { id: '1', name: 'John' })
    expect(cache.get('users', '1')).toEqual({ id: '1', name: 'John' })
  })

  it('returns undefined for missing documents', () => {
    expect(cache.get('users', 'nonexistent')).toBeUndefined()
  })

  it('deletes documents', () => {
    cache.set('users', '1', { id: '1', name: 'John' })
    cache.delete('users', '1')
    expect(cache.get('users', '1')).toBeUndefined()
  })

  it('tracks fully loaded collections', () => {
    expect(cache.isFullyLoaded('users')).toBe(false)
    cache.markFullyLoaded('users')
    expect(cache.isFullyLoaded('users')).toBe(true)
  })

  it('clears a specific collection', () => {
    cache.set('users', '1', { id: '1', name: 'John' })
    cache.set('posts', '1', { id: '1', title: 'Hello' })
    cache.markFullyLoaded('users')

    cache.clear('users')

    expect(cache.get('users', '1')).toBeUndefined()
    expect(cache.isFullyLoaded('users')).toBe(false)
    expect(cache.get('posts', '1')).toEqual({ id: '1', title: 'Hello' })
  })

  it('clears everything', () => {
    cache.set('users', '1', { id: '1', name: 'John' })
    cache.set('posts', '1', { id: '1', title: 'Hello' })
    cache.markFullyLoaded('users')

    cache.clear()

    expect(cache.get('users', '1')).toBeUndefined()
    expect(cache.get('posts', '1')).toBeUndefined()
    expect(cache.isFullyLoaded('users')).toBe(false)
  })

  it('returns all values for a collection', () => {
    cache.set('users', '1', { id: '1', name: 'Alice' })
    cache.set('users', '2', { id: '2', name: 'Bob' })

    const values = cache.values('users')
    expect(values).toHaveLength(2)
    expect(values.map((v) => v.name).sort()).toEqual(['Alice', 'Bob'])
  })

  it('returns empty array for unknown collection', () => {
    expect(cache.values('unknown')).toEqual([])
  })
})
