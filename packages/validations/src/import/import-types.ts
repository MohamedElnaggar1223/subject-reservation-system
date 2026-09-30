/**
 * The shapes the day-one import's review answers with (F7), declared here so
 * the web app can name them through the RPC client: a type the API declares
 * in its own files cannot be named by the web's declaration output (TS2742 —
 * F0a moved its eligibility answer here for the same reason). The API's
 * readers (apps/api/src/services/import) build these; nothing here is an
 * input schema.
 */
import type { ImportProblemCode, ImportSeverity, MoneyHistoryKind } from './import.validations';

export type ImportSeriesType = 'january' | 'june' | 'october' | 'november';
export type ImportSeries = { type: ImportSeriesType; year: number };
export type ImportLevelFamily = 'igcse' | 'as' | 'a2' | 'al' | 'combined';

/** A problem as a line's reading finds it (its severity is the registry's unless it says otherwise). */
export type ImportLineProblem = { code: ImportProblemCode; severity?: ImportSeverity; detail?: string };

/** A line of the school's registration sheet, read. */
export type ImportSheetLine = {
  kind: 'sheet';
  studentName: string;
  studentEmail: string;
  studentEmailOk: boolean;
  studentPhone: string | null;
  parentName: string;
  parentEmail: string;
  parentEmailOk: boolean;
  parentPhone: string | null;
  noParent: boolean;
  classText: string;
  grade: number | null;
  section: string | null;
  levelText: string;
  levelCode: string | null;
  levelFamily: ImportLevelFamily | null;
  subject: string;
  isUnit: boolean;
  teacher: string | null;
  series: ImportSeries | null;
  seriesSource: 'column' | 'title' | 'edit' | null;
  confirm: 'confirm' | 'drop_intent' | null;
  selfStudy: boolean;
  selfStudyChoice: 'in_school' | 'enrol_only' | null;
  feeNote: string | null;
  feeKind: MoneyHistoryKind | null;
  feePercent: number | null;
  carryForwardFrom: string | null;
  carryForwardNote: string | null;
  local: ImportLineProblem[];
};

export type ImportSclParent = { name: string; email: string; emailOk: boolean; phone: string | null };

/** A line of SCL's grade-9 roster, read. */
export type ImportSclLine = {
  kind: 'scl';
  studentName: string;
  studentEmail: string;
  studentEmailOk: boolean;
  studentPhone: string | null;
  sclId: string | null;
  grade: number | null;
  section: string | null;
  parents: ImportSclParent[];
  noParent: boolean;
  local: ImportLineProblem[];
};

/** A line of the money record, read. */
export type ImportMoneyLine = {
  kind: 'money';
  studentRef: string;
  happenedOn: string | null;
  amount: number | null;
  direction: 'in' | 'out' | null;
  moneyKind: MoneyHistoryKind;
  percent: number | null;
  method: string | null;
  receiptNumber: string | null;
  seriesLabel: string | null;
  subject: string | null;
  note: string | null;
  local: ImportLineProblem[];
};

export type ImportLineData = ImportSheetLine | ImportSclLine | ImportMoneyLine;

/** A line as the review shows it: what was read, without the reading's working list. */
export type ImportLineView = Omit<ImportSheetLine, 'local'> | Omit<ImportSclLine, 'local'> | Omit<ImportMoneyLine, 'local'>;

export type ImportSourceTabKind = 'session' | 'roster' | 'other';

/** A tab of the file, as read. */
export type ImportSourceTab = {
  name: string;
  kind: ImportSourceTabKind;
  title: string;
  headerRow: number;
  columns: string[];
  lines: number;
};

/** A problem as the review shows it. */
export type ImportViewProblem = { code: ImportProblemCode; severity: ImportSeverity; detail: string | null };

/** What a commit would do with a row. */
export type ImportRowPlan = {
  student: 'create' | 'match' | 'none';
  parents: ('create' | 'match')[];
  links: ('create' | 'exists')[];
  section: 'add' | 'exists' | 'keep' | 'none';
  enrolment: 'create' | 'exists' | 'none';
  registration: 'live' | 'live_exists' | 'history' | 'history_exists' | 'none';
  money: 'create' | 'exists' | 'none';
};
