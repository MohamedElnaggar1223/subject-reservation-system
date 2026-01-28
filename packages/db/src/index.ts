/**
 * Database Package Exports
 *
 * This package encapsulates all database operations.
 * It exports everything needed so consumers (API, services) never
 * need to import from drizzle-orm directly.
 *
 * This maintains clean separation and makes it easy to swap ORMs later.
 */

// Database instance
export * from './db'

// Schema (tables, relations)
export * from './schema'

// Health checks
export * from './health'

/**
 * Drizzle ORM Query Builders
 *
 * Re-export commonly used Drizzle operators so consumers
 * don't need drizzle-orm as a direct dependency.
 *
 * These are the building blocks for type-safe queries.
 */
export {
  // Comparison operators
  eq,    // Equal: where(eq(user.id, '123'))
  ne,    // Not equal: where(ne(user.status, 'deleted'))
  gt,    // Greater than: where(gt(user.age, 18))
  gte,   // Greater than or equal
  lt,    // Less than
  lte,   // Less than or equal

  // Logical operators
  and,   // AND: where(and(eq(user.id, '123'), eq(user.active, true)))
  or,    // OR: where(or(eq(user.role, 'admin'), eq(user.role, 'mod')))
  not,   // NOT: where(not(eq(user.banned, true)))

  // Pattern matching
  like,      // LIKE: where(like(user.email, '%@gmail.com'))
  ilike,     // Case-insensitive LIKE
  notLike,   // NOT LIKE
  notIlike,  // NOT ILIKE

  // NULL checks
  isNull,    // IS NULL: where(isNull(user.deletedAt))
  isNotNull, // IS NOT NULL

  // Array operations
  inArray,     // IN: where(inArray(user.id, ['1', '2', '3']))
  notInArray,  // NOT IN

  // Sorting
  asc,   // Ascending: orderBy(asc(user.createdAt))
  desc,  // Descending: orderBy(desc(user.createdAt))

  // Aggregation
  count,  // COUNT: select({ count: count() })
  sum,    // SUM
  avg,    // AVG
  min,    // MIN
  max,    // MAX

  // SQL helpers
  sql,   // Raw SQL: sql`LOWER(${user.email})`
} from 'drizzle-orm'