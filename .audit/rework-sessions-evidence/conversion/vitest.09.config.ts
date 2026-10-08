// 09's rules over a converted database (the conversion proof): no global setup — the database is
// a copy made for this run and is not dropped or migrated here.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    root: '/Users/mohamedelnaggar/Coding/subject-reservation-system/.claude/worktrees/rework-sessions/apps/api',
    include: ['test/09-money-invariants.test.ts'],
    setupFiles: ['/Users/mohamedelnaggar/Coding/subject-reservation-system/.claude/worktrees/rework-sessions/apps/api/test/env.ts'],
    fileParallelism: false,
    testTimeout: 60_000,
    reporters: ['verbose'],
  },
});
