/**
 * reference:labels — prints, for every offering of the June 2027 pre-load (COORDINATOR_REWORK.md
 * §8), each option a first-time student and a retaker would see, with its wording in English and
 * Arabic (labels.ts, D9–D10) and its exam fee, for the owner to hold next to the school's 25
 * Google Forms. Real teacher names when packages/db/seeds/local/june-2027.teachers.json exists.
 *
 * Writes .audit/coordinator-p0-evidence/june-2027-family-wording.md (git-ignored).
 * Usage: pnpm --filter @repo/db reference:labels   (build @repo/validations first)
 */

import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import {
  CELL_NAMES,
  CELL_OPTIONS,
  COUNCIL_LABELS,
  deriveSessionName,
  examMonthLabel,
  optionLabel,
  refundPolicySentence,
  rowLabel,
  type CellName,
  type SeedTeacher,
} from "@repo/validations";
import { REPO_DIR, ReferenceFileError, loadReferenceFiles, resolveTeacherPlaceholders } from "./reference-files";

const OUT = join(REPO_DIR, ".audit", "coordinator-p0-evidence", "june-2027-family-wording.md");
const egp = (n: number | null) => (n === null ? "not set" : `EGP ${n.toLocaleString("en-US")}`);

function main(): number {
  let files;
  try {
    files = loadReferenceFiles();
  } catch (e) {
    if (e instanceof ReferenceFileError) {
      console.error(e.message);
      return 1;
    }
    throw e;
  }
  const { subjects, seed, teachers } = files;
  const share = seed.session.selfStudyPercent;
  const nameOf = (t: SeedTeacher) => {
    const n = teachers?.[t.key] ?? t.key;
    const tags = [t.online ? "online" : null, t.external ? "external team" : null].filter(Boolean);
    return tags.length ? `${n} (${tags.join(", ")})` : n;
  };

  const out: string[] = [];
  out.push(`# ${deriveSessionName(seed.session.type, seed.session.year)}: what families read`);
  out.push("");
  out.push(`Generated ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC by \`pnpm --filter @repo/db reference:labels\` from packages/db/seeds/june-2027.json and packages/db/reference (COORDINATOR_REWORK.md §8, D9–D10).`);
  out.push(teachers ? "Teacher names from the local file (git-ignored)." : "Teachers are placeholders: the local names file is absent.");
  out.push("");
  out.push(`- Self-study share: ${share}% of the course fee; the exam fee is paid whole (E4). Course fees are not set yet (Q1), so only exam fees are shown.`);
  out.push(`- Refund policy: ${refundPolicySentence(seed.session.refundPolicy)} (C7, from the first lesson).`);
  out.push("- \"A first-time student\" lists the first-entry options, \"a retaker\" the retake options. A student the system does not know has sat the subject sees both lists, a retake being declared as on the forms (F2); one the system knows has sat it sees the retake list only.");
  out.push("- Columns: FI first entry in school · RI retake in school (RI* ticked by Q10's default, not read on the form) · RS retake self study · FS first entry self study (not taught this cycle).");
  out.push("");

  let options = 0;
  for (const o of seed.offerings) {
    const subject = subjects[o.board].find((s) => s.code === o.subject)!;
    const all = o.teachers;
    out.push(`## ${o.order}. ${subject.name} ${subject.group} — ${COUNCIL_LABELS[o.board]}, ${subject.code}${subject.confirmed ? "" : " (code to check)"}`);
    out.push("");
    out.push(`Teachers: ${o.teacherTbc ? "teacher to be announced (to be confirmed)" : all.map(nameOf).join(", ")}${!o.teacherTbc && all.length > 1 ? " — families choose (required)" : ""}`);
    if (o.flags.length) {
      out.push("");
      for (const f of o.flags) out.push(`> ${resolveTeacherPlaceholders(f, teachers)}`);
    }
    out.push("");
    out.push("| Row | Cells | Exam fee |");
    out.push("|---|---|---|");
    for (const r of o.rows) {
      const ref = subject.rows.find((x) => x.key === r.key)!;
      const cells = CELL_NAMES.filter((c) => r.cells[c]).map((c) => ({ firstInSchool: "FI", retakeInSchool: "RI", retakeSelfStudy: "RS", firstSelfStudy: "FS" })[c] + (r.cellsByDefault.includes(c) ? "*" : ""));
      const src = r.examFeeSource === "list" ? r.examFeeList : r.examFeeSource === "units_sum" ? `sum, ${r.examFeeList}` : r.examFeeSource === "board_rule" ? `the syllabus's fee (board rule), ${r.examFeeList}` : null;
      out.push(`| ${rowLabel(ref, "en")} · ${rowLabel(ref, "ar")} | ${cells.join(" ")} | ${egp(r.examFee)}${src ? ` (${src})` : ""} |`);
    }
    out.push("");
    for (const [who, attempt] of [["A first-time student sees", "first"], ["A retaker sees", "retake"]] as const) {
      const lines: string[] = [];
      for (const r of o.rows) {
        const ref = subject.rows.find((x) => x.key === r.key)!;
        for (const c of CELL_NAMES as readonly CellName[]) {
          const opt = CELL_OPTIONS[c];
          if (!r.cells[c] || opt.attempt !== attempt) continue;
          options++;
          const en = optionLabel(ref, opt, { selfStudyShare: share, lang: "en" });
          const ar = optionLabel(ref, opt, { selfStudyShare: share, lang: "ar" });
          const teach = opt.mode === "in_school"
            ? (o.teacherTbc ? "teacher to be announced" : (r.teachers ?? all).map(nameOf).join(" / "))
            : "no teacher";
          const from = r.allowedPriorSittings
            ? ` — carried from: ${r.allowedPriorSittings.map((p) => examMonthLabel(p, "en")).join(" / ")} · ${r.allowedPriorSittings.map((p) => examMonthLabel(p, "ar")).join(" / ")}`
            : "";
          lines.push(`- **${en}** — ${ar} — exam fee ${egp(r.examFee)} — ${teach}${from}`);
        }
      }
      out.push(`${who}:`);
      out.push("");
      out.push(...(lines.length ? lines : ["- nothing (no option of this kind is ticked)"]));
      out.push("");
    }
  }
  out.push(`${seed.offerings.length} subjects, ${options} options.`);

  mkdirSync(join(REPO_DIR, ".audit", "coordinator-p0-evidence"), { recursive: true });
  writeFileSync(OUT, out.join("\n") + "\n", "utf8");
  const size = statSync(OUT).size;
  console.log(`reference:labels — ${seed.offerings.length} subjects, ${options} options → ${relative(REPO_DIR, OUT)} (${Math.round(size / 1024)} KB)`);
  if (size > 300 * 1024) {
    console.error("the print is over 300 KB: evidence under .audit may not be that large");
    return 1;
  }
  return 0;
}

process.exit(main());
