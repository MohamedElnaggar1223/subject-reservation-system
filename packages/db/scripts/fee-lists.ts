/**
 * The school's own fee lists (COORDINATOR_REWORK.md §1; SCHOOL_FORMS.md §3), transcribed row by
 * row from the PDFs the owner shared on 7 October 2026 (read with `pdftotext -layout`; the PDFs
 * themselves stay out of the repository). Codes and amounts exactly as printed, EGP; the subject
 * name as printed. `reference:check` holds every row to exactly one reference row through the
 * rows' priceCodes and the boards' aliases, and every list-sourced exam fee of the June 2027
 * pre-load to the amount here.
 */

import type { ReferenceBoardCode } from "@repo/validations";

export type FeeListRow = { printed: string; name: string; amount: number; note?: string };
export type FeeList = { name: string; board: ReferenceBoardCode; heading: string; rows: FeeListRow[] };

export const SCHOOL_FEE_LISTS: FeeList[] = [
  {
    name: "Cambridge June 2026",
    board: "cambridge",
    heading: "Cambridge Registration Fees - June 2026 (Year 11 & 12)",
    rows: [
      { printed: "3180 A", name: "IGCSE ARABIC", amount: 9850 },
      { printed: "0970 CX", name: "IGCSE BIOLOGY", amount: 10850 },
      { printed: "0986 AX", name: "IGCSE BUSINESS STUDIES", amount: 9850 },
      { printed: "0971 CX", name: "IGCSE CHEMISTRY", amount: 10850 },
      { printed: "0653 CX", name: "IGCSE COMBINED SCIENCE", amount: 10850 },
      { printed: "0984 AX", name: "IGCSE COMPUTER SCIENCE", amount: 9850 },
      { printed: "7156 X", name: "IGCSE FOREIGN LANGUAGE FRENCH", amount: 12550 },
      { printed: "7159 Y", name: "IGCSE FOREIGN LANGUAGE GERMAN", amount: 12550 },
      { printed: "0983 DY", name: "IGCSE INFORMATION AND COMMUNICATION", amount: 12950 },
      { printed: "0972 CX", name: "IGCSE PHYSICS", amount: 10850 },
      { printed: "9700 S1 / S2", name: "AS Level BIOLOGY", amount: 14100 },
      { printed: "9701 S1 / S2", name: "AS Level CHEMISTRY", amount: 14100 },
      { printed: "9608 SY", name: "AS Level COMPUTER SCIENCE", amount: 11400, note: "the previous syllabus code; the current one is 9618" },
      { printed: "9702 S1 / S2", name: "AS Level PHYSICS", amount: 14100 },
      { printed: "9700 BY / CT", name: "A2 Level BIOLOGY", amount: 11400 },
      { printed: "9701 BY / CT", name: "A2 Level CHEMISTRY", amount: 11400 },
      { printed: "9618 BY / CT", name: "A2 Level COMPUTER SCIENCE", amount: 12450 },
      { printed: "9702 BX / CQ", name: "A2 Level PHYSICS", amount: 11400 },
      { printed: "9700 AX / HX", name: "A Level BIOLOGY", amount: 18600 },
      { printed: "9701 AX / HX", name: "A Level CHEMISTRY", amount: 18600 },
      { printed: "9618 AY", name: "A Level COMPUTER SCIENCE", amount: 16950 },
      { printed: "9702 AX / HX", name: "A Level PHYSICS", amount: 18600 },
    ],
  },
  {
    name: "Edexcel June 2026",
    board: "pearson_edexcel",
    heading: "Edexcel June 2026 (Registration Fees Y.11 & 12)",
    rows: [
      { printed: "WAA01", name: "IAL Arabic AL", amount: 8950 },
      { printed: "WAA02", name: "IAL Arabic AL", amount: 9350 },
      { printed: "WMA11", name: "IAL MATHEMATICS ( P1 )", amount: 4800 },
      { printed: "WMA12", name: "IAL MATHEMATICS ( P2 )", amount: 4800 },
      { printed: "WMA13", name: "IAL MATHEMATICS ( P3 )", amount: 4800 },
      { printed: "WMA14", name: "IAL MATHEMATICS ( P4 )", amount: 4800 },
      { printed: "WME01", name: "IAL MATHEMATICS ( M1 )", amount: 4450 },
      { printed: "WME02", name: "IAL MATHEMATICS ( M2 )", amount: 4450 },
      { printed: "WST01", name: "IAL MATHEMATICS ( S1 )", amount: 4450 },
      { printed: "WBI15", name: "IGCSE BIOLOGY (PAPER 5)", amount: 4450, note: "an IAL unit, printed under IGCSE" },
      { printed: "WBI16", name: "IGCSE BIOLOGY (PAPER 6)", amount: 4450, note: "an IAL unit, printed under IGCSE" },
      { printed: "4WM1H", name: "IGCSE MATHEMATICS", amount: 4600, note: "International GCSE Mathematics A Paper 1H (4MA1/1H)" },
      { printed: "4WM2H", name: "IGCSE MATHEMATICS", amount: 4600, note: "International GCSE Mathematics A Paper 2H (4MA1/2H)" },
    ],
  },
  {
    name: "Edexcel January 2026",
    board: "pearson_edexcel",
    heading: "Edexcel January 2026 (Registration Fees), printed 2 Oct 2025",
    rows: [
      { printed: "WBI13", name: "IAL BIOLOGY 3", amount: 4550 },
      { printed: "WBI14", name: "IAL BIOLOGY 4", amount: 4550 },
      { printed: "WMA11", name: "IAL MATHEMATICS ( P1 )", amount: 4910 },
      { printed: "WMA12", name: "IAL MATHEMATICS ( P2 )", amount: 4910 },
      { printed: "WMA13", name: "IAL MATHEMATICS ( P3 )", amount: 4910 },
      { printed: "WMA14", name: "IAL MATHEMATICS ( P4 )", amount: 4910 },
      { printed: "WME01", name: "IAL MATHEMATICS ( M1 )", amount: 4550 },
      { printed: "WST01", name: "IAL MATHEMATICS ( S1 )", amount: 4550 },
    ],
  },
  {
    name: "Edexcel November 2026 (IAL)",
    board: "pearson_edexcel",
    heading: "A.S./A.L. Edexcel Registration fees (November 2026)",
    rows: [
      { printed: "WMA11", name: "IAL PURE MATHEMATICS 1 (P1)", amount: 5140 },
      { printed: "WMA12", name: "IAL PURE MATHEMATICS 2 (P2)", amount: 5140 },
      { printed: "WMA13", name: "IAL PURE MATHEMATICS 3 P3) (RETAKE ONLY)", amount: 5140 },
      { printed: "WMA14", name: "IAL PURE MATHEMATICS 4 (P4) (RETAKE ONLY)", amount: 5140 },
      { printed: "WME01", name: "IAL MECHANICS 1 (M1)", amount: 4790 },
      { printed: "WST01", name: "IAL STATISTICS 1 (S1)", amount: 4790, note: "printed 'WST01 ('" },
      { printed: "WBI11", name: "IAL BIOLOGY 1", amount: 4790 },
      { printed: "WBI12", name: "IAL BIOLOGY 2", amount: 4790 },
      { printed: "WBI13", name: "IAL BIOLOGY 3 (RETAKE ONLY)", amount: 4790 },
      { printed: "WBI14", name: "IAL BIOLOGY 4 (RETAKE ONLY)", amount: 4790 },
    ],
  },
  {
    name: "Edexcel November 2026 (International GCSE)",
    board: "pearson_edexcel",
    heading: "Edexcel November 2026 (Registration Fees)",
    rows: [
      { printed: "4HB1", name: "IGCSE Human Biology", amount: 9840 },
      { printed: "4MA1H", name: "IGCSE MATHEMATICS", amount: 9840 },
      { printed: "4MA2H", name: "IGCSE MATHEMATICS", amount: 9840 },
    ],
  },
];

