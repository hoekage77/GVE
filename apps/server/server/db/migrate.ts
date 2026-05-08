import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, writeFileSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "..", "..", ".data");

function log(msg: string) {
  console.log(`[DB Migrate] ${msg}`);
}

export function runMigration(): void {
  const migratedMarker = join(DATA_DIR, ".migration-complete");
  if (existsSync(migratedMarker)) {
    log("Migration already completed. Skipping.");
    return;
  }

  // Legacy SQLite-to-filesystem migration is no longer needed.
  // Supabase schema migration should be run via the SQL Editor using supabase-schema.sql.
  writeFileSync(migratedMarker, new Date().toISOString(), "utf-8");
  log("Migration marker written. Supabase migration is manual via SQL Editor.");
}
