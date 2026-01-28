/**
 * Todo Validation Schemas
 *
 * EXAMPLE: This file demonstrates how to create validation schemas
 * that are shared across API, web, and mobile apps.
 *
 * Key Patterns:
 * 1. Reusable field validators with constraints
 * 2. Separate schemas for different operations (create, update, etc.)
 * 3. Type inference from Zod schemas
 * 4. Input sanitization (trim, transform)
 *
 * Usage:
 * - API: zValidator('json', CreateTodo)
 * - Web/Mobile: useForm with zodResolver(CreateTodo)
 * - Types: z.infer<typeof CreateTodo>
 */

import { z } from 'zod'

/**
 * Reusable Field Validators
 *
 * Define common fields once, reuse in multiple schemas.
 * This ensures consistency and makes updates easier.
 */
const title = z
  .string()
  .min(1, 'Title is required')
  .max(200, 'Title must be 200 characters or less')
  .trim()

const description = z
  .string()
  .max(1000, 'Description must be 1000 characters or less')
  .trim()
  .optional()

const completed = z
  .boolean()
  .default(false)

/**
 * CREATE TODO SCHEMA
 *
 * Used when creating a new todo item.
 * Only includes fields that the user can set.
 * Server will add: id, userId, createdAt, updatedAt
 */
export const CreateTodo = z.object({
  title,
  description,
})

/**
 * UPDATE TODO SCHEMA
 *
 * Used when updating an existing todo.
 * All fields are optional (partial update).
 * At least one field must be provided (enforced by API).
 */
export const UpdateTodo = z.object({
  title: title.optional(),
  description,
  completed: completed.optional(),
})

/**
 * TODO ID SCHEMA
 *
 * Used for validating URL parameters.
 * Ensures the ID is a valid UUID.
 */
export const TodoId = z.object({
  id: z.string().uuid('Invalid todo ID'),
})

/**
 * Type Inference - INPUT TYPES ONLY
 *
 * IMPORTANT: Only export types for INPUT validation (create, update, params).
 * NEVER manually type API responses - let Hono RPC infer them automatically.
 *
 * Why?
 * - RPC provides automatic end-to-end type safety
 * - Manual types cause mismatches (e.g., Date vs string in JSON)
 * - Breaks the whole point of using Hono RPC
 *
 * For response types, use:
 * - Awaited<ReturnType<typeof api.v1.todos.$get>>
 * - Or just let TypeScript infer automatically
 */
export type CreateTodoType = z.infer<typeof CreateTodo>
export type UpdateTodoType = z.infer<typeof UpdateTodo>
export type TodoIdType = z.infer<typeof TodoId>

/**
 * DO NOT EXPORT RESPONSE TYPES
 *
 * The Todo response type is automatically inferred from the API.
 * If you need the type, extract it from the RPC client:
 *
 * type TodosResponse = Awaited<ReturnType<typeof apiResponse<typeof api.v1.todos.$get>>>
 *
 * But in practice, you rarely need this - just let TypeScript infer.
 */
