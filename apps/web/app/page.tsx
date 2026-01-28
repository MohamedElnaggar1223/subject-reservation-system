/**
 * Home Page - Protected Route Example
 *
 * This page demonstrates:
 * - Server-side authentication check
 * - Automatic redirect to sign-up if not authenticated
 * - Role-based UI rendering
 * - Type-safe session access
 */

import type { JSX } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuthenticated } from "~/lib/auth/session";

export default async function Home(): Promise<JSX.Element> {
  // Redirect to sign-up if not authenticated
  const session = await requireAuthenticated()

  if(!session.session) {
    redirect('/sign-up')
  }

  return (
    <main className='min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-8'>
      <div className='max-w-4xl mx-auto'>
        <header className='mb-12'>
          <h1 className='text-4xl font-bold text-gray-900 mb-2'>
            Welcome to Your App
          </h1>
          <p className='text-lg text-gray-600'>
            Turborepo + Hono + Next.js + Expo Template
          </p>
        </header>

        <div className='bg-white rounded-lg shadow-md p-6 mb-6'>
          <h2 className='text-2xl font-semibold mb-4'>
            Hello, {session.user.name || session.user.email}!
          </h2>
          <p className='text-gray-600 mb-4'>
            You are logged in with role: <span className='font-semibold'>{session.user.role || 'user'}</span>
          </p>
        </div>

        <div className='bg-white rounded-lg shadow-md p-6 mb-6'>
          <h3 className='text-xl font-semibold mb-4'>Quick Start</h3>
          <ul className='space-y-3 text-gray-700'>
            <li>✅ Authentication is working</li>
            <li>✅ Server-side rendering with Next.js</li>
            <li>✅ Role-based access control enabled</li>
            <li>✅ Type-safe API with Hono RPC</li>
          </ul>

          <div className='mt-6 pt-6 border-t border-gray-200'>
            <p className='text-sm text-gray-600 mb-3'>
              Get started by adding your routes in <code className='bg-gray-100 px-2 py-1 rounded'>apps/api/src/routes/</code>
            </p>
            <div className='flex flex-wrap gap-2'>
              <Link
                href='/sign-in'
                className='text-blue-600 hover:text-blue-800 underline'
              >
                Sign In Page
              </Link>
              <span className='text-gray-400'>|</span>
              <Link
                href='/sign-up'
                className='text-blue-600 hover:text-blue-800 underline'
              >
                Sign Up Page
              </Link>
              <span className='text-gray-400'>|</span>
              <Link
                href='/todos'
                className='text-blue-600 hover:text-blue-800 underline'
              >
                Todo Example
              </Link>
              <span className='text-gray-400'>|</span>
              <Link
                href='/documents'
                className='text-blue-600 hover:text-blue-800 underline'
              >
                File Upload Example
              </Link>
            </div>
          </div>
        </div>

        <div className='bg-green-50 rounded-lg shadow-md p-6 border border-green-200 mb-6'>
          <h3 className='text-xl font-semibold text-green-900 mb-3'>
            📝 Try the Todo Example
          </h3>
          <p className='text-green-800 mb-4'>
            A complete CRUD example demonstrating all template patterns:
          </p>
          <ul className='space-y-2 text-sm text-green-700 mb-4'>
            <li>• Server-side rendering with data pre-fetching</li>
            <li>• Type-safe API calls with Hono RPC</li>
            <li>• Optimistic UI updates with TanStack Query</li>
            <li>• Form validation with Zod schemas</li>
            <li>• Database operations with Drizzle ORM</li>
            <li>• Role-based access control</li>
          </ul>
          <Link
            href='/todos'
            className='inline-block bg-green-600 text-white px-6 py-2 rounded-lg hover:bg-green-700 transition-colors'
          >
            View Todo Example →
          </Link>
        </div>

        <div className='bg-purple-50 rounded-lg shadow-md p-6 border border-purple-200'>
          <h3 className='text-xl font-semibold text-purple-900 mb-3'>
            📁 Try the File Upload Example
          </h3>
          <p className='text-purple-800 mb-4'>
            A comprehensive file management example with advanced features:
          </p>
          <ul className='space-y-2 text-sm text-purple-700 mb-4'>
            <li>• Multipart form data uploads (avatar, document, general)</li>
            <li>• Image processing with automatic thumbnail generation</li>
            <li>• Multiple image variants (thumbnail, medium, large)</li>
            <li>• File filtering and pagination</li>
            <li>• Cloudflare R2 storage integration</li>
            <li>• Type-safe uploads with Hono RPC (no manual types!)</li>
          </ul>
          <Link
            href='/documents'
            className='inline-block bg-purple-600 text-white px-6 py-2 rounded-lg hover:bg-purple-700 transition-colors'
          >
            View File Upload Example →
          </Link>
        </div>
      </div>
    </main>
  );
}
