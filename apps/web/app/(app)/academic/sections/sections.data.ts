/**
 * The Sections screens' requests (FEATURES_PLAN.md F0a), shared by the
 * grid, the section's page and the roll-over. Every row type is derived
 * from its fetcher (CLAUDE.md: Hono RPC everywhere).
 */

import { apiResponse, type RollOverSectionsType } from '@repo/validations';
import { api } from '~/lib/hono';

export const fetchYears = () => apiResponse(api.v1.academic.years.$get());
export type Year = Awaited<ReturnType<typeof fetchYears>>[number];

export const fetchSections = (academicYearId: string) =>
  apiResponse(api.v1.academic.sections.$get({ query: { academicYearId } }));
export type SectionRow = Awaited<ReturnType<typeof fetchSections>>[number];

export const fetchSection = (id: string) => apiResponse(api.v1.academic.sections[':id'].$get({ param: { id } }));
export type SectionDetailData = Awaited<ReturnType<typeof fetchSection>>;

export const fetchActiveTeachers = () => apiResponse(api.v1.teachers.$get({ query: { isActive: 'true' } }));
export const fetchRooms = () => apiResponse(api.v1.academic.rooms.$get());

export type StudentsQuery = Parameters<typeof api.v1.students.$get>[0]['query'];
export const fetchStudents = (query: StudentsQuery) => apiResponse(api.v1.students.$get({ query }));

export const rollOverSections = (json: RollOverSectionsType) =>
  apiResponse(api.v1.academic.sections['roll-over'].$post({ json }));
export type RollOverPlan = Awaited<ReturnType<typeof rollOverSections>>;

/**
 * The query keys. All start with 'academic', so a change anywhere
 * (invalidating ['academic']) refreshes every view of it; the screen's own
 * segment keeps them apart from other screens' queries of the same endpoints.
 */
export const keys = {
  years: ['academic', 'sections-screen', 'years'] as const,
  sections: (yearId: string) => ['academic', 'sections-screen', 'sections', yearId] as const,
  section: (id: string) => ['academic', 'sections-screen', 'section', id] as const,
  teachers: ['academic', 'sections-screen', 'teachers'] as const,
  rooms: ['academic', 'sections-screen', 'rooms'] as const,
  unplaced: (grade: number) => ['academic', 'sections-screen', 'unplaced', grade] as const,
};
