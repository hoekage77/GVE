import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, readdirSync, renameSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "..", ".data", "sessions");
const INDEX_PATH = join(DATA_DIR, "..", "index.json");

// Ensure data directory exists
if (!existsSync(DATA_DIR)) {
  mkdirSync(DATA_DIR, { recursive: true });
}

// ── Debounced write queue ──

const pendingWrites = new Map();
const DEBOUNCE_MS = 500;

function scheduleSave(sessionId, state) {
  if (pendingWrites.has(sessionId)) {
    clearTimeout(pendingWrites.get(sessionId).timer);
  }

  const timer = setTimeout(() => {
    flushSession(sessionId);
  }, DEBOUNCE_MS);

  pendingWrites.set(sessionId, { state, timer });
}

function flushSession(sessionId) {
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
    console.error(`[FileStore] Failed to save session ${sessionId}:`, err.message);
  }
}

// ── Path helpers ──

function sessionFilePath(sessionId) {
  // Sanitize session ID to prevent path traversal
  const safeId = sessionId.replace(/[^a-zA-Z0-9\-_]/g, "_");
  return join(DATA_DIR, `${safeId}.json`);
}

// ── Public API ──

/**
 * Save a session state to disk (debounced).
 * Multiple rapid calls for the same session are batched into a single write.
 */
export function saveSession(sessionId, state) {
  scheduleSave(sessionId, state);
}

/**
 * Save a session state to disk immediately (synchronous).
 * Use for critical saves like session creation.
 */
export function saveSessionSync(sessionId, state) {
  try {
    const filePath = sessionFilePath(sessionId);
    const tmpPath = `${filePath}.tmp`;
    const data = JSON.stringify(state, null, 2);
    writeFileSync(tmpPath, data, "utf-8");
    renameSync(tmpPath, filePath);
  } catch (err) {
    console.error(`[FileStore] Failed to sync-save session ${sessionId}:`, err.message);
  }
}

/**
 * Load a single session from disk.
 * Returns null if the session file doesn't exist.
 */
export function loadSession(sessionId) {
  const filePath = sessionFilePath(sessionId);

  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const raw = readFileSync(filePath, "utf-8");
    return JSON.parse(raw);
  } catch (err) {
    console.error(`[FileStore] Failed to load session ${sessionId}:`, err.message);
    return null;
  }
}

/**
 * Load all sessions from disk.
 * Reads every .json file in the sessions directory.
 * Returns a Map of sessionId -> sessionState.
 */
export function loadAllSessions() {
  const sessions = new Map();

  if (!existsSync(DATA_DIR)) {
    return sessions;
  }

  try {
    const files = readdirSync(DATA_DIR).filter(f => f.endsWith(".json") && !f.endsWith(".tmp"));

    for (const file of files) {
      try {
        const raw = readFileSync(join(DATA_DIR, file), "utf-8");
        const state = JSON.parse(raw);

        if (state && state.sessionId) {
          sessions.set(state.sessionId, state);
        }
      } catch (err) {
        console.error(`[FileStore] Failed to parse ${file}:`, err.message);
      }
    }

    console.log(`[FileStore] Loaded ${sessions.size} persisted session(s) from disk.`);
  } catch (err) {
    console.error(`[FileStore] Failed to read sessions directory:`, err.message);
  }

  return sessions;
}

/**
 * Delete a session file from disk.
 */
export function deleteSession(sessionId) {
  const filePath = sessionFilePath(sessionId);

  // Cancel any pending write
  if (pendingWrites.has(sessionId)) {
    clearTimeout(pendingWrites.get(sessionId).timer);
    pendingWrites.delete(sessionId);
  }

  try {
    if (existsSync(filePath)) {
      unlinkSync(filePath);
    }
  } catch (err) {
    console.error(`[FileStore] Failed to delete session ${sessionId}:`, err.message);
  }
}

/**
 * Flush all pending writes immediately.
 * Call on server shutdown to ensure no data is lost.
 */
export function flushAll() {
  for (const [sessionId] of pendingWrites) {
    flushSession(sessionId);
  }
}

/**
 * Get persistence stats.
 */
export function getStoreStats() {
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
