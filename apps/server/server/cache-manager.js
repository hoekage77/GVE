function createHash(input) {
  let hash = 0;
  const str = typeof input === "string" ? input : JSON.stringify(input);

  for (let i = 0; i < str.length; i += 1) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }

  return `h${(hash >>> 0).toString(36)}`;
}

class LRUCache {
  constructor({ max = 500, ttlMs = 3600000 } = {}) {
    this.max = max;
    this.ttlMs = ttlMs;
    this.cache = new Map();
    this.hits = 0;
    this.misses = 0;
  }

  get(key) {
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

    this.cache.delete(key);
    this.cache.set(key, entry);
    this.hits += 1;
    return entry.value;
  }

  set(key, value) {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }

    if (this.cache.size >= this.max) {
      const oldestKey = this.cache.keys().next().value;
      this.cache.delete(oldestKey);
    }

    this.cache.set(key, {
      value,
      createdAt: Date.now()
    });
  }

  has(key) {
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

  clear() {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }

  get size() {
    return this.cache.size;
  }

  get stats() {
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
const skillCache = new LRUCache({ max: 50, ttlMs: 7200000 });

export function getGenerationCacheKey(query, skill, quality) {
  return createHash({ query: query.trim().toLowerCase(), skill, quality });
}

export function getCachedGeneration(key) {
  return generationCache.get(key);
}

export function setCachedGeneration(key, result) {
  generationCache.set(key, result);
}

export function getCachedSkill(skillId) {
  return skillCache.get(skillId);
}

export function setCachedSkill(skillId, profile) {
  skillCache.set(skillId, profile);
}

export function getCacheStats() {
  return {
    generation: generationCache.stats,
    skill: skillCache.stats
  };
}

export function clearAllCaches() {
  generationCache.clear();
  skillCache.clear();
}
