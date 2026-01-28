# Getting Started

This guide will help you set up and start developing with this template.

## Prerequisites

Before you begin, ensure you have:

- **Node.js** >= 18 ([Download](https://nodejs.org/))
- **pnpm** >= 9.0.0 ([Install](https://pnpm.io/installation))
- **PostgreSQL** database ([Local](https://www.postgresql.org/download/) or [Cloud](https://supabase.com/))
- **Git** for version control

## Initial Setup

### 1. Clone or Use Template

**Option A: Use as GitHub Template**
```bash
# Click "Use this template" button on GitHub
# Then clone your new repository
git clone https://github.com/your-username/your-project.git
cd your-project
```

**Option B: Clone Directly**
```bash
git clone https://github.com/your-username/turborepo-hono-nextjs-expo.git my-project
cd my-project
rm -rf .git  # Remove template git history
git init     # Start fresh
```

### 2. Install Dependencies

```bash
pnpm install
```

This installs all dependencies across all apps and packages.

### 3. Set Up Database

**Option A: Local PostgreSQL**

```bash
# Create database
createdb myapp

# Or using psql
psql postgres
CREATE DATABASE myapp;
\q
```

**Option B: Cloud Database (Recommended for simplicity)**

- [Supabase](https://supabase.com/) (Free tier, great DX)
- [Neon](https://neon.tech/) (Serverless PostgreSQL)
- [Railway](https://railway.app/) (Simple deployment)

Get your `DATABASE_URL` from the provider.

### 4. Configure Environment Variables

**API Environment (`apps/api/.env`)**

```bash
# Copy example file
cp .env.example apps/api/.env

# Edit apps/api/.env with your values:
# - Generate BETTER_AUTH_SECRET: openssl rand -base64 32
# - Set DATABASE_URL to your database connection string
```

**Web Environment (`apps/web/.env.local`)**

```bash
# Create file
cat > apps/web/.env.local << 'EOF'
NEXT_PUBLIC_API_URL=http://localhost:3001
NODE_ENV=development
EOF
```

**Mobile Environment (`apps/app/.env.local`)**

```bash
# Create file
cat > apps/app/.env.local << 'EOF'
EXPO_PUBLIC_API_URL=http://localhost:3001
NODE_ENV=development
EOF
```

### 5. Run Database Migrations

```bash
cd packages/db
pnpm db:migrate
cd ../..
```

This creates all necessary tables (users, sessions, todos, files, etc.).

### 6. Build Packages

```bash
pnpm build
```

Builds all packages (db, validations, storage) that apps depend on.

### 7. Start Development

```bash
pnpm dev
```

This starts:
- **API Server**: http://localhost:3001
- **Web App**: http://localhost:3000
- **Mobile App**: Expo dev server (scan QR code with Expo Go app)

## First Steps

### 1. Create Your First User

1. Open http://localhost:3000
2. You'll be redirected to `/sign-up`
3. Create an account with email/password
4. You're logged in!

### 2. Explore Examples

**Todo CRUD** (http://localhost:3000/todos)
- Demonstrates full CRUD operations
- Server-side rendering with data pre-fetching
- Optimistic UI updates
- Form validation with Zod

**File Upload** (http://localhost:3000/documents)
- Image upload with thumbnails
- Document upload (PDF, DOCX, etc.)
- Signed URLs for security
- Cloudflare R2 integration (optional, needs setup)

### 3. Explore the Codebase

**Key Files to Understand:**

```
apps/api/src/
├── index.ts                          # Main API server, middleware stack
├── lib/
│   ├── auth.ts                       # Better-auth configuration
│   ├── permissions.ts                # RBAC roles and permissions
│   └── response.ts                   # Response helpers
├── routes/
│   ├── todo.routes.ts                # Example: CRUD routes
│   └── file.routes.ts                # Example: File upload routes
└── services/
    ├── todo.services.ts              # Business logic
    └── file.services.ts              # File operations

apps/web/app/
├── todos/
│   ├── page.tsx                      # Server component (SSR)
│   └── todos.client.tsx              # Client component (interactive)
└── documents/
    ├── page.tsx                      # Server component
    └── documents.client.tsx          # Client component

packages/
├── db/                               # Database package
│   ├── src/schema.ts                 # Drizzle schema
│   └── drizzle/                      # SQL migrations
├── validations/                      # Shared Zod schemas
│   └── src/todo/todo.validations.ts  # Example validations
└── storage/                          # S3/R2 abstraction
    └── src/r2-client.ts              # Storage client
```

## Development Workflow

### Adding a New Feature

1. **Define Validation Schema** (`packages/validations/src/`)
   ```typescript
   // packages/validations/src/post/post.validations.ts
   export const CreatePost = z.object({
     title: z.string().min(1),
     content: z.string()
   });
   export type CreatePostType = z.infer<typeof CreatePost>;
   ```

2. **Update Database Schema** (`packages/db/src/schema.ts`)
   ```typescript
   export const post = pgTable("post", {
     id: text("id").primaryKey(),
     userId: text("user_id").notNull().references(() => user.id),
     title: text("title").notNull(),
     content: text("content").notNull(),
     createdAt: timestamp("created_at").defaultNow().notNull(),
   });
   ```

3. **Generate & Run Migration**
   ```bash
   cd packages/db
   pnpm db:generate:migrations  # Generates SQL
   pnpm db:migrate              # Runs migration
   ```

4. **Create Service** (`apps/api/src/services/post.services.ts`)
   ```typescript
   import { db, post } from '@repo/db';

   export async function createPost(data: CreatePostType, userId: string) {
     return db.insert(post).values({ ...data, userId }).returning();
   }
   ```

5. **Create Route** (`apps/api/src/routes/post.routes.ts`)
   ```typescript
   import { Hono } from 'hono';
   import { requireAuth } from '../middleware/access-control.middleware';

   export const posts = new Hono()
     .use('*', requireAuth())
     .post('/', zValidator('json', CreatePost), handler);
   ```

6. **Mount Route** (`apps/api/src/index.ts`)
   ```typescript
   import { posts } from './routes/post.routes';

   const v1 = new Hono()
     .route('/posts', posts);
   ```

7. **Use in Frontend** (`apps/web/app/posts/posts.client.tsx`)
   ```typescript
   const createMutation = useMutation({
     mutationFn: async (data: CreatePostType) => {
       return apiResponse(api.v1.posts.$post({ json: data }));
     }
   });
   ```

### Running Individual Apps

```bash
# API only
pnpm dev --filter=api

# Web only
pnpm dev --filter=web

# Mobile only
pnpm dev --filter=app
```

### Type Checking

```bash
# Check all
pnpm check-types

# Check specific app
pnpm check-types --filter=web
```

### Linting

```bash
# Lint all
pnpm lint

# Lint specific app
pnpm lint --filter=api
```

### Building for Production

```bash
# Build all
pnpm build

# Build specific app
pnpm build --filter=web
```

## Common Tasks

### Resetting the Database

```bash
# Drop and recreate
dropdb myapp && createdb myapp

# Run migrations
cd packages/db && pnpm db:migrate
```

### Adding a New Package

```bash
# Create package directory
mkdir -p packages/my-package/src

# Create package.json (follow pattern from packages/storage)
# Add to pnpm-workspace.yaml (already includes packages/*)
# Install dependencies
pnpm install
```

### Debugging

**API Server:**
```bash
# Add to apps/api/src/index.ts
console.log('Debug:', { user, data });
```

**Database Queries:**
```bash
# Open Drizzle Studio
cd packages/db
pnpm db:studio
# Opens http://localhost:4983
```

**Environment Variables:**
```bash
# Verify they're loaded
echo $DATABASE_URL  # Should print your DB URL
```

## Next Steps

1. **Read Architecture Docs**: Check `PATTERNS.md` for coding patterns
2. **Review Examples**: Study `todos` and `documents` implementations
3. **Set Up R2 (Optional)**: For file uploads, configure Cloudflare R2
4. **Deploy**: See `DEPLOYMENT.md` for production deployment

## Troubleshooting

### "Module not found" errors

```bash
# Rebuild packages
pnpm build

# Or rebuild specific package
cd packages/db && pnpm build
```

### Database connection errors

```bash
# Test connection
psql $DATABASE_URL

# Check if database exists
psql -l | grep myapp
```

### Port already in use

```bash
# Kill process on port 3001
lsof -ti:3001 | xargs kill -9

# Or change port in apps/api/.env
PORT=3002
```

### TypeScript errors in IDE

```bash
# Restart TypeScript server in VS Code
# Cmd+Shift+P → "TypeScript: Restart TS Server"
```

## Resources

- [Hono Documentation](https://hono.dev/)
- [Next.js Documentation](https://nextjs.org/docs)
- [Expo Documentation](https://docs.expo.dev/)
- [Drizzle ORM Documentation](https://orm.drizzle.team/)
- [Better-auth Documentation](https://www.better-auth.com/)
- [Turborepo Documentation](https://turbo.build/repo/docs)

## Getting Help

If you encounter issues:

1. Check this guide and `PATTERNS.md`
2. Review the example implementations (todos, documents)
3. Check `CONTEXT.md` for architectural decisions
4. Open an issue on GitHub
