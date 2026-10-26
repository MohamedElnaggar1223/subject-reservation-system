/**
 * reference:check — holds the reference data and the June 2027 pre-load to COORDINATOR_REWORK.md
 * §7.1 and §8:
 *
 * - every file parses through its schema (@repo/validations, offering/reference.ts);
 * - the boards: aliases reach real rows, price codes are unique per board, sittings are sat by
 *   the levels they list (an IGCSE never in October or January), a confirmed sitting cites an
 *   official board document, Cambridge's November has a retake deadline and its June none;
 * - the subjects: stored labels are what labels.ts generates, no family wording carries board
 *   jargon (F3), rows run in D10's order, every subject of both links sheets is present;
 * - the school's fee lists (scripts/fee-lists.ts): every printed row reaches exactly one row;
 * - the pre-load: subjects and row keys exist, rows in D10's order, O.L. before A.S./A.L., the
 *   carried-from lists exactly where the board asks (and in the boards' sittings), every exam fee
 *   equal to its list (a sum or the board rule applied), the June refund policy of C7, teacher
 *   placeholders only;
 * - the wording: a null self-study share reads plain "self study"; the jargon finder catches
 *   plurals and Arabic attached forms;
 * - personal data (reference-files.ts personalDataIssues): no mobile number in the reference, the
 *   seeds, these scripts or the coordinator trails, and no teacher's name there when the local
 *   names file exists (the name scan skips without it, as in CI, which runs this check).
 *
 * Usage: pnpm --filter @repo/db reference:check   (build @repo/validations first)
 * Exit code 1 on any error; warnings are printed and do not fail.
 */

import {
  CELL_NAMES,
  DEFAULT_REFUND_POLICIES,
  compareRowKinds,
  familyJargonIn,
  matchPrintedCode,
  modeLabel,
  normalizePrintedCode,
  optionLabel,
  referenceRowLabel,
  CELL_OPTIONS,
  GROUP_ORDER,
  type ReferenceBoard,
  type ReferenceBoardCode,
  type ReferenceRow,
  type ReferenceSubject,
  type SittingRef,
} from "@repo/validations";
import { SCHOOL_FEE_LISTS, WINTER_2026_LINKS_SHEET, type FeeList } from "./fee-lists";
import { ReferenceFileError, loadReferenceFiles, personalDataIssues, teacherPlaceholdersIn } from "./reference-files";

const errors: string[] = [];
const warnings: string[] = [];
const err = (m: string) => errors.push(m);
const warn = (m: string) => warnings.push(m);

const OFFICIAL_SOURCES = ["https://www.cambridgeinternational.org/", "https://qualifications.pearson.com/", "https://www.oxfordaqa.com/"];
const sittingName = (s: SittingRef) => `${["", "January", "", "", "", "", "June", "", "", "", "October", "November"][s.month]} ${s.year}`;
const monthsBetween = (a: SittingRef, b: SittingRef) => (b.year - a.year) * 12 + (b.month - a.month);

