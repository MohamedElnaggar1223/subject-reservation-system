import { z } from 'zod';

const paginationFields = {
  limit:  z.coerce.number().min(1).max(5000).default(500),
  offset: z.coerce.number().min(0).default(0),
};

export const SessionReportQuery = z.object({
  sessionId: z.string().min(1, 'Invalid session ID'),
  council:   z.string().optional(),
  format:    z.enum(['json', 'csv']).optional(),
  ...paginationFields,
});
export type SessionReportQueryType = z.infer<typeof SessionReportQuery>;

export const RegistrationReportQuery = z.object({
  sessionId: z.string().min(1, 'Invalid session ID'),
  grade:     z.string().optional().transform((v) => (v ? parseInt(v, 10) : undefined)),
  status:    z.string().optional(),
  council:   z.string().optional(),
  format:    z.enum(['json', 'csv']).optional(),
  ...paginationFields,
});
export type RegistrationReportQueryType = z.infer<typeof RegistrationReportQuery>;

export const RosterReportQuery = z.object({
  grade:  z.string().optional().transform((v) => {
    if (v === 'graduated') return null;
    return v ? parseInt(v, 10) : undefined;
  }),
  format: z.enum(['json', 'csv']).optional(),
  ...paginationFields,
});
export type RosterReportQueryType = z.infer<typeof RosterReportQuery>;

export const FormatQuery = z.object({
  format: z.enum(['json', 'csv']).optional(),
  ...paginationFields,
});
export type FormatQueryType = z.infer<typeof FormatQuery>;
