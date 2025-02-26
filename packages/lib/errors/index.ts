import { TRPCError } from '@trpc/server';
import { ZodError } from 'zod';
import { NextApiRequest, NextApiResponse } from 'next';

/**
 * Error codes for the application.
 */
export enum ErrorCode {
  // Authentication errors
  UNAUTHORIZED = 'UNAUTHORIZED',
  INVALID_CREDENTIALS = 'INVALID_CREDENTIALS',
  SESSION_EXPIRED = 'SESSION_EXPIRED',
  
  // Authorization errors
  FORBIDDEN = 'FORBIDDEN',
  INSUFFICIENT_PERMISSIONS = 'INSUFFICIENT_PERMISSIONS',
  
  // Resource errors
  NOT_FOUND = 'NOT_FOUND',
  ALREADY_EXISTS = 'ALREADY_EXISTS',
  CONFLICT = 'CONFLICT',
  
  // Validation errors
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  INVALID_INPUT = 'INVALID_INPUT',
  
  // Rate limiting
  RATE_LIMITED = 'RATE_LIMITED',
  
  // Server errors
  INTERNAL_SERVER_ERROR = 'INTERNAL_SERVER_ERROR',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
  DATABASE_ERROR = 'DATABASE_ERROR',
  
  // Document errors
  DOCUMENT_LOCKED = 'DOCUMENT_LOCKED',
  DOCUMENT_ALREADY_SIGNED = 'DOCUMENT_ALREADY_SIGNED',
  DOCUMENT_EXPIRED = 'DOCUMENT_EXPIRED',
  
  // External service errors
  EXTERNAL_SERVICE_ERROR = 'EXTERNAL_SERVICE_ERROR',
  PAYMENT_ERROR = 'PAYMENT_ERROR',
}

/**
 * Base error class for the application.
 */
export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: number;
  public readonly details?: Record<string, any>;
  public readonly isOperational: boolean;
  
  constructor(
    message: string,
    code: ErrorCode = ErrorCode.INTERNAL_SERVER_ERROR,
    statusCode = 500,
    details?: Record<string, any>,
    isOperational = true
  ) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    this.isOperational = isOperational;
    
    // Capture stack trace
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Error for unauthorized access.
 */
export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized', details?: Record<string, any>) {
    super(message, ErrorCode.UNAUTHORIZED, 401, details);
  }
}

/**
 * Error for forbidden access.
 */
export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden', details?: Record<string, any>) {
    super(message, ErrorCode.FORBIDDEN, 403, details);
  }
}

/**
 * Error for resource not found.
 */
export class NotFoundError extends AppError {
  constructor(message = 'Resource not found', details?: Record<string, any>) {
    super(message, ErrorCode.NOT_FOUND, 404, details);
  }
}

/**
 * Error for validation failures.
 */
export class ValidationError extends AppError {
  constructor(message = 'Validation error', details?: Record<string, any>) {
    super(message, ErrorCode.VALIDATION_ERROR, 400, details);
  }
}

/**
 * Error for rate limiting.
 */
export class RateLimitError extends AppError {
  constructor(message = 'Too many requests', details?: Record<string, any>) {
    super(message, ErrorCode.RATE_LIMITED, 429, details);
  }
}

/**
 * Error for database failures.
 */
export class DatabaseError extends AppError {
  constructor(message = 'Database error', details?: Record<string, any>) {
    super(message, ErrorCode.DATABASE_ERROR, 500, details);
  }
}

/**
 * Error for external service failures.
 */
export class ExternalServiceError extends AppError {
  constructor(message = 'External service error', details?: Record<string, any>) {
    super(message, ErrorCode.EXTERNAL_SERVICE_ERROR, 502, details);
  }
}

/**
 * Convert a Zod error to a ValidationError.
 */
export function zodErrorToValidationError(error: ZodError): ValidationError {
  return new ValidationError('Validation error', {
    errors: error.errors.map((err) => ({
      path: err.path,
      message: err.message,
    })),
  });
}

