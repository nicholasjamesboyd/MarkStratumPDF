export type CacheEntry<T> = {
  key: string
  value: T
}

export class LruCache<T> {
  private readonly map = new Map<string, T>()

  constructor(private readonly maxEntries: number) {
    if (maxEntries < 1) {
      throw new Error('maxEntries must be >= 1')
    }
  }

  get size(): number {
    return this.map.size
  }

  has(key: string): boolean {
    return this.map.has(key)
  }

  get(key: string): T | undefined {
    const value = this.map.get(key)
    if (value === undefined) {
      return undefined
    }
    this.map.delete(key)
    this.map.set(key, value)
    return value
  }

  set(key: string, value: T): void {
    if (this.map.has(key)) {
      this.map.delete(key)
    }
    this.map.set(key, value)
    while (this.map.size > this.maxEntries) {
      const oldest = this.map.keys().next().value
      if (oldest === undefined) {
        break
      }
      this.map.delete(oldest)
    }
  }

  clear(): void {
    this.map.clear()
  }
}

export function makePageCacheKey(
  pageIndex: number,
  scale: number,
  rotation: number,
): string {
  const roundedScale = Math.round(scale * 1000) / 1000
  return `${pageIndex}:${roundedScale}:${rotation}`
}
