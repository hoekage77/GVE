import { db, isoNow } from "../index.js";
import { createHash, randomBytes } from "node:crypto";

function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export interface ApiKeyRow {
  id: string;
  user_id: string;
  name: string | null;
  key_hash: string;
  scopes: string;
  created_at: string;
  expires_at: string | null;
  last_used_at: string | null;
  revoked: number;
}

export interface ApiKeyResponse {
  id: string;
  name: string | null;
  scopes: string[];
  created_at: string;
  expires_at: string | null;
  last_used_at: string | null;
  revoked: boolean;
}

export const apiKeyRepo = {
  generate(userId: string, name: string, scopes?: string[]): { row: ApiKeyRow; plainKey: string } {
    const id = `ak_${randomBytes(16).toString("hex")}`;
    const plainKey = `genvis_${randomBytes(32).toString("base64url")}`;
    const keyHash = hashKey(plainKey);
    const scopeStr = JSON.stringify(scopes?.length ? scopes : ["*"]);

    const now = isoNow();
    db.prepare(
      `INSERT INTO api_keys (id, user_id, name, key_hash, scopes, created_at, expires_at, last_used_at, revoked)
       VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, 0)`
    ).run(id, userId, name, keyHash, scopeStr, now);

    const row = { id, user_id: userId, name, key_hash: keyHash, scopes: scopeStr, created_at: now, expires_at: null, last_used_at: null, revoked: 0 };
    return { row, plainKey };
  },

  findByHash(keyHash: string): ApiKeyRow | undefined {
    return db.prepare(
      "SELECT * FROM api_keys WHERE key_hash = ? AND revoked = 0 AND (expires_at IS NULL OR expires_at > ?)"
    ).get(keyHash, isoNow()) as ApiKeyRow | undefined;
  },

  findById(id: string): ApiKeyRow | undefined {
    return db.prepare("SELECT * FROM api_keys WHERE id = ?").get(id) as ApiKeyRow | undefined;
  },

  listByUser(userId: string): ApiKeyResponse[] {
    const rows = db.prepare("SELECT * FROM api_keys WHERE user_id = ? ORDER BY created_at DESC").all(userId) as ApiKeyRow[];
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      scopes: JSON.parse(r.scopes),
      created_at: r.created_at,
      expires_at: r.expires_at,
      last_used_at: r.last_used_at,
      revoked: Boolean(r.revoked),
    }));
  },

  touch(id: string): void {
    db.prepare("UPDATE api_keys SET last_used_at = ? WHERE id = ?").run(isoNow(), id);
  },

  revoke(id: string, userId: string): boolean {
    const result = db.prepare("UPDATE api_keys SET revoked = 1 WHERE id = ? AND user_id = ?").run(id, userId);
    return (result.changes ?? 0) > 0;
  },

  delete(id: string, userId: string): boolean {
    const result = db.prepare("DELETE FROM api_keys WHERE id = ? AND user_id = ?").run(id, userId);
    return (result.changes ?? 0) > 0;
  },

  checkScope(row: ApiKeyRow, requiredScope: string): boolean {
    const scopes: string[] = JSON.parse(row.scopes);
    if (scopes.includes("*")) return true;
    return scopes.includes(requiredScope);
  },

  hash: hashKey,
};