/** The November 2026 / January 2027 links sheet (18 rows): every subject it names must be in the reference. */
export const WINTER_2026_LINKS_SHEET: { row: string; board: ReferenceBoardCode; subject: string }[] = [
  { row: "O.L. 1 Arabic O.L. (Cambridge)", board: "cambridge", subject: "3180" },
  { row: "O.L. 1 Arabic O.L. (one teacher's line says Edexcel)", board: "pearson_edexcel", subject: "4AA1" },
  { row: "O.L. 2 Biology O.L.", board: "cambridge", subject: "0970" },
  { row: "O.L. 3 Chemistry O.L.", board: "cambridge", subject: "0971" },
  { row: "O.L. 4 Combined Science O.L.", board: "cambridge", subject: "0653" },
  { row: "O.L. 5 Computer Science O.L.", board: "cambridge", subject: "0984" },
  { row: "O.L. 6 English (ESL)", board: "oxford", subject: "9280" },
  { row: "O.L. 7 Environmental Management", board: "cambridge", subject: "0680" },
  { row: "O.L. 8 French O.L.", board: "cambridge", subject: "7156" },
  { row: "O.L. 9 Human Biology O.L.", board: "pearson_edexcel", subject: "4HB1" },
  { row: "O.L. 10 ICT O.L.", board: "cambridge", subject: "0983" },
  { row: "O.L. 11 Mathematics O.L.", board: "pearson_edexcel", subject: "4MA1" },
  { row: "O.L. 12 Physics O.L.", board: "cambridge", subject: "0972" },
  { row: "O.L. 13 Psychology O.L.", board: "oxford", subject: "9218" },
  { row: "A.S./A.L. 1 Arabic A.L. (Edexcel IAL)", board: "pearson_edexcel", subject: "YAA01" },
  { row: "A.S./A.L. 2 Biology A.S./A.L. (Edexcel IAL)", board: "pearson_edexcel", subject: "YBI11" },
  { row: "A.S./A.L. 3 Computer Science A.S./A.L.", board: "cambridge", subject: "9618" },
  { row: "A.S./A.L. 4 Mathematics A.S./A.L. (Edexcel IAL)", board: "pearson_edexcel", subject: "YMA01" },
  { row: "A.S./A.L. 5 Physics A.S.", board: "cambridge", subject: "9702" },
];
