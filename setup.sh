#!/bin/bash

# Turborepo + Hono + Next.js + Expo Template Setup Script
# This script automates the initial setup process

set -e  # Exit on error

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Helper functions
print_header() {
  echo ""
  echo -e "${BLUE}================================================${NC}"
  echo -e "${BLUE}$1${NC}"
  echo -e "${BLUE}================================================${NC}"
  echo ""
}

print_success() {
  echo -e "${GREEN}✓${NC} $1"
}

print_error() {
  echo -e "${RED}✗${NC} $1"
}

print_warning() {
  echo -e "${YELLOW}⚠${NC} $1"
}

print_info() {
  echo -e "${BLUE}ℹ${NC} $1"
}

# Check if command exists
command_exists() {
  command -v "$1" >/dev/null 2>&1
}

# Main setup process
main() {
  print_header "Turborepo + Hono + Next.js + Expo Template Setup"

  echo "This script will:"
  echo "  1. Check prerequisites"
  echo "  2. Install dependencies"
  echo "  3. Set up environment variables"
  echo "  4. Initialize database"
  echo "  5. Build packages"
  echo ""
  read -p "Continue? (y/n) " -n 1 -r
  echo ""
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Setup cancelled."
    exit 0
  fi

  # Step 1: Check prerequisites
  print_header "Step 1: Checking Prerequisites"

  # Check Node.js
  if command_exists node; then
    NODE_VERSION=$(node -v)
    NODE_MAJOR_VERSION=$(echo $NODE_VERSION | cut -d '.' -f 1 | sed 's/v//')
    if [ "$NODE_MAJOR_VERSION" -ge 18 ]; then
      print_success "Node.js $NODE_VERSION (>= 18 required)"
    else
      print_error "Node.js version $NODE_VERSION is too old. Please install Node.js >= 18"
      exit 1
    fi
  else
    print_error "Node.js is not installed. Please install Node.js >= 18"
    print_info "Download from: https://nodejs.org/"
    exit 1
  fi

  # Check pnpm
  if command_exists pnpm; then
    PNPM_VERSION=$(pnpm -v)
    print_success "pnpm $PNPM_VERSION"
  else
    print_error "pnpm is not installed. Installing pnpm..."
    npm install -g pnpm
    if [ $? -eq 0 ]; then
      print_success "pnpm installed successfully"
    else
      print_error "Failed to install pnpm. Please install manually:"
      print_info "npm install -g pnpm"
      exit 1
    fi
  fi

  # Check PostgreSQL (optional, just warn)
  if command_exists psql; then
    PSQL_VERSION=$(psql --version | awk '{print $3}')
    print_success "PostgreSQL $PSQL_VERSION installed"
  else
    print_warning "PostgreSQL not found locally. You can use a cloud database instead."
    print_info "Cloud options: Supabase, Neon, Railway"
  fi

  # Step 2: Install dependencies
  print_header "Step 2: Installing Dependencies"

  print_info "Running: pnpm install"
  pnpm install

  if [ $? -eq 0 ]; then
    print_success "Dependencies installed successfully"
  else
    print_error "Failed to install dependencies"
    exit 1
  fi

  # Step 3: Set up environment variables
  print_header "Step 3: Setting Up Environment Variables"

  # API environment
  if [ ! -f "apps/api/.env" ]; then
    print_info "Setting up API environment variables..."

    # Check if .env.example exists
    if [ -f ".env.example" ]; then
      cp .env.example apps/api/.env
      print_success "Created apps/api/.env from .env.example"
    else
      # Create minimal .env file
      cat > apps/api/.env << 'EOF'
# Better-auth Secret (generate with: openssl rand -base64 32)
BETTER_AUTH_SECRET=replace_with_random_secret_here
BETTER_AUTH_URL=http://localhost:3001

# Database URL (replace with your database connection string)
DATABASE_URL=postgresql://user:password@localhost:5432/myapp

# Server Config
NODE_ENV=development
PORT=3001

# CORS (web app origin)
CORS_ORIGINS=http://localhost:3000

# Optional: Cloudflare R2 for file uploads
# R2_ACCOUNT_ID=
# R2_ACCESS_KEY_ID=
# R2_SECRET_ACCESS_KEY=
# R2_BUCKET_NAME=
EOF
      print_success "Created apps/api/.env"
    fi

    print_warning "IMPORTANT: You need to update apps/api/.env with:"
    echo ""
    echo "  1. Generate BETTER_AUTH_SECRET:"
    echo "     openssl rand -base64 32"
    echo ""
    echo "  2. Set DATABASE_URL to your PostgreSQL connection string"
    echo "     Example: postgresql://user:password@localhost:5432/myapp"
    echo ""
    read -p "Press Enter when you've updated apps/api/.env..."
  else
    print_success "apps/api/.env already exists"
  fi

  # Web environment
  if [ ! -f "apps/web/.env.local" ]; then
    cat > apps/web/.env.local << 'EOF'
# API URL
NEXT_PUBLIC_API_URL=http://localhost:3001

# Environment
NODE_ENV=development
EOF
    print_success "Created apps/web/.env.local"
  else
    print_success "apps/web/.env.local already exists"
  fi

  # Mobile environment
  if [ ! -f "apps/app/.env.local" ]; then
    cat > apps/app/.env.local << 'EOF'
# API URL
EXPO_PUBLIC_API_URL=http://localhost:3001
EOF
    print_success "Created apps/app/.env.local"
  else
    print_success "apps/app/.env.local already exists"
  fi

  # Step 4: Initialize database
  print_header "Step 4: Initializing Database"

  print_info "Running database migrations..."

  # Check if DATABASE_URL is set
  if grep -q "postgresql://" apps/api/.env 2>/dev/null && ! grep -q "user:password@localhost" apps/api/.env; then
    cd packages/db
    pnpm db:migrate

    if [ $? -eq 0 ]; then
      cd ../..
      print_success "Database initialized successfully"
    else
      cd ../..
      print_error "Failed to run migrations. Please check your DATABASE_URL in apps/api/.env"
      print_info "You can run migrations manually later with:"
      print_info "  cd packages/db && pnpm db:migrate"
      read -p "Continue anyway? (y/n) " -n 1 -r
      echo ""
      if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
      fi
    fi
  else
    print_warning "Skipping migrations - DATABASE_URL not configured"
    print_info "After setting up your database, run:"
    print_info "  cd packages/db && pnpm db:migrate"
  fi

  # Step 5: Build packages
  print_header "Step 5: Building Packages"

  print_info "Building all packages..."
  pnpm build

  if [ $? -eq 0 ]; then
    print_success "Packages built successfully"
  else
    print_error "Failed to build packages"
    exit 1
  fi

  # Final success message
  print_header "Setup Complete!"

  echo ""
  print_success "Your development environment is ready!"
  echo ""
  echo "Next steps:"
  echo ""
  echo "  1. Start development servers:"
  echo "     ${GREEN}pnpm dev${NC}"
  echo ""
  echo "  2. Open your browser:"
  echo "     Web app:  ${BLUE}http://localhost:3000${NC}"
  echo "     API docs: ${BLUE}http://localhost:3001/v1/health${NC}"
  echo ""
  echo "  3. Create your first user account at:"
  echo "     ${BLUE}http://localhost:3000/sign-up${NC}"
  echo ""
  echo "  4. Explore the examples:"
  echo "     - Todo CRUD:     ${BLUE}http://localhost:3000/todos${NC}"
  echo "     - File Upload:   ${BLUE}http://localhost:3000/documents${NC}"
  echo ""
  echo "  5. Read the documentation:"
  echo "     - Getting Started: ${BLUE}GETTING_STARTED.md${NC}"
  echo "     - Patterns:        ${BLUE}PATTERNS.md${NC}"
  echo "     - Deployment:      ${BLUE}DEPLOYMENT.md${NC}"
  echo ""
  print_info "For mobile development, scan the QR code in the terminal after running 'pnpm dev'"
  echo ""
}

# Run main function
main
