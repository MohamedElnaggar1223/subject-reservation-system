# Deployment Guide

This guide covers deploying your application to production using the recommended architecture: **Vercel (web) + Render (API + database)**.

## Overview

**Recommended Production Architecture:**

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
- ✅ Next.js optimized on Vercel (built by same team)
- ✅ Private database network (secure + fast)
- ✅ Easy to scale API independently
- ✅ Simple cookie management (same domain, different subdomains)
- ✅ Cost-effective (Vercel free tier + Render free tier possible)

---

## Prerequisites

Before deploying, ensure you have:

- [ ] Domain name (e.g., `yourdomain.com`)
- [ ] GitHub repository with your code
- [ ] Vercel account ([Sign up](https://vercel.com/))
- [ ] Render account ([Sign up](https://render.com/))
- [ ] Cloudflare account for R2 (optional, for file uploads)

---

## Part 1: Database Setup (Render PostgreSQL)

### 1.1 Create PostgreSQL Database

1. Go to [Render Dashboard](https://dashboard.render.com/)
2. Click **"New +"** → **"PostgreSQL"**
3. Configure:
   - **Name**: `your-app-db`
   - **Database**: `your_app` (auto-generated)
   - **User**: `your_app_user` (auto-generated)
   - **Region**: Choose closest to your users
   - **Plan**: Free (or Starter for production)
4. Click **"Create Database"**

### 1.2 Get Connection Details

After creation, you'll see:
- **Internal Database URL** (for API server) - faster, private network
- **External Database URL** (for migrations) - public internet

**Save both URLs** - you'll need them.

Example Internal URL:
```
postgresql://user:pass@dpg-abc123/dbname
```

---

## Part 2: API Deployment (Render Web Service)

### 2.1 Create Web Service

1. Go to [Render Dashboard](https://dashboard.render.com/)
2. Click **"New +"** → **"Web Service"**
3. Connect your GitHub repository
4. Configure:
   - **Name**: `your-app-api`
   - **Region**: **Same as database** (for private network)
   - **Branch**: `main`
   - **Root Directory**: `apps/api`
   - **Runtime**: `Node`
   - **Build Command**: `pnpm install && pnpm build --filter=api`
   - **Start Command**: `pnpm start --filter=api`
   - **Plan**: Free (or Starter for production)

### 2.2 Set Environment Variables

Add these environment variables in Render:

```bash
# Better-auth (generate with: openssl rand -base64 32)
BETTER_AUTH_SECRET=<your-production-secret>

# Better-auth URL (your API domain)
BETTER_AUTH_URL=https://api.yourdomain.com

# Database URL (use INTERNAL URL from step 1.2)
DATABASE_URL=<internal-database-url>

# Node environment
NODE_ENV=production

# Port (Render provides this automatically, but explicit is good)
PORT=3001

# CORS Origins (your web app domain)
CORS_ORIGINS=https://app.yourdomain.com

# Cookie Domain (for cross-subdomain cookies)
COOKIE_DOMAIN=.yourdomain.com

# Cloudflare R2 (if using file uploads)
R2_ACCOUNT_ID=<your-r2-account-id>
R2_ACCESS_KEY_ID=<your-r2-access-key>
R2_SECRET_ACCESS_KEY=<your-r2-secret>
R2_BUCKET_NAME=<your-bucket-name>
```

**Important Notes:**
- `COOKIE_DOMAIN` should start with a dot (`.yourdomain.com`) for subdomains
- `CORS_ORIGINS` should match your exact web app domain
- Keep `BETTER_AUTH_SECRET` secure (don't commit to git)

### 2.3 Deploy

1. Click **"Create Web Service"**
2. Render will automatically build and deploy
3. Wait for deployment to complete
4. Your API will be available at: `https://your-app-api.onrender.com`

---

## Part 3: Run Database Migrations

Before your API can work, you need to run migrations.

### 3.1 Install Dependencies Locally

```bash
# From project root
pnpm install
```

### 3.2 Run Migrations

```bash
# Set the EXTERNAL database URL temporarily
export DATABASE_URL="<external-database-url>"

# Run migrations
cd packages/db
pnpm db:migrate

# Verify tables were created
pnpm db:studio
# Opens Drizzle Studio - you should see all tables
```

**Important:** Use the **External Database URL** for migrations (runs from your machine), not the Internal URL.

---

## Part 4: Web App Deployment (Vercel)

### 4.1 Create Project

1. Go to [Vercel Dashboard](https://vercel.com/dashboard)
2. Click **"Add New"** → **"Project"**
3. Import your GitHub repository
4. Configure:
   - **Framework Preset**: Next.js
   - **Root Directory**: `apps/web`
   - **Build Command**: `pnpm build --filter=web`
   - **Output Directory**: `.next` (default)
   - **Install Command**: `pnpm install`

### 4.2 Set Environment Variables

Add these in Vercel project settings:

```bash
# API URL (your Render API domain)
NEXT_PUBLIC_API_URL=https://api.yourdomain.com

# Node environment
NODE_ENV=production
```

### 4.3 Deploy

1. Click **"Deploy"**
2. Vercel will build and deploy automatically
3. Your web app will be available at: `https://your-project.vercel.app`

---

## Part 5: Custom Domain Setup

### 5.1 Configure API Domain (Render)

1. Go to your Render service dashboard
2. Click **"Settings"** → **"Custom Domains"**
3. Add: `api.yourdomain.com`
4. Render will provide DNS instructions (CNAME record)

### 5.2 Configure Web Domain (Vercel)

1. Go to your Vercel project dashboard
2. Click **"Settings"** → **"Domains"**
3. Add: `app.yourdomain.com` (or `www.yourdomain.com`)
4. Vercel will provide DNS instructions

### 5.3 Update DNS

Go to your domain registrar (Cloudflare, Namecheap, etc.) and add:

```
Type    Name    Value                           TTL
CNAME   api     your-app-api.onrender.com       Auto
CNAME   app     cname.vercel-dns.com            Auto
```

**Wait for DNS propagation** (can take up to 48 hours, usually ~15 minutes).

### 5.4 Update Environment Variables

Once domains are active, update environment variables:

**Render (API):**
```bash
BETTER_AUTH_URL=https://api.yourdomain.com
CORS_ORIGINS=https://app.yourdomain.com
COOKIE_DOMAIN=.yourdomain.com
```

**Vercel (Web):**
```bash
NEXT_PUBLIC_API_URL=https://api.yourdomain.com
```

**Redeploy both services** after updating environment variables.

---

## Part 6: Mobile App Deployment (Expo)

### 6.1 Update API URL

Edit `apps/app/.env.production`:
```bash
EXPO_PUBLIC_API_URL=https://api.yourdomain.com
```

### 6.2 Build with EAS

```bash
cd apps/app

# Install EAS CLI
npm install -g eas-cli

# Login to Expo
eas login

# Configure project
eas build:configure

# Build for iOS
eas build --platform ios

# Build for Android
eas build --platform android
```

### 6.3 Submit to Stores

```bash
# Submit to App Store
eas submit --platform ios

# Submit to Google Play
eas submit --platform android
```

Refer to [Expo EAS documentation](https://docs.expo.dev/build/introduction/) for detailed submission guides.

---

## Part 7: Cloudflare R2 Setup (File Uploads)

### 7.1 Create R2 Bucket

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com/) → **R2**
2. Click **"Create bucket"**
3. Configure:
   - **Bucket name**: `your-app-files`
   - **Location**: Automatic (or choose region)
4. Click **"Create bucket"**
5. **Important**: Keep bucket **PRIVATE** (do not enable public access)

### 7.2 Create API Token

1. Go to **R2** → **"Manage R2 API Tokens"**
2. Click **"Create API Token"**
3. Configure:
   - **Token name**: `your-app-api-token`
   - **Permissions**: Admin Read & Write
   - **Specify bucket**: Select your bucket
4. Click **"Create API Token"**
5. **Save** the Access Key ID and Secret Access Key (shown once!)

### 7.3 Add to Environment Variables

Update Render API environment variables:
```bash
R2_ACCOUNT_ID=<your-cloudflare-account-id>
R2_ACCESS_KEY_ID=<access-key-from-step-7.2>
R2_SECRET_ACCESS_KEY=<secret-access-key-from-step-7.2>
R2_BUCKET_NAME=your-app-files
```

**Redeploy API** after adding these variables.

---

## Part 8: Verification & Testing

### 8.1 Test API Health

```bash
curl https://api.yourdomain.com/v1/health
# Should return: {"healthy":true}
```

### 8.2 Test Authentication

1. Open `https://app.yourdomain.com`
2. Sign up with a new account
3. Verify you're logged in and redirected to home page

### 8.3 Test File Upload (if configured)

1. Go to `https://app.yourdomain.com/documents`
2. Upload a file
3. Verify it appears in the list
4. Click the file to download (tests signed URLs)

### 8.4 Test CORS

Check browser console for CORS errors:
- No "CORS policy" errors should appear
- Cookies should be set properly

---

## Common Issues & Solutions

### Issue: CORS errors in production

**Solution:**
- Verify `CORS_ORIGINS` in Render includes your exact web domain
- Ensure `COOKIE_DOMAIN` starts with a dot: `.yourdomain.com`
- Check both API and web are on same root domain (different subdomains)

### Issue: Cookies not persisting

**Solution:**
- Verify `COOKIE_DOMAIN=.yourdomain.com` in API environment
- Ensure both apps use HTTPS in production
- Check browser allows third-party cookies

### Issue: Database connection timeouts

**Solution:**
- Use **Internal Database URL** in Render API environment
- Ensure API and database are in the same Render region
- Check connection pooling settings in `packages/db/src/db.ts`

### Issue: Build fails on Render

**Solution:**
- Verify `pnpm install` runs before build command
- Check all required environment variables are set
- Ensure `NODE_ENV=production`
- Review Render build logs for specific errors

### Issue: File uploads fail

**Solution:**
- Verify R2 credentials are correct
- Check bucket exists and is accessible
- Ensure API has all R2 environment variables
- Test bucket access from API server

---

## Monitoring & Maintenance

### Logs

**Render:**
- Go to service dashboard → **"Logs"** tab
- Real-time logs of API server

**Vercel:**
- Go to deployment → **"Logs"** tab
- Build and runtime logs

### Database Backups

**Render PostgreSQL:**
- Free tier: No automatic backups
- Starter tier: Daily automated backups
- Manual backup:
  ```bash
  pg_dump $EXTERNAL_DATABASE_URL > backup.sql
  ```

### Performance Monitoring

**Recommended tools:**
- [Sentry](https://sentry.io/) - Error tracking
- [LogRocket](https://logrocket.com/) - Session replay
- Vercel Analytics - Web vitals
- Render Metrics - API performance

### Cost Estimates

**Free Tier (Development):**
- Render PostgreSQL: Free
- Render Web Service: Free (limited hours)
- Vercel: Free (personal projects)
- Cloudflare R2: Free (10GB storage, 1M requests/month)
- **Total: $0/month**

**Production (Starter):**
- Render PostgreSQL Starter: $7/month
- Render Web Service Starter: $7/month
- Vercel Pro (optional): $20/month
- Cloudflare R2: Pay-as-you-go (~$0.15/GB)
- **Total: ~$14-34/month**

---

## Alternative Deployment Options

### Option A: Single Service Deployment

If you want everything on one platform:

**Vercel Only:**
- Deploy API as Vercel Serverless Function
- Use Vercel Edge Config for env vars
- Use Supabase/Neon for database

**Render Only:**
- Deploy web as static site on Render
- Deploy API as web service
- Use Render PostgreSQL

### Option B: Docker Deployment

Deploy anywhere that supports Docker:

```dockerfile
# Dockerfile example in apps/api/
FROM node:18-alpine
WORKDIR /app
COPY . .
RUN pnpm install
RUN pnpm build
CMD ["pnpm", "start"]
```

Supports: Railway, Fly.io, AWS ECS, Google Cloud Run, etc.

---

## Security Checklist

Before going live:

- [ ] Use strong `BETTER_AUTH_SECRET` (32+ random characters)
- [ ] Enable HTTPS on all domains
- [ ] Set `NODE_ENV=production`
- [ ] Restrict `CORS_ORIGINS` to your exact domains
- [ ] Use database connection with SSL
- [ ] Keep R2 bucket private (signed URLs only)
- [ ] Set secure cookie attributes (`secure: true`, `sameSite: 'lax'`)
- [ ] Enable rate limiting on sensitive endpoints (login, signup)
- [ ] Review and remove any debug logs with sensitive data
- [ ] Use environment variables for all secrets (never hardcode)

---

## Next Steps

After deployment:

1. **Monitor**: Set up error tracking (Sentry)
2. **Analytics**: Add analytics (Vercel Analytics, Posthog)
3. **Backups**: Set up automated database backups
4. **CI/CD**: Configure GitHub Actions for automated deployments
5. **Testing**: Set up staging environment
6. **Documentation**: Update README with production URLs

---

## Support

If you encounter deployment issues:

1. Check service logs (Render/Vercel dashboards)
2. Verify all environment variables are set correctly
3. Test each service independently
4. Review this guide and the main README
5. Open an issue on GitHub with deployment logs
