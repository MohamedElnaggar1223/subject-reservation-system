'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { usePathname } from 'next/navigation';
import { cn } from '~/lib/utils';

/** The staff's campus-leave screens, one row of links (the gate and the policy are the academic staff's). */
export function LeaveNav({ academic }: { academic: boolean }) {
  const path = usePathname();
  const links: { href: string; label: string }[] = [
    { href: '/leave/manage', label: 'Requests' },
    ...(academic ? [{ href: '/gate', label: 'Gate' }] : []),
    { href: '/leave/reports', label: 'Reports' },
    ...(academic ? [{ href: '/leave/policy', label: 'Policy' }] : []),
  ];
  return (
    <nav aria-label="Campus leave" className="mb-5 flex flex-wrap gap-1 border-b border-border">
      {links.map((l) => {
        const on = path === l.href || path.startsWith(`${l.href}/`);
        return (
          <Link key={l.href} href={l.href as Route} aria-current={on ? 'page' : undefined}
            className={cn('-mb-px border-b-2 px-3 py-2 text-sm font-medium', on ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}>
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
