/**
 * Reads the reference data and the June 2027 pre-load (COORDINATOR_REWORK.md §7.1) through the
 * schemas of @repo/validations. Used by `reference:check` and `reference:labels`.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BoardsFileSchema,
  LocalTeachersFileSchema,
  REFERENCE_BOARD_CODES,
  SessionSeedFileSchema,
  SubjectsFileSchema,
  type BoardsFile,
  type LocalTeachersFile,
  type ReferenceBoardCode,
  type SessionSeedFile,
  type SubjectsFile,
} from "@repo/validations";

export const DB_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
export const REPO_DIR = join(DB_DIR, "..", "..");
export const REFERENCE_DIR = join(DB_DIR, "reference");
export const SEEDS_DIR = join(DB_DIR, "seeds");

export type ReferenceFiles = {
  boards: BoardsFile;
  subjects: Record<ReferenceBoardCode, SubjectsFile>;
  seed: SessionSeedFile;
  /** Placeholder key → name, when the git-ignored local file exists. */
  teachers: LocalTeachersFile | null;
  /** Every committed file read, for the text checks. */
  committed: { path: string; text: string }[];
};

export class ReferenceFileError extends Error {}

type Issue = { path: PropertyKey[]; message: string };
type Parser = { safeParse: (v: unknown) => { success: boolean; data?: unknown; error?: { issues: Issue[] } } };

function parseFile<T>(path: string, schema: Parser): { data: T; text: string } {
  const rel = relative(REPO_DIR, path);
  if (!existsSync(path)) throw new ReferenceFileError(`${rel}: missing`);
  const text = readFileSync(path, "utf8");
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new ReferenceFileError(`${rel}: not JSON (${(e as Error).message})`);
  }
  const r = schema.safeParse(json);
  if (!r.success) {
    const lines = (r.error?.issues ?? []).map((i) => `  ${i.path.map(String).join(".") || "(file)"}: ${i.message}`);
    throw new ReferenceFileError(`${rel}: does not match its schema\n${lines.join("\n")}`);
  }
  return { data: r.data as T, text };
}

export function loadReferenceFiles(): ReferenceFiles {
  const committed: { path: string; text: string }[] = [];
  const boardsPath = join(REFERENCE_DIR, "boards.json");
  const boards = parseFile<BoardsFile>(boardsPath, BoardsFileSchema);
  committed.push({ path: boardsPath, text: boards.text });

  const subjectsDir = join(REFERENCE_DIR, "subjects");
  const files = existsSync(subjectsDir) ? readdirSync(subjectsDir).filter((f) => f.endsWith(".json")).sort() : [];
  const expected = REFERENCE_BOARD_CODES.map((c) => `${c}.json`).sort();
  if (JSON.stringify(files) !== JSON.stringify(expected)) {
    throw new ReferenceFileError(`packages/db/reference/subjects holds ${files.join(", ") || "nothing"}; expected ${expected.join(", ")}`);
  }
  const subjects = {} as Record<ReferenceBoardCode, SubjectsFile>;
  for (const code of REFERENCE_BOARD_CODES) {
    const p = join(subjectsDir, `${code}.json`);
    const f = parseFile<SubjectsFile>(p, SubjectsFileSchema);
    subjects[code] = f.data;
    committed.push({ path: p, text: f.text });
  }

  const seedPath = join(SEEDS_DIR, "june-2027.json");
  const seed = parseFile<SessionSeedFile>(seedPath, SessionSeedFileSchema);
  committed.push({ path: seedPath, text: seed.text });

  const localPath = join(SEEDS_DIR, "local", "june-2027.teachers.json");
  const teachers = existsSync(localPath) ? parseFile<LocalTeachersFile>(localPath, LocalTeachersFileSchema).data : null;

  return { boards: boards.data, subjects, seed: seed.data, teachers, committed };
}

/**
 * The committed files that must never carry a teacher's name or a mobile number: the reference
 * data, the committed seeds, these scripts, and the coordinator trails (.audit/coordinator-*.tsv).
 */
export function personalDataScanFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string, keep: (f: string) => boolean, skip: (d: string) => boolean = () => false) => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir).sort()) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) {
        if (!skip(p)) walk(p, keep, skip);
      } else if (keep(name)) out.push(p);
    }
  };
  walk(REFERENCE_DIR, (f) => f.endsWith(".json"));
  walk(SEEDS_DIR, (f) => f.endsWith(".json"), (d) => d === join(SEEDS_DIR, "local"));
  walk(join(DB_DIR, "scripts"), (f) => f.endsWith(".ts"));
  walk(join(REPO_DIR, ".audit"), (f) => /^coordinator-.*\.tsv$/.test(f), () => true);
  return out;
}

/**
 * Personal data in the committed files: an 11-digit mobile number always; a teacher's name only
 * when the git-ignored local names file exists (the names to look for are the local file's, so
 * the scan skips where it is absent, as in CI).
 */
export function personalDataIssues(teachers: LocalTeachersFile | null): string[] {
  const issues: string[] = [];
  const names = teachers ? (Object.values(teachers) as string[]) : [];
  for (const path of personalDataScanFiles()) {
    const rel = relative(REPO_DIR, path);
    readFileSync(path, "utf8").split("\n").forEach((line, i) => {
      if (/(^|[^0-9])01[0-9]{9}([^0-9]|$)/.test(line)) issues.push(`${rel}:${i + 1} contains an 11-digit mobile number`);
      for (const n of names) {
        if (line.includes(n)) issues.push(`${rel}:${i + 1} contains a teacher's name (${n.slice(0, 3)}…): names live only in the local file`);
      }
    });
  }
  return issues;
}

/** "{T-ESL-2}" placeholders in a flag, replaced by names when the local file has them. */
export function resolveTeacherPlaceholders(text: string, teachers: LocalTeachersFile | null): string {
  return text.replace(/\{(T-[A-Z0-9-]+)\}/g, (_, key: string) => teachers?.[key] ?? key);
}

export function teacherPlaceholdersIn(text: string): string[] {
  return [...text.matchAll(/\{(T-[A-Z0-9-]+)\}/g)].map((m) => m[1]!);
}
