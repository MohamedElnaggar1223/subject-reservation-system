# Architecture Patterns & Best Practices

This document explains the key architectural decisions and patterns used in this template.

## ⚠️ CRITICAL: Hono RPC Type Inference

### The Golden Rule: NEVER Manually Type API Responses

**The entire point of Hono RPC is automatic end-to-end type safety.**

### ❌ WRONG - Manual Typing

```typescript
// DON'T create manual response types
export type Todo = {
  id: string
  title: string
  createdAt: Date  // ❌ Wrong! API returns string (JSON serialization)
  updatedAt: Date  // ❌ Wrong! API returns string
}

// DON'T explicitly type responses
const { data } = useQuery<Todo[]>({  // ❌ Breaks RPC inference
  queryKey: ['todos'],
  queryFn: async () => apiResponse(api.v1.todos.$get())
})

// DON'T explicitly type cache operations
queryClient.setQueryData<Todo[]>(['todos'], ...)  // ❌ Type mismatch!
```

**Why this is wrong:**
- Creates type mismatches (Date vs string)
- Defeats the entire purpose of Hono RPC
- Causes runtime errors
- Breaks automatic type inference

### ✅ CORRECT - Let RPC Infer

```typescript
// ✅ ONLY create types for INPUTS (validation)
export type CreateTodoType = z.infer<typeof CreateTodo>
export type UpdateTodoType = z.infer<typeof UpdateTodo>

// ✅ DON'T type the query - let RPC infer
const { data: todos } = useQuery({
  queryKey: ['todos'],
  queryFn: async () => apiResponse(api.v1.todos.$get())
  // todos type is automatically inferred from API!
})

// ✅ DON'T type cache operations - use inference
queryClient.setQueryData(['todos'], (old) =>
  old?.map((todo) => ({ ...todo, completed: true }))
  // todo type is inferred from query
)

// ✅ If you need the type, extract from the inferred data
const handleToggle = (todo: typeof todos[number]) => {
  // todo type is automatically correct (string dates, not Date objects)
}
```

### When You Absolutely Need a Response Type

**99% of the time, you don't.** But if you do:

```typescript
// Extract from RPC client
type TodosResponse = Awaited<ReturnType<typeof apiResponse<typeof api.v1.todos.$get>>>

// Or from the inferred data
const { data: todos } = useQuery(...)
type Todo = typeof todos[number]
```

But seriously, just let TypeScript infer it automatically.

---

## 🗄️ Database Package Abstraction

### The Golden Rule: Never Import from `drizzle-orm`

**The `@repo/db` package owns ALL database dependencies.**

### ❌ WRONG

```typescript
// In apps/api/src/services/...
import { db } from '@repo/db'
import { eq, and } from 'drizzle-orm'  // ❌ Breaks abstraction
```

### ✅ CORRECT

```typescript
// In apps/api/src/services/...
import { db, eq, and, desc } from '@repo/db'  // ✅ Everything from @repo/db
```

**Why?**
- Single source of truth for DB dependencies
- Only `@repo/db` knows about Drizzle
- Easy to swap ORMs later
- No duplicate dependencies

**What `@repo/db` exports:**
- Database instance (`db`)
- All schema tables (`user`, `todo`, etc.)
- All Drizzle operators (`eq`, `and`, `or`, `desc`, etc.)
- Health check functions

---

## 📦 Validation Schemas

### Only Export INPUT Types

```typescript
// ✅ Export input validation types
export const CreateTodo = z.object({ ... })
export type CreateTodoType = z.infer<typeof CreateTodo>

// ❌ DON'T export response types
export type Todo = { ... }  // Don't do this! Let RPC infer.
```

**Input types are for:**
- Form validation (`zValidator` in API)
- React Hook Form (`zodResolver`)
- TypeScript function parameters

**Response types come from:**
- Hono RPC automatic inference
- Never manually created

---

## 🔄 TanStack Query Patterns

### Queries: Let Inference Work

```typescript
// ✅ No explicit typing
const { data: todos } = useSuspenseQuery({
  queryKey: ['todos'],
  queryFn: async () => apiResponse(api.v1.todos.$get())
})

// Type of todos: Todo[] (automatically inferred from API)
```

### Mutations: Only Type Inputs

```typescript
// ✅ Only type the input parameter
const createMutation = useMutation({
  mutationFn: async (input: CreateTodoType) => {
    return apiResponse(api.v1.todos.$post({ json: input }))
  }
})

// Return type automatically inferred from API
```

### Optimistic Updates: No Explicit Types

```typescript
onMutate: async (id) => {
  // ✅ No type annotation
  const previous = queryClient.getQueryData(['todos'])

  // ✅ No type annotation
  queryClient.setQueryData(['todos'], (old) =>
    old?.filter(todo => todo.id !== id)
  )

  return { previous }
}
```

---

## 🔐 Authentication Patterns

### Server Components: Use `requireAuth()`

