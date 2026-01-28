import { createAccessControl } from "better-auth/plugins/access";
import { adminAc, defaultStatements } from "better-auth/plugins/admin/access";

/**
 * make sure to use `as const` so typescript can infer the type correctly
 */
const statement = { 
    ...defaultStatements,
    staff: ["create", "read", "update", "delete"], 
    coach: ["create", "read", "update", "delete"],
    student: ["create", "read", "update", "delete"]
} as const; 

export const ac = createAccessControl(statement);

export const userRole = ac.newRole({
    student: ["create"]
})

export const adminRole = ac.newRole({
    staff: ["create", "read", "update", "delete"], 
    coach: ["create", "read", "update", "delete"],
    student: ["create", "read", "update", "delete"],
    ...adminAc.statements
})

export const studentRole = ac.newRole({
    student: ["read", "update", "create"]
})

export const coachRole = ac.newRole({
    coach: ["read", "update", "create", "delete"]
})