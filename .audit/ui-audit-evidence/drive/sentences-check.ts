// F6: the queued Arabic sentences, read through the dictionaries the page translator uses.
import { translateSchedulingText } from '/Users/mohamedelnaggar/Coding/subject-reservation-system/.claude/worktrees/ui-audit/apps/web/lib/i18n-scheduling';
import { translateSessionsText } from '/Users/mohamedelnaggar/Coding/subject-reservation-system/.claude/worktrees/ui-audit/apps/web/lib/i18n-sessions';

const show = (s: string | null) => JSON.stringify(s?.replace(/⁨/g, '⟨').replace(/⁩/g, '⟩'));
const clash = 'It would clash in the published timetable: Student FU-5 would be in Biology 11 — Teacher B and Homeroom 11 — Teacher H at Wednesday period 2 from Wednesday, 21 October 2026 (Term 1 — first)';
console.log('clash  :', show(translateSchedulingText(clash)));
console.log('named  :', show(translateSessionsText('0610 Biology for Student Placeholder A1 has already gone to the board in Cambridge International June 2027: withdraw its entries first')));
console.log('unnamed:', show(translateSessionsText('0610 Biology for the candidate has already gone to the board in Cambridge International June 2027: withdraw its entries first')));
