import { Redis } from 'ioredis';
import { LRUCache } from 'lru-cache';

// Redis client for distributed caching
const redisClient = process.env.REDIS_URL
  ? new Redis(process.env.REDIS_URL)
  : null;

// In-memory LRU cache for local caching
const memoryCache = new LRUCache<string, any>({
  max: 1000, // Maximum number of items to store
  ttl: 1000 * 60 * 5, // Default TTL: 5 minutes
  allowStale: false,
  updateAgeOnGet: true,
});

/**
 * Cache options.
 */
interface CacheOptions {
  ttl?: number; // Time to live in milliseconds
  useRedis?: boolean; // Whether to use Redis for distributed caching
  useMemory?: boolean; // Whether to use in-memory caching
}

/**
 * Default cache options.
 */
const DEFAULT_OPTIONS: CacheOptions = {
  ttl: 1000 * 60 * 5, // 5 minutes
  useRedis: !!redisClient,
  useMemory: true,
};

/**
 * Get a value from the cache.
 */
export async function get<T>(key: string, options: CacheOptions = {}): Promise<T | null> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  
  // Try memory cache first
  if (opts.useMemory) {
    const memoryValue = memoryCache.get(key);
    
    if (memoryValue !== undefined) {
      return memoryValue as T;
    }
  }
  
  // Try Redis if available
  if (opts.useRedis && redisClient) {
    try {
      const redisValue = await redisClient.get(key);
      
      if (redisValue) {
        const parsedValue = JSON.parse(redisValue);
        
        // Store in memory cache for faster access next time
        if (opts.useMemory) {
          memoryCache.set(key, parsedValue, { ttl: opts.ttl });
        }
        
        return parsedValue as T;
      }
    } catch (error) {
      console.error('Redis cache error:', error);
    }
  }
  
  return null;
}

/**
 * Set a value in the cache.
 */
export async function set<T>(key: string, value: T, options: CacheOptions = {}): Promise<void> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  
  // Set in memory cache
  if (opts.useMemory) {
    memoryCache.set(key, value, { ttl: opts.ttl });
  }
  
  // Set in Redis if available
  if (opts.useRedis && redisClient) {
    try {
      await redisClient.set(key, JSON.stringify(value), 'PX', opts.ttl);
    } catch (error) {
      console.error('Redis cache error:', error);
    }
  }
}

/**
 * Delete a value from the cache.
 */
export async function del(key: string, options: CacheOptions = {}): Promise<void> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  
  // Delete from memory cache
  if (opts.useMemory) {
    memoryCache.delete(key);
  }
  
  // Delete from Redis if available
  if (opts.useRedis && redisClient) {
    try {
      await redisClient.del(key);
    } catch (error) {
      console.error('Redis cache error:', error);
    }
  }
}

/**
 * Clear all values from the cache.
 */
export async function clear(options: CacheOptions = {}): Promise<void> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  
  // Clear memory cache
  if (opts.useMemory) {
    memoryCache.clear();
  }
  
  // Clear Redis if available
  if (opts.useRedis && redisClient) {
    try {
      await redisClient.flushdb();
    } catch (error) {
      console.error('Redis cache error:', error);
    }
  }
}

/**
 * Get multiple values from the cache.
 */
export async function mget<T>(keys: string[], options: CacheOptions = {}): Promise<(T | null)[]> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const results: (T | null)[] = [];
  
  // Get from Redis if available
  if (opts.useRedis && redisClient && keys.length > 0) {
    try {
      const redisValues = await redisClient.mget(keys);
      
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        const redisValue = redisValues[i];
        
        if (redisValue) {
          const parsedValue = JSON.parse(redisValue);
          results[i] = parsedValue as T;
          
          // Store in memory cache for faster access next time
          if (opts.useMemory) {
            memoryCache.set(key, parsedValue, { ttl: opts.ttl });
          }
        } else {
          // Try memory cache
          if (opts.useMemory) {
            const memoryValue = memoryCache.get(key);
            results[i] = memoryValue !== undefined ? (memoryValue as T) : null;
          } else {
            results[i] = null;
          }
        }
      }
      
      return results;
    } catch (error) {
      console.error('Redis cache error:', error);
    }
  }
  
  // Fallback to individual gets
  return Promise.all(keys.map((key) => get<T>(key, options)));
}

/**
 * Set multiple values in the cache.
 */
export async function mset<T>(entries: [string, T][], options: CacheOptions = {}): Promise<void> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  
  // Set in memory cache
  if (opts.useMemory) {
    for (const [key, value] of entries) {
      memoryCache.set(key, value, { ttl: opts.ttl });
    }
  }
  
  // Set in Redis if available
  if (opts.useRedis && redisClient && entries.length > 0) {
    try {
      const pipeline = redisClient.pipeline();
      
      for (const [key, value] of entries) {
        pipeline.set(key, JSON.stringify(value), 'PX', opts.ttl);
      }
      
      await pipeline.exec();
    } catch (error) {
      console.error('Redis cache error:', error);
    }
  }
}

/**
 * Cache a function result.
 */
export function cached<T, Args extends any[]>(
  fn: (...args: Args) => Promise<T>,
  keyFn: (...args: Args) => string,
  options: CacheOptions = {}
): (...args: Args) => Promise<T> {
  return async (...args: Args): Promise<T> => {
    const key = keyFn(...args);
    const cachedResult = await get<T>(key, options);
    
    if (cachedResult !== null) {
      return cachedResult;
    }
    
    const result = await fn(...args);
    await set(key, result, options);
    return result;
  };
}

/**
 * Invalidate a cached function result.
 */
export function invalidate<Args extends any[]>(
  keyFn: (...args: Args) => string,
  options: CacheOptions = {}
): (...args: Args) => Promise<void> {
  return async (...args: Args): Promise<void> => {
    const key = keyFn(...args);
    await del(key, options);
  };
}
