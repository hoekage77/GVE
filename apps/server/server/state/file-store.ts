import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, readdirSync, renameSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import type { SessionState } from "../types/session.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Allow overriding the data directory via env var. Fallback walks from the
// source file up to the workspace root (apps/server/server/state → apps/).
const DATA_DIR = process.env.SESSION_DATA_DIR
  ? process.env.SESSION_DATA_DIR
  : join(__dirname, "..", "..", "..", ".data", "sessions");
const INDEX_PATH = join(DATA_DIR, "..", "index.json");

// Ensure data directory exists
if (!existsSync(DATA_DIR)) {
  mkdirSync(DATA_DIR, { recursive: true });
}

// ── Debounced write queue ──

interface PendingWrite {
  state: SessionState;
  timer: ReturnType<typeof setTimeout>;
}

const pendingWrites = new Map<string, PendingWrite>();
const DEBOUNCE_MS = 500;

function scheduleSave(sessionId: string, state: SessionState): void {
  if (pendingWrites.has(sessionId)) {
    clearTimeout(pendingWrites.get(sessionId)!.timer);
  }

  const timer = setTimeout(() => {
    flushSession(sessionId);
  }, DEBOUNCE_MS);

  pendingWrites.set(sessionId, { state, timer });
}

function flushSession(sessionId: string): void {
  const pending = pendingWrites.get(sessionId);
  if (!pending) return;

  pendingWrites.delete(sessionId);

  try {
    const filePath = sessionFilePath(sessionId);
    const tmpPath = `${filePath}.tmp`;
    const data = JSON.stringify(pending.state, null, 2);

    // Atomic write: write to tmp file, then rename
    writeFileSync(tmpPath, data, "utf-8");
    renameSync(tmpPath, filePath);
  } catch (err) {
    console.error(`[FileStore] Failed to save session ${sessionId}:`, (err as Error).message);
  }
}

// ── Path helpers ──

function sessionFilePath(sessionId: string): string {
  // Sanitize session ID to prevent path traversal
  const safeId = sessionId.replace(/[^a-zA-Z0-9\-_]/g, "_");
  return join(DATA_DIR, `${safeId}.json`);
}

// ── Public API ──

/**
 * Save a session state to disk (debounced).
 * Multiple rapid calls for the same session are batched into a single write.
 */
export function saveSession(sessionId: string, state: SessionState): void {
  scheduleSave(sessionId, state);
}

/**
 * Save a session state to disk immediately (synchronous).
 * Use for critical saves like session creation.
 */
export function saveSessionSync(sessionId: string, state: SessionState): void {
  try {
    const filePath = sessionFilePath(sessionId);
    const tmpPath = `${filePath}.tmp`;
    const data = JSON.stringify(state, null, 2);
    writeFileSync(tmpPath, data, "utf-8");
    renameSync(tmpPath, filePath);
  } catch (err) {
    console.error(`[FileStore] Failed to sync-save session ${sessionId}:`, (err as Error).message);
  }
}

/**
 * Load a single session from disk.
 * Returns null if the session file doesn't exist.
 */
export function loadSession(sessionId: string): SessionState | null {
  const filePath = sessionFilePath(sessionId);

  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const raw = readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as SessionState;
  } catch (err) {
    console.error(`[FileStore] Failed to load session ${sessionId}:`, (err as Error).message);
    return null;
  }
}

/**
 * Load all sessions from disk.
 * Returns a Map of sessionId -> sessionState.
 */
export function loadAllSessions(): Map<string, SessionState> {
  const sessions = new Map<string, SessionState>();

  if (!existsSync(DATA_DIR)) {
    return sessions;
  }

  try {
    const files = readdirSync(DATA_DIR).filter(f => f.endsWith(".json") && !f.endsWith(".tmp"));

    for (const file of files) {
      try {
        const raw = readFileSync(join(DATA_DIR, file), "utf-8");
        const state = JSON.parse(raw) as SessionState;

        if (state && state.sessionId) {
          sessions.set(state.sessionId, state);
        }
      } catch (err) {
        console.error(`[FileStore] Failed to parse ${file}:`, (err as Error).message);
      }
    }

    console.log(`[FileStore] Loaded ${sessions.size} persisted session(s) from disk.`);
  } catch (err) {
    console.error(`[FileStore] Failed to read sessions directory:`, (err as Error).message);
  }

  return sessions;
}

/**
 * Delete a session file from disk.
 */
export function deleteSession(sessionId: string): void {
  const filePath = sessionFilePath(sessionId);

  // Cancel any pending write
  if (pendingWrites.has(sessionId)) {
    clearTimeout(pendingWrites.get(sessionId)!.timer);
    pendingWrites.delete(sessionId);
  }

  try {
    if (existsSync(filePath)) {
      unlinkSync(filePath);
    }
  } catch (err) {
    console.error(`[FileStore] Failed to delete session ${sessionId}:`, (err as Error).message);
  }
}

/**
 * Flush all pending writes immediately.
 * Call on server shutdown to ensure no data is lost.
 */
export function flushAll(): void {
  for (const [sessionId] of pendingWrites) {
    flushSession(sessionId);
  }
}

/**
 * Get persistence stats.
 */
export function getStoreStats(): { dataDir: string; fileCount: number; pendingWrites: number } {
  let fileCount = 0;

  try {
    if (existsSync(DATA_DIR)) {
      fileCount = readdirSync(DATA_DIR).filter(f => f.endsWith(".json") && !f.endsWith(".tmp")).length;
    }
  } catch {
    // ignore
  }

  return {
    dataDir: DATA_DIR,
    fileCount,
    pendingWrites: pendingWrites.size
  };
}
