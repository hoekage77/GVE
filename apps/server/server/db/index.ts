/**
 * Database layer — Supabase PostgreSQL backend.
 *
 * Replaces the previous better-sqlite3 implementation.
 * All repository methods are now async.
 */

export { supabase, isoNow } from "./supabase.js";
