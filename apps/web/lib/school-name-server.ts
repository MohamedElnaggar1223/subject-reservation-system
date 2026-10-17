/**
 * The school's name for a signed-in page that prints (F8-11: the reservation slip and the receipt), read on the
 * server from the public read (`GET /v1/settings/public`, decision 15's `{ schoolName }`). Empty — the setting not
 * set, or the API not answering — the page prints the app's name alone; a failure is logged, never hidden.
 */

import { apiResponse } from '@repo/validations';
import { getServerApi } from './hono-server';

export async function readSchoolName(): Promise<string> {
  try {
    const api = await getServerApi();
    return (await apiResponse(api.v1.settings.public.$get())).schoolName;
  } catch (err) {
    console.warn('[print] the school name could not be read:', err instanceof Error ? err.message : err);
    return '';
  }
}
