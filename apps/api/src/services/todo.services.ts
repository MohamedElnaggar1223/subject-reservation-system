/**
 * Todo Service Layer
 *
 * EXAMPLE: This file demonstrates the service layer pattern.
 *
 * Service Layer Responsibilities:
 * 1. Business logic (data validation happens in routes with Zod)
 * 2. Database operations (using Drizzle ORM)
 * 3. Data transformation
 * 4. Authorization checks (ownership verification)
 *
 * Keep services focused on data access and business rules.
 * Don't put HTTP concerns (status codes, headers) here - that's for routes.
 *
 * Pattern: Each service function is a single operation
 * - getUserTodos: List all todos for a user
 * - getTodoById: Get specific todo
 * - createTodo: Create new todo
 * - updateTodo: Update existing todo
 * - deleteTodo: Delete todo
 */

/**
 * IMPORTANT: Import everything from @repo/db
 *
 * Never import from 'drizzle-orm' directly in services.
 * All drizzle operators are re-exported from @repo/db.
 *
 * This maintains clean architecture:
 * - @repo/db owns all database dependencies
 * - Services only depend on @repo/db
 * - Easier to swap ORMs in the future
 */
import { db, todo, eq, and, desc } from '@repo/db'
import { randomUUID } from 'crypto'
import type { CreateTodoType, UpdateTodoType } from '@repo/validations'

/**
 * Get all todos for a specific user
 *
 * @param userId - The user's ID
 * @returns Array of todos ordered by creation date (newest first)
 *
 * Pattern: User-scoped queries
 * - Always filter by userId to ensure data isolation
 * - Use orderBy for consistent sorting
 */
export async function getUserTodos(userId: string) {
  return db.query.todo.findMany({
    where: (todos, { eq }) => eq(todos.userId, userId),
    orderBy: (todos, { desc }) => [desc(todos.createdAt)],
  })
}

/**
 * Get a specific todo by ID
 *
 * @param id - The todo's ID
 * @returns Todo object or undefined if not found
 *
 * Pattern: Single record fetch
 * - Use findFirst for nullable return
 * - Caller should check for undefined
 */
export async function getTodoById(id: string) {
  return db.query.todo.findFirst({
    where: (todos, { eq }) => eq(todos.id, id),
  })
}

/**
 * Create a new todo
 *
 * @param input - Todo data (title, description)
 * @param userId - The owner's user ID
 * @returns The created todo with all fields
 *
 * Pattern: Insert with generated fields
 * - Generate UUID on server (never trust client IDs)
 * - Set timestamps automatically (using DB defaults + returning)
 * - Use returning() to get the inserted record
 */
export async function createTodo(input: CreateTodoType, userId: string) {
  const id = randomUUID()
  const now = new Date()

  const [created] = await db
    .insert(todo)
    .values({
      id,
      title: input.title,
      description: input.description || null,
      userId,
      completed: false,
      createdAt: now,
      updatedAt: now,
    })
    .returning()

  return created
}

/**
 * Update an existing todo
 *
 * @param id - The todo's ID
 * @param input - Fields to update (partial)
 * @returns The updated todo
 *
 * Pattern: Partial update
 * - Only update provided fields
 * - Always update updatedAt timestamp
 * - Return updated record with returning()
 *
 * Note: Ownership check should be done in route handler before calling this
 */
export async function updateTodo(id: string, input: UpdateTodoType) {
  const [updated] = await db
    .update(todo)
    .set({
      ...input,
      updatedAt: new Date(),
    })
    .where(eq(todo.id, id))
    .returning()

  return updated
}

/**
 * Delete a todo
 *
 * @param id - The todo's ID
 *
 * Pattern: Simple delete
 * - No returning() needed for deletes
 * - Ownership check should be done in route handler
 *
 * Note: If user is deleted, all their todos are auto-deleted
 * due to onDelete: "cascade" in schema
 */
export async function deleteTodo(id: string) {
  await db.delete(todo).where(eq(todo.id, id))
}

/**
 * Check if a todo belongs to a specific user
 *
 * @param todoId - The todo's ID
 * @param userId - The user's ID
 * @returns true if user owns the todo
 *
 * Pattern: Ownership verification
 * - Use this before update/delete operations
 * - Prevents users from modifying others' data
 */
export async function isTodoOwner(todoId: string, userId: string): Promise<boolean> {
  const todoItem = await db.query.todo.findFirst({
    where: (todos, { and, eq }) => and(
      eq(todos.id, todoId),
      eq(todos.userId, userId)
    ),
  })

  return !!todoItem
}
