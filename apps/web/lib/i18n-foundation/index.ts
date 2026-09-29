/**
 * Arabic for the F0a screens (FEATURES_PLAN.md F0a), one dictionary per area
 * so the screens of one area can be written without touching another's.
 * Merged into the page translator's exact-text dictionary in lib/i18n.tsx:
 * every English string a screen renders needs its Arabic here (or a pattern
 * in translateDynamicText).
 */
import { coreArabic } from './core';
import { academicArabic } from './academic';
import { studentsArabic } from './students';

export const foundationArabic: Record<string, string> = {
  ...coreArabic,
  ...academicArabic,
  ...studentsArabic,
};
