/**
 * In-memory file cache with ETag validation.
 * Caches file blobs and object URLs to avoid redundant downloads when previewing documents.
 */

interface CachedFile {
  blob: Blob
  etag: string
  timestamp: number
  objectUrl?: string  // 缓存 object URL 供 iframe 直接使用
}

class FileCache {
  private cache = new Map<string, CachedFile>()
  private inflight = new Map<string, Promise<CachedFile>>()

  /**
   * Build cache key from document ID
   */
  private getKey(docId: string): string {
    return `doc:${docId}`
  }

  /**
   * Get cached file if available
   */
  get(docId: string): Blob | null {
    const entry = this.cache.get(this.getKey(docId))
    if (entry) {
      return entry.blob
    }
    return null
  }

  /**
   * Get cached ETag
   */
  getEtag(docId: string): string | null {
    const entry = this.cache.get(this.getKey(docId))
    return entry?.etag ?? null
  }

  /**
   * Store a file in the cache
   */
  set(docId: string, blob: Blob, etag: string): void {
    const key = this.getKey(docId)
    const existing = this.cache.get(key)
    
    // 如果已存在旧的 objectUrl，先撤销它
    if (existing?.objectUrl) {
      URL.revokeObjectURL(existing.objectUrl)
    }
    
    this.cache.set(key, {
      blob,
      etag,
      timestamp: Date.now(),
    })
  }

  /**
   * Get or create a cached object URL for direct iframe/src usage.
   * This avoids creating new object URLs on every render.
   */
  getObjectUrl(docId: string, url: string): string | null {
    const key = this.getKey(docId)
    const cached = this.cache.get(key)
    if (cached?.objectUrl) {
      return cached.objectUrl
    }
    return null
  }

  /**
   * Ensure a file is cached and return its object URL.
   * If not cached, fetches it first.
   */
  async getObjectUrlAsync(docId: string, url: string): Promise<string> {
    const key = this.getKey(docId)
    const cached = this.cache.get(key)
    
    if (cached?.objectUrl) {
      return cached.objectUrl
    }
    
    // Fetch the file
    const result = await this.fetch(docId, url)
    const newObjectUrl = URL.createObjectURL(result)
    
    // Store the object URL in cache
    const entry = this.cache.get(key)
    if (entry) {
      entry.objectUrl = newObjectUrl
    }
    
    return newObjectUrl
  }

  /**
   * Fetch a file with caching and ETag validation.
   * Returns the cached blob if available and valid, or fetches a fresh copy.
   */
  async fetch(docId: string, url: string): Promise<Blob> {
    const key = this.getKey(docId)
    const cached = this.cache.get(key)

    // If we have a cached version, send a conditional request
    const headers: Record<string, string> = {}
    if (cached?.etag) {
      headers['If-None-Match'] = cached.etag
    }

    // Deduplicate concurrent requests for the same file
    if (this.inflight.has(key)) {
      const result = await this.inflight.get(key)!
      return result.blob
    }

    const fetchPromise = (async () => {
      try {
        const response = await fetch(url, {
          headers,
          // Don't use browser cache - we manage it ourselves
          cache: 'no-store',
        })

        if (response.status === 304 && cached) {
          // File hasn't changed, reuse cached blob
          return cached
        }

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`)
        }

        const newEtag = response.headers.get('etag') || ''
        const blob = await response.blob()

        const entry: CachedFile = {
          blob,
          etag: newEtag,
          timestamp: Date.now(),
        }
        this.cache.set(key, entry)
        return entry
      } finally {
        this.inflight.delete(key)
      }
    })()

    this.inflight.set(key, fetchPromise)
    const result = await fetchPromise
    return result.blob
  }

  /**
   * Invalidate cache for a specific document
   */
  invalidate(docId: string): void {
    const key = this.getKey(docId)
    const cached = this.cache.get(key)
    if (cached?.objectUrl) {
      URL.revokeObjectURL(cached.objectUrl)
    }
    this.cache.delete(key)
  }

  /**
   * Clear all cached files
   */
  clear(): void {
    this.cache.clear()
  }

  /**
   * Get cache statistics
   */
  stats(): { size: number; entries: string[] } {
    return {
      size: this.cache.size,
      entries: Array.from(this.cache.keys()),
    }
  }
}

// Singleton instance
export const fileCache = new FileCache()
