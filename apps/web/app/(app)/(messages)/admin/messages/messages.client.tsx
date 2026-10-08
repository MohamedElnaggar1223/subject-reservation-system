'use client';

/**
 * Messages and reminders (RESERVATIONS_REWORK.md §4.8). Four tabs: a new message, the log with the
 * deliveries per recipient, the reminder rules with what went out, the school's texts. The admin
 * has all of it; finance sends to the money lists (a session's unpaid families, the holders of a
 * charge) and reads those messages; the finance admin also sets the reminder rules (§5).
 */

import { useState } from 'react';
import { Composer } from './composer.client';
import { MessageLog } from './log.client';
import { Reminders } from './reminders.client';
import { Templates } from './templates.client';

const TABS = ['new', 'log', 'reminders', 'templates'] as const;
type Tab = (typeof TABS)[number];
const TAB_WORD: Record<Tab, string> = { new: 'New message', log: 'Sent', reminders: 'Reminders', templates: 'Texts' };

export default function MessagesClient({ viewerRole }: { viewerRole: string | null }): React.JSX.Element {
  const admin = viewerRole === 'admin';
  const rules = admin || viewerRole === 'finance_admin';
  const tabs = TABS.filter((t) => t !== 'reminders' || rules);
  const [tab, setTab] = useState<Tab>('new');
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <div className="mx-auto max-w-6xl space-y-6 px-6 py-8 animate-fade-up">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">Messages</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Families read these in their notifications (and by email); nobody can delete one. Reminders go out on their own, once each.
        </p>
      </div>
      <div className="flex flex-wrap gap-1 border-b border-border" role="tablist" aria-label="Messages">
        {tabs.map((t) => (
          <button key={t} role="tab" type="button" aria-selected={tab === t} onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${tab === t ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
            {TAB_WORD[t]}
          </button>
        ))}
      </div>
      {tab === 'new' && <Composer admin={admin} />}
      {tab === 'log' && <MessageLog openId={openId} onOpen={setOpenId} />}
      {tab === 'reminders' && rules && <Reminders />}
      {tab === 'templates' && <Templates admin={admin} />}
    </div>
  );
}
