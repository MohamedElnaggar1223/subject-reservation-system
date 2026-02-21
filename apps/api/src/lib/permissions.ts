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
    ...adminAc.statements
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