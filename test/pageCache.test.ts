import { describe, expect, it } from 'vitest'
import { LruCache, makePageCacheKey } from '../electron/main/pdf/pageCache'

describe('LruCache', () => {
  it('evicts the least recently used entry', () => {
    const cache = new LruCache<string>(2)
    cache.set('a', '1')
    cache.set('b', '2')
    expect(cache.get('a')).toBe('1')
    cache.set('c', '3')
    expect(cache.has('b')).toBe(false)
    expect(cache.get('a')).toBe('1')
    expect(cache.get('c')).toBe('3')
  })

  it('builds stable page cache keys', () => {
    expect(makePageCacheKey(2, 1.23456, 0)).toBe('2:1.235:0')
  })
})
