// F6 dev data, part 8: the entries derived from the paid reservations of Cambridge International June 2027
// (what Exam Entries' "Preview" then "Make them" do), so the entries screens are judged with content.
import { signIn, out } from './api.mjs';
const coord = await signIn('coordinator.ui@igcse.local');
const series = 'bs_936acb8d32599e0fccf11a977a6ea6e9';
out(JSON.stringify(await coord('POST', '/v1/exams/entries/derive', { boardSeriesId: series, commit: true })).slice(0, 600));
