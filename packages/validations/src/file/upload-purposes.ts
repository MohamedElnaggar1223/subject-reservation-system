/**
 * Upload purposes (FEATURES_PLAN.md F0a, "Uploads").
 *
 * Every file the system keeps is uploaded for one purpose, and the purpose
 * decides everything about it: the types and size it may be, who may upload
 * it, whether it concerns a student (and so belongs to a family), and who
 * may read it back. One upload path serves every feature
 * (POST /v1/files/upload, form { file, purpose, studentId? }); reads go
 * through GET /v1/files/:id/content, which applies the purpose's read rule.
 *
 * Read rules:
 * - 'owner'  the account that uploaded the file;
 * - 'family' the student the file concerns and their approved linked
 *            parents (a purpose with this rule requires a studentId);
 * - a role   anyone signed in with that role (staff).
 *
 * The magic bytes decide a file's type, never the name or the declared type.
 *
 * Adding a purpose: add an entry below, rebuild this package; the API and
 * the matrix in apps/api/test pick it up. Changing who may read a purpose
 * that already holds files changes who can see them — record why.
 */

import { z } from 'zod';
import { ROLES, type Role } from '../roles';

const IMAGES = ['image/jpeg', 'image/png', 'image/webp'] as const;
const PDF = 'application/pdf';
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const CSV = 'text/csv';
const TXT = 'text/plain';

const MB = 1024 * 1024;

export type ReadRule = 'owner' | 'family' | Role;

export type UploadPurposeDefinition = {
  label: string;
  mimeTypes: readonly string[];
  maxBytes: number;
  /** Roles that may upload a file for this purpose. */
  uploadRoles: readonly Role[];
  /** Whether the file concerns one student (and so their family). */
  concernsStudent: 'required' | 'none';
  read: readonly ReadRule[];
  /** Image thumbnails are made for it (avatars only). */
  thumbnails?: boolean;
  /** Which feature uses it. */
  usedBy: string;
};

const FAMILY_AND_STAFF_UPLOAD = [
  ROLES.PARENT,
  ROLES.STUDENT,
  ROLES.COORDINATOR,
  ROLES.ADMIN,
  ROLES.FINANCE_OFFICER,
  ROLES.FINANCE_ADMIN,
] as const;

