/**
 * Todo API Routes
 *
 * EXAMPLE: This file demonstrates all key patterns for building API routes:
 * 1. Authentication middleware (requireAuth)
 * 2. Zod validation (zValidator)
 * 3. Response helpers (success, error)
 * 4. Service layer integration
 * 5. Authorization checks (ownership verification)
 * 6. Role-based access control (RBAC)
 * 7. Type-safe context access
 *
 * Route Structure:
 * - GET /todos          - List user's todos
 * - POST /todos         - Create new todo
 * - GET /todos/:id      - Get specific todo
 * - PUT /todos/:id      - Update todo
 * - DELETE /todos/:id   - Delete todo (admin only)
 *
 * This is a complete reference implementation showing best practices.
 */

import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { CreateTodo, UpdateTodo, TodoId, ROLES } from '@repo/validations'
import { success, error } from '../lib/response'
import { requireAuth, requireRole } from '../middleware/access-control.middleware'
import type { HonoEnv } from '../lib/types'
import * as todoService from '../services/todo.services'

/**
 * Initialize route with typed environment
 *
 * HonoEnv provides type-safe access to:
 * - c.get('user')     - Current authenticated user
 * - c.get('session')  - Current session
 * - c.get('requestId') - Request tracking ID
 */
export const todos = new Hono<HonoEnv>()
  /**
   * Middleware: Require authentication for all routes
   *
   * This runs before any route handler.
   * If not authenticated, returns 401 Unauthorized.
   */
  .use('*', requireAuth())

  /**
   * LIST TODOS
   * GET /todos
   *
   * Returns all todos for the authenticated user.
   * Demonstrates:
   * - Reading user from context
   * - User-scoped data fetching
   * - Success response helper
   */
  .get('/', async (c) => {
    const user = c.get('user')!  // Safe because requireAuth() runs first

    const userTodos = await todoService.getUserTodos(user.id)

    return success(c, userTodos)
  })

  /**
   * CREATE TODO
   * POST /todos
   * Body: { title: string, description?: string }
   *
   * Creates a new todo for the authenticated user.
   * Demonstrates:
   * - Request body validation with Zod
   * - Type-safe validated data access
   * - Service layer integration
   * - 201 Created status code
   */
  .post('/',
    zValidator('json', CreateTodo),
    async (c) => {
      const user = c.get('user')!
      const data = c.req.valid('json')  // Type: CreateTodoType (inferred from Zod)

      const created = await todoService.createTodo(data, user.id)

      return success(c, created, 201)
    }
  )

  /**
   * GET TODO BY ID
   * GET /todos/:id
   * Params: { id: string (UUID) }
   *
   * Returns a specific todo if it belongs to the user.
   * Demonstrates:
   * - URL parameter validation
   * - Ownership verification
   * - 404 Not Found handling
   * - 403 Forbidden for access violations
   */
  .get('/:id',
    zValidator('param', TodoId),
    async (c) => {
      const user = c.get('user')!
      const { id } = c.req.valid('param')  // Type: { id: string }

      const todoItem = await todoService.getTodoById(id)

      // Check if todo exists
      if (!todoItem) {
        return error(c, 'Todo not found', 404)
      }

      // Check ownership (users can only access their own todos)
      if (todoItem.userId !== user.id) {
        return error(c, 'Access denied', 403)
      }

      return success(c, todoItem)
    }
  )

  /**
   * UPDATE TODO
   * PUT /todos/:id
   * Params: { id: string }
   * Body: { title?: string, description?: string, completed?: boolean }
   *
   * Updates a todo if it belongs to the user.
   * Demonstrates:
   * - Multiple validators (param + json)
   * - Partial update pattern
   * - Ownership check before modification
   */
  .put('/:id',
    zValidator('param', TodoId),
    zValidator('json', UpdateTodo),
    async (c) => {
      const user = c.get('user')!
      const { id } = c.req.valid('param')
      const data = c.req.valid('json')  // Type: UpdateTodoType

      // Verify ownership before allowing update
      const isOwner = await todoService.isTodoOwner(id, user.id)
      if (!isOwner) {
        return error(c, 'Todo not found or access denied', 404)
      }

      const updated = await todoService.updateTodo(id, data)

      return success(c, updated)
    }
  )

  /**
   * DELETE TODO
   * DELETE /todos/:id
   * Params: { id: string }
   *
   * Deletes a todo. Only admins can delete any todo.
   * Regular users can only delete their own.
   *
   * Demonstrates:
   * - Role-based access control (RBAC)
   * - Different authorization rules by role
   * - 204 No Content response pattern
   */
  .delete('/:id',
    zValidator('param', TodoId),
    async (c) => {
      const user = c.get('user')!
      const { id } = c.req.valid('param')

      // Check ownership (unless admin)
      if (user.role !== ROLES.ADMIN) {
        const isOwner = await todoService.isTodoOwner(id, user.id)
        if (!isOwner) {
          return error(c, 'Todo not found or access denied', 404)
        }
      }

      await todoService.deleteTodo(id)

      // Return success with no content body
      return success(c, { deleted: true })
    }
  )

/**
 * Export type for RPC client
 *
 * This enables type-safe API calls from web and mobile:
 *
 * const todos = await apiResponse(api.v1.todos.$get())
 * // Type automatically inferred: Todo[]
 *
 * const created = await apiResponse(
 *   api.v1.todos.$post({ json: { title: 'New todo' } })
 * )
 * // Type: Todo
 */
export type TodosApi = typeof todos
