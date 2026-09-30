/**
 * The generator runs on a worker thread (F1 review, flag 4): a search of a
 * few seconds (about 3 s at the school's size, 11 s on the worst infeasible
 * input measured) must not stop the API answering everyone else meanwhile.
 * The generator is pure — the same input gives the same timetable on any
 * thread — so moving it changes nothing but where it runs.
 *
 * The worker is a few lines evaluated in place; it loads the generator from
 * the built @repo/validations package, so it runs the same way under the dev
 * server, the test runner and the compiled server.
 */
import { Worker } from 'node:worker_threads';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { EngineInput, GenerateOptions, GenerateResult } from '@repo/validations';
import { SchedulingError } from './scheduling-shared.services';

const WORKER_SOURCE = `
const { parentPort, workerData } = require('node:worker_threads');
import(workerData.moduleUrl)
  .then((m) => parentPort.postMessage({ ok: true, result: m.generate(workerData.input, workerData.options) }))
  .catch((err) => parentPort.postMessage({ ok: false, message: String((err && err.stack) || err) }));
`;

/** Far above any run measured; a run past it is stopped and nothing is written. */
export const GENERATOR_TIME_LIMIT_MS = 90_000;

let generatorUrl: string | null = null;
function generatorModule(): string {
  if (!generatorUrl) {
    const index = createRequire(import.meta.url).resolve('@repo/validations');
    generatorUrl = pathToFileURL(join(dirname(index), 'scheduling', 'generator.js')).href;
  }
  return generatorUrl;
}

/** `generate(input, options)`, on a worker thread. */
export function generateInWorker(input: EngineInput, options: GenerateOptions = {}): Promise<GenerateResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER_SOURCE, { eval: true, workerData: { moduleUrl: generatorModule(), input, options } });
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
      void worker.terminate();
    };
    const timer = setTimeout(() => finish(() => reject(new SchedulingError(
      `The generator ran past ${GENERATOR_TIME_LIMIT_MS / 1000} seconds and was stopped; nothing was written — lock more lessons, or run it with fewer steps`, 409,
    ))), GENERATOR_TIME_LIMIT_MS);
    worker.once('message', (m: { ok: true; result: GenerateResult } | { ok: false; message: string }) =>
      finish(() => (m.ok ? resolve(m.result) : reject(new Error(`The generator failed: ${m.message}`)))));
    worker.once('error', (err) => finish(() => reject(err)));
    worker.once('exit', (code) => finish(() => reject(new Error(`The generator's thread stopped (code ${code})`))));
  });
}
