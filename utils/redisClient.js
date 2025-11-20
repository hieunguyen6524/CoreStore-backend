const redis = require('redis');

// Build Redis connection URL
const getRedisUrl = () => {
  if (process.env.REDIS_URL) {
    return process.env.REDIS_URL;
  }
  const host = process.env.REDIS_HOST || 'localhost';
  const port = process.env.REDIS_PORT || 6379;
  const password = process.env.REDIS_PASSWORD;
  if (password) {
    return `redis://:${password}@${host}:${port}`;
  }
  return `redis://${host}:${port}`;
};

// Create Redis client
const client = redis.createClient({
  url: getRedisUrl(),
  socket: {
    reconnectStrategy: (retries) => {
      if (retries > 10) {
        console.error('Redis: Max retries reached. Giving up.');
        return new Error('Max retries reached');
      }
      return Math.min(retries * 100, 3000);
    },
  },
});

// Handle connection errors
client.on('error', (err) => {
  console.error('Redis Client Error:', err);
});

// Track connection status
let isConnected = false;

// Connect to Redis
client
  .connect()
  .then(() => {
    isConnected = true;
    console.log('✅ Redis connected successfully');
  })
  .catch((err) => {
    isConnected = false;
    console.error('Redis connection failed:', err);
    console.log(
      '⚠️  Redis cache will be disabled. App will continue without cache.',
    );
  });

// Helper function to get cache key
const getCacheKey = (prefix, query, params = {}) => {
  // Combine query and params
  const combined = { ...query, ...params };

  // Sort keys to ensure consistent cache keys
  const sorted = Object.keys(combined)
    .sort()
    .reduce((acc, key) => {
      acc[key] = combined[key];
      return acc;
    }, {});
  return `${prefix}:${JSON.stringify(sorted)}`;
};

// Cache middleware factory
const cacheMiddleware =
  (prefix, ttl = 3600, useParams = false) =>
  // TTL in seconds (default: 1 hour)
  // useParams: if true, include route params in cache key
  async (req, res, next) => {
    // Skip cache for non-GET requests
    if (req.method !== 'GET') {
      return next();
    }

    // Skip cache if Redis is not connected
    if (!isConnected) {
      return next();
    }

    try {
      // Build cache key from query parameters and optionally route params
      const params = useParams ? req.params : {};
      const cacheKey = getCacheKey(prefix, req.query, params);

      // Try to get from cache
      const cachedData = await client.get(cacheKey);

      if (cachedData) {
        // Cache hit - return cached data
        const parsedData = JSON.parse(cachedData);
        return res.status(200).json(parsedData);
      }

      // Cache miss - store original json method
      const originalJson = res.json.bind(res);

      // Override res.json to cache the response
      res.json = function (data) {
        // Cache the response (async, don't wait)
        if (isConnected) {
          client.setEx(cacheKey, ttl, JSON.stringify(data)).catch((err) => {
            console.error('Redis cache set error:', err);
          });
        }

        // Call original json method
        return originalJson(data);
      };

      next();
    } catch (err) {
      // If Redis fails, continue without cache
      console.error('Redis cache error:', err);
      next();
    }
  };

// Invalidate cache by pattern
const invalidateCache = async (pattern) => {
  if (!isConnected) {
    return;
  }
  try {
    const keys = await client.keys(pattern);
    if (keys.length > 0) {
      if (keys.length === 1) {
        await client.del(keys[0]);
      } else {
        await client.del(keys);
      }
      console.log(
        `✅ Invalidated ${keys.length} cache keys matching: ${pattern}`,
      );
    }
  } catch (err) {
    console.error('Redis cache invalidation error:', err);
  }
};

// Invalidate all product-related cache
const invalidateProductCache = async () => {
  if (!isConnected) {
    return;
  }
  try {
    // Invalidate all product list caches
    await invalidateCache('products:*');
    // Invalidate all category caches
    await invalidateCache('products:category:*');
    // Invalidate all single product caches
    await invalidateCache('product:*');
  } catch (err) {
    console.error('Product cache invalidation error:', err);
  }
};

module.exports = {
  client,
  cacheMiddleware,
  invalidateCache,
  invalidateProductCache,
  getCacheKey,
};
