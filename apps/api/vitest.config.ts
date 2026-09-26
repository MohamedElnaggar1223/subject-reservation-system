import { defineConfig } from 'vitest/config';
import { BaseSequencer, type TestSpecification } from 'vitest/node';

/** Files run in name order (00-, 01-, …) so a run is reproducible. */
class ByNameSequencer extends BaseSequencer {
  override async sort(files: TestSpecification[]) {
    return [...files].sort((a, b) => a.moduleId.localeCompare(b.moduleId));
  }
}

/**
 * Integration tests against a real Postgres.
 *
 * - global-setup.ts drops and recreates the test database and runs every
 *   migration, once per run.
 * - env.ts sets the environment before any app module is imported.
 * - Files run one at a time (they share the database); within a file, tests
 *   run in order because each scenario is a chain of real money movements.
 *
 * Prerequisite: a Postgres reachable at TEST_PG_ADMIN_URL (default: the
 * local dev container on 127.0.0.1:5433, or the CI service). See test/README.md.
 */
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['./test/global-setup.ts'],
    setupFiles: ['./test/env.ts'],
    fileParallelism: false,
    sequence: { concurrent: false, sequencer: ByNameSequencer },
    testTimeout: 30_000,
    hookTimeout: 120_000,
    reporters: ['default'],
  },
});
