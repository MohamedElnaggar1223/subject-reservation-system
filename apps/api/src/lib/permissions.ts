import { createAccessControl } from "better-auth/plugins/access";
import { adminAc, defaultStatements } from "better-auth/plugins/admin/access";

/**
 * Access Control Configuration
 * 
 * IGCSE Subject Reservation System permissions:
 * - staff: Admin-level operations
 * - student: Student-specific operations (registration, escrow, etc.)
 * - parent: Parent-specific operations (manage children, transfers)
 * - link: Parent-student linking operations
 * 
 * Make sure to use `as const` so typescript can infer the type correctly
 */
const statement = {
    ...defaultStatements,
    staff: ["create", "read", "update", "delete"],
    student: ["create", "read", "update", "delete"],
    parent: ["create", "read", "update", "delete"],
    link: ["create", "read", "update", "delete"],
    finance: ["create", "read", "update", "delete", "approve"],
} as const;

export const ac = createAccessControl(statement);

/**
 * Admin Role
 * Full access to all resources
 */
export const adminRole = ac.newRole({
    staff: ["create", "read", "update", "delete"],
    student: ["create", "read", "update", "delete"],
    parent: ["create", "read", "update", "delete"],
    link: ["create", "read", "update", "delete"],
    finance: ["create", "read", "update", "delete", "approve"],
    ...adminAc.statements
})

/**
 * Finance Officer Role
 * Executes money movements at the school desk: confirms in-school and
 * InstaPay payments, issues/takes back physical receipts, disburses
 * cash refunds. Cannot approve refunds or grant exceptions.
 */
export const financeOfficerRole = ac.newRole({
    finance: ["create", "read", "update"],
    student: ["read"],
    parent: ["read"],
    // SECURITY: finance roles must NEVER hold better-auth's `user`
    // resource. Those permissions are checked by better-auth's own
    // /api/auth/admin/* endpoints, which apply a client-supplied `role`
    // verbatim on create-user and allow set-user-password against ANY
    // target — so granting them here would let desk staff mint admin
    // accounts and take over existing ones. Desk onboarding instead
    // creates accounts through the public sign-up API with the role
    // hard-coded server-side (see desk.services.ts findOrCreatePerson).
})

/**
 * Finance Admin Role
 * Everything an officer does, plus approvals: completes refunds,
 * grants/revokes exceptions, manages fee schedules, voids receipts.
 */
export const financeAdminRole = ac.newRole({
    finance: ["create", "read", "update", "delete", "approve"],
    student: ["read"],
    parent: ["read"],
    // See the security note on financeOfficerRole — no `user` resource.
})

/**
 * Student Role
 * Can manage own registrations, view subjects, manage escrow
 */
export const studentRole = ac.newRole({
    student: ["read", "update", "create"],
    link: ["read", "update"], // Can view and respond to link requests
})

/**
 * Parent Role
 * Can manage linked children, register on behalf, transfer escrow
 */
export const parentRole = ac.newRole({
    parent: ["read", "update", "create"],
    link: ["create", "read"], // Can create and view link requests
    student: ["read"], // Can view linked children's data
})