function main(): number {
  let files;
  try {
    files = loadReferenceFiles();
  } catch (e) {
    if (e instanceof ReferenceFileError) {
      console.error(`reference:check — FAILED\n${e.message}`);
      return 1;
    }
    throw e;
  }
  const { boards, subjects, seed, teachers } = files;
  const boardOf = new Map<ReferenceBoardCode, ReferenceBoard>(boards.map((b) => [b.code, b]));
  const subjectOf = (board: ReferenceBoardCode, code: string): ReferenceSubject | undefined => subjects[board]?.find((s) => s.code === code);
  const rowOf = (board: ReferenceBoardCode, code: string, key: string): ReferenceRow | undefined => subjectOf(board, code)?.rows.find((r) => r.key === key);

  // ── Boards ──
  for (const code of Object.keys(subjects) as ReferenceBoardCode[]) {
    if (!boardOf.has(code)) err(`boards.json has no board ${code}, yet subjects/${code}.json exists`);
  }
  for (const b of boards) {
    for (const a of b.aliases) {
      if (!rowOf(b.code, a.subject, a.row)) err(`${b.code} alias '${a.printed}' points at ${a.subject}/${a.row}, which is not a reference row`);
    }
    const priceCodes = new Map<string, string>();
    for (const s of subjects[b.code]) {
      for (const r of s.rows) {
        for (const pc of r.priceCodes) {
          const n = normalizePrintedCode(pc);
          const here = `${s.code}/${r.key}`;
          const there = priceCodes.get(n);
          if (there && there !== here) err(`${b.code} price code '${pc}' is on two rows: ${there} and ${here}`);
          priceCodes.set(n, here);
        }
      }
    }
    for (const a of b.aliases) {
      const n = normalizePrintedCode(a.printed);
      if (priceCodes.has(n)) err(`${b.code} alias '${a.printed}' is also a price code of ${priceCodes.get(n)}`);
    }
    for (const s of b.sittings) {
      const name = `${b.code} ${sittingName(s)}`;
      if ((s.month === 1 || s.month === 10) && s.levels.includes("igcse")) err(`${name}: an IGCSE never sits in October or January`);
      if (s.confirmed) {
        for (const url of s.source.split(" ; ")) {
          if (!OFFICIAL_SOURCES.some((o) => url.trim().startsWith(o))) err(`${name}: confirmed, but '${url}' is not one of the boards' own sites`);
        }
      }
      if (b.code === "cambridge") {
        if (s.month === 6 && s.retakeDeadline !== null) err(`${name}: Cambridge sets no separate retake deadline in June`);
        if (s.month === 11 && s.confirmed && s.retakeDeadline === null) err(`${name}: Cambridge's November has a retake deadline (retakes of the June syllabus)`);
      } else if (s.retakeDeadline !== null) {
        err(`${name}: only Cambridge has a separate retake deadline`);
      }
    }
  }

  // ── Subjects ──
  let rowCount = 0;
  for (const b of boards) {
    for (const s of subjects[b.code]) {
      for (const [i, r] of s.rows.entries()) {
        rowCount++;
        const want = referenceRowLabel(r);
        if (r.label.en !== want.en || r.label.ar !== want.ar) {
          err(`${b.code} ${s.code}/${r.key}: label ${JSON.stringify(r.label)} is not what labels.ts generates, ${JSON.stringify(want)}`);
        }
        const prev = s.rows[i - 1];
        if (prev && compareRowKinds(prev, r) > 0) err(`${b.code} ${s.code}: row ${r.key} (${r.kind}) comes after ${prev.key} (${prev.kind}), against D10`);
        for (const share of [50, 40]) {
          for (const c of CELL_NAMES) {
            for (const lang of ["en", "ar"] as const) {
              const text = optionLabel(r, CELL_OPTIONS[c], { selfStudyShare: share, lang });
              const bad = familyJargonIn(text);
              if (bad.length) err(`${b.code} ${s.code}/${r.key}: '${text}' carries board jargon (${bad.join(", ")})`);
            }
          }
        }
      }
    }
  }
  if (modeLabel("self_study", 40, "en") !== "self study 40%") err("labels.ts: the self-study share is not taken from its parameter");
  // A row with its own self-study amount (E4, self_study_fee) passes a null share: no percentage shown.
  const p4142 = { kind: "paper" as const, short: "Paper 41/42", codes: ["0970/41"] };
  const nullShare = {
    en: optionLabel(p4142, CELL_OPTIONS.retakeSelfStudy, { selfStudyShare: null, lang: "en" }),
    ar: optionLabel(p4142, CELL_OPTIONS.retakeSelfStudy, { selfStudyShare: null, lang: "ar" }),
  };
  if (nullShare.en !== "Retake · self study · Paper 41/42 only") err(`labels.ts: a null share reads '${nullShare.en}', not plain "self study"`);
  if (nullShare.ar !== "إعادة · دراسة ذاتية · الورقة 41/42 فقط") err(`labels.ts: a null share reads '${nullShare.ar}' in Arabic, not plain "دراسة ذاتية"`);
  // The jargon finder catches plurals and Arabic attached forms (F3), and nothing in plain wording.
  for (const text of ["Sittings", "two components", "the Awards", "syllabi", "syllabuses", "the June series", "option codes", "cash-ins",
    "الدورة", "للدورة", "بالدورة", "والدورة", "دورات", "دورتها", "دوراتها", "السلسلة", "المكونات", "مكوّنات", "مكوناتها"]) {
    if (familyJargonIn(text).length === 0) err(`labels.ts: familyJargonIn misses '${text}'`);
  }
  for (const text of ["First entry · in school · all papers", "Retake · self study 50% · A.2. (carry forward)", "International A Level (YAA01)",
    "إعادة · دراسة ذاتية 50% · A.2. (نقل نتيجة)", "قيد أول · في المدرسة · المستوى A الدولي (YAA01)", "الدوري", "دور"]) {
    if (familyJargonIn(text).length) err(`labels.ts: familyJargonIn flags plain wording '${text}' (${familyJargonIn(text).join(", ")})`);
  }
  for (const l of WINTER_2026_LINKS_SHEET) {
    if (!subjectOf(l.board, l.subject)) err(`the November 2026 / January 2027 links sheet's '${l.row}' (${l.board} ${l.subject}) is not in the reference`);
  }

  // ── The school's fee lists ──
  const feeRowMatch = new Map<string, { list: FeeList; printed: string; amount: number; toCheck: boolean }[]>();
  let feeRows = 0;
  for (const list of SCHOOL_FEE_LISTS) {
    const board = boardOf.get(list.board);
    if (!board) {
      err(`fee list ${list.name}: no board ${list.board}`);
      continue;
    }
    for (const fr of list.rows) {
      feeRows++;
      const hits = matchPrintedCode(fr.printed, board, subjects[list.board]);
      if (hits.length !== 1) {
        err(`fee list ${list.name}: '${fr.printed}' (${fr.name}) reaches ${hits.length} rows${hits.length ? `: ${hits.map((h) => `${h.subject}/${h.row}`).join(", ")}` : ""}`);
        continue;
      }
      const k = `${list.board}|${hits[0]!.subject}|${hits[0]!.row}`;
      const seen = feeRowMatch.get(k) ?? [];
      if (seen.some((x) => x.list.name === list.name)) err(`fee list ${list.name}: two printed rows reach ${hits[0]!.subject}/${hits[0]!.row}`);
      seen.push({ list, printed: fr.printed, amount: fr.amount, toCheck: !!hits[0]!.toCheck });
      feeRowMatch.set(k, seen);
      if (hits[0]!.toCheck) warn(`fee list ${list.name}: '${fr.printed}' ${fr.amount} reaches ${hits[0]!.subject}/${hits[0]!.row} only through an alias to check — ${hits[0]!.note}`);
    }
  }
  const listFee = (board: ReferenceBoardCode, subject: string, row: string, listName: string) =>
    feeRowMatch.get(`${board}|${subject}|${row}`)?.find((x) => x.list.name === listName);

  // ── The June 2027 pre-load ──
  const session: SittingRef = { month: 6, year: seed.session.year };
  if (seed.session.type !== "june") err(`the pre-load is a ${seed.session.type} session, not June`);
  if (JSON.stringify(seed.session.refundPolicy) !== JSON.stringify(DEFAULT_REFUND_POLICIES.june)) err("the pre-load's refund policy is not C7's June default");
  if (seed.session.selfStudyPercent !== 50) err(`the pre-load's self-study share is ${seed.session.selfStudyPercent}, not 50`);
  if (seed.offerings.length !== 25) err(`the pre-load has ${seed.offerings.length} offerings; §8 has 25`);
  for (const k of ["closesAt", "paymentDueAt", "courseStartsOn"] as const) {
    if (seed.session[k] !== null) err(`the pre-load sets ${k}; §8 pre-loads no date`);
  }
  for (const o of seed.offerings) {
    if (o.courseFee !== null || o.rows.some((r) => r.courseFee !== null)) err(`pre-load #${o.order}: a course fee is set; §8 pre-loads none (Q1)`);
  }

  const usedKeys = new Set<string>();
  const boardsUsed = new Set<ReferenceBoardCode>();
  let lastGroup = -1;
  let seedRows = 0;
  for (const o of seed.offerings) {
    const where = `pre-load #${o.order} (${o.board} ${o.subject})`;
    const subject = subjectOf(o.board, o.subject);
    const board = boardOf.get(o.board)!;
    boardsUsed.add(o.board);
    if (!subject) {
      err(`${where}: no such reference subject`);
      continue;
    }
    const g = GROUP_ORDER.indexOf(subject.group);
    if (g < lastGroup) err(`${where}: an ${subject.group} subject after an A.S./A.L. one, against D10`);
    lastGroup = Math.max(lastGroup, g);
    for (const t of o.teachers) usedKeys.add(t.key);
    for (const f of o.flags) for (const k of teacherPlaceholdersIn(f)) usedKeys.add(k);

    const order = subject.rows.map((r) => r.key);
    let lastIndex = -1;
    for (const r of o.rows) {
      seedRows++;
      const ref = subject.rows.find((x) => x.key === r.key);
      const rw = `${where} row ${r.key}`;
      if (!ref) {
        err(`${rw}: not a row of ${subject.code}`);
        continue;
      }
      const idx = order.indexOf(r.key);
      if (idx < lastIndex) err(`${rw}: out of the reference's (D10) order`);
      lastIndex = idx;
      for (const t of r.teachers ?? []) usedKeys.add(t.key);

      // Carried-from sittings: exactly where the board asks (D6).
      const asks = ref.kind === "a2" || (ref.kind === "paper" && board.onePaperAsksSitting);
      const retakes = r.cells.retakeInSchool || r.cells.retakeSelfStudy;
      if (asks && (retakes || ref.kind === "a2") && r.allowedPriorSittings === null) err(`${rw}: ${board.code} asks which earlier exam it carries from, and the row has no list`);
      if (!asks && r.allowedPriorSittings !== null) err(`${rw}: ${board.code} does not ask an earlier exam for a ${ref.kind} row`);
      for (const p of r.allowedPriorSittings ?? []) {
        if (!board.sittings.some((s) => s.month === p.month && s.year === p.year)) err(`${rw}: carried from ${sittingName(p)}, which ${board.code} does not list`);
        if (monthsBetween(p, session) <= 0) err(`${rw}: carried from ${sittingName(p)}, not before ${sittingName(session)}`);
        if (board.carryForwardMonths !== null && monthsBetween(p, session) > board.carryForwardMonths) {
          warn(`${rw}: carried from ${sittingName(p)}, ${monthsBetween(p, session)} months before ${sittingName(session)} (${board.code} allows ${board.carryForwardMonths}): kept, her list wins (D6)`);
        }
      }

      // Exam fee and its source (E5, §6).
      if (r.examFee === null) continue;
      if (!SCHOOL_FEE_LISTS.some((l) => l.name === r.examFeeList && l.board === o.board)) {
        err(`${rw}: exam fee from '${r.examFeeList}', which is not one of the school's ${o.board} lists`);
        continue;
      }
      if (r.examFeeSource === "list") {
        const hit = listFee(o.board, subject.code, r.key, r.examFeeList!);
        if (!hit) err(`${rw}: '${r.examFeeList}' has no row for ${subject.code}/${r.key}`);
        else if (hit.toCheck) err(`${rw}: the fee comes from '${hit.printed}', a match still to check`);
        else if (hit.amount !== r.examFee) err(`${rw}: exam fee ${r.examFee}, the list's '${hit.printed}' says ${hit.amount}`);
      } else if (r.examFeeSource === "units_sum") {
        if (!ref.sumOfUnits) err(`${rw}: a sum, but the reference row sums nothing`);
        else {
          let sum = 0;
          for (const k of ref.sumOfUnits) {
            const hit = listFee(o.board, subject.code, k, r.examFeeList!);
            if (!hit) err(`${rw}: '${r.examFeeList}' has no row for ${subject.code}/${k}`);
            else if (hit.toCheck) err(`${rw}: the sum takes '${hit.printed}', a match still to check`);
            else sum += hit.amount;
          }
          if (sum !== r.examFee) err(`${rw}: exam fee ${r.examFee}, the sum of ${ref.sumOfUnits.join(" + ")} is ${sum}`);
        }
      } else if (r.examFeeSource === "board_rule") {
        const whole = o.rows.find((x) => subject.rows.find((y) => y.key === x.key)?.kind === "all_papers");
        if (ref.kind !== "paper" || board.onePaperFee !== "syllabus") err(`${rw}: the board rule prices a one-paper row of a syllabus-priced board only`);
        else if (!whole || whole.examFee !== r.examFee || whole.examFeeList !== r.examFeeList) err(`${rw}: by ${board.code}'s rule the fee is the syllabus's (the all-papers row's), ${whole?.examFee ?? "absent"}`);
      } else {
        warn(`${rw}: exam fee typed (${r.examFee})`);
      }
    }
  }

  // The sitting each board used would sit in, and whether it can open (C6).
  for (const code of boardsUsed) {
    const s = boardOf.get(code)!.sittings.find((x) => x.month === 6 && x.year === seed.session.year);
    if (!s) err(`${code} lists no June ${seed.session.year} sitting, which the pre-load uses`);
    else if (s.entryDeadline === null) warn(`${code} June ${seed.session.year}: no entry deadline yet (${s.confirmed ? "confirmed?" : "unconfirmed"}): the session cannot open until it is entered`);
  }

  // Teachers: placeholders only; the local file names them all.
  if (teachers) {
    for (const k of usedKeys) if (!teachers[k]) err(`the local teachers file has no name for ${k}`);
    for (const k of Object.keys(teachers)) if (!usedKeys.has(k)) warn(`the local teachers file names ${k}, which the pre-load does not use`);
  } else {
    warn("packages/db/seeds/local/june-2027.teachers.json is absent: teachers stay placeholders and the name scan is skipped");
  }
  for (const issue of personalDataIssues(teachers)) err(issue);

  const unconfirmed = boards.flatMap((b) => subjects[b.code].filter((s) => !s.confirmed).map((s) => `${b.code} ${s.code} ${s.name} (${s.group})`));
  const openSittings = boards.flatMap((b) => b.sittings.filter((s) => !s.confirmed).map((s) => `${b.code} ${sittingName(s)}`));

  console.log("reference:check");
  console.log(`  boards ${boards.length}; subjects ${boards.reduce((n, b) => n + subjects[b.code].length, 0)}; rows ${rowCount}`);
  console.log(`  fee-list rows ${feeRows} in ${SCHOOL_FEE_LISTS.length} lists, each reaching exactly one row unless listed below`);
  console.log(`  pre-load: ${seed.offerings.length} offerings, ${seedRows} rows`);
  console.log(`  codes to check (${unconfirmed.length}): ${unconfirmed.join("; ")}`);
  console.log(`  sittings without a confirmed deadline (${openSittings.length}): ${openSittings.join("; ")}`);
  for (const w of warnings) console.log(`  warning: ${w}`);
  if (errors.length) {
    console.log(`FAILED — ${errors.length} error(s):`);
    for (const e of errors) console.log(`  error: ${e}`);
    return 1;
  }
  console.log("OK");
  return 0;
}

