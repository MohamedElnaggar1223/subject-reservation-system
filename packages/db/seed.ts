/**
 * Database Seed Script
 *
 * Populates the database with realistic IGCSE subjects, sample registration
 * sessions, and promotes an admin user.
 *
 * Usage:  npx tsx seed.ts
 * Or via: pnpm seed  (see package.json)
 *
 * Safe to run multiple times -- uses upsert (ON CONFLICT DO UPDATE) so
 * existing rows are updated rather than duplicated.
 */

import { config } from "dotenv";
// Load env BEFORE any db module is imported (ES module hoisting workaround)
config();
config({ path: "../../apps/api/.env" });

// Dynamic import so the Pool is created AFTER DATABASE_URL is set
const { db, subject, registrationSession, user, eq } = await import("./src/index");

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/**
 * Placeholder board entry fee per subject (EGP) used to split each seeded
 * price into courseFee + registrationFee. Real values come from the
 * school's fee list (DISCOVERY.md F-02).
 */
const SEED_REGISTRATION_FEE = 300;

/** Generate a deterministic text ID from a prefix + code for idempotency. */
function subjectId(code: string): string {
  return `subj_${code}`;
}

function sessionId(slug: string): string {
  return `sess_${slug}`;
}

/* ------------------------------------------------------------------ */
/*  Subject seed data                                                  */
/* ------------------------------------------------------------------ */

interface SubjectSeed {
  id: string;
  name: string;
  code: string;
  council: string;
  priceInSchool: number;
  isOfferedAtSchool: boolean;
  customPrice: number | null;
  isCore: boolean;
  isActive: boolean;
}

const subjects: SubjectSeed[] = [
  // ── Core subjects (Grade 10 mandatory) ──────────────────────────
  {
    id: subjectId("0500"),
    name: "English Language",
    code: "0500",
    council: "cambridge",
    priceInSchool: 1500.00,
    isOfferedAtSchool: true,
    customPrice: null,
    isCore: true,
    isActive: true,
  },
  {
    id: subjectId("0580"),
    name: "Mathematics",
    code: "0580",
    council: "cambridge",
    priceInSchool: 1500.00,
    isOfferedAtSchool: true,
    customPrice: null,
    isCore: true,
    isActive: true,
  },
  {
    id: subjectId("0544"),
    name: "Arabic Language",
    code: "0544",
    council: "cambridge",
    priceInSchool: 1200.00,
    isOfferedAtSchool: true,
    customPrice: null,
    isCore: true,
    isActive: true,
  },

  // ── Elective subjects ───────────────────────────────────────────
  {
    id: subjectId("0625"),
    name: "Physics",
    code: "0625",
    council: "cambridge",
    priceInSchool: 1500.00,
    isOfferedAtSchool: true,
    customPrice: null,
    isCore: false,
    isActive: true,
  },
  {
    id: subjectId("0620"),
    name: "Chemistry",
    code: "0620",
    council: "cambridge",
    priceInSchool: 1500.00,
    isOfferedAtSchool: true,
    customPrice: null,
    isCore: false,
    isActive: true,
  },
  {
    id: subjectId("0610"),
    name: "Biology",
    code: "0610",
    council: "cambridge",
    priceInSchool: 1500.00,
    isOfferedAtSchool: true,
    customPrice: null,
    isCore: false,
    isActive: true,
  },
  {
    id: subjectId("0478"),
    name: "Computer Science",
    code: "0478",
    council: "cambridge",
    priceInSchool: 1500.00,
    isOfferedAtSchool: true,
    customPrice: null,
    isCore: false,
    isActive: true,
  },
  {
    id: subjectId("0450"),
    name: "Business Studies",
    code: "0450",
    council: "cambridge",
    priceInSchool: 1400.00,
    isOfferedAtSchool: true,
    customPrice: null,
    isCore: false,
    isActive: true,
  },
  {
    id: subjectId("0455"),
    name: "Economics",
    code: "0455",
    council: "cambridge",
    priceInSchool: 1400.00,
    isOfferedAtSchool: true,
    customPrice: null,
    isCore: false,
    isActive: true,
  },
  {
    id: subjectId("0470"),
    name: "History",
    code: "0470",
    council: "cambridge",
    priceInSchool: 1400.00,
    isOfferedAtSchool: true,
    customPrice: null,
    isCore: false,
    isActive: true,
  },
  {
    id: subjectId("0460"),
    name: "Geography",
    code: "0460",
    council: "cambridge",
    priceInSchool: 1400.00,
    isOfferedAtSchool: true,
    customPrice: null,
    isCore: false,
    isActive: true,
  },
  {
    id: subjectId("0400"),
    name: "Art & Design",
    code: "0400",
    council: "cambridge",
    priceInSchool: 1600.00,
    isOfferedAtSchool: true,
    customPrice: null,
    isCore: false,
    isActive: true,
  },
  {
    id: subjectId("0520"),
    name: "French",
    code: "0520",
    council: "cambridge",
    priceInSchool: 1300.00,
    isOfferedAtSchool: false,
    customPrice: 1800.00,
    isCore: false,
    isActive: true,
  },
  {
    id: subjectId("0452"),
    name: "Accounting",
    code: "0452",
    council: "cambridge",
    priceInSchool: 1400.00,
    isOfferedAtSchool: true,
    customPrice: null,
    isCore: false,
    isActive: true,
  },
  {
    id: subjectId("0417"),
    name: "Information and Communication Technology",
    code: "0417",
    council: "cambridge",
    priceInSchool: 1500.00,
    isOfferedAtSchool: true,
    customPrice: null,
    isCore: false,
    isActive: true,
  },
  {
    id: subjectId("0680"),
    name: "Environmental Management",
    code: "0680",
    council: "cambridge",
    priceInSchool: 1300.00,
    isOfferedAtSchool: false,
    customPrice: 1700.00,
    isCore: false,
    isActive: true,
  },
  {
    id: subjectId("0413"),
    name: "Physical Education",
    code: "0413",
    council: "cambridge",
    priceInSchool: 1200.00,
    isOfferedAtSchool: true,
    customPrice: null,
    isCore: false,
    isActive: true,
  },
];

