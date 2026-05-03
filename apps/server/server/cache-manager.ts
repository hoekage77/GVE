interface CacheEntry<T> {
  value: T;
  createdAt: number;
}

interface CacheStats {
  size: number;
  max: number;
  hits: number;
  misses: number;
  hitRate: number;
}

function createHash(input: unknown): string {
  let hash = 0;
  const str = typeof input === "string" ? input : JSON.stringify(input);

  for (let i = 0; i < str.length; i += 1) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }

  return `h${(hash >>> 0).toString(36)}`;
}

class LRUCache<T = unknown> {
  private max: number;
  private ttlMs: number;
  private cache: Map<string, CacheEntry<T>>;
  private hits: number;
  private misses: number;

  constructor({ max = 500, ttlMs = 3600000 } = {}) {
    this.max = max;
    this.ttlMs = ttlMs;
    this.cache = new Map();
    this.hits = 0;
    this.misses = 0;
  }

  get(key: string): T | undefined {
    const entry = this.cache.get(key);

    if (!entry) {
      this.misses += 1;
      return undefined;
    }

    if (Date.now() - entry.createdAt > this.ttlMs) {
      this.cache.delete(key);
      this.misses += 1;
      return undefined;
    }

    // Move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, entry);
    this.hits += 1;
    return entry.value;
  }

  set(key: string, value: T): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }

    if (this.cache.size >= this.max) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
      }
    }

    this.cache.set(key, {
      value,
      createdAt: Date.now()
    });
  }

  has(key: string): boolean {
    const entry = this.cache.get(key);

    if (!entry) {
      return false;
    }

    if (Date.now() - entry.createdAt > this.ttlMs) {
      this.cache.delete(key);
      return false;
    }

    return true;
  }

  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }

  get size(): number {
    return this.cache.size;
  }

  get stats(): CacheStats {
    const total = this.hits + this.misses;
    return {
      size: this.cache.size,
      max: this.max,
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? Number((this.hits / total).toFixed(4)) : 0
    };
  }
}

const generationCache = new LRUCache({ max: 500, ttlMs: 3600000 });

export function getGenerationCacheKey(query: string, skill: string, quality: string): string {
  return createHash({ query: query.trim().toLowerCase(), skill, quality });
}

export function getCachedGeneration(key: string): unknown | undefined {
  return generationCache.get(key);
}

export function setCachedGeneration(key: string, result: unknown): void {
  generationCache.set(key, result);
}

export function getCacheStats(): { generation: CacheStats; skill: CacheStats } {
  return {
    generation: generationCache.stats,
    skill: { size: 0, max: 0, hits: 0, misses: 0, hitRate: 0 }
  };
}
