import { TRPCError } from '@trpc/server';
import { Redis } from 'ioredis';
import { NextRequest, NextResponse } from 'next/server';

// Redis client for storing rate limit data
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

interface RateLimitOptions {
  windowMs: number;
  max: number;
  keyGenerator?: (req: NextRequest) => string;
  handler?: (req: NextRequest, res: NextResponse) => void;
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
}

/**
 * Create a rate limiter middleware for API routes
 */
export function createRateLimiter({
  windowMs = 15 * 60 * 1000, // 15 minutes
  max = 100, // limit each IP to 100 requests per windowMs
  keyGenerator = (req) => req.ip || 'unknown',
  handler,
  skipSuccessfulRequests = false,
  skipFailedRequests = false,
}: RateLimitOptions) {
  return async function rateLimiterMiddleware(
    req: NextRequest,
    res: NextResponse,
    next: () => Promise<void>
  ) {
    const key = `rate-limit:${keyGenerator(req)}`;
    
    try {
      // Get current count
      const currentCount = await redis.get(key);
      const count = currentCount ? parseInt(currentCount, 10) : 0;
      
      // Check if over limit
      if (count >= max) {
        if (handler) {
          return handler(req, res);
        }
        
        throw new TRPCError({
          code: 'TOO_MANY_REQUESTS',
          message: 'Too many requests, please try again later.',
        });
      }
      
      // Increment count
      await redis.incr(key);
      
      // Set expiry if this is the first request in the window
      if (count === 0) {
        await redis.expire(key, Math.floor(windowMs / 1000));
      }
      
      // Continue to the next middleware or route handler
      await next();
      
      // Optionally decrement the counter if the request was successful
      if (skipSuccessfulRequests && res.status >= 200 && res.status < 300) {
        await redis.decr(key);
      }
    } catch (error) {
      // Optionally decrement the counter if the request failed
      if (skipFailedRequests && error instanceof Error) {
        await redis.decr(key);
      }
      
      throw error;
    }
  };
}

/**
 * Create a rate limiter for TRPC procedures
 */
export function createTRPCRateLimiter({
  windowMs = 15 * 60 * 1000, // 15 minutes
  max = 100, // limit each IP to 100 requests per windowMs
}: {
  windowMs?: number;
  max?: number;
}) {
  return async function rateLimiterMiddleware(ctx: any) {
    const ip = ctx.req?.ip || ctx.req?.headers?.['x-forwarded-for'] || 'unknown';
    const key = `rate-limit:trpc:${ip}`;
    
    // Get current count
    const currentCount = await redis.get(key);
    const count = currentCount ? parseInt(currentCount, 10) : 0;
    
    // Check if over limit
    if (count >= max) {
      throw new TRPCError({
        code: 'TOO_MANY_REQUESTS',
        message: 'Too many requests, please try again later.',
      });
    }
    
    // Increment count
    await redis.incr(key);
    
    // Set expiry if this is the first request in the window
    if (count === 0) {
      await redis.expire(key, Math.floor(windowMs / 1000));
    }
  };
}
