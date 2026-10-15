/**
 * Today's query keys, shared by the server page (which prefetches) and the
 * client (which reads). Kept out of the 'use client' module: a server
 * component importing a value from it gets a client reference, not the value.
 */
export const TEACHES_KEY = ['account', 'teaches'] as const;
