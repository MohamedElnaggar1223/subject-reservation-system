# Turborepo + Hono + Next.js + Expo Template

[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](https://www.typescriptlang.org/)
[![pnpm](https://img.shields.io/badge/pnpm-9.x-orange)](https://pnpm.io/)

A production-ready, full-stack monorepo template for building web and mobile applications with shared type safety, authentication, and database integration.

**Perfect for:** SaaS applications, internal tools, mobile-first products, or any project requiring web + mobile clients with a shared API.

## 🚀 What's Included

### Apps & Packages

- **`apps/api`**: [Hono](https://hono.dev/) REST API server with Better-auth
- **`apps/web`**: [Next.js 16](https://nextjs.org/) web application with App Router
- **`apps/app`**: [Expo](https://expo.dev/) React Native mobile application
- **`packages/db`**: [Drizzle ORM](https://orm.drizzle.team/) database layer with PostgreSQL
- **`packages/validations`**: Shared [Zod](https://zod.dev/) validation schemas
- **`packages/typescript-config`**: Shared TypeScript configurations
- **`packages/eslint-config`**: Shared ESLint configurations

### Tech Stack

- **🔐 Authentication**: [Better-auth](https://www.better-auth.com/) with role-based access control (RBAC)
- **📦 Monorepo**: [Turborepo](https://turbo.build/) for fast builds and caching
- **🗄️ Database**: PostgreSQL with Drizzle ORM
- **✅ Validation**: Zod schemas shared across all apps
- **🔄 Type Safety**: End-to-end type safety with Hono RPC
- **📱 Mobile**: React Native with Expo
- **🎨 Styling**: Tailwind CSS v4
- **⚡ Package Manager**: pnpm with workspace protocol

## 📖 Documentation

- **[Getting Started Guide](./GETTING_STARTED.md)** - Complete setup instructions for new developers
- **[Deployment Guide](./DEPLOYMENT.md)** - Production deployment to Vercel + Render
- **[Architecture Patterns](./PATTERNS.md)** - Coding patterns and best practices
- **[Project Context](./CONTEXT.md)** - Architectural decisions and history

## ✨ Key Features

### 1. **End-to-End Type Safety**
- Hono RPC provides automatic type inference from API to clients
- No code generation needed
- Shared Zod schemas ensure validation consistency

### 2. **Authentication & Authorization**
- Email/password authentication with Better-auth
- Role-based access control (RBAC)
- Cross-subdomain cookie support for production
- Expo-compatible mobile auth
- Session management on server and client

### 3. **Database Integration**
- Drizzle ORM for type-safe database queries
- PostgreSQL with connection pooling
- Better-auth tables included
- Migration management with Drizzle Kit

### 4. **Developer Experience**
- Hot reload across all apps
- Shared TypeScript configurations
- Consistent code style with ESLint + Prettier
- Turborepo caching for fast builds
- Path aliases configured

### 5. **Example Implementations**

The template includes production-ready examples to help you get started:

**Todo CRUD** (`/todos`)
- Full CRUD operations with optimistic updates
- Server-side rendering with data pre-fetching
- Form validation with Zod
- Protected routes with authentication
- Demonstrates the complete data flow pattern

**File Upload System** (`/documents`)
- Secure file uploads to Cloudflare R2
- Signed URL generation for private files
- Image thumbnails and document previews
- Multiple file type support
- Production-ready storage abstraction

Both examples follow the architectural patterns documented in [PATTERNS.md](./PATTERNS.md) and serve as reference implementations for building your own features.

## 🏃‍♂️ Quick Start

> **📘 For detailed setup instructions, see [GETTING_STARTED.md](./GETTING_STARTED.md)**

### Prerequisites

- Node.js >= 18
- pnpm >= 9.0.0
- PostgreSQL database (local or hosted)

### 5-Minute Setup

**Option A: Automated Setup (Recommended)**

```bash
git clone <your-repo-url>
cd turborepo-hono-nextjs-expo
./setup.sh
```

The setup script will automatically:
- Check prerequisites (Node.js, pnpm)
- Install dependencies
- Create environment files
- Initialize database
- Build packages

**Option B: Manual Setup**

```bash
# 1. Clone and install
git clone <your-repo-url>
cd turborepo-hono-nextjs-expo
pnpm install

# 2. Set up environment
cp .env.example apps/api/.env
# Edit apps/api/.env with your database URL and secrets

# 3. Initialize database
cd packages/db
pnpm db:migrate
cd ../..

# 4. Build packages
pnpm build

# 5. Start development
pnpm dev
```

This starts:
- **API server** on `http://localhost:3001`
- **Web app** on `http://localhost:3000`
- **Expo dev server** (scan QR code with Expo Go app)

Open `http://localhost:3000`, create an account, and explore the example features!

## 📁 Project Structure

```
.
├── apps/
│   ├── api/                 # Hono API server
│   │   ├── src/
│   │   │   ├── index.ts    # Main app with middleware stack
│   │   │   ├── env.ts      # Environment validation
│   │   │   ├── lib/        # Auth, permissions, utilities
│   │   │   ├── middleware/ # Access control middleware
│   │   │   ├── routes/     # API route handlers
│   │   │   └── services/   # Business logic layer
│   │   └── package.json
│   │
│   ├── web/                # Next.js web app
│   │   ├── app/            # App router pages
│   │   ├── lib/            # Client utilities
│   │   │   ├── hono.ts    # RPC client
│   │   │   └── auth-client.ts
│   │   └── package.json
│   │
│   └── app/                # Expo mobile app
│       ├── app/            # Expo router pages
│       └── package.json
│
├── packages/
│   ├── db/                 # Database layer
│   │   ├── src/
│   │   │   ├── schema.ts  # Drizzle schema
│   │   │   ├── db.ts      # Database connection
│   │   │   └── index.ts   # Exports
│   │   └── drizzle/       # Migrations
│   │
│   ├── validations/        # Shared schemas
│   │   ├── src/
│   │   │   ├── common.validations.ts
│   │   │   ├── api-response.ts
│   │   │   └── roles.ts
│   │   └── package.json
│   │
│   ├── typescript-config/  # Shared TS configs
│   └── eslint-config/      # Shared ESLint configs
│
├── package.json            # Root package
├── pnpm-workspace.yaml     # Workspace config
└── turbo.json              # Turborepo config
```

## 🔨 Development

### Running Individual Apps

```bash
# Run only web app
pnpm dev --filter=web

# Run only API server
pnpm dev --filter=api

# Run only mobile app
pnpm dev --filter=app
```

### Building

```bash
# Build all apps
pnpm build

# Build specific app
pnpm build --filter=web
```

### Database Commands

```bash
cd packages/db

# Generate migrations from schema changes
pnpm db:generate:migrations

# Run migrations
pnpm db:migrate

# Open Drizzle Studio (database GUI)
pnpm db:studio
```

### Linting & Type Checking

```bash
# Lint all apps
pnpm lint

# Type check all apps
pnpm check-types

# Format all files
pnpm format
```

## 🏗️ Architecture Patterns

> **📖 See [PATTERNS.md](./PATTERNS.md) for comprehensive documentation of all architectural patterns and best practices.**

### 1. API Response Abstraction

The template includes a powerful `apiResponse()` helper that automatically unwraps Hono RPC responses with full type inference:

```typescript
// Instead of this:
const res = await api.v1.users.$get()
const json = await res.json()
if (!json.success) throw new Error(json.error)
const data = json.data  // Type: any

// Write this:
const data = await apiResponse(api.v1.users.$get())
// Type automatically inferred: User[]
```

### 2. Middleware Stack

The API includes a carefully ordered middleware stack:
1. **Request ID tracking** - Distributed tracing support
2. **Expo origin normalization** - Mobile compatibility
3. **CORS with credentials** - Cross-origin cookie support
4. **Rate limiting** - Brute force protection
5. **Session extraction** - Auth context injection

### 3. Database Package Abstraction

**Important**: The `@repo/db` package encapsulates ALL database operations.

```typescript
// ✅ CORRECT: Import everything from @repo/db
import { db, user, eq, and, desc } from '@repo/db'

// ❌ WRONG: Never import from drizzle-orm directly
import { eq } from 'drizzle-orm'  // Don't do this!
```

**Why?**
- Single source of truth for database dependencies
- Clean architecture (services don't know about ORM)
- Easy to swap ORMs later (only change @repo/db)
- No duplicate dependencies

The `@repo/db` package re-exports all commonly used Drizzle operators (`eq`, `and`, `or`, `desc`, etc.) so you never need `drizzle-orm` in your app dependencies.

### 4. Role-Based Access Control

```typescript
// Define roles
export const ROLES = {
  ADMIN: 'admin',
  USER: 'user',
} as const

// Protect routes
app.get('/admin/users',
  requireRole(ROLES.ADMIN),
  async (c) => { /* handler */ }
)
```

### 5. Server-Side Rendering with Auth

```typescript
// Server component
export default async function Page() {
  const session = await requireAuth()  // Redirect if not authenticated

  // Pre-fetch data on server
  const queryClient = getQueryClient()
  await queryClient.prefetchQuery({
    queryKey: ['users'],
    queryFn: async () => apiResponse(api.v1.users.$get())
  })

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <ClientComponent />
    </HydrationBoundary>
  )
}
```

## 🚢 Deployment

> **📘 For complete deployment instructions, see [DEPLOYMENT.md](./DEPLOYMENT.md)**

### Recommended Architecture

```
┌─────────────────────────────────────────────────┐
│  app.yourdomain.com (Vercel)                   │
│  Next.js Web App                                │
└─────────────────────────────────────────────────┘
                      ↓ API calls
┌─────────────────────────────────────────────────┐
│  api.yourdomain.com (Render)                   │
│  Hono API Server                                │
│  ├─ File Storage (Cloudflare R2)              │
│  └─ Private Network → PostgreSQL               │
└─────────────────────────────────────────────────┘
```

**Why this architecture?**
- Next.js optimized on Vercel (built by same team)
- Private database network (secure + fast)
- Easy to scale API independently
- Simple cookie management (same domain, different subdomains)
- Cost-effective (free tiers available)

**Deployment steps:**
1. Deploy PostgreSQL database on Render
2. Deploy API server on Render with private network connection
3. Deploy web app on Vercel
4. Configure custom domains: `api.yourdomain.com` and `app.yourdomain.com`
5. Build mobile app with EAS and submit to stores

See [DEPLOYMENT.md](./DEPLOYMENT.md) for detailed step-by-step instructions.

## 🎯 What to Do Next

After setting up the template, here's a suggested roadmap:

### 1. **Explore the Examples** (15 minutes)
- Open `http://localhost:3000/todos` and try the Todo CRUD
- Check out `http://localhost:3000/documents` for file upload
- Review the code in `apps/web/app/todos/` and `apps/api/src/routes/todo.routes.ts`

### 2. **Understand the Patterns** (30 minutes)
- Read [PATTERNS.md](./PATTERNS.md) to understand the three golden rules
- Study how authentication works in `apps/api/src/lib/auth.ts`
- Learn the middleware stack in `apps/api/src/index.ts`

### 3. **Build Your First Feature** (1-2 hours)
Follow the workflow in [GETTING_STARTED.md](./GETTING_STARTED.md#adding-a-new-feature):
1. Define Zod validation schema in `packages/validations/`
2. Update database schema in `packages/db/src/schema.ts`
3. Generate and run migrations
4. Create service layer in `apps/api/src/services/`
5. Create route in `apps/api/src/routes/`
6. Build UI in `apps/web/app/`

### 4. **Customize for Your Project**
- Update package names in `package.json` files
- Modify authentication providers in `apps/api/src/lib/auth.ts`
- Add your own database tables
- Customize UI theme and components
- Set up Cloudflare R2 for file uploads (optional)

### 5. **Deploy to Production**
- Follow [DEPLOYMENT.md](./DEPLOYMENT.md) for production deployment
- Set up custom domains
- Configure environment variables
- Deploy mobile app to stores

## 📚 Learn More

- [Turborepo Documentation](https://turbo.build/repo/docs)
- [Hono Documentation](https://hono.dev/)
- [Next.js Documentation](https://nextjs.org/docs)
- [Expo Documentation](https://docs.expo.dev/)
- [Drizzle ORM Documentation](https://orm.drizzle.team/docs/overview)
- [Better-auth Documentation](https://www.better-auth.com/docs)

## 🤝 Contributing

Contributions are welcome! This template is designed to be a solid foundation for your projects. If you find issues or have suggestions:

1. Check existing issues or create a new one
2. Fork the repository
3. Create a feature branch (`git checkout -b feature/amazing-feature`)
4. Commit your changes (`git commit -m 'Add amazing feature'`)
5. Push to the branch (`git push origin feature/amazing-feature`)
6. Open a Pull Request

Please ensure:
- Code follows the existing patterns documented in [PATTERNS.md](./PATTERNS.md)
- TypeScript types are properly defined
- Changes are tested locally
- Documentation is updated if needed

## 💬 Support

- **Documentation**: Check [GETTING_STARTED.md](./GETTING_STARTED.md), [DEPLOYMENT.md](./DEPLOYMENT.md), and [PATTERNS.md](./PATTERNS.md)
- **Issues**: Open an issue on GitHub for bugs or feature requests
- **Discussions**: Use GitHub Discussions for questions and community support

---

**Built with** ❤️ **using the best tools in the ecosystem**

**Stack**: Turborepo · Hono · Next.js · Expo · Drizzle · Better-auth · Tailwind · TypeScript
# turborepo-hono-nextjs-expo-starter
