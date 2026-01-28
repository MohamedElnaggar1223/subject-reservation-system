/**
 * Todos Client Component
 *
 * EXAMPLE: This demonstrates complete CRUD operations with TanStack Query:
 * 1. Data fetching with useSuspenseQuery
 * 2. Mutations (create, update, delete)
 * 3. Optimistic updates for instant UI feedback
 * 4. Error handling
 * 5. Loading states
 * 6. Form handling with React Hook Form + Zod
 *
 * Patterns Demonstrated:
 * - Type-safe API calls with Hono RPC
 * - Automatic refetching after mutations
 * - Optimistic UI updates
 * - Form validation
 * - Conditional rendering based on data
 */

'use client'

/**
 * IMPORTANT: RPC Type Inference
 *
 * Notice we DON'T import a Todo type - Hono RPC infers it automatically!
 * The response type from api.v1.todos.$get() is automatically inferred.
 *
 * This is the correct pattern for Hono RPC:
 * - Import INPUT types (CreateTodoType, UpdateTodoType)
 * - Let RPC infer OUTPUT types automatically
 * - Never manually type API responses
 */
import { useState } from "react"
import { useSuspenseQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { api } from "~/lib/hono"
import { apiResponse, type CreateTodoType, type UpdateTodoType } from "@repo/validations"

export default function TodosClient(): React.JSX.Element {
  const queryClient = useQueryClient()
  const [newTitle, setNewTitle] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editDescription, setEditDescription] = useState('')

  /**
   * QUERY: Fetch Todos
   *
   * useSuspenseQuery automatically:
   * - Uses server-prefetched data (instant load)
   * - Shows loading state on subsequent fetches
   * - Handles errors
   * - Type-safe with inferred return type
   *
   * Note: This uses the same queryKey as server prefetch
   */
  const { data: todos } = useSuspenseQuery({
    queryKey: ['todos'],
    queryFn: async () => apiResponse(api.v1.todos.$get()),
  })

  /**
   * MUTATION: Create Todo
   *
   * Demonstrates:
   * - Type-safe mutation input
   * - Automatic cache invalidation
   * - Error handling
   * - Success callback to clear form
   */
  const createMutation = useMutation({
    mutationFn: async (input: CreateTodoType) => {
      return apiResponse(api.v1.todos.$post({ json: input }))
    },
    onSuccess: () => {
      // Invalidate and refetch todos
      queryClient.invalidateQueries({ queryKey: ['todos'] })
      // Clear form
      setNewTitle('')
      setNewDescription('')
    },
    onError: (error) => {
      console.error('Failed to create todo:', error)
      alert('Failed to create todo. Please try again.')
    },
  })

  /**
   * MUTATION: Update Todo
   *
   * Demonstrates:
   * - Partial update (only changed fields)
   * - Optimistic UI update (instant feedback)
   * - Rollback on error
   * - NO explicit typing - let RPC infer everything
   */
  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: UpdateTodoType }) => {
      return apiResponse(api.v1.todos[':id'].$put({
        param: { id },
        json: data
      }))
    },
    // Optimistic update: Update UI before server responds
    onMutate: async ({ id, data }) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['todos'] })

      // Snapshot previous value for rollback
      // ✅ No explicit type - inferred from query
      const previousTodos = queryClient.getQueryData(['todos'])

      // Optimistically update cache
      // ✅ No explicit type - inferred from query
      // ✅ Don't set updatedAt - let the server response handle it
      queryClient.setQueryData(['todos'], (old: typeof todos) =>
        old?.map((todo) =>
          todo.id === id ? { ...todo, ...data } : todo
        )
      )

      return { previousTodos }
    },
    onError: (error, variables, context) => {
      // Rollback on error
      if (context?.previousTodos) {
        queryClient.setQueryData(['todos'], context.previousTodos)
      }
      console.error('Failed to update todo:', error)
      alert('Failed to update todo. Please try again.')
    },
    onSuccess: () => {
      // Refetch to ensure sync with server
      queryClient.invalidateQueries({ queryKey: ['todos'] })
      setEditingId(null)
    },
  })

  /**
   * MUTATION: Delete Todo
   *
   * Demonstrates:
   * - Optimistic deletion
   * - Confirmation before destructive action
   * - Rollback on error
   * - NO explicit typing - RPC inference works perfectly
   */
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiResponse(api.v1.todos[':id'].$delete({ param: { id } }))
    },
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: ['todos'] })
      // ✅ No explicit type - inferred from query
      const previousTodos = queryClient.getQueryData(['todos'])

      // Optimistically remove from UI
      // ✅ No explicit type - inferred from query
      queryClient.setQueryData(['todos'], (old: typeof todos) =>
        old?.filter((todo) => todo.id !== id)
      )

      return { previousTodos }
    },
    onError: (error, variables, context) => {
      if (context?.previousTodos) {
        queryClient.setQueryData(['todos'], context.previousTodos)
      }
      console.error('Failed to delete todo:', error)
      alert('Failed to delete todo. Please try again.')
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['todos'] })
    },
  })

  /**
   * EVENT HANDLERS
   */

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault()
    if (!newTitle.trim()) return

    createMutation.mutate({
      title: newTitle,
      description: newDescription || undefined,
    })
  }

  const handleToggleComplete = (todo: typeof todos[number]) => {
    updateMutation.mutate({
      id: todo.id,
      data: { completed: !todo.completed },
    })
  }

  const handleStartEdit = (todo: typeof todos[number]) => {
    setEditingId(todo.id)
    setEditTitle(todo.title)
    setEditDescription(todo.description || '')
  }

  const handleSaveEdit = (id: string) => {
    updateMutation.mutate({
      id,
      data: {
        title: editTitle,
        description: editDescription || undefined,
      },
    })
  }

  const handleDelete = (id: string) => {
    if (confirm('Are you sure you want to delete this todo?')) {
      deleteMutation.mutate(id)
    }
  }

  /**
   * RENDER
   */

  return (
    <div className='min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-8'>
      <div className='max-w-4xl mx-auto'>
        {/* Header */}
        <header className='mb-8'>
          <h1 className='text-4xl font-bold text-gray-900 mb-2'>My Todos</h1>
          <p className='text-gray-600'>Manage your tasks efficiently</p>
        </header>

        {/* Create Form */}
        <div className='bg-white rounded-lg shadow-md p-6 mb-6'>
          <h2 className='text-xl font-semibold mb-4'>Add New Todo</h2>
          <form onSubmit={handleCreate} className='space-y-4'>
            <div>
              <input
                type='text'
                placeholder='Todo title...'
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                className='w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500'
                required
              />
            </div>
            <div>
              <textarea
                placeholder='Description (optional)...'
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                className='w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none'
                rows={3}
              />
            </div>
            <button
              type='submit'
              disabled={createMutation.isPending}
              className='w-full bg-blue-600 text-white py-2 px-4 rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors'
            >
              {createMutation.isPending ? 'Adding...' : 'Add Todo'}
            </button>
          </form>
        </div>

        {/* Todos List */}
        <div className='bg-white rounded-lg shadow-md p-6'>
          <h2 className='text-xl font-semibold mb-4'>
            Your Todos ({todos.length})
          </h2>

          {todos.length === 0 ? (
            <p className='text-gray-500 text-center py-8'>
              No todos yet. Create one above!
            </p>
          ) : (
            <div className='space-y-3'>
              {todos.map((todo) => (
                <div
                  key={todo.id}
                  className='border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow'
                >
                  {editingId === todo.id ? (
                    /* Edit Mode */
                    <div className='space-y-3'>
                      <input
                        type='text'
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        className='w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500'
                      />
                      <textarea
                        value={editDescription}
                        onChange={(e) => setEditDescription(e.target.value)}
                        className='w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none'
                        rows={2}
                      />
                      <div className='flex gap-2'>
                        <button
                          onClick={() => handleSaveEdit(todo.id)}
                          className='px-4 py-1 bg-green-600 text-white rounded hover:bg-green-700'
                        >
                          Save
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          className='px-4 py-1 bg-gray-300 text-gray-700 rounded hover:bg-gray-400'
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    /* Display Mode */
                    <div>
                      <div className='flex items-start justify-between'>
                        <div className='flex items-start gap-3 flex-1'>
                          <input
                            type='checkbox'
                            checked={todo.completed}
                            onChange={() => handleToggleComplete(todo)}
                            className='mt-1 w-5 h-5 text-blue-600 rounded focus:ring-2 focus:ring-blue-500'
                          />
                          <div className='flex-1'>
                            <h3
                              className={`text-lg font-medium ${
                                todo.completed
                                  ? 'line-through text-gray-400'
                                  : 'text-gray-900'
                              }`}
                            >
                              {todo.title}
                            </h3>
                            {todo.description && (
                              <p className='text-gray-600 mt-1'>
                                {todo.description}
                              </p>
                            )}
                            <p className='text-sm text-gray-400 mt-2'>
                              Created {new Date(todo.createdAt).toLocaleDateString()}
                            </p>
                          </div>
                        </div>
                        <div className='flex gap-2'>
                          <button
                            onClick={() => handleStartEdit(todo)}
                            className='text-blue-600 hover:text-blue-800 px-3 py-1'
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleDelete(todo.id)}
                            className='text-red-600 hover:text-red-800 px-3 py-1'
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Pattern Reference */}
        <div className='mt-8 bg-blue-50 rounded-lg p-6 border border-blue-200'>
          <h3 className='text-lg font-semibold text-blue-900 mb-2'>
            ✨ Patterns Demonstrated
          </h3>
          <ul className='space-y-1 text-sm text-blue-800'>
            <li>✓ Server-side rendering with data pre-fetching</li>
            <li>✓ Type-safe API calls with Hono RPC</li>
            <li>✓ Optimistic UI updates for instant feedback</li>
            <li>✓ Automatic error handling and rollback</li>
            <li>✓ Form validation with controlled components</li>
            <li>✓ CRUD operations (Create, Read, Update, Delete)</li>
          </ul>
        </div>
      </div>
    </div>
  )
}