```typescript
// apps/web/app/dashboard/page.tsx
export default async function DashboardPage() {
  const session = await requireAuth()  // Redirects if not authenticated

  // Pre-fetch data with server API client
  const api = await getServerApi()
  // ...
}
```

### API Routes: Use Middleware

```typescript
// apps/api/src/routes/todos.routes.ts
export const todos = new Hono()
  .use('*', requireAuth())  // All routes require auth
  .get('/', handler)        // This route is protected
  .post('/', handler)       // This route is protected
```

### Role-Based Access

```typescript
// Specific role required
.use(requireRole(ROLES.ADMIN))

// Multiple roles allowed
.use(requireRole(ROLES.ADMIN, ROLES.COACH))

// Convenience shortcuts
.use(requireAdmin())
.use(requireCoach())
```

---

## 🏗️ Service Layer Pattern

**Services handle business logic and database operations.**

### Good Service

```typescript
export async function getUserTodos(userId: string) {
  return db.query.todo.findMany({
    where: (todos, { eq }) => eq(todos.userId, userId),
    orderBy: (todos, { desc }) => [desc(todos.createdAt)]
  })
}
```

**Characteristics:**
- Pure data access logic
- No HTTP concerns (no status codes, headers)
- Validation happens in routes (via Zod)
- Returns data or throws errors
- No response formatting (routes handle that)

### Bad Service

```typescript
// ❌ Don't do this
export async function getUserTodos(req: Request) {
  // Validation in service? No - do it in route
  const userId = validate(req.userId)

  const todos = await db.query...

  // HTTP response in service? No - return data only
  return Response.json({ success: true, data: todos })
}
```

---

## 📁 File Organization

### API Routes

```
apps/api/src/
├── routes/
│   ├── todo.routes.ts       # Feature-based routing
│   └── user.routes.ts
├── services/
│   ├── todo.services.ts     # Business logic
│   └── user.services.ts
├── middleware/
│   └── access-control.middleware.ts
└── lib/
    ├── auth.ts              # Better-auth setup
    ├── response.ts          # Response helpers
    └── permissions.ts       # RBAC definitions
```

### Shared Packages

```
packages/
├── db/
│   ├── src/
│   │   ├── schema.ts        # All tables
│   │   ├── db.ts            # DB instance
│   │   └── index.ts         # Re-exports everything
│   └── drizzle/             # Migrations
└── validations/
    ├── src/
    │   ├── todo/
    │   │   └── todo.validations.ts  # Feature-based
    │   ├── common.validations.ts    # Shared validators
    │   ├── roles.ts                 # Role definitions
    │   └── api-response.ts          # Response unwrapper
    └── index.ts
```

---

## 🎯 When to Use Each Pattern

| Scenario | Pattern | Example |
|----------|---------|---------|
| API returns data | Let RPC infer | `const { data } = useQuery(...)` |
| Form validation | Zod schema | `zValidator('json', CreateTodo)` |
| Need response type | Extract from data | `typeof todos[number]` |
| Database query | Use @repo/db | `import { db, eq } from '@repo/db'` |
| Protect route | Middleware | `.use(requireAuth())` |
| Business logic | Service layer | `todoService.getUserTodos()` |
| Cache update | No types | `queryClient.setQueryData(['todos'], ...)` |

---

## 🚫 Common Mistakes

### 1. Manual Response Types

```typescript
// ❌ Don't create manual types for API responses
export type Todo = {
  createdAt: Date  // API returns string!
}

// ✅ Let RPC infer automatically
const { data: todos } = useQuery(...)  // Type inferred!
```

### 2. Importing from drizzle-orm

```typescript
// ❌ Don't import from drizzle-orm
import { eq } from 'drizzle-orm'

// ✅ Import from @repo/db
import { eq } from '@repo/db'
```

### 3. Explicit Type Annotations on Queries

```typescript
// ❌ Don't explicitly type
queryClient.getQueryData<Todo[]>(['todos'])

// ✅ Let it infer
queryClient.getQueryData(['todos'])
```

### 4. Creating Dates in Optimistic Updates

```typescript
// ❌ Don't create Date objects
queryClient.setQueryData(['todos'], (old) =>
  old?.map(todo => ({ ...todo, updatedAt: new Date() }))
)

// ✅ Let server handle timestamps
queryClient.setQueryData(['todos'], (old) =>
  old?.map(todo => ({ ...todo, completed: true }))
)
```

---

## ✅ Summary

**Three Golden Rules:**

1. **Never manually type API responses** - let Hono RPC infer
2. **Never import from `drizzle-orm`** - use `@repo/db`
3. **Only create types for inputs** - validation schemas only

Follow these rules and you'll have:
- ✅ End-to-end type safety
- ✅ Clean architecture
- ✅ No type mismatches
- ✅ No runtime errors from type issues
- ✅ Easy refactoring
- ✅ Maintainable codebase