/* ------------------------------------------------------------------ */
/*  Registration session seed data                                     */
/* ------------------------------------------------------------------ */

interface SessionSeed {
  id: string;
  name: string;
  sessionType: string;
  startDate: Date;
  endDate: Date;
  status: string;
}

const sessions: SessionSeed[] = [
  {
    id: sessionId("june-2026"),
    name: "June 2026",
    sessionType: "june",
    startDate: new Date("2026-02-01T00:00:00Z"),
    endDate: new Date("2026-04-30T23:59:59Z"),
    status: "active",
  },
  {
    id: sessionId("november-2026"),
    name: "November 2026",
    sessionType: "november",
    startDate: new Date("2026-07-01T00:00:00Z"),
    endDate: new Date("2026-09-30T23:59:59Z"),
    status: "draft",
  },
];

/* ------------------------------------------------------------------ */
/*  Main seed function                                                 */
/* ------------------------------------------------------------------ */

async function seed() {
  console.log("--- Starting database seed ---\n");

  // ── 1. Upsert subjects ───────────────────────────────────────────
  console.log(`Seeding ${subjects.length} subjects...`);
  for (const s of subjects) {
    // V3 fee split (RF-01): the pricing engine reads courseFee +
    // registrationFee, never priceInSchool. Without these two columns every
    // seeded subject prices at 0 EGP. priceInSchool stays as the legacy
    // total; the split below is a placeholder until the school's real fee
    // list arrives (DISCOVERY.md F-02).
    const fees = {
      courseFee: s.priceInSchool - SEED_REGISTRATION_FEE,
      registrationFee: SEED_REGISTRATION_FEE,
    };
    // Subjects belong to the admins once they exist (the same rule RF-02
    // applies to sessions): every column here — fees, custom price, core flag,
    // active flag — is editable in the app, so a re-run must not touch an
    // existing row. It only creates the ones that are missing. A subject an
    // old seed left priced at zero is repaired in the admin UI, not by re-running.
    await db
      .insert(subject)
      .values({ ...s, ...fees })
      .onConflictDoNothing({ target: subject.code });
    console.log(`  [subject] ${s.code} - ${s.name} (created if missing)`);
  }
  console.log("");

  // ── 2. Upsert registration sessions ──────────────────────────────
  console.log(`Seeding ${sessions.length} registration sessions...`);
  for (const sess of sessions) {
    await db
      .insert(registrationSession)
      .values({
        ...sess,
        editHistory: [],
      })
      // Sessions belong to the admins once they exist (RF-02): the seed
      // creates missing ones and never touches a live one. Re-running the
      // seed used to reset a closed window back to 'active' and an
      // activated one back to 'draft'.
      .onConflictDoNothing({ target: registrationSession.id });
    console.log(`  [session] ${sess.name} (${sess.sessionType}) - ${sess.status} (created if missing)`);
  }
  console.log("");

  // ── 3. Promote admin user (if the account already exists) ────────
  const adminEmail = "admin@igcse.local";
  console.log(`Looking for user ${adminEmail} to promote to admin...`);

  const existing = await db
    .select({ id: user.id, role: user.role })
    .from(user)
    .where(eq(user.email, adminEmail))
    .limit(1);

  if (existing.length > 0) {
    if (existing[0].role === "admin") {
      console.log(`  User ${adminEmail} is already an admin. Skipping.`);
    } else {
      await db
        .update(user)
        .set({ role: "admin" })
        .where(eq(user.email, adminEmail));
      console.log(`  Promoted ${adminEmail} to admin.`);
    }
  } else {
    console.log(`  User ${adminEmail} does not exist yet. Skipping promotion.`);
    console.log("  (Create the account via the app first, then re-run this seed.)");
  }

  console.log("\n--- Seed complete ---");
}

/* ------------------------------------------------------------------ */
/*  Run                                                                */
/* ------------------------------------------------------------------ */

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  });
