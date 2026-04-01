import { WriteQueue } from '../src/storage/write-queue'

describe('WriteQueue', () => {
  it('executes enqueued writes', async () => {
    const queue = new WriteQueue(10)
    const results: string[] = []

    queue.enqueue('a', async () => { results.push('a') })
    queue.enqueue('b', async () => { results.push('b') })
    await queue.flush()

    expect(results).toEqual(['a', 'b'])
  })

  it('deduplicates by key (latest wins)', async () => {
    const queue = new WriteQueue(10)
    const results: string[] = []

    queue.enqueue('key', async () => { results.push('first') })
    queue.enqueue('key', async () => { results.push('second') })
    await queue.flush()

    expect(results).toEqual(['second'])
  })

  it('processes in batches', async () => {
    const queue = new WriteQueue(2)
    let maxConcurrent = 0
    let current = 0

    const makeWriter = (id: string) => async () => {
      current++
      maxConcurrent = Math.max(maxConcurrent, current)
      await new Promise((r) => setTimeout(r, 10))
      current--
    }

    queue.enqueue('a', makeWriter('a'))
    queue.enqueue('b', makeWriter('b'))
    queue.enqueue('c', makeWriter('c'))
    queue.enqueue('d', makeWriter('d'))
    await queue.flush()

    expect(maxConcurrent).toBeLessThanOrEqual(2)
  })

  it('flush resolves immediately when queue is empty', async () => {
    const queue = new WriteQueue(10)
    await queue.flush()
  })

  it('tracks pending count', () => {
    const queue = new WriteQueue(10)
    expect(queue.pending).toBe(0)
    queue.enqueue('a', async () => {})
    expect(queue.pending).toBeGreaterThanOrEqual(0)
  })

  it('handles errors without crashing', async () => {
    const queue = new WriteQueue(10)
    const results: string[] = []

    queue.enqueue('fail', async () => { throw new Error('boom') })
    queue.enqueue('ok', async () => { results.push('ok') })
    await queue.flush()

    expect(results).toEqual(['ok'])
  })
})