/**
 * With a database (DATABASE_URL), the deadlines the admin entered from the check list (C6, dates_source
 * 'admin') that the files now give differently: warned, never failed — the loader keeps the admin's, and
 * someone checks which is right. Without one (CI's check runs before any database), skipped.
 */
async function adminDates(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) return;
  const { connectTo } = await import("../src/scratch");
  const { adminDateDisagreements } = await import("../src/reference");
  const db = connectTo(url);
  try {
    const kept = await db.query<{ board_code: string; month: string; year: number; entry_deadline: Date | null; retake_deadline: Date | null }>(
      `select board_code, month, year, entry_deadline, retake_deadline from board_series where label = '' and dates_source = 'admin'`);
    const monthNumber: Record<string, number> = { january: 1, june: 6, october: 10, november: 11 };
    const { boards } = loadReferenceFiles();
    const found = kept.flatMap((k) => {
      const s = boards.find((b) => b.code === k.board_code)?.sittings.find((x) => x.month === monthNumber[k.month] && x.year === k.year);
      return s ? adminDateDisagreements(`${k.board_code} ${k.month} ${k.year}`, { entry: k.entry_deadline, retake: k.retake_deadline }, { entry: s.entryDeadline, retake: s.retakeDeadline }) : [];
    });
    console.log(`  admin-entered deadlines (C6): ${kept.length}, ${found.length} the files give differently`);
    for (const w of found) console.log(`  warning: ${w}`);
  } catch (e) {
    console.log(`  admin-entered deadlines (C6): skipped (${(e as Error).message})`);
  } finally {
    await db.end();
  }
}

const code = main();
if (code === 0) await adminDates();
process.exit(code);
