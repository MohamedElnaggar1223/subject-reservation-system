import { z } from 'zod';

/**
 * Sanitization utilities for user input
 */
export const sanitizers = {
  /**
   * Trims whitespace and collapses multiple spaces into one
   */
  string: (str: string) => str.trim().replace(/\s+/g, ' '),
  
  /**
   * Trims and converts email to lowercase
   */
  email: (email: string) => email.trim().toLowerCase(),
  
  /**
   * Sanitizes name - removes special characters, trims, collapses spaces
   * Allows letters, spaces, hyphens, and apostrophes
   */
  name: (name: string) => {
    return name
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/[^a-zA-Z\s-']/g, '');
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
  
  /**
   * ID schema - accepts UUID or any non-empty string
   */
  id: z.string().uuid().or(z.string().min(1)),
  
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

