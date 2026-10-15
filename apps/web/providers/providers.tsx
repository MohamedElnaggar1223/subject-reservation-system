'use client'
import { QueryClientProvider } from '@tanstack/react-query'
import { getQueryClient } from '../lib/query-client'
import { I18nProvider, type Language } from '../lib/i18n'
import type * as React from 'react'

export default function Providers({ children, initialLanguage }: { children: React.ReactNode; initialLanguage: Language }): React.JSX.Element {
  const queryClient = getQueryClient()

  return (
    <QueryClientProvider client={queryClient}>
      <I18nProvider initialLanguage={initialLanguage}>
        {children}
      </I18nProvider>
    </QueryClientProvider>
  )
}
