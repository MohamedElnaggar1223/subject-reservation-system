# CONTEXT.md - Complete Knowledge Transfer for Future Claude Instances

**Last Updated:** December 28, 2025
**Status:** Stage 2 - File Upload Feature ✅ COMPLETE (with Signed URLs Security)
**Next Phase:** Stage 3 - Real-time WebSocket & Background Workers

---

## 🎯 PURPOSE OF THIS DOCUMENT

This document contains **everything** a fresh Claude Code instance needs to know to continue working on this template. It captures:
- Complete project history and context
- All architectural decisions with detailed rationale
- Critical patterns that MUST be followed
- Anti-patterns discovered and how they were fixed
- Future roadmap with implementation details
- Configuration file explanations
- Deployment strategy decisions

**Read this document in full before making any changes to the template.**

---

## 📖 TABLE OF CONTENTS

1. [Project Genesis](#project-genesis)
2. [Project Architecture Philosophy](#project-architecture-philosophy)
3. [Completed Work - Detailed Breakdown](#completed-work)
4. [Critical Architectural Patterns](#critical-architectural-patterns)
5. [Anti-Patterns & How They Were Fixed](#anti-patterns)
6. [Configuration Files - Critical Details](#configuration-files)
7. [Future Roadmap - Staged Implementation](#future-roadmap)
8. [Deployment Architecture](#deployment-architecture)
9. [File-by-File Guide](#file-by-file-guide)
10. [Testing & Validation](#testing-validation)
11. [Common Issues & Solutions](#common-issues)

---

## 🌱 PROJECT GENESIS

### How This Template Came to Be

**Original Project:** `internship-tracker-practice`
- Location: `/Users/mohamedelnaggar/Coding/internship-tracker-practice`
- Purpose: Learning project to master a full-stack monorepo architecture
- User's Goal: Learn the stack deeply, then extract it into a reusable template

**User's Vision:**
The user built an internship tracking application to learn:
- Turborepo monorepo management
- Hono for lightweight, type-safe APIs
- Next.js 16 with App Router
- Expo for React Native mobile
- Better-auth for authentication with RBAC
- Drizzle ORM with PostgreSQL
- End-to-end type safety with Hono RPC

**Key Insight:** The user wanted to create reusable abstractions and patterns during development, making it easier to extract into a template later. This is why files like `@repo/validations/src/api-response.ts` exist - they were created specifically to avoid code repetition and demonstrate best practices.

### Extraction Process

**Date:** December 25-28, 2025
**Method:**
1. Analyzed the internship-tracker codebase deeply
2. Identified generic vs domain-specific code
3. Removed all internship-specific logic
4. Created comprehensive documentation
5. Added a complete Todo CRUD example as reference implementation
6. Fixed critical anti-patterns (RPC type inference, database abstraction)

**Template Location:** `/Users/mohamedelnaggar/Coding/turborepo-hono-nextjs-expo/`

---

## 🏛️ PROJECT ARCHITECTURE PHILOSOPHY

### Core Principles

**1. End-to-End Type Safety Without Code Generation**
- Hono RPC provides automatic type inference from API to clients
- No need for tRPC's complex setup or GraphQL's schema duplication
- Types flow automatically through the entire stack

**2. Clean Package Abstraction**
- Each package owns its dependencies completely
- No leaking of implementation details
- Easy to swap underlying technologies (e.g., switch ORMs)

**3. Monorepo Benefits Without Complexity**
- Turborepo for fast builds with intelligent caching
- pnpm workspaces for efficient dependency management
- Shared code without the overhead of publishing packages

**4. Production-Ready from Day One**
- Better-auth with full RBAC support
- Proper cookie configuration for cross-subdomain auth
- Rate limiting, request tracking, CORS handling
- Environment-aware configuration (dev vs production)

**5. Developer Experience First**
- Hot reload everywhere
- Type-safe everything
- Comprehensive inline documentation
- Clear separation of concerns

### Technology Choices & Rationale

**Turborepo:**
- Chosen over Nx for simplicity
- Intelligent caching drastically reduces build times
- Simple configuration via turbo.json
- Works seamlessly with pnpm workspaces

**Hono:**
- Chosen over Express/Fastify for type safety
- Lightweight (no dependencies)
- RPC client provides automatic type inference
- Better DX than tRPC (simpler setup)
- Works on any runtime (Node, Bun, Cloudflare Workers, etc.)

**Next.js 16:**
- App Router for server-first architecture
- React 19 with server components
- Built-in optimization and caching
- Best Vercel deployment integration

**Expo:**
- Fastest way to build React Native apps
- EAS Build for cloud builds
- Works with same validation schemas as web
- Better-auth Expo plugin for mobile auth

**Better-auth:**
- Modern auth library with RBAC built-in
- Adapter pattern (works with any database)
- Expo-compatible out of the box
- Simpler than NextAuth v5
- Full control over auth flow

**Drizzle ORM:**
- Type-safe queries without code generation
- Lightweight (just a query builder)
- SQL-like syntax (easy to learn)
- Great TypeScript inference
- Migrations are pure SQL (easy to understand)

**PostgreSQL:**
- Industry-standard relational database
- Better-auth requires it (or MySQL/SQLite)
- Excellent Drizzle support
- Easy to host (Supabase, Neon, Render, Railway)

---

## ✅ COMPLETED WORK

### Phase 1: Core Template Structure (Dec 25, 2025)

#### What Was Done

**1. Directory Structure Creation**
```
turborepo-hono-nextjs-expo/
├── apps/
│   ├── api/       # Copied with all middleware intact
│   ├── web/       # Copied with auth integration
│   └── app/       # Copied with Expo setup
├── packages/
│   ├── db/        # Better-auth tables only
│   ├── validations/
│   ├── typescript-config/
│   └── eslint-config/
├── README.md
├── .env.example
└── .vscode/settings.json
```

**2. Domain-Specific Code Removal**
- Removed `apps/api/src/routes/admin.routes.ts`
- Removed `apps/api/src/routes/coach.routes.ts`
- Removed `apps/api/src/services/admin.services.ts`
- Removed `apps/api/src/services/coach.services.ts`
- Removed `apps/web/app/admin/` directory
- Removed `apps/web/app/coach/` directory
- Removed `apps/web/app/students/` directory
- Removed `packages/validations/src/student/` directory
- Removed hardcoded students array from `apps/api/src/index.ts`

**3. Code Enhanced with Template Comments**

Added extensive inline documentation showing:
- Where to add custom routes
- How to extend validations
- Middleware stack ordering and purpose
- Pattern explanations

**Key Files Modified:**
- `apps/api/src/index.ts` - Added template comments for route mounting
- `packages/validations/src/index.ts` - Added template comments for exports
- `apps/web/app/page.tsx` - Generic welcome page instead of internship-specific

**4. Configuration Files Preserved EXACTLY**

**CRITICAL:** All `package.json` and `tsconfig.json` files were copied **byte-for-byte** because:
- Module resolution settings matter (`"type": "module"`)
- Export field structures are critical for package imports
- Build scripts use specific tools (`tsc && tsc-alias`)
- Path aliases must match across packages
- Workspace protocol dependencies (`workspace:*`) enable monorepo linking

**5. Documentation Created**
- `README.md` - Quick start, architecture overview, deployment
- `.env.example` - Complete environment variable reference

**6. Validation**
- ✅ `pnpm install` - All dependencies installed successfully
- ✅ `pnpm build` - All 4 packages built successfully
- ✅ Database migrations ran successfully
- ✅ `pnpm dev` - All dev servers started without errors

**Files Preserved Completely:**
- `.gitignore`
- `.npmrc`
- `pnpm-workspace.yaml`
- `turbo.json`
- All `package.json` files
- All `tsconfig.json` files
- `.vscode/settings.json`

---

### Phase 2: Todo CRUD Example (Dec 26-28, 2025)

#### What Was Done

**1. Validation Schemas** (`packages/validations/src/todo/`)

Created `todo.validations.ts` with:
- `CreateTodo` schema (title, description)
- `UpdateTodo` schema (partial updates)
- `TodoId` schema (UUID validation)
- **Type exports for INPUTS ONLY** (critical pattern)
- **NO manual response types** (let RPC infer)

**Key Pattern Demonstrated:**
```typescript
// ✅ Export input types only
export type CreateTodoType = z.infer<typeof CreateTodo>

// ❌ DON'T export response types (RPC infers them)
// export type Todo = { ... }  // NEVER DO THIS
```

**2. Database Schema** (`packages/db/src/schema.ts`)

Added `todo` table with:
- Primary key (`id`)
- User foreign key with cascade delete
- Auto-updating timestamps
- Index on `userId` for query performance
- Relations for type-safe joins

**Key Pattern Demonstrated:**
```typescript
export const todo = pgTable("todo", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date())  // Auto-update on modifications
    .notNull(),
}, (table) => [
  index("todo_userId_idx").on(table.userId),  // Performance
])
```

**3. Service Layer** (`apps/api/src/services/todo.services.ts`)

Created complete service with:
- `getUserTodos()` - User-scoped queries
- `getTodoById()` - Single record fetch
- `createTodo()` - UUID generation, timestamp handling
- `updateTodo()` - Partial updates
- `deleteTodo()` - Simple deletion
- `isTodoOwner()` - Ownership verification for auth

**Key Pattern Demonstrated:**
```typescript
// ✅ Import everything from @repo/db
import { db, todo, eq, and, desc } from '@repo/db'

// ❌ NEVER import from drizzle-orm directly
// import { eq } from 'drizzle-orm'  // DON'T DO THIS
```

**4. API Routes** (`apps/api/src/routes/todo.routes.ts`)

Created complete CRUD routes:
- `GET /v1/todos` - List user's todos
- `POST /v1/todos` - Create todo (with validation)
- `GET /v1/todos/:id` - Get specific todo (ownership check)
- `PUT /v1/todos/:id` - Update todo (ownership check)
- `DELETE /v1/todos/:id` - Delete todo (admin or owner)

**Key Patterns Demonstrated:**
- Middleware composition (`.use(requireAuth())`)
- Zod validation with `zValidator`
- Response helpers (`success`, `error`)
- Ownership verification before mutations
- Role-based access control (admin can delete any todo)

**5. Middleware Enhancement** (`apps/api/src/middleware/access-control.middleware.ts`)

Added `requireAuth()` function:
- Simpler than `requireRole()` when role doesn't matter
- Just checks for valid session
- Added comprehensive documentation

**6. Web Pages** (`apps/web/app/todos/`)

**Server Component** (`page.tsx`):
- Authentication check with `requireAuth()`
- Data pre-fetching with TanStack Query
- Query dehydration for instant page loads
- Hydration boundary for client component

**Client Component** (`todos.client.tsx`):
- Complete CRUD UI
- Create form with validation
- Inline editing
- Toggle completion
- Delete with confirmation
- **Optimistic updates** for instant feedback
- **Automatic rollback** on errors
- **NO manual type annotations** (RPC inference)

**Key Pattern Demonstrated:**
```typescript
// ✅ Let RPC infer the type
const { data: todos } = useSuspenseQuery({
  queryKey: ['todos'],
  queryFn: async () => apiResponse(api.v1.todos.$get()),
})

// todos type is AUTOMATICALLY correct (createdAt: string, not Date)

// ✅ Use inferred type for function parameters
const handleToggle = (todo: typeof todos[number]) => {
  // todo type is automatically correct
}
```

**7. Updated Home Page**
- Added link to Todo example
- Highlighted patterns demonstrated
- Visual call-to-action box

**8. Session Helper Enhancement** (`apps/web/lib/auth/session.ts`)
- Added `requireAuth()` function
- Simpler API for pages that just need authentication

---

### Critical Bug Fixes During Phase 2

**Issue 1: Drizzle ORM Dependency Leakage**

**Problem:** Service layer imported `drizzle-orm` directly, breaking package abstraction.

**Solution:**
1. Updated `packages/db/src/index.ts` to re-export all Drizzle operators
2. Updated service to only import from `@repo/db`
3. Added comprehensive documentation explaining why

**Why This Matters:**
- Maintains clean architecture
- Only `@repo/db` knows about Drizzle
- Easy to swap ORMs later
- No duplicate dependencies

**Issue 2: Manual RPC Response Typing (CRITICAL)**

**Problem:** Created manual `Todo` type with `Date` fields, but API returns `string` (JSON serialization).

**Impact:**
- Type mismatches (Date vs string)
- Runtime errors
- Defeated the entire purpose of Hono RPC
- Broke automatic type inference

**Solution:**
1. Removed all manual response types from `@repo/validations`
2. Removed explicit type annotations from queries (`useQuery<Todo[]>`)
3. Let RPC infer types automatically
4. Used `typeof todos[number]` to extract item type when needed
5. Created `PATTERNS.md` documenting this critical pattern

**Why This Matters:**
This is the **MOST IMPORTANT** architectural pattern in the entire template. Hono RPC's automatic type inference is the killer feature. Manual typing breaks it completely.

**The Fix in Detail:**

**Before (❌ Wrong):**
```typescript
// In validations
export type Todo = {
  createdAt: Date  // Wrong! API returns string
}

// In component
import { Todo } from '@repo/validations'
const { data } = useQuery<Todo[]>(...)  // Explicit type breaks inference
queryClient.setQueryData<Todo[]>(['todos'], ...)  // Type mismatch!
```

**After (✅ Correct):**
```typescript
// In validations
// NO response type exports - only input types

// In component
const { data: todos } = useQuery({
  queryFn: async () => apiResponse(api.v1.todos.$get())
})
// todos type is AUTOMATICALLY inferred from API
// createdAt is correctly typed as string (from JSON)

queryClient.setQueryData(['todos'], ...)  // No type annotation needed
```

---

## ✅ STAGE 2: FILE UPLOAD FEATURE ✅ COMPLETE (Dec 28, 2025)

### What Was Completed

**1. New Package: `@repo/storage`** (`packages/storage/`)

Created complete storage abstraction package with **signed URLs security**:
- `src/types.ts` - TypeScript interfaces (NO URL fields - security pattern)
- `src/constants.ts` - MIME types, file size limits, image variant dimensions
- `src/file-validator.ts` - File validation with magic number MIME detection
- `src/image-processor.ts` - Sharp-based image processing and thumbnail generation
- `src/r2-client.ts` - Cloudflare R2 storage client with `getSignedUrl()` method
- `src/index.ts` - Barrel exports following package pattern

**Key Features:**
- Validates files using actual content (magic numbers) to prevent MIME type spoofing
- Generates multiple image variants (original, thumbnail 150x150, medium 600x600, large 1200x1200)
- Converts images to WebP format for optimal compression
- File size limits: Avatar 5MB, Document 10MB, General 50MB
- Supports avatars (images), documents (PDF, DOCX, XLSX, TXT, CSV), and general files
- **SECURITY: Uses private bucket with signed URLs (1-hour expiration)**

**2. Database Schema Extensions** (`packages/db/src/schema.ts`)

Added two new tables (updated for signed URLs):
- `file` table - Stores file metadata with `storageKey` only (NO URL column)
- `file_variant` table - Stores image variants with `storageKey` only (NO URL column)

**Pattern followed:**
- Indexes on `userId` and `fileType` for query performance
- Cascade delete (deleting user deletes all their files)
- Auto-updating timestamps with `$onUpdate`
- Relations for type-safe joins
- **SECURITY: No URLs stored - generated on-demand**

**3. Validation Schemas** (`packages/validations/src/file/file.validations.ts`)

Created Zod schemas for:
- `UploadAvatar` - Image validation (5MB, image types only)
- `UploadDocument` - Document validation (10MB, specific MIME types)
- `UploadFile` - General file validation (50MB)
- `FileId` - UUID validation for URL params
- `ListFilesQuery` - Pagination and filtering

**CRITICAL Pattern Followed:**
- Only exported INPUT types (CreateTodoType pattern)
- NO manual response types (let RPC infer)
- Used Zod v4 `z.instanceof(File)` for multipart form data

**4. Environment Configuration** (`apps/api/src/env.ts`)

Added R2 configuration with Zod validation (updated for security):
- `R2_ACCOUNT_ID` - Cloudflare account ID
- `R2_ACCESS_KEY_ID` - R2 API access key (S3-compatible credentials)
- `R2_SECRET_ACCESS_KEY` - R2 API secret
- `R2_BUCKET_NAME` - Bucket name
- **REMOVED `R2_PUBLIC_URL` - Bucket must be PRIVATE**

**5. Service Layer** (`apps/api/src/services/file.services.ts`)

Implemented complete file management with signed URLs:
- `uploadFile()` - Upload to R2, save only `storageKey` to DB
- `getUserFile()` - Get file metadata (no URLs)
- `getUserFiles()` - List files with **auto-generated signed URLs**
- `deleteFile()` - Delete from R2 and DB (handles variants)
- `isFileOwner()` - Ownership verification
- `updateUserAvatar()` - Replace existing avatar
- **NEW: `getFileSignedUrl()`** - Generate temporary signed URL (1-hour expiration)
- **NEW: `getUserFileWithSignedUrls()`** - Get file with signed URLs for all variants

**Pattern followed:**
- Imported everything from `@repo/db` (NOT drizzle-orm)
- Pure business logic (no HTTP concerns)
- Returns data or throws errors
- Follows todo.services.ts structure exactly
- **SECURITY: Signed URLs generated on-demand, never stored**

**6. API Routes** (`apps/api/src/routes/file.routes.ts`)

Created complete REST API:
- `POST /v1/files/avatar` - Upload avatar with automatic thumbnails
- `POST /v1/files/document` - Upload document (no image processing)
- `POST /v1/files` - Upload general file
- `GET /v1/files` - List user's files (paginated, filterable, **includes signed URLs**)
- `GET /v1/files/:id` - Get file metadata (no URLs)
- **NEW: `GET /v1/files/:id/download`** - Get file with signed URLs
- `DELETE /v1/files/:id` - Delete file (admin or owner)

**Pattern followed:**
- Form data sent as plain object (not FormData): `{ file: File }`
- `requireAuth()` middleware on all routes
- Try-catch error handling
- `success()` and `error()` response helpers
- Ownership verification before mutations
- Follows todo.routes.ts structure exactly

**7. Web Components** (`apps/web/`)

Created complete file management UI:
- `components/avatar-upload.tsx` - Reusable avatar upload component with preview
- `app/documents/page.tsx` - Server component with data pre-fetching
- `app/documents/documents.client.tsx` - Full-featured file management interface

**Features demonstrated:**
- File upload with preview (images only)
- Three upload types: avatar, document, general
- File filtering by type
- Pagination (20 items per page)
- Image variant display (thumbnail, medium, large links)
- Optimistic UI updates
- Delete with confirmation and rollback
- **RPC type inference - NO manual types!**

**8. Database Migrations**

- Migration `drizzle/0003_fair_nitro.sql` - Created `file` and `file_variant` tables
- **Migration `drizzle/0004_public_shiver_man.sql` - Dropped `url` columns for security**
- Both successfully applied to database

**9. Documentation Updates**

- Updated `.env.example` with R2 setup instructions (removed `R2_PUBLIC_URL`)
- Added clear warning: **Keep bucket PRIVATE**
- Added comprehensive inline documentation in all files
- Updated `apps/web/app/page.tsx` - Added link to file upload example

---

### SECURITY ARCHITECTURE: Signed URLs

**WHY Signed URLs Instead of Public Bucket:**

❌ **Public Bucket (Original approach):**
- Anyone with URL can access files forever
- No access control after upload
- Cannot revoke access
- Security risk for private documents

✅ **Private Bucket + Signed URLs (Implemented):**
- Files cannot be accessed directly
- All access goes through API (ownership verified)
- URLs expire after 1 hour
- Can add analytics, rate limiting, etc.
- Follows AWS S3 best practices

**How It Works:**

1. **Upload:** File uploaded to PRIVATE R2 bucket, only `storageKey` stored in DB
2. **List Files:** API generates signed URLs on-the-fly (expires in 1 hour)
3. **View File:** Frontend uses temporary signed URL from API response
4. **After 1 hour:** URL expires, must fetch new signed URL from API

**Implementation Details:**

```typescript
// Storage package - NO URLs returned
interface UploadResult {
  key: string              // R2 object key
  size: number
  mimeType: string
  variants?: VariantInfo[] // Also NO URLs
}

// Service - Generate signed URLs on demand
export async function getUserFiles(userId, options) {
  const files = await db.query.file.findMany(...)

  // Generate signed URLs for each file (1-hour expiration)
  const filesWithUrls = await Promise.all(
    files.map(async (file) => ({
      ...file,
      url: await r2Client.getSignedUrl(file.storageKey, 3600)
    }))
  )

  return { data: filesWithUrls, pagination: {...} }
}
```

---

### Files Created/Modified in Stage 2

**New Files:**
- `packages/storage/package.json`
- `packages/storage/tsconfig.json`
- `packages/storage/src/types.ts`
- `packages/storage/src/constants.ts`
- `packages/storage/src/file-validator.ts`
- `packages/storage/src/image-processor.ts`
- `packages/storage/src/r2-client.ts`
- `packages/storage/src/index.ts`
- `packages/validations/src/file/file.validations.ts`
- `apps/api/src/services/file.services.ts`
- `apps/api/src/routes/file.routes.ts`
- `apps/web/components/avatar-upload.tsx`
- `apps/web/app/documents/page.tsx`
- `apps/web/app/documents/documents.client.tsx`
- `packages/db/drizzle/0004_public_shiver_man.sql`

**Modified Files:**
- `packages/db/src/schema.ts` - Added file and fileVariant tables, removed url columns
- `packages/validations/src/index.ts` - Export file validations
- `apps/api/src/env.ts` - Added R2 environment variables (removed R2_PUBLIC_URL)
- `apps/api/src/index.ts` - Mounted file routes
- `apps/api/package.json` - Added @repo/storage dependency
- `apps/web/app/page.tsx` - Added link to documents example
- `.env.example` - Updated R2 configuration (removed R2_PUBLIC_URL, added security notes)

---

## 🎯 CRITICAL ARCHITECTURAL PATTERNS

These patterns are **MANDATORY** and must never be violated.

### Pattern 1: Hono RPC Type Inference (CRITICAL)

**Rule:** NEVER manually type API responses. Let Hono RPC infer them automatically.

**Why:**
- Hono RPC provides end-to-end type safety automatically
- Manual types create mismatches (Date vs string, etc.)
- Defeats the entire purpose of using Hono RPC
- Causes runtime errors

**✅ Correct:**
```typescript
// In validations: Only export INPUT types
export const CreateTodo = z.object({ title: z.string() })
export type CreateTodoType = z.infer<typeof CreateTodo>
// NO response type exports!

// In component: Let RPC infer
const { data: todos } = useQuery({
  queryKey: ['todos'],
  queryFn: async () => apiResponse(api.v1.todos.$get())
})
// todos type is automatically inferred

// If you need the type, extract it:
type Todo = typeof todos[number]

// Cache operations: No type annotations
queryClient.setQueryData(['todos'], (old) =>
  old?.map(todo => ({ ...todo, completed: true }))
)
```

**❌ Wrong:**
```typescript
// DON'T create manual response types
export type Todo = {
  createdAt: Date  // Wrong! API returns string
}

// DON'T explicitly type queries
const { data } = useQuery<Todo[]>(...)

// DON'T type cache operations
queryClient.setQueryData<Todo[]>(['todos'], ...)
```

**When You Absolutely Need a Type:**

99% of the time, you don't. But if you do:
```typescript
// Extract from the inferred data
const { data: todos } = useQuery(...)
type Todo = typeof todos[number]

// Or from RPC client (complex)
type TodosResponse = Awaited<ReturnType<typeof apiResponse<typeof api.v1.todos.$get>>>
```

**See `PATTERNS.md` for comprehensive examples.**

---

### Pattern 2: Database Package Abstraction

**Rule:** NEVER import from `drizzle-orm` in apps/services. Only import from `@repo/db`.

**Why:**
- `@repo/db` owns ALL database dependencies
- Clean architecture (services don't know about ORM)
- Easy to swap ORMs later
- No duplicate dependencies

**✅ Correct:**
```typescript
// In services
import { db, user, todo, eq, and, desc } from '@repo/db'

// Everything comes from @repo/db
const todos = await db.query.todo.findMany({
  where: (todos, { eq }) => eq(todos.userId, userId),
  orderBy: (todos, { desc }) => [desc(todos.createdAt)]
})
```

**❌ Wrong:**
```typescript
// DON'T import from drizzle-orm
import { db } from '@repo/db'
import { eq, and } from 'drizzle-orm'  // ❌ Breaks abstraction
```

**What `@repo/db` Exports:**
- Database instance (`db`)
- All schema tables (`user`, `todo`, etc.)
- All Drizzle operators (`eq`, `and`, `or`, `desc`, `asc`, `like`, `isNull`, etc.)
- Health check functions (`pingDb`)

**Implementation:**
```typescript
// packages/db/src/index.ts
export * from './db'
export * from './schema'
export * from './health'

// Re-export all Drizzle operators
export {
  eq, ne, gt, gte, lt, lte,  // Comparison
  and, or, not,              // Logical
  like, ilike,               // Pattern
  isNull, isNotNull,         // NULL checks
  inArray, notInArray,       // Arrays
  asc, desc,                 // Sorting
  count, sum, avg, min, max, // Aggregation
  sql,                       // Raw SQL
} from 'drizzle-orm'
```

---

### Pattern 3: Validation - Input Types Only

**Rule:** Only create and export types for INPUTS (validation). Never for responses.

**Why:**
- Validation schemas are for user input (forms, API requests)
- Response types come from RPC inference
- Separation of concerns

**✅ Correct:**
```typescript
// Export validation schemas and their inferred types
export const CreateTodo = z.object({
  title: z.string().min(1),
  description: z.string().optional()
})

export type CreateTodoType = z.infer<typeof CreateTodo>

// Use in API
app.post('/',
  zValidator('json', CreateTodo),  // Runtime validation
  async (c) => {
    const data = c.req.valid('json')  // Type: CreateTodoType
    // ...
  }
)

// Use in React Hook Form
const form = useForm<CreateTodoType>({
  resolver: zodResolver(CreateTodo)
})
```

**❌ Wrong:**
```typescript
// DON'T create response types
export type Todo = { ... }  // Let RPC infer this!

// DON'T create types for internal use
export type TodoWithUser = Todo & { user: User }  // Use SQL joins instead
```

---

### Pattern 4: Service Layer Responsibilities

**Rule:** Services handle business logic and data access ONLY. No HTTP concerns.

**Services Do:**
- Database queries
- Business logic (calculations, validations)
- Data transformations
- Return data or throw errors

**Services Don't:**
- Parse request bodies (routes do this with Zod)
- Return HTTP responses (routes do this)
- Handle status codes or headers (routes do this)
- Log requests (middleware does this)

**✅ Correct:**
```typescript
// Service returns data
export async function getUserTodos(userId: string) {
  return db.query.todo.findMany({
    where: (todos, { eq }) => eq(todos.userId, userId),
  })
}

// Route handles HTTP concerns
app.get('/todos', requireAuth(), async (c) => {
  const user = c.get('user')!
  const todos = await todoService.getUserTodos(user.id)
  return success(c, todos)  // HTTP response
})
```

**❌ Wrong:**
```typescript
// Service returns HTTP response
export async function getUserTodos(c: Context) {
  const user = c.get('user')
  const todos = await db.query.todo.findMany(...)
  return c.json({ success: true, data: todos })  // ❌ HTTP concern
}
```

---

### Pattern 5: Middleware Stack Ordering

**Rule:** Middleware order is CRITICAL. Never change without understanding dependencies.

**Current Order (in `apps/api/src/index.ts`):**
```typescript
const app = new Hono<HonoEnv>()
  .use('*', requestIdMiddleware)     // 1. Tracking (used by logger)
  .use('*', expoOriginMiddleware)    // 2. Normalize headers (before CORS)
  .use('*', corsMiddleware)          // 3. CORS (before auth)
  .use('/api/auth/*', authRateLimit) // 4. Rate limit (specific routes)
  .use('*', sessionMiddleware)       // 5. Extract session (after CORS)
  .on(['POST', 'GET'], '/api/auth/*', authHandler) // 6. Auth routes
```

**Why This Order:**
1. **Request ID first** - Needed for logging in all subsequent middleware
2. **Expo origin normalization** - Must happen before CORS checks
3. **CORS** - Must allow origin before auth attempts
4. **Rate limiting** - Protect auth routes from brute force
5. **Session extraction** - Makes user/session available to all routes
6. **Auth handler** - Handles login/signup/signout

**Changing this order can break:**
- CORS for Expo apps
- Authentication for API calls
- Request tracking
- Rate limiting

---

### Pattern 6: Server-Side Rendering with Pre-fetching

**Rule:** Pre-fetch data on server, hydrate on client for instant page loads.

**Pattern:**
```typescript
// Server Component (apps/web/app/todos/page.tsx)
export default async function TodosPage() {
  // 1. Authenticate
  await requireAuth()

  // 2. Get server API client (with cookies)
  const api = await getServerApi()

  // 3. Pre-fetch data
  const queryClient = getQueryClient()
  await queryClient.prefetchQuery({
    queryKey: ['todos'],
    queryFn: async () => apiResponse(api.v1.todos.$get())
  })

  // 4. Dehydrate and pass to client
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <TodosClient />
    </HydrationBoundary>
  )
}

// Client Component (apps/web/app/todos/todos.client.tsx)
'use client'
export default function TodosClient() {
  // Uses pre-fetched data instantly (no loading state on initial render)
  const { data: todos } = useSuspenseQuery({
    queryKey: ['todos'],  // Same key as server
    queryFn: async () => apiResponse(api.v1.todos.$get())
  })

  return <div>{todos.map(...)}</div>
}
```

**Benefits:**
- ✅ Instant page load (no spinner)
- ✅ SEO-friendly (data in HTML)
- ✅ Progressive enhancement
- ✅ Smooth client-side mutations

---

### Pattern 7: Optimistic Updates with Rollback

**Rule:** Update UI instantly, rollback on error for best UX.

**Pattern:**
```typescript
const updateMutation = useMutation({
  mutationFn: async ({ id, data }) => {
    return apiResponse(api.v1.todos[':id'].$put({
      param: { id },
      json: data
    }))
  },

  // Optimistic update (runs before mutationFn)
  onMutate: async ({ id, data }) => {
    // 1. Cancel ongoing queries to prevent race conditions
    await queryClient.cancelQueries({ queryKey: ['todos'] })

    // 2. Snapshot current data for rollback
    const previous = queryClient.getQueryData(['todos'])

    // 3. Optimistically update cache
    queryClient.setQueryData(['todos'], (old) =>
      old?.map(todo =>
        todo.id === id ? { ...todo, ...data } : todo
      )
    )

    // 4. Return snapshot for rollback
    return { previous }
  },

  // Rollback on error
  onError: (error, variables, context) => {
    if (context?.previous) {
      queryClient.setQueryData(['todos'], context.previous)
    }
    alert('Update failed')
  },

  // Refetch on success (ensure sync with server)
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['todos'] })
  }
})
```

**Critical Notes:**
- ❌ DON'T set timestamps in optimistic update (`updatedAt: new Date()`)
- ✅ Let server response handle timestamps
- ❌ DON'T use explicit types in cache operations
- ✅ Let RPC inference handle types

---

### Pattern 8: Authentication & Authorization

**Three Levels:**

**1. Middleware-Level (API Routes):**
```typescript
export const todos = new Hono<HonoEnv>()
  .use('*', requireAuth())  // All routes require auth
  .get('/', handler)        // Protected
  .post('/', handler)       // Protected
```

**2. Route-Level (Specific Routes):**
```typescript
app.delete('/:id',
  requireRole(ROLES.ADMIN),  // Only admins
  handler
)
```

**3. Handler-Level (Business Logic):**
```typescript
app.put('/:id', async (c) => {
  const user = c.get('user')!

  // Check ownership
  const isOwner = await isTodoOwner(todoId, user.id)
  if (!isOwner && user.role !== ROLES.ADMIN) {
    return error(c, 'Forbidden', 403)
  }

  // Proceed with update
})
```

**Server Component Auth:**
```typescript
export default async function Page() {
  // Redirects to /sign-in if not authenticated
  const session = await requireAuth()

  // Access user data
  console.log(session.user.email)
}
```

---

## 🚫 ANTI-PATTERNS

These patterns were discovered and FIXED. Never reintroduce them.

### Anti-Pattern 1: Manual RPC Response Types

**❌ What Was Done Wrong:**
```typescript
// Created manual type in validations
export type Todo = {
  id: string
  createdAt: Date  // Wrong! API returns string
  updatedAt: Date  // Wrong! API returns string
}

// Used it in component
import { Todo } from '@repo/validations'
const { data } = useQuery<Todo[]>(...)
```

**Why It's Wrong:**
- JSON serialization converts `Date` → `string`
- Type says `Date`, runtime has `string` → mismatch
- Defeats the entire purpose of Hono RPC
- Breaks automatic type inference

**✅ How It Was Fixed:**
1. Removed `export type Todo` from validations
2. Removed all `useQuery<Type>` explicit annotations
3. Let RPC infer types automatically
4. Used `typeof todos[number]` to extract type when needed
5. Documented extensively in `PATTERNS.md`

**Impact:** This was the MOST CRITICAL fix in the entire project.

---

### Anti-Pattern 2: Drizzle ORM Dependency Leakage

**❌ What Was Done Wrong:**
```typescript
// In apps/api/src/services/todo.services.ts
import { db, todo } from '@repo/db'
import { eq, and, desc } from 'drizzle-orm'  // ❌ Direct import
```

**Why It's Wrong:**
- Breaks package abstraction
- Services know about Drizzle (implementation detail)
- `drizzle-orm` becomes a dependency of `apps/api`
- Can't swap ORMs without changing all services

**✅ How It Was Fixed:**
1. Updated `packages/db/src/index.ts` to re-export all Drizzle operators
2. Changed service imports to `import { db, todo, eq, and, desc } from '@repo/db'`
3. Documented the pattern in README and PATTERNS.md

**Impact:** Maintains clean architecture, makes template future-proof.

---

### Anti-Pattern 3: Explicit Types in Cache Operations

**❌ What Was Done Wrong:**
```typescript
queryClient.setQueryData<Todo[]>(['todos'], (old) =>
  old?.map(todo => ({ ...todo, completed: true }))
)
```

**Why It's Wrong:**
- Type annotation fights RPC inference
- Can cause type mismatches
- Unnecessary (TypeScript infers from query)

**✅ How It Was Fixed:**
```typescript
queryClient.setQueryData(['todos'], (old) =>
  old?.map(todo => ({ ...todo, completed: true }))
)
// Type is inferred from the query
```

---

### Anti-Pattern 4: Setting Timestamps in Optimistic Updates

**❌ What Was Done Wrong:**
```typescript
queryClient.setQueryData(['todos'], (old) =>
  old?.map(todo =>
    todo.id === id
      ? { ...todo, ...data, updatedAt: new Date() }  // ❌ Creating Date
      : todo
  )
)
```

**Why It's Wrong:**
- Server returns `updatedAt` as string (JSON)
- Creating `new Date()` creates type mismatch
- Optimistic update should match server response

**✅ How It Was Fixed:**
```typescript
queryClient.setQueryData(['todos'], (old) =>
  old?.map(todo =>
    todo.id === id
      ? { ...todo, ...data }  // ✅ Let server handle timestamps
      : todo
  )
)
```

---

## ⚙️ CONFIGURATION FILES

**CRITICAL:** Package.json and tsconfig.json files are EXTREMELY important. Every setting exists for a reason.

### Why Configuration Files Matter

The user specifically warned: "Keep in mind the package.json and the tsconfig.json files in each package and understand why each has what it has because it affects the package and how it run if you change the simple stuff or if you do not understand why we made a certain choice in either of these 2 files."

**What This Means:**
- Don't change settings without understanding their impact
- Module resolution affects how imports work
- Build scripts use specific tools for specific reasons
- Export fields control how packages are consumed

### Root package.json

```json
{
  "name": "turborepo-hono-nextjs-expo",
  "private": true,
  "scripts": {
    "build": "turbo run build",
    "dev": "turbo run dev",
    "start": "turbo run start",
    "lint": "turbo run lint",
    "format": "prettier --write \"**/*.{ts,tsx,md}\"",
    "check-types": "turbo run check-types"
  },
  "packageManager": "pnpm@9.0.0",  // Enforces pnpm version
  "engines": {
    "node": ">=18"  // Minimum Node version
  }
}
```

**Key Points:**
- `private: true` - Won't accidentally publish
- `packageManager` - Enforces specific pnpm version for consistency
- `engines` - Documents minimum Node version

---

### API package.json

```json
{
  "name": "@repo/api",
  "type": "module",  // ⚠️ CRITICAL: ESM modules
  "exports": {
    ".": {
      "types": "./src/index.ts",      // Development (TypeScript)
      "default": "./dist/index.js"    // Production (compiled)
    }
  },
  "scripts": {
    "dev": "tsx watch src/index.ts",   // Hot reload with tsx
    "build": "tsc && tsc-alias",       // Compile + resolve path aliases
    "start": "node ./dist/index.js"    // Run compiled code
  }
}
```

**Critical Settings:**

**`"type": "module"`**
- Enables ESM (import/export instead of require)
- Must use `.js` extension in imports or configure module resolution
- All dependencies must be ESM-compatible

**`exports` field:**
- `types` - TypeScript points to source for better DX
- `default` - Production uses compiled code
- Enables proper package imports

**`build` script:**
- `tsc` - Compiles TypeScript to JavaScript
- `tsc-alias` - Resolves path aliases (`@/lib/...` → `./lib/...`)
- **BOTH are required** - tsc alone doesn't handle path aliases

**Why `tsx watch`:**
- tsx compiles TypeScript on-the-fly (faster than tsc)
- watch mode for hot reload
- Perfect for development

---

### Web package.json

```json
{
  "name": "web",
  "type": "module",
  "scripts": {
    "dev": "next dev --port 3000",
    "build": "next build",
    "start": "next start",
    "check-types": "next typegen && tsc --noEmit"
  }
}
```

**Key Points:**
- Next.js handles all compilation
- `next typegen` generates route types for typed navigation
- `tsc --noEmit` validates types without compiling

---

### Database package.json

```json
{
  "name": "@repo/db",
  "type": "module",
  "scripts": {
    "build": "tsc && tsc-alias",
    "dev": "tsc -w",
    "db:generate:migrations": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate",
    "db:studio": "drizzle-kit studio",
    "db:up": "docker compose up -d"
  },
  "exports": {
    ".": {
      "types": "./dist/src/index.d.ts",
      "default": "./dist/src/index.js"
    }
  }
}
```

**Key Points:**
- `tsc -w` watches for schema changes
- Drizzle Kit scripts for migrations
- `docker compose up` for local PostgreSQL (optional)

---

### TypeScript Configurations

**Base Config** (`packages/typescript-config/base.json`):
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": true
  }
}
```

**Why These Settings:**
- `NodeNext` - Proper ESM module resolution
- `strict: true` - Maximum type safety
- `declaration: true` - Generate .d.ts files for consumers
- `declarationMap: true` - Better IDE navigation

**Next.js Config** (`packages/typescript-config/nextjs.json`):
```json
{
  "extends": "./base.json",
  "compilerOptions": {
    "target": "ES2017",
    "module": "ESNext",
    "moduleResolution": "Bundler",  // Next.js bundler
    "plugins": [{ "name": "next" }]
  }
}
```

**Why Different:**
- Next.js has its own bundler (Webpack/Turbopack)
- `Bundler` resolution works better with Next.js
- `next` plugin provides better type checking

---

### turbo.json

```json
{
  "$schema": "https://turborepo.com/schema.json",
  "ui": "tui",  // Terminal UI for builds
  "globalEnv": ["NEXT_PUBLIC_API_URL"],
  "tasks": {
    "build": {
      "env": ["NEXT_PUBLIC_API_URL"],
      "dependsOn": ["^build"],  // Build dependencies first
      "inputs": ["$TURBO_DEFAULT$", ".env*"],
      "outputs": [".next/**", "!.next/cache/**", "dist/**"]
    },
    "dev": {
      "cache": false,      // Don't cache dev
      "persistent": true   // Keep running
    },
    "start": {
      "dependsOn": ["^build"],
      "cache": false,
      "persistent": true
    }
  }
}
```

**Key Concepts:**

**`dependsOn: ["^build"]`:**
- `^` means dependencies
- Ensures packages build before apps

**`inputs` and `outputs`:**
- Turborepo uses these for caching
- Changing inputs invalidates cache
- Outputs are cached for reuse

**`persistent: true`:**
- Task keeps running (like dev server)
- Turborepo won't kill it

---

## 🗺️ FUTURE ROADMAP

### Current Status: Stage 1 Complete

**What's Done:**
- ✅ Core template structure
- ✅ All architectural patterns
- ✅ Todo CRUD example
- ✅ Comprehensive documentation

### Stage 2: Advanced Features (PLANNED)

The user approved adding these features after Stage 1 is validated:

#### Feature 1: File Upload System

**Package:** `@repo/storage` (new)

**Purpose:** Abstract file uploads for any storage provider.

**Tech Stack:**
- **Primary:** Cloudflare R2 (generous free tier, S3-compatible)
- **Alternative:** AWS S3
- **Dev/Testing:** Local filesystem

**Architecture:**
```typescript
// @repo/storage/src/providers/cloudflare-r2.ts
export class CloudflareR2Provider {
  async upload(file: File, options: UploadOptions): Promise<string>
  async getSignedUrl(key: string, expiresIn: number): Promise<string>
  async delete(key: string): Promise<void>
}

// @repo/storage/src/index.ts
export const storage = createStorageProvider({
  provider: env.STORAGE_PROVIDER,  // 'r2' | 's3' | 'local'
  config: { ... }
})
```

**API Routes:**
```typescript
// POST /v1/upload/avatar
// - Multipart form data
// - File type validation (MIME type whitelist)
// - Size validation (configurable max)
// - Virus scanning (optional, using ClamAV)
// - Returns public URL or signed URL

// GET /v1/upload/signed-url
// - Generate pre-signed URL for client-side upload
// - Reduces server load
// - Direct browser → storage upload
```

**Features:**
- Image optimization (sharp library)
- Automatic thumbnails
- Progress tracking
- Retry logic
- Chunked uploads for large files

**Example Usage:**
```typescript
// In mobile app
const { data: uploadUrl } = await apiResponse(
  api.v1.upload['signed-url'].$post({
    json: { filename: 'avatar.jpg', contentType: 'image/jpeg' }
  })
)

// Direct upload to storage
await fetch(uploadUrl.url, {
  method: 'PUT',
  body: file,
  headers: { 'Content-Type': 'image/jpeg' }
})
```

**Why This Helps Users:**
- 90% of apps need file uploads
- Configurable providers (easy to switch)
- Production-ready (security, validation)
- Works offline with retry

**Implementation Time:** 6-8 hours

---

#### Feature 2: Real-time WebSocket System

**Package:** `@repo/realtime` (new)

**Purpose:** Real-time updates for collaborative features, notifications, live data.

**Tech Stack:**
- **Server:** Hono WebSocket support
- **Client:** Native WebSocket with auto-reconnect
- **Pattern:** Room-based pub/sub

**Architecture:**
```typescript
// apps/api/src/realtime/server.ts
import { createBunWebSocket } from 'hono/bun'

const { upgradeWebSocket } = createBunWebSocket()

app.get('/ws',
  requireAuth(),  // Auth before upgrade!
  upgradeWebSocket((c) => {
    const user = c.get('user')!

    return {
      onOpen(evt, ws) {
        // Join user's personal room
        rooms.join(`user:${user.id}`, ws)
      },

      onMessage(evt, ws) {
        const data = JSON.parse(evt.data)

        // Broadcast to room
        rooms.broadcast(data.room, {
          type: data.type,
          payload: data.payload,
          user: { id: user.id, name: user.name }
        })
      },

      onClose() {
        rooms.leave(user.id)
        presence.remove(user.id)
      }
    }
  })
)
```

**Client:**
```typescript
// @repo/realtime/src/client.ts
export class RealtimeClient {
  connect(url: string, token: string)
  disconnect()
  joinRoom(roomId: string)
  leaveRoom(roomId: string)
  send(event: string, data: any)
  on(event: string, handler: (data: any) => void)
}

// Auto-reconnect on disconnect
// Exponential backoff
// Message queue during offline
```

**Example: Chat with Presence**
```typescript
// Server
app.post('/v1/chat/:room/message',
  requireAuth(),
  async (c) => {
    const { room } = c.req.param()
    const { message } = await c.req.json()

    // Save to database
    const msg = await chatService.createMessage(room, message)

    // Broadcast to room
    realtime.broadcast(`chat:${room}`, {
      type: 'message',
      payload: msg
    })

    return success(c, msg)
  }
)

// Client
const realtime = new RealtimeClient()
realtime.connect(apiUrl, authToken)
realtime.joinRoom('chat:general')
realtime.on('message', (data) => {
  // Update UI instantly
  queryClient.setQueryData(['messages'], (old) => [...old, data])
})
```

**Features:**
- Room-based messaging
- User presence tracking (online/offline/typing)
- Automatic reconnection
- Message queuing during offline
- Typing indicators
- Read receipts

**Use Cases:**
- Chat applications
- Real-time notifications
- Collaborative editing
- Live dashboards
- Activity feeds

**Why This Helps Users:**
- Real-time is increasingly expected
- Shows WebSocket auth pattern
- Room architecture is scalable
- Generic enough for any use case

**Implementation Time:** 8-10 hours

---

#### Feature 3: Background Workers & Queue System

**Package:** `@repo/queue` (new)

**App:** `apps/worker` (new)

**Purpose:** Handle long-running tasks asynchronously.

**Tech Stack:**
- **Queue:** BullMQ (Redis-based, production-ready)
- **Storage:** Redis (for queue + optional caching)
- **Workers:** Separate Node process (scalable)

**Architecture:**
```typescript
// @repo/queue/src/queue.ts
import { Queue, Worker } from 'bullmq'

export const queues = {
  email: new Queue('email', { connection: redisConnection }),
  ai: new Queue('ai', { connection: redisConnection }),
  image: new Queue('image', { connection: redisConnection }),
}

export function addJob<T>(
  queue: keyof typeof queues,
  name: string,
  data: T,
  options?: JobOptions
) {
  return queues[queue].add(name, data, options)
}
```

**Worker Process:**
```typescript
// apps/worker/src/index.ts
import { Worker } from 'bullmq'

// Email worker
new Worker('email', async (job) => {
  const { to, subject, html } = job.data
  await sendEmail({ to, subject, html })
}, { connection: redisConnection })

// AI worker
new Worker('ai', async (job) => {
  const { userId, prompt } = job.data

  // Call OpenAI
  const result = await openai.images.generate({ prompt })

  // Upload to storage
  const url = await storage.upload(result.data[0].url, {
    bucket: 'ai-generated',
    userId
  })

  // Notify user via WebSocket
  realtime.send(userId, {
    type: 'ai:complete',
    url
  })

  return { url }
})
```

**API Integration:**
```typescript
// Enqueue job (instant response)
app.post('/v1/ai/generate',
  requireAuth(),
  zValidator('json', GenerateImageSchema),
  async (c) => {
    const user = c.get('user')!
    const { prompt } = c.req.valid('json')

    const job = await addJob('ai', 'generate', {
      userId: user.id,
      prompt
    }, {
      attempts: 3,  // Retry on failure
      backoff: { type: 'exponential', delay: 2000 }
    })

    return success(c, { jobId: job.id, status: 'queued' }, 202)
  }
)

// Check job status
app.get('/v1/ai/jobs/:id', async (c) => {
  const job = await queues.ai.getJob(c.req.param('id'))

  return success(c, {
    id: job.id,
    status: await job.getState(),
    progress: job.progress,
    result: job.returnvalue,
    failedReason: job.failedReason
  })
})
```

**Example Jobs:**
1. **Email Sending**
   - Welcome emails
   - Password resets
   - Notifications
   - Batch emails

2. **AI Integration**
   - Image generation (OpenAI DALL-E)
   - Text completion
   - Embeddings calculation
   - Content moderation

3. **Image Processing**
   - Resize/crop
   - Format conversion
   - Thumbnail generation
   - Watermarking

4. **Data Export**
   - CSV generation
   - PDF reports
   - Archive creation
   - Batch operations

**Dashboard:**
```typescript
// Bull Dashboard (admin only)
app.get('/admin/jobs',
  requireAdmin(),
  async (c) => {
    // Return Bull Dashboard UI
    return bullDashboard.handler(c.req.raw)
  }
)
```

**Features:**
- Job retry with exponential backoff
- Job scheduling (run at specific time)
- Job prioritization
- Progress tracking
- Failure handling
- Rate limiting
- Concurrency control

**Why This Helps Users:**
- Long tasks need background processing
- Shows Redis integration
- AI integrations are hot
- Scalable (add more workers)
- Production-ready retry logic

**Implementation Time:** 6-7 hours

---

### Stage 3: Final Polish & Documentation

**After Stage 2 Features Complete:**

1. **ARCHITECTURE.md**
   - Deep dive into every pattern
   - Architectural decision records
   - Performance considerations
   - Security best practices

2. **DEPLOYMENT.md**
   - Step-by-step for each platform
   - Environment variable checklists
   - Database setup guides
   - CI/CD examples
   - Monitoring setup

3. **Advanced Examples**
   - Multi-tenant application
   - E-commerce patterns
   - Social features
   - Admin dashboards

4. **Video Walkthrough** (optional)
   - Setting up from scratch
   - Adding a feature
   - Deploying to production

**Total Time for Complete Template:** 36-46 hours

---

## 🚀 DEPLOYMENT ARCHITECTURE

### User's Production Architecture (RECOMMENDED)

The user has tested and validated this architecture:

**Web (Next.js):** Vercel
- Automatic deployments from git
- Edge network for fast global delivery
- Environment: `NEXT_PUBLIC_API_URL=https://api.yourdomain.com`

**API + Database:** Render
- **PostgreSQL:** Managed database instance
- **API:** Web Service connected to database via **private network**
- Private network = database not exposed to internet
- Environment: `DATABASE_URL` uses internal URL (fast, secure)

**Domain Setup:**
- Web: `app.yourdomain.com` (or `www.yourdomain.com`)
- API: `api.yourdomain.com`
- Same domain, different subdomains

**Cookie Configuration:**
```typescript
// Production settings
advanced: {
  crossSubDomainCookies: {
    enabled: true  // Same domain, different subdomains
  },
  defaultCookieAttributes: {
    sameSite: 'lax',  // CSRF protection
    secure: true,     // HTTPS only
    partitioned: true, // Privacy sandbox
    domain: '.yourdomain.com'  // Works across subdomains
  }
}
```

**Why This Architecture:**
- ✅ Next.js optimized on Vercel (built by same team)
- ✅ Private database network (secure + fast)
- ✅ Easy to scale API independently
- ✅ Simple cookie management (same domain)
- ✅ Cost-effective (Vercel free tier + Render)

---

### Alternative: Single Domain with Rewrites

**If you must deploy on separate domains:**

```javascript
// next.config.js
module.exports = {
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: 'https://your-api.onrender.com/api/:path*'
      }
    ]
  }
}
```

**Pros:**
- Single domain (simpler cookies)
- No CORS needed

**Cons:**
- Vercel proxy overhead
- Tighter coupling
- Harder to scale independently

**User's Note:** Include this as a tip in deployment docs, but recommend the subdomain approach.

---

### Mobile Deployment (Expo)

**Development:**
- `expo start` for local testing
- Update `EXPO_PUBLIC_API_URL` to your machine's IP

**Production:**
- Use EAS Build for cloud builds
- Environment: `EXPO_PUBLIC_API_URL=https://api.yourdomain.com`
- Submit to App Store / Play Store

**Important:** Expo can't set standard `Origin` header. The template handles this:
```typescript
// Middleware converts expo-origin → origin
const expoOrigin = c.req.header("expo-origin")
if (expoOrigin && !c.req.header("origin")) {
  c.req.raw.headers.set("origin", expoOrigin)
}
```

---

## 📂 FILE-BY-FILE GUIDE

### Critical Files - Never Delete

**Root Level:**
- `package.json` - Monorepo scripts, pnpm version enforcement
- `pnpm-workspace.yaml` - Defines workspace packages
- `turbo.json` - Turborepo task configuration
- `.gitignore` - Git ignore patterns
- `.npmrc` - pnpm configuration
- `README.md` - User-facing documentation
- `PATTERNS.md` - Architectural pattern reference
- `CONTEXT.md` - This file (for future Claude instances)
- `.env.example` - Environment variable template

**Apps:**

`apps/api/`:
- `src/index.ts` - Main app, middleware stack, route mounting
- `src/env.ts` - Environment validation (Zod)
- `src/lib/auth.ts` - Better-auth configuration (CRITICAL)
- `src/lib/permissions.ts` - RBAC definitions
- `src/lib/response.ts` - Response helpers
- `src/lib/types.ts` - Hono environment types
- `src/middleware/access-control.middleware.ts` - Auth middleware
- `src/routes/` - API route modules
- `src/services/` - Business logic layer

`apps/web/`:
- `app/layout.tsx` - Root layout with providers
- `app/page.tsx` - Home page
- `app/sign-in/` - Auth pages
- `app/sign-up/` - Auth pages
- `app/todos/` - Example CRUD pages
- `lib/hono.ts` - Client-side RPC client (CRITICAL)
- `lib/hono-server.ts` - Server-side RPC client (CRITICAL)
- `lib/auth-client.ts` - Better-auth React client
- `lib/auth/session.ts` - Server-side session helpers
- `lib/query-client.ts` - TanStack Query setup
- `env.ts` - Environment validation

`apps/app/`:
- `app/` - Expo Router file-based routing
- Similar structure to web app

**Packages:**

`packages/db/`:
- `src/schema.ts` - All database tables
- `src/db.ts` - Database connection with pooling
- `src/index.ts` - Exports everything (CRITICAL - re-exports Drizzle)
- `src/health.ts` - Database health check
- `drizzle.config.ts` - Drizzle Kit configuration
- `drizzle/` - Generated migrations

`packages/validations/`:
- `src/index.ts` - Central exports
- `src/common.validations.ts` - Reusable validators
- `src/roles.ts` - Role definitions and helpers
- `src/api-response.ts` - RPC response unwrapper (CRITICAL)
- `src/todo/` - Example domain validations

`packages/typescript-config/`:
- `base.json` - Base TypeScript config
- `nextjs.json` - Next.js-specific config

`packages/eslint-config/`:
- ESLint configurations

---

## 🧪 TESTING & VALIDATION

### How to Verify Template Works

**After Fresh Clone:**

1. **Install Dependencies:**
   ```bash
   pnpm install
   ```
   Expected: All packages install without errors

2. **Build Everything:**
   ```bash
   pnpm build
   ```
   Expected: All 4 packages build successfully
   - @repo/db
   - @repo/validations
   - @repo/api
   - web

3. **Setup Database:**
   ```bash
   cd packages/db
   pnpm db:generate:migrations  # Generate SQL from schema
   pnpm db:migrate              # Run migrations
   ```
   Expected: Migrations run successfully

4. **Start Dev Servers:**
   ```bash
   pnpm dev
   ```
   Expected:
   - API server starts on port 3001
   - Web server starts on port 3000
   - Expo server starts (optional)

5. **Test Authentication:**
   - Navigate to `http://localhost:3000`
   - Should redirect to `/sign-up` (not authenticated)
   - Create an account
   - Should redirect to home page
   - User info should display

6. **Test Todo Example:**
   - Navigate to `/todos`
   - Create a new todo
   - Edit inline
   - Toggle completion
   - Delete
   - Refresh page (data should persist)

7. **Verify Type Safety:**
   ```bash
   pnpm check-types
   ```
   Expected: No TypeScript errors

8. **Verify Linting:**
   ```bash
   pnpm lint
   ```
   Expected: No ESLint errors (or only warnings)

---

## 🐛 COMMON ISSUES & SOLUTIONS

### Issue: "drizzle-orm not found" in API

**Cause:** Service importing from `drizzle-orm` directly instead of `@repo/db`

**Solution:**
```typescript
// ❌ Wrong
import { eq } from 'drizzle-orm'

// ✅ Correct
import { eq } from '@repo/db'
```

---

### Issue: Type Mismatch in RPC Responses

**Cause:** Manual type annotation fighting RPC inference

**Solution:**
```typescript
// ❌ Wrong
const { data } = useQuery<Todo[]>(...)

// ✅ Correct
const { data: todos } = useQuery({
  queryFn: async () => apiResponse(api.v1.todos.$get())
})
```

---

### Issue: CORS Error from Expo App

**Cause:** Expo origin header not converted

**Solution:** Already handled in middleware, but check:
1. Expo origin middleware runs BEFORE CORS middleware
2. CORS origins include Expo patterns in dev:
   ```typescript
   corsOrigins = [
     'exp://*/*',
     'exp://10.0.0.*:*/*',
     // etc.
   ]
   ```

---

### Issue: Cookie Not Set in Production

**Cause:** Cookie domain misconfigured

**Solution:**
1. Set `COOKIE_DOMAIN=.yourdomain.com` in API env
2. Ensure `crossSubDomainCookies.enabled = true`
3. Verify `secure: true` (requires HTTPS)
4. Check `sameSite: 'lax'` (not 'none' in production)

---

### Issue: Build Fails with "Cannot find module"

**Cause:** Package not built yet, or workspace protocol issue

**Solution:**
```bash
# Build packages first
cd packages/db
pnpm build

cd ../validations
pnpm build

# Then build apps
cd ../../
pnpm build
```

Or use Turborepo (handles automatically):
```bash
pnpm build  # Builds in correct order
```

---

### Issue: Types Not Updating in IDE

**Cause:** TypeScript server needs restart

**Solution:**
1. VS Code: `Cmd+Shift+P` → "TypeScript: Restart TS Server"
2. Or rebuild packages: `pnpm build`

---

## 📋 CHECKLIST FOR FUTURE CLAUDE

When continuing this work, verify:

**Before Making Changes:**
- [ ] Read this entire CONTEXT.md file
- [ ] Read PATTERNS.md for critical patterns
- [ ] Understand the RPC type inference pattern (CRITICAL)
- [ ] Understand the database abstraction pattern (CRITICAL)
- [ ] Review recent git commits to see what changed

**When Adding Features:**
- [ ] Never manually type API responses (let RPC infer)
- [ ] Never import from `drizzle-orm` (use `@repo/db`)
- [ ] Only create types for inputs (validation schemas)
- [ ] Add comprehensive inline documentation
- [ ] Follow existing patterns exactly
- [ ] Test end-to-end before committing

**When Modifying Config Files:**
- [ ] Understand WHY each setting exists
- [ ] Test build after changes
- [ ] Verify dev servers still work
- [ ] Check type checking still works

**When Adding Documentation:**
- [ ] Include "why" not just "what"
- [ ] Show ❌ wrong vs ✅ correct examples
- [ ] Link to related patterns
- [ ] Update CONTEXT.md if architectural

---

## 🎯 IMMEDIATE NEXT STEPS

**Current Status:** ✅ Stage 2 File Upload COMPLETE with Signed URLs Security (Dec 28, 2025)

**What to Do Next:**

1. **Optional: Test File Upload Feature with Real R2 Bucket:**
   - Set up R2 credentials (keep bucket PRIVATE)
   - Upload various file types (images, PDFs, documents)
   - Verify signed URLs expire after 1 hour
   - Verify MIME type validation works (try spoofed files)
   - Test file size limits
   - Verify thumbnails are generated for avatars
   - Test pagination and filtering
   - Test delete functionality (R2 + DB cleanup)

2. **Begin Stage 3: Real-time Features & Background Processing:**

   Choose one of:

   **Option A: WebSocket Real-time System**
   - Real-time notifications (new todo, file uploaded, etc.)
   - Live presence indicators
   - Real-time collaboration features
   - Follow implementation plan in Future Roadmap section

   **Option B: Background Workers (Bull/BullMQ)**
   - Email sending queue
   - File processing queue (video transcoding, PDF generation)
   - Scheduled tasks (cleanup, reports)
   - Job retry and failure handling

   **Recommendation:** Start with WebSocket - more visible, demonstrates real-time patterns

3. **Maintain Quality Standards:**
   - Follow the three golden rules (RPC inference, @repo/db, input types only)
   - Add comprehensive inline documentation
   - Create example implementations
   - Update CONTEXT.md when complete
   - Test thoroughly before marking complete

4. **After All Stage 2 Features:**
   - Create comprehensive ARCHITECTURE.md
   - Create detailed DEPLOYMENT.md
   - Add advanced examples
   - Consider video walkthrough

---

## 💡 FINAL NOTES FOR FUTURE CLAUDE

**The Most Important Lessons:**

1. **Hono RPC Type Inference is Sacred**
   - This is the #1 pattern that must never be violated
   - Manual types defeat the entire purpose
   - When in doubt, let TypeScript infer

2. **Package Abstraction Matters**
   - Clean architecture makes the template maintainable
   - Implementation details should never leak
   - Each package owns its dependencies completely

3. **Configuration Files Are Critical**
   - Don't change them without understanding why
   - Every setting exists for a reason
   - Ask the user if uncertain

4. **Documentation is Part of the Product**
   - Inline comments explain patterns
   - External docs provide context
   - Examples show correct usage
   - Anti-patterns show what NOT to do

5. **User's Architectural Choices Are Intentional**
   - They built the original project to learn
   - They created abstractions deliberately
   - They tested the deployment architecture
   - Trust their decisions

**When Stuck:**
- Refer to PATTERNS.md
- Look at the Todo example
- Check git history for context
- Ask the user for clarification

**Remember:**
This template is meant to be a **learning tool** and **production starter**. Every decision prioritizes developer experience, type safety, and production readiness.

---

**End of CONTEXT.md**

*This document will be updated as the project evolves. Always check the "Last Updated" date at the top.*
