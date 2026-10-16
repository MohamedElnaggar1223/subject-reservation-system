#!/bin/bash
# Writes the clone's two env files (F8 set-up proof). The secret is generated here and never printed.
set -e
cd /tmp/f8-clone
SECRET=$(openssl rand -base64 32)
cat > apps/api/.env <<EOF
# Local development (the F8 walkthrough's clone). Never committed: .env is gitignored.
NODE_ENV=development
PORT=3191
DATABASE_URL=postgresql://audit:auditpass@127.0.0.1:5434/igcse_walk_dev
BETTER_AUTH_SECRET=${SECRET}
BETTER_AUTH_URL=http://localhost:3191
CORS_ORIGINS=http://localhost:3190
APP_URL=http://localhost:3190
SCHOOL_BANK_NAME=Example Bank
SCHOOL_ACCOUNT_NAME=Example School
SCHOOL_ACCOUNT_NUMBER=0000000000000000
# A scripted run (the walkthrough drive, the demo script) sends more than the default 600 requests in 15 minutes
# from one machine; the defaults stay for production.
API_RATE_LIMIT_MAX=20000
AUTH_RATE_LIMIT_MAX=2000
EOF
printf 'NEXT_PUBLIC_API_URL=http://localhost:3191\n' > apps/web/.env.local
sed -E 's/(BETTER_AUTH_SECRET=).*/\1<generated: openssl rand -base64 32>/' apps/api/.env
cat apps/web/.env.local
