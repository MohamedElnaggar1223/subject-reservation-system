import { describe, it, expect, beforeAll } from 'vitest';
import { apiResponse, academicYearStartOf } from '@repo/validations';
import { admin, staff, onboard, subject, session, refused, one, sql, audited, futureWindow, lockWaiters, schoolToday, teachOffer, sessionName, type Client, reservationOf } from './helpers';

/** Hold the year's enrolment lock (upsertEnrolments' advisory lock) from outside, so two commits queue behind it together. */
async function holdEnrolmentLock(academicYearId: string): Promise<() => Promise<void>> {
  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await client.query('BEGIN');
  await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [`enrolment:${academicYearId}`]);
  return async () => {
    await client.query('COMMIT');
    await client.end();
  };
}

/**
 * F0b — course enrolment per academic year (FEATURES_PLAN.md F0b).
 *
 * What each student is taught this year, by which teacher, in school or as
 * self-study; created one at a time, carried forward, from registrations
 * (with the teacher each names), a whole section, or rows pasted from a
 * sheet (F7's entry point). Registrations are checked against it — flagged,
 * never blocked. F1 builds teaching groups from it (self-study forms none);
 * F4 takes the student's teacher for forecast grades from it.
 *
 * Windows here are drafts (families preregister): no (type, level) pair is
 * held open.
 */

