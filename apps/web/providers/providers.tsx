'use client'
import { QueryClientProvider } from '@tanstack/react-query'
import { getQueryClient } from '../lib/query-client'
import { I18nProvider } from '../lib/i18n'
import type * as React from 'react'

export default function Providers({ children }: { children: React.ReactNode }): React.JSX.Element {
  const queryClient = getQueryClient()

  return (
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        {children}
      </I18nProvider>
    </QueryClientProvider>
  )
}
