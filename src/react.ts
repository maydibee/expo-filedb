import { useEffect, useState } from 'react'
import type { Collection } from './collection'
import type { Document, QueryOptions } from './types'

/**
 * React hook that subscribes to a collection query.
 * Re-renders automatically when the underlying data changes.
 */
export function useQuery<T extends Document>(collection: Collection<T>, query?: QueryOptions) {
  const [data, setData] = useState<T[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const subscription = collection.observe(query ?? {}).subscribe((results) => {
      setData(results)
      setLoading(false)
    })
    return () => subscription.unsubscribe()
  }, [collection, JSON.stringify(query)])

  return { data, loading }
}

/**
 * React hook that subscribes to a single document by id.
 * Re-renders automatically when the document changes.
 */
export function useDocument<T extends Document>(collection: Collection<T>, id: string) {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const subscription = collection.observeOne(id).subscribe((doc) => {
      setData(doc)
      setLoading(false)
    })
    return () => subscription.unsubscribe()
  }, [collection, id])

  return { data, loading }
}