/**
 * Convert a TRPC error to an AppError.
 */
export function trpcErrorToAppError(error: TRPCError): AppError {
  switch (error.code) {
    case 'UNAUTHORIZED':
      return new UnauthorizedError(error.message);
    case 'FORBIDDEN':
      return new ForbiddenError(error.message);
    case 'NOT_FOUND':
      return new NotFoundError(error.message);
    case 'BAD_REQUEST':
      return new ValidationError(error.message);
    case 'TOO_MANY_REQUESTS':
      return new RateLimitError(error.message);
    case 'INTERNAL_SERVER_ERROR':
      return new AppError(error.message);
    default:
      return new AppError(error.message, ErrorCode.INTERNAL_SERVER_ERROR, 500);
  }
}

/**
 * Convert an AppError to a TRPC error.
 */
export function appErrorToTrpcError(error: AppError): TRPCError {
  let code: any;
  
  switch (error.code) {
    case ErrorCode.UNAUTHORIZED:
    case ErrorCode.INVALID_CREDENTIALS:
    case ErrorCode.SESSION_EXPIRED:
      code = 'UNAUTHORIZED';
      break;
    case ErrorCode.FORBIDDEN:
    case ErrorCode.INSUFFICIENT_PERMISSIONS:
      code = 'FORBIDDEN';
      break;
    case ErrorCode.NOT_FOUND:
      code = 'NOT_FOUND';
      break;
    case ErrorCode.VALIDATION_ERROR:
    case ErrorCode.INVALID_INPUT:
    case ErrorCode.ALREADY_EXISTS:
    case ErrorCode.CONFLICT:
      code = 'BAD_REQUEST';
      break;
    case ErrorCode.RATE_LIMITED:
      code = 'TOO_MANY_REQUESTS';
      break;
    default:
      code = 'INTERNAL_SERVER_ERROR';
  }
  
  return new TRPCError({
    code,
    message: error.message,
    cause: error,
  });
}

/**
 * Handle errors in API routes.
 */
export function apiErrorHandler(
  err: unknown,
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Log the error
  console.error('API Error:', err);
  
  // Handle different types of errors
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
        details: err.details,
      },
    });
  }
  
  if (err instanceof ZodError) {
    const validationError = zodErrorToValidationError(err);
    
    return res.status(validationError.statusCode).json({
      error: {
        code: validationError.code,
        message: validationError.message,
        details: validationError.details,
      },
    });
  }
  
  if (err instanceof TRPCError) {
    const appError = trpcErrorToAppError(err);
    
    return res.status(appError.statusCode).json({
      error: {
        code: appError.code,
        message: appError.message,
        details: appError.details,
      },
    });
  }
  
  // Default to internal server error
  return res.status(500).json({
    error: {
      code: ErrorCode.INTERNAL_SERVER_ERROR,
      message: err instanceof Error ? err.message : 'An unexpected error occurred',
    },
  });
}

/**
 * Global error handler for the application.
 */
export function globalErrorHandler(err: Error): void {
  // Log the error
  console.error('Global Error:', err);
  
  // Send to error monitoring service if available
  if (process.env.NODE_ENV === 'production') {
    // In a real implementation, you would send this to an error monitoring service
    // like Sentry, New Relic, etc.
    console.error('Would send to error monitoring service:', {
      name: err.name,
      message: err.message,
      stack: err.stack,
      isOperational: err instanceof AppError ? err.isOperational : false,
    });
  }
}

/**
 * Handle uncaught exceptions and unhandled promise rejections.
 */
export function setupGlobalErrorHandlers(): void {
  process.on('uncaughtException', (err) => {
    globalErrorHandler(err);
    
    // If the error is not operational, exit the process
    if (!(err instanceof AppError) || !err.isOperational) {
      process.exit(1);
    }
  });
  
  process.on('unhandledRejection', (reason) => {
    const error = reason instanceof Error ? reason : new Error(String(reason));
    globalErrorHandler(error);
  });
}