export const UPLOAD_PURPOSES = {
  avatar: {
    label: 'Profile photo',
    mimeTypes: IMAGES,
    maxBytes: 5 * MB,
    uploadRoles: [
      ROLES.ADMIN, ROLES.STUDENT, ROLES.PARENT, ROLES.FINANCE_OFFICER, ROLES.FINANCE_ADMIN,
      ROLES.COORDINATOR, ROLES.TEACHER, ROLES.GATE,
    ],
    concernsStudent: 'none',
    read: ['owner'],
    thumbnails: true,
    usedBy: 'Profile',
  },
  document: {
    // The personal document of the original upload route. Staff read one
    // only once it is attached as evidence to a payment or a remark (the
    // file service checks the attachment).
    label: 'Personal document',
    mimeTypes: [PDF, DOCX, XLSX, TXT, CSV, ...IMAGES],
    maxBytes: 10 * MB,
    uploadRoles: [
      ROLES.ADMIN, ROLES.STUDENT, ROLES.PARENT, ROLES.FINANCE_OFFICER, ROLES.FINANCE_ADMIN,
      ROLES.COORDINATOR, ROLES.TEACHER, ROLES.GATE,
    ],
    concernsStudent: 'none',
    read: ['owner'],
    usedBy: 'Legacy uploads',
  },
  payment_evidence: {
    label: 'InstaPay transfer screenshot',
    mimeTypes: [PDF, ...IMAGES],
    maxBytes: 10 * MB,
    uploadRoles: [ROLES.PARENT],
    concernsStudent: 'required',
    read: ['owner', ROLES.FINANCE_OFFICER, ROLES.FINANCE_ADMIN, ROLES.ADMIN],
    usedBy: 'Payments (InstaPay reference)',
  },
  remark_consent: {
    label: 'Signed remark consent',
    mimeTypes: [PDF, ...IMAGES],
    maxBytes: 10 * MB,
    uploadRoles: [ROLES.PARENT],
    concernsStudent: 'required',
    read: ['owner', ROLES.FINANCE_OFFICER, ROLES.FINANCE_ADMIN, ROLES.ADMIN],
    usedBy: 'Remarks',
  },
  supporting_document: {
    label: 'Supporting document',
    mimeTypes: [PDF, DOCX, ...IMAGES],
    maxBytes: 10 * MB,
    uploadRoles: FAMILY_AND_STAFF_UPLOAD,
    concernsStudent: 'required',
    read: ['owner', 'family', ROLES.COORDINATOR, ROLES.ADMIN, ROLES.FINANCE_OFFICER, ROLES.FINANCE_ADMIN],
    usedBy: 'Leave requests, exceptions, withdrawals',
  },
  collector_photo: {
    // F2: the desk records a family's collector on its behalf (pending the
    // coordinator's approval), so it uploads the photo too. The gate reads a
    // photo only of a collector of a student on the day's leave list (the
    // file service checks it).
    label: 'Authorised collector photo',
    mimeTypes: IMAGES,
    maxBytes: 5 * MB,
    uploadRoles: [ROLES.PARENT, ROLES.COORDINATOR, ROLES.ADMIN, ROLES.FINANCE_OFFICER, ROLES.FINANCE_ADMIN],
    concernsStudent: 'required',
    read: ['owner', 'family', ROLES.COORDINATOR, ROLES.ADMIN, ROLES.GATE],
    usedBy: 'Campus leave (F2)',
  },
  // F2: a person who may not collect a student. Never a family's to read: a
  // restricted parent is often linked to the child. The gate reads it only for
  // a student on the day's leave list (the file service checks it).
  custody_photo: {
    label: 'Photo of a person who may not collect',
    mimeTypes: IMAGES,
    maxBytes: 5 * MB,
    uploadRoles: [ROLES.COORDINATOR, ROLES.ADMIN],
    concernsStudent: 'required',
    read: [ROLES.COORDINATOR, ROLES.ADMIN, ROLES.GATE],
    usedBy: 'Campus leave (F2): custody restrictions',
  },
  custody_document: {
    label: 'Custody document (court order, written instruction)',
    mimeTypes: [PDF, DOCX, ...IMAGES],
    maxBytes: 10 * MB,
    uploadRoles: [ROLES.COORDINATOR, ROLES.ADMIN],
    concernsStudent: 'required',
    read: [ROLES.COORDINATOR, ROLES.ADMIN],
    usedBy: 'Campus leave (F2): custody restrictions',
  },
  excuse_note: {
    label: 'Absence excuse note',
    mimeTypes: [PDF, ...IMAGES],
    maxBytes: 10 * MB,
    uploadRoles: [ROLES.PARENT, ROLES.STUDENT, ROLES.COORDINATOR, ROLES.ADMIN],
    concernsStudent: 'required',
    read: ['owner', 'family', ROLES.COORDINATOR, ROLES.ADMIN],
    usedBy: 'Attendance (F3)',
  },
  import_file: {
    label: 'Import file',
    mimeTypes: [XLSX, CSV, TXT],
    maxBytes: 10 * MB,
    uploadRoles: [ROLES.ADMIN, ROLES.COORDINATOR],
    concernsStudent: 'none',
    read: ['owner', ROLES.ADMIN, ROLES.COORDINATOR],
    usedBy: 'Day-one import (F7)',
  },
} as const satisfies Record<string, UploadPurposeDefinition>;

export type UploadPurpose = keyof typeof UPLOAD_PURPOSES;
export const UPLOAD_PURPOSE_KEYS = Object.keys(UPLOAD_PURPOSES) as UploadPurpose[];
export const UploadPurposeSchema = z.enum(UPLOAD_PURPOSE_KEYS as [UploadPurpose, ...UploadPurpose[]]);

/** The largest file any purpose takes; the API's body limit sits just above it. */
export const MAX_UPLOAD_BYTES = Math.max(...Object.values(UPLOAD_PURPOSES).map((p) => p.maxBytes));

export const UploadFile = z.object({
  file: z.instanceof(File).refine((f) => f.size > 0, 'File cannot be empty'),
  purpose: UploadPurposeSchema,
  studentId: z.string().min(1).optional(),
});
export type UploadFileType = z.infer<typeof UploadFile>;

/** Purposes whose files may be attached to a payment as InstaPay evidence. */
export const PAYMENT_EVIDENCE_PURPOSES: readonly UploadPurpose[] = ['payment_evidence', 'document'];
/** Purposes whose files may be attached to a remark as the signed consent. */
export const REMARK_CONSENT_PURPOSES: readonly UploadPurpose[] = ['remark_consent', 'document'];
