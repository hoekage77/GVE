import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readdirSync, readFileSync, renameSync, mkdirSync } from "node:fs";
import { db, isoNow } from "./index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "..", "..", ".data");
const SESSIONS_DIR = join(DATA_DIR, "sessions");
const BACKUP_DIR = join(DATA_DIR, "sessions.migrated-backup");

function log(msg: string) {
  console.log(`[DB Migrate] ${msg}`);
}

export function runMigration(): void {
  // Check if already migrated
  const migratedMarker = join(DATA_DIR, ".migration-complete");
  if (existsSync(migratedMarker)) {
    log("Migration already completed. Skipping.");
    return;
  }

  if (!existsSync(SESSIONS_DIR)) {
    log("No legacy sessions directory found. Nothing to migrate.");
    writeMarker(migratedMarker);
    return;
  }

  const files = readdirSync(SESSIONS_DIR).filter(
    (f) => f.endsWith(".json") && !f.endsWith(".tmp")
  );

  if (files.length === 0) {
    log("No session files to migrate.");
    writeMarker(migratedMarker);
    return;
  }

  log(`Found ${files.length} session file(s) to migrate.`);

  const insertSession = db.prepare(
    `INSERT OR IGNORE INTO sessions (id, owner_id, title, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  );

  const insertMessage = db.prepare(
    `INSERT OR IGNORE INTO messages (id, session_id, role, content, kind, error, meta, metadata, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const insertScene = db.prepare(
    `INSERT OR IGNORE INTO scenes (id, session_id, version, scene_id, code, preview_url, skill, media_url, media_type, output_kind, asset_plan, explanation, source, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const migrateTransaction = db.transaction(() => {
    for (const file of files) {
      try {
        const raw = readFileSync(join(SESSIONS_DIR, file), "utf-8");
        const state = JSON.parse(raw);

        if (!state.sessionId) {
          log(`Skipping ${file} — no sessionId`);
          continue;
        }

        const title =
          state.artifacts?.[0]?.title ??
          (state.currentScene?.sceneId
            ? `Scene ${state.currentScene.sceneId.slice(-6)}`
            : null);

        insertSession.run(
          state.sessionId,
          state.ownerId ?? null,
          title ?? null,
          state.status ?? "idle",
          state.createdAt ?? isoNow(),
          state.updatedAt ?? state.createdAt ?? isoNow()
        );

        // Migrate messages
        if (Array.isArray(state.messages)) {
          for (const msg of state.messages) {
            insertMessage.run(
              msg.messageId ?? msg.id ?? `${state.sessionId}-msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              state.sessionId,
              msg.role ?? "assistant",
              msg.content ?? "",
              msg.kind ?? null,
              msg.error ? JSON.stringify(msg.error) : null,
              Array.isArray(msg.meta) ? JSON.stringify(msg.meta) : null,
              msg.metadata ? JSON.stringify(msg.metadata) : null,
              msg.createdAt ?? isoNow(),
              msg.updatedAt ?? msg.createdAt ?? isoNow()
            );
          }
        }

        // Migrate scenes (from currentScene and versions)
        const seenScenes = new Set<string>();
        const scenes: any[] = [];

        if (state.currentScene) {
          scenes.push({ ...state.currentScene, _isCurrent: true });
          seenScenes.add(state.currentScene.versionId ?? state.currentScene.sceneId);
        }

        if (Array.isArray(state.sceneVersions)) {
          for (const sv of state.sceneVersions) {
            if (!seenScenes.has(sv.versionId ?? sv.sceneId)) {
              scenes.push(sv);
              seenScenes.add(sv.versionId ?? sv.sceneId);
            }
          }
        }

        if (Array.isArray(state.versions)) {
          for (const v of state.versions) {
            if (!seenScenes.has(v.versionId ?? v.sceneId)) {
              scenes.push(v);
              seenScenes.add(v.versionId ?? v.sceneId);
            }
          }
        }

        for (const sv of scenes) {
          insertScene.run(
            sv.versionId ?? `${state.sessionId}-scene-${sv.version ?? 0}`,
            state.sessionId,
            sv.version ?? 0,
            sv.sceneId ?? null,
            sv.code ?? null,
            sv.previewUrl ?? null,
            sv.skill ?? null,
            sv.mediaUrl ?? null,
            sv.mediaType ?? null,
            sv.outputKind ?? null,
            sv.assetPlan ? JSON.stringify(sv.assetPlan) : null,
            sv.explanation ?? null,
            sv.source ?? "generate",
            sv.createdAt ?? isoNow()
          );
        }

        log(`Migrated session: ${state.sessionId}`);
      } catch (err) {
        log(`Failed to migrate ${file}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  });

  migrateTransaction();

  // Backup legacy files
  if (!existsSync(BACKUP_DIR)) {
    mkdirSync(BACKUP_DIR, { recursive: true });
  }
  renameSync(SESSIONS_DIR, BACKUP_DIR);
  log(`Backed up legacy sessions to ${BACKUP_DIR}`);

  writeMarker(migratedMarker);
  log(`Migration complete. Migrated ${files.length} session(s).`);
}

function writeMarker(path: string) {
  try {
    import("node:fs").then(({ writeFileSync }) => {
      writeFileSync(path, new Date().toISOString(), "utf-8");
    });
  } catch {
    // ignore
  }
}
