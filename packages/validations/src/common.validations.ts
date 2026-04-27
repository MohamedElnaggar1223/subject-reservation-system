import { z } from 'zod';

/**
 * Sanitization utilities for user input
 */
export const sanitizers = {
  string: (str: string) => str.trim().replace(/\s+/g, ' '),
  email: (email: string) => email.trim().toLowerCase(),
  name: (name: string) => {
    return name
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/[^\p{L}\s\-']/gu, '');
  },
};

/**
 * Common reusable Zod schemas with built-in sanitization
 */
export const CommonSchemas = {
  /**
   * Email schema with automatic lowercase transformation
   */
  email: z.string().email().transform(sanitizers.email),
  
  /**
   * Name schema with sanitization (2-100 characters)
   */
  name: z.string().min(2).max(100).transform(sanitizers.name),
  
  /**
   * Positive integer schema
   */
  positiveInt: z.coerce.number().int().positive(),
  
  id: z.string().min(1),

  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number'),
  
  /**
   * Pagination schema for list endpoints
   */
  pagination: z.object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(20),
  }),
};

/**
 * Standard API response types
 */
export type ApiSuccess<T> = {
  success: true;
  data: T;
  message?: string;
};

export type ApiError = {
  success: false;
  error: string;
  details?: unknown;
};

export type ApiResponse<T> = ApiSuccess<T> | ApiError;

/**
 * Paginated response type
 */
export type PaginatedResponse<T> = {
  data: T[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
};