describe('F0b: course enrolment', () => {
  let adm: Client, coordinator: Client, officer: Client, teacherA: Client, teacherB: Client;
  let tA: string, tB: string, thisYear: string, lastYear: string, section: string, june: string;
  const s: Record<string, { parent: Client; student: Client; studentId: string }> = {};
  const subj: Record<string, string> = {};
  const Y = academicYearStartOf();

  const enrol = (json: { studentId: string; subjectId: string; teacherId?: string | null; mode?: 'in_school' | 'self_study'; academicYearId?: string }) =>
    coordinator.api.v1.enrolments.$post({ json: { academicYearId: thisYear, ...json } });
  const openEnrolments = (studentId: string, yearId = thisYear) =>
    sql<{ subject_id: string; teacher_id: string | null; mode: string; source: string }>(
      `select subject_id, teacher_id, mode, source from course_enrolment where student_id = $1 and academic_year_id = $2 and ended_on is null order by subject_id`,
      [studentId, yearId],
    );

  beforeAll(async () => {
    adm = await admin('enr');
    coordinator = await staff(adm, 'coordinator', 'enr');
    officer = await staff(adm, 'finance_officer', 'enr');
    teacherA = await staff(adm, 'teacher', 'enr-a');
    teacherB = await staff(adm, 'teacher', 'enr-b');
    tA = (await one<{ id: string }>(`select id from teacher where user_id = $1`, [teacherA.id])).id;
    tB = (await one<{ id: string }>(`select id from teacher where user_id = $1`, [teacherB.id])).id;
    for (const [code, name, offered] of [['ENG', 'English', true], ['MAT', 'Mathematics', true], ['BIO', 'Biology', true], ['PHY', 'Physics', false]] as const) {
      subj[code] = await subject(adm, `EN-${code}`, `${name} (enrolment)`, { course: 1000, registration: 500 }, { isOfferedAtSchool: offered });
    }
    // This academic year and the one before, as the coordinator set them up (08f/08g may have).
    const years = await apiResponse(coordinator.api.v1.academic.years.$get());
    thisYear = years.find((y) => y.startYear === Y)?.id
      ?? (await apiResponse(coordinator.api.v1.academic.years.$post({ json: { startYear: Y, startsOn: `${Y}-09-06`, endsOn: `${Y + 1}-06-25` } }))).id;
    lastYear = years.find((y) => y.startYear === Y - 1)?.id
      ?? (await apiResponse(coordinator.api.v1.academic.years.$post({ json: { startYear: Y - 1, startsOn: `${Y - 1}-09-06`, endsOn: `${Y}-06-25` } }))).id;
    for (const tag of ['s1', 's2', 's3', 's5']) s[tag] = await onboard(officer, `enr-${tag}`, 11);
    s.s4 = await onboard(officer, 'enr-s4', 12);
    section = (await apiResponse(coordinator.api.v1.academic.sections.$post({ json: { academicYearId: thisYear, grade: 11, name: 'EN-11A' } }))).id;
    await apiResponse(coordinator.api.v1.academic.sections[':id'].members.$post({
      param: { id: section }, json: { studentIds: [s.s1!.studentId, s.s2!.studentId, s.s3!.studentId] },
    }));
    june = await session(adm, 'June (IGCSE, enrolment)', 'june', 'igcse', futureWindow());
    // Who teaches English and Mathematics this cycle (the reservations rework: a line names one of its offer's teachers).
    await teachOffer(adm, june, subj.ENG!, [tA, tB]);
    await teachOffer(adm, june, subj.MAT!, [tA, tB]);
  });

  describe('one at a time', () => {
    it('a student is enrolled in a subject with a teacher; the teacher becomes linked to the subject', async () => {
      const e = await apiResponse(enrol({ studentId: s.s1!.studentId, subjectId: subj.ENG!, teacherId: tA }));
      expect(e).toMatchObject({ mode: 'in_school', teacherId: tA, source: 'manual', academicYearId: thisYear });
      await audited([e.id], ['ENROLMENT_CREATED']);
      expect(await sql(`select 1 from subject_teacher where subject_id = $1 and teacher_id = $2`, [subj.ENG!, tA])).toHaveLength(1);
      expect(await refused(enrol({ studentId: s.s1!.studentId, subjectId: subj.ENG!, teacherId: tB }))).toEqual({
        status: 409, error: 'This student is already enrolled in that subject this year',
      });
    });

    it('what cannot be taught is refused with a sentence; self-study has no teacher', async () => {
      expect((await refused(enrol({ studentId: s.s1!.studentId, subjectId: subj.MAT!, teacherId: tA, mode: 'self_study' }))).status).toBe(400);
      expect(await refused(enrol({ studentId: s.s1!.studentId, subjectId: subj.PHY!, teacherId: tA }))).toEqual({
        status: 400, error: 'The school does not teach Physics (enrolment) — enrol it as self-study',
      });
      const phy = await apiResponse(enrol({ studentId: s.s1!.studentId, subjectId: subj.PHY!, mode: 'self_study' }));
      expect(phy).toMatchObject({ mode: 'self_study', teacherId: null });
      // The database holds it too: self-study is not taught.
      await expect(sql(`update course_enrolment set teacher_id = $1 where id = $2`, [tA, phy.id])).rejects.toThrow();
    });

    it('the teacher or mode changes in place; an enrolment ends with a reason and stays as history', async () => {
      const bio = await apiResponse(enrol({ studentId: s.s1!.studentId, subjectId: subj.BIO!, teacherId: tB }));
      const self = await apiResponse(coordinator.api.v1.enrolments[':id'].$put({ param: { id: bio.id }, json: { mode: 'self_study' } }));
      expect(self).toMatchObject({ mode: 'self_study', teacherId: null });
      await apiResponse(coordinator.api.v1.enrolments[':id'].$put({ param: { id: bio.id }, json: { mode: 'in_school', teacherId: tB } }));
      const ended = await apiResponse(coordinator.api.v1.enrolments[':id'].end.$post({ param: { id: bio.id }, json: { reason: 'dropped Biology in October' } }));
      expect(ended).toMatchObject({ endReason: 'dropped Biology in October', endedOn: schoolToday() });
      await audited([bio.id], ['ENROLMENT_CREATED', 'ENROLMENT_UPDATED', 'ENROLMENT_UPDATED', 'ENROLMENT_ENDED']);
      expect(await refused(coordinator.api.v1.enrolments[':id'].end.$post({ param: { id: bio.id }, json: { reason: 'again' } }))).toEqual({ status: 409, error: 'This enrolment already ended' });
      const all = await apiResponse(coordinator.api.v1.enrolments.$get({ query: { academicYearId: thisYear, studentId: s.s1!.studentId, includeEnded: 'true' } }));
      expect(all.find((x) => x.id === bio.id)).toMatchObject({ endReason: 'dropped Biology in October', section: { name: 'EN-11A' }, gradeThatYear: 11 });
      expect((await apiResponse(coordinator.api.v1.enrolments.$get({ query: { academicYearId: thisYear, studentId: s.s1!.studentId } }))).some((x) => x.id === bio.id)).toBe(false);
    });

    it('a student who leaves the school stops being taught: their enrolments end with the leaving, and new ones are refused', async () => {
      await apiResponse(enrol({ studentId: s.s5!.studentId, subjectId: subj.ENG!, teacherId: tA }));
      await apiResponse(coordinator.api.v1.students[':id'].leave.$post({
        param: { id: s.s5!.studentId }, json: { kind: 'withdrawn', leftOn: schoolToday(), reason: 'family moved abroad' },
      }));
      expect(await openEnrolments(s.s5!.studentId)).toEqual([]);
      expect((await one<{ reason: string }>(`select end_reason as reason from course_enrolment where student_id = $1`, [s.s5!.studentId])).reason).toBe('Left the school (withdrawn)');
      expect(await refused(enrol({ studentId: s.s5!.studentId, subjectId: subj.MAT!, teacherId: tA }))).toEqual({ status: 400, error: 'Student enr-s5 has left the school' });
    });
  });

  describe('in bulk', () => {
    it('an enrolment carried forward: last year\'s subjects, teachers and modes, previewed, then committed once', async () => {
      // Last year (grade 10): s2 was taught English by A and Mathematics by B; s3 studied Mathematics alone.
      for (const [st, subjectId, teacherId, mode] of [
        [s.s2!, subj.ENG!, tA, 'in_school'], [s.s2!, subj.MAT!, tB, 'in_school'], [s.s3!, subj.MAT!, null, 'self_study'],
      ] as const) {
        await apiResponse(enrol({ academicYearId: lastYear, studentId: st.studentId, subjectId, teacherId, mode }));
      }
      const carry = (commit: boolean) => coordinator.api.v1.enrolments.bulk.$post({
        json: {
          academicYearId: thisYear, source: 'previous_enrolment', studentIds: [s.s2!.studentId, s.s3!.studentId],
          // English is a one-year course here: it does not continue.
          subjectMap: [{ from: subj.ENG!, to: null }], exclude: [], commit,
        },
      });
      const preview = await apiResponse(carry(false));
      expect(preview).toMatchObject({ committed: false, summary: { toCreate: 2, created: 0, existing: 0, refused: 0 } });
      expect(preview.rows.map((r) => [r.studentName, r.subjectName, r.teacherName, r.mode, r.outcome]).sort()).toEqual([
        ['Student enr-s2', 'Mathematics (enrolment)', 'teacher enr-b', 'in_school', 'create'],
        ['Student enr-s3', 'Mathematics (enrolment)', null, 'self_study', 'create'],
      ]);
      expect(await openEnrolments(s.s2!.studentId)).toEqual([]);

      const committed = await apiResponse(carry(true));
      expect(committed.summary).toEqual({ toCreate: 0, created: 2, existing: 0, refused: 0 });
      expect(await openEnrolments(s.s2!.studentId)).toEqual([{ subject_id: subj.MAT!, teacher_id: tB, mode: 'in_school', source: 'carried_forward' }]);
      expect(await openEnrolments(s.s3!.studentId)).toEqual([{ subject_id: subj.MAT!, teacher_id: null, mode: 'self_study', source: 'carried_forward' }]);
      await audited([thisYear], ['ENROLMENTS_BULK_CREATED']);
      // Running it again creates nothing.
      expect((await apiResponse(carry(true))).summary).toEqual({ toCreate: 0, created: 0, existing: 2, refused: 0 });
    });

    it('from registrations: the teacher each registration names, and self-study where it was taken outside school', async () => {
      // s3 preregisters English with teacher A, and Physics (not taught here, so outside school).
      await apiResponse(s.s3!.parent.api.v1.registrations.preregister.$post({
        json: { sessionId: june, ...(await reservationOf(june, [subj.ENG!, subj.PHY!], { teachers: { [subj.ENG!]: tA } })), studentId: s.s3!.studentId },
      }));
      const r = await apiResponse(coordinator.api.v1.enrolments.bulk.$post({
        json: { academicYearId: thisYear, source: 'registrations', studentIds: [s.s3!.studentId], subjectMap: [], exclude: [], commit: true },
      }));
      expect(r.summary).toMatchObject({ created: 2 });
      expect(await openEnrolments(s.s3!.studentId)).toEqual([
        { subject_id: subj.ENG!, teacher_id: tA, mode: 'in_school', source: 'registrations' },
        { subject_id: subj.MAT!, teacher_id: null, mode: 'self_study', source: 'carried_forward' },
        { subject_id: subj.PHY!, teacher_id: null, mode: 'self_study', source: 'registrations' },
      ].sort((a, b) => a.subject_id.localeCompare(b.subject_id)));
    });

    it('a whole section at once, with one teacher per subject', async () => {
      const r = await apiResponse(coordinator.api.v1.enrolments.section.$post({
        json: { sectionId: section, subjects: [{ subjectId: subj.BIO!, teacherId: tB, mode: 'in_school' }], excludeStudentIds: [s.s3!.studentId] },
      }));
      expect(r).toMatchObject({ section: { name: 'EN-11A' }, summary: { created: 2, existing: 0, refused: 0 } });
      expect((await openEnrolments(s.s2!.studentId)).find((e) => e.subject_id === subj.BIO!)).toEqual({ subject_id: subj.BIO!, teacher_id: tB, mode: 'in_school', source: 'section' });
      expect((await openEnrolments(s.s3!.studentId)).find((e) => e.subject_id === subj.BIO!)).toBeUndefined();
    });

    it('rows pasted from a sheet: by student ID or email, subject code and teacher name; what does not resolve is listed, not guessed', async () => {
      const s4Code = (await one<{ code: string }>(`select student_id as code from "user" where id = $1`, [s.s4!.studentId])).code;
      const rows = [
        { student: s4Code, subject: 'EN-MAT', teacher: 'teacher enr-b', mode: 'in_school' as const, ref: 'sheet row 2' },
        { student: 'student.enr-s4@test.local', subject: 'en-eng', teacher: null, mode: 'self_study' as const, ref: 'sheet row 3' },
        { student: 'nobody@test.local', subject: 'EN-MAT', mode: 'in_school' as const, ref: 'sheet row 4' },
        { student: s4Code, subject: 'EN-XYZ', mode: 'in_school' as const, ref: 'sheet row 5' },
      ];
      const preview = await apiResponse(coordinator.api.v1.enrolments.batch.$post({ json: { academicYearId: thisYear, rows, commit: false } }));
      expect(preview.summary).toEqual({ toCreate: 2, created: 0, existing: 0, refused: 0, unresolved: 2 });
      expect(preview.unresolved.map((u) => [u.line, u.reason])).toEqual([
        [3, 'No student with the ID or email "nobody@test.local"'],
        [4, 'No subject with the code or name "EN-XYZ"'],
      ]);
      const done = await apiResponse(coordinator.api.v1.enrolments.batch.$post({ json: { academicYearId: thisYear, rows, commit: true } }));
      expect(done.summary).toMatchObject({ created: 2, unresolved: 2 });
      expect(await openEnrolments(s.s4!.studentId)).toEqual([
        { subject_id: subj.ENG!, teacher_id: null, mode: 'self_study', source: 'manual' },
        { subject_id: subj.MAT!, teacher_id: tB, mode: 'in_school', source: 'manual' },
      ].sort((a, b) => a.subject_id.localeCompare(b.subject_id)));
      expect((await one<{ ref: string }>(`select source_ref as ref from course_enrolment where student_id = $1 and subject_id = $2`, [s.s4!.studentId, subj.MAT!])).ref).toBe('sheet row 2');
    });
  });

  describe('registrations checked against enrolments — flagged, never blocked', () => {
    it('a registration without an enrolment is flagged, and the registration stands', async () => {
      // s4 preregisters Biology, which nobody enrolled them in.
      const reg = (await apiResponse(s.s4!.parent.api.v1.registrations.preregister.$post({
        json: { sessionId: june, ...(await reservationOf(june, [subj.BIO!])), studentId: s.s4!.studentId },
      })))[0]!;
      expect(reg.status).toBe('preregistered');
      const flags = await apiResponse(coordinator.api.v1.enrolments.check.$get({ query: { academicYearId: thisYear } }));
      expect(flags.registeredNotEnrolled.filter((f) => f.studentId === s.s4!.studentId).map((f) => [f.subjectName, f.window, f.registrationStatus]))
        .toEqual([['Biology (enrolment)', await sessionName(june), 'preregistered']]);
      // s1 is enrolled in English and registered nowhere this year.
      expect(flags.enrolledNotRegistered.filter((f) => f.studentId === s.s1!.studentId).map((f) => [f.subjectName, f.teacherName, f.section]))
        .toContainEqual(['English (enrolment)', 'teacher enr-a', 'EN-11A']);
      // s4 studies English alone, but no registration of theirs says so yet; s3's matches.
      expect(flags.modeDiffers.filter((f) => f.studentId === s.s3!.studentId)).toEqual([]);
      // The desk and the family read the same flags for one student.
      const mine = await apiResponse(s.s4!.parent.api.v1.enrolments.student[':studentId'].$get({ param: { studentId: s.s4!.studentId }, query: {} }));
      expect(mine.flags.registeredNotEnrolled.map((f) => f.subjectName)).toEqual(['Biology (enrolment)']);
      expect(mine.enrolments.map((e) => [e.subjectName, e.mode]).sort()).toEqual([['English (enrolment)', 'self_study'], ['Mathematics (enrolment)', 'in_school']]);
      const desk = await apiResponse(officer.api.v1.enrolments.student[':studentId'].$get({ param: { studentId: s.s4!.studentId }, query: {} }));
      expect(desk.academicYear).toMatchObject({ id: thisYear, startYear: Y });
    });

    it('a mode or teacher that disagrees is flagged too', async () => {
      // s2 is taught Mathematics by B; their registration names A (both teach it).
      await apiResponse(adm.api.v1.subjects[':id'].teachers.$put({ param: { id: subj.MAT! }, json: { teacherIds: [tA, tB] } }));
      await apiResponse(s.s2!.parent.api.v1.registrations.preregister.$post({
        json: { sessionId: june, ...(await reservationOf(june, [subj.MAT!], { teachers: { [subj.MAT!]: tA } })), studentId: s.s2!.studentId },
      }));
      const flags = await apiResponse(coordinator.api.v1.enrolments.check.$get({ query: { academicYearId: thisYear, studentId: s.s2!.studentId } }));
      expect(flags.teacherDiffers.map((f) => [f.subjectName, f.registrationTeacher, f.teacherName])).toEqual([['Mathematics (enrolment)', 'teacher enr-a', 'teacher enr-b']]);
    });
  });

  describe('teaching: self-study forms no group', () => {
    it('a self-study enrolment is excluded from teaching: no group, no class list, no count', async () => {
      const demand = await apiResponse(coordinator.api.v1.enrolments['teaching-demand'].$get({ query: { academicYearId: thisYear } }));
      const group = (subjectId: string, teacherId: string | null) => demand.find((g) => g.subjectId === subjectId && g.teacherId === teacherId);
      // Mathematics: s2 (B, in school) and s4 (B, in school) form B's group; s3 studies it alone and is in none.
      expect(group(subj.MAT!, tB)!.students.map((x) => x.name).sort()).toEqual(['Student enr-s2', 'Student enr-s4']);
      expect(demand.filter((g) => g.subjectId === subj.MAT!).flatMap((g) => g.students.map((x) => x.studentId))).not.toContain(s.s3!.studentId);
      // Physics is studied alone by everyone enrolled in it: no group at all.
      expect(demand.filter((g) => g.subjectId === subj.PHY!)).toEqual([]);
      expect(group(subj.ENG!, tA)!.students.find((x) => x.studentId === s.s1!.studentId)).toMatchObject({ section: 'EN-11A' });

      // The teacher's own class list and "My teaching" read the same.
      const cls = await apiResponse(teacherB.api.v1.enrolments.class.$get({ query: { subjectId: subj.MAT! } }));
      expect(cls.students.map((x) => x.name).sort()).toEqual(['Student enr-s2', 'Student enr-s4']);
      const me = await apiResponse(teacherB.api.v1.teaching.me.$get());
      expect(me.classes.find((c) => c.subjectId === subj.MAT!)).toMatchObject({ students: 2 });
      expect(me.classes.some((c) => c.subjectId === subj.PHY!)).toBe(false);
    });

    it("F4's contract: the teacher who gives the forecast grade — none for self-study", async () => {
      // No request exposes it yet (F4 reads it in its service); called the way F4 will.
      const { teacherOf } = await import('../src/services/enrolment.services');
      expect(await teacherOf(s.s2!.studentId, subj.MAT!, Y)).toEqual({ teacherId: tB, name: 'teacher enr-b', userId: teacherB.id });
      expect(await teacherOf(s.s3!.studentId, subj.MAT!, Y)).toBeNull();
      expect(await teacherOf(s.s1!.studentId, subj.MAT!, Y)).toBeNull();
    });
  });

  describe('two people at once', () => {
    it('two coordinators commit the same rows at the same moment: each enrolment is made once', async () => {
      const other = await staff(adm, 'coordinator', 'enr-2');
      const rows = [s.s1!, s.s2!].map((st) => ({ student: st.studentId, subject: 'EN-PHY', mode: 'self_study' as const }));
      // Both judge the rows before either writes (each sees s2 not enrolled),
      // then queue behind the year's lock: the second's insert must find the first's.
      const release = await holdEnrolmentLock(thisYear);
      let first: Promise<unknown> | undefined;
      let second: Promise<unknown> | undefined;
      try {
        first = apiResponse(coordinator.api.v1.enrolments.batch.$post({ json: { academicYearId: thisYear, rows, commit: true } }));
        second = apiResponse(other.api.v1.enrolments.batch.$post({ json: { academicYearId: thisYear, rows, commit: true } }));
        await lockWaiters(2);
      } finally {
        await release();
      }
      const [a, b] = (await Promise.all([first!, second!])) as [{ summary: { created: number; existing: number } }, { summary: { created: number; existing: number } }];
      // s1 already studies Physics alone; s2 gets it once, whoever commits first.
      expect(a.summary.created + b.summary.created).toBe(1);
      expect(a.summary.existing + b.summary.existing).toBe(3);
      expect((await one<{ n: string }>(`select count(*) as n from course_enrolment where student_id = $1 and subject_id = $2 and ended_on is null`, [s.s2!.studentId, subj.PHY!])).n).toBe('1');
    });

    it('rows committed while the student leaves: the leaving ends them too, never an open enrolment for a student who left', async () => {
      const leaver = await onboard(officer, 'enr-s6', 11);
      // The commit reads its students, then queues behind the year's lock;
      // the leaving fires while it waits. The commit holds the student FOR
      // SHARE, so the leaving waits for it and then ends what it made.
      const release = await holdEnrolmentLock(thisYear);
      let commit: Promise<{ status: number }> | undefined;
      let leaving: Promise<{ status: number }> | undefined;
      try {
        commit = coordinator.api.v1.enrolments.batch.$post({ json: { academicYearId: thisYear, rows: [{ student: leaver.studentId, subject: 'EN-ENG', mode: 'in_school' }], commit: true } });
        await lockWaiters(1);
        leaving = coordinator.api.v1.students[':id'].leave.$post({
          param: { id: leaver.studentId }, json: { kind: 'transferred', leftOn: schoolToday(), reason: 'moved to another school' },
        });
        await Promise.race([leaving, lockWaiters(2)]);
      } finally {
        await release();
      }
      const [c, l] = await Promise.all([commit!, leaving!]);
      expect(c.status).toBe(200);
      expect(l.status).toBe(200);
      expect(await openEnrolments(leaver.studentId)).toEqual([]);
      expect((await one<{ reason: string }>(`select end_reason as reason from course_enrolment where student_id = $1`, [leaver.studentId])).reason).toBe('Left the school (transferred)');
    });

    it('a single enrolment and a section enrolment of the same student at once: one open enrolment', async () => {
      const [single, whole] = await Promise.allSettled([
        apiResponse(enrol({ studentId: s.s1!.studentId, subjectId: subj.MAT!, teacherId: tB })),
        apiResponse(coordinator.api.v1.enrolments.section.$post({ json: { sectionId: section, subjects: [{ subjectId: subj.MAT!, teacherId: tB, mode: 'in_school' }], excludeStudentIds: [] } })),
      ]);
      expect(whole.status).toBe('fulfilled');
      // Whichever came second found the first: the single one refused with 409, or the section one counted it as existing.
      if (single.status === 'rejected') expect(String(single.reason)).toContain('already enrolled');
      expect((await one<{ n: string }>(`select count(*) as n from course_enrolment where student_id = $1 and subject_id = $2 and ended_on is null`, [s.s1!.studentId, subj.MAT!])).n).toBe('1');
    });
  });
});
