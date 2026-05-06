import { db, isoNow } from "../index.js";

export interface SessionRow {
  id: string;
  owner_id: string | null;
  title: string | null;
  status: string;
  archived: number;
  created_at: string;
  updated_at: string;
}

export interface PaginatedSessions {
  data: SessionRow[];
  meta: { page: number; limit: number; total: number };
}

export const sessionRepo = {
  create(id: string, ownerId: string | null, title?: string | null): SessionRow {
    const now = isoNow();
    db.prepare(
      `INSERT OR REPLACE INTO sessions (id, owner_id, title, status, created_at, updated_at)
       VALUES (?, ?, ?, 'idle', ?, ?)`
    ).run(id, ownerId ?? null, title ?? null, now, now);
    return { id, owner_id: ownerId ?? null, title: title ?? null, status: "idle", archived: 0, created_at: now, updated_at: now };
  },

  findById(id: string): SessionRow | undefined {
    return db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as SessionRow | undefined;
  },

  findByOwner(ownerId: string, opts?: { limit?: number; offset?: number; archived?: boolean }): PaginatedSessions {
    const limit = Math.min(opts?.limit ?? 20, 100);
    const offset = opts?.offset ?? 0;
    const archived = opts?.archived ?? false;

    const countRow = db.prepare(
      "SELECT COUNT(*) as total FROM sessions WHERE owner_id = ? AND archived = ?"
    ).get(ownerId, archived ? 1 : 0) as { total: number };

    const rows = db.prepare(
      `SELECT * FROM sessions
       WHERE owner_id = ? AND archived = ?
       ORDER BY updated_at DESC
       LIMIT ? OFFSET ?`
    ).all(ownerId, archived ? 1 : 0, limit, offset) as SessionRow[];

    return {
      data: rows,
      meta: { page: Math.floor(offset / limit) + 1, limit, total: countRow.total },
    };
  },

  update(id: string, patch: Partial<Pick<SessionRow, "title" | "status" | "archived">>): SessionRow | undefined {
    const fields: string[] = [];
    const values: any[] = [];

    if (patch.title !== undefined) {
      fields.push("title = ?");
      values.push(patch.title);
    }
    if (patch.status !== undefined) {
      fields.push("status = ?");
      values.push(patch.status);
    }
    if (patch.archived !== undefined) {
      fields.push("archived = ?");
      values.push(patch.archived ? 1 : 0);
    }
    if (fields.length === 0) return this.findById(id);

    fields.push("updated_at = ?");
    values.push(isoNow());
    values.push(id);

    db.prepare(`UPDATE sessions SET ${fields.join(", ")} WHERE id = ?`).run(...values);
    return this.findById(id);
  },

  delete(id: string): boolean {
    const result = db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
    return (result.changes ?? 0) > 0;
  },

  touch(id: string): void {
    db.prepare("UPDATE sessions SET updated_at = ? WHERE id = ?").run(isoNow(), id);
  },
};
