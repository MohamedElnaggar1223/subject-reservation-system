'use client';

/**
 * The remark's service, from the board's own list for the line's series (RESERVATIONS_REWORK.md
 * §3.6): Cambridge 1, 1S, 2, 2S; Pearson's review of marking, clerical re-check, access to
 * scripts, priority review; Oxford's — each with its fee at the line's level (per paper where the
 * board charges per paper) and its last date in that series. The request sends the board
 * service, not V3's three service types.
 */

import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '~/lib/hono';
import { apiResponse, serviceLevelOf } from '@repo/validations';
import { Day } from '~/app/(app)/(sessions)/admin/sessions/sessions-shared';

const fetchLine = (id: string) => apiResponse(api.v1.registrations[':id'].$get({ param: { id } }));
const fetchServices = (q: { boardSeriesId?: string; boardCode?: string }) => apiResponse(api.v1['board-services'].$get({ query: q }));

export type PickedService = { id: string; feePerPaper: number | null; perComponent: boolean; deadline: string | null } | null;

export function RemarkServicePicker({ registrationId, familyAsks, value, onChange }: {
  registrationId: string; familyAsks: boolean; value: string; onChange: (picked: PickedService) => void;
}) {
  const line = useQuery({ queryKey: ['registrations', registrationId, 'line'], queryFn: () => fetchLine(registrationId), enabled: !!registrationId });
  const seriesId = line.data?.boardSeriesId ?? undefined;
  const board = line.data?.subject?.council;
  const services = useQuery({
    queryKey: ['board-services', seriesId ?? board ?? ''],
    queryFn: () => fetchServices(seriesId ? { boardSeriesId: seriesId } : { boardCode: board! }),
    enabled: !!seriesId || !!board,
  });
  const level = serviceLevelOf(line.data?.subject?.qualificationLevel);
  const remarks = (services.data ?? []).filter((s) => s.kind === 'remark' && s.isActive && (!familyAsks || s.requestableByFamily));
  const describe = (id: string): PickedService => {
    const s = remarks.find((x) => x.id === id);
    if (!s) return null;
    const fee = s.fees.find((f) => f.level === level) ?? (s.levelRates ? undefined : s.fees[0]);
    return { id: s.id, feePerPaper: fee?.amount ?? null, perComponent: s.perComponent, deadline: s.deadline ? String(s.deadline) : null };
  };
  // The first service is picked by default; the parent's choice is kept as the list refreshes.
  useEffect(() => {
    if (!remarks.length) return;
    onChange(describe(remarks.some((s) => s.id === value) ? value : remarks[0]!.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [services.data, line.data]);

  const picked = describe(value);
  return (
    <div>
      <label className="block text-sm font-medium text-foreground mb-1" htmlFor="remark-service">Service</label>
      <select id="remark-service" value={value} disabled={!remarks.length} onChange={(e) => onChange(describe(e.target.value))}
        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground">
        {!remarks.length && <option value="">{registrationId ? 'No remark service offered for this subject' : 'Pick the subject first'}</option>}
        {remarks.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
      </select>
      {picked?.deadline && (
        <p className="mt-1 text-xs text-muted-foreground"><span>The board&apos;s last date for it:</span> <Day iso={picked.deadline} /></p>
      )}
    </div>
  );
}
