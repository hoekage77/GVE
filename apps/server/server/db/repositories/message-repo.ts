import { db, isoNow } from "../index.js";

export interface MessageRow {
  id: string;
  session_id: string;
  role: string;
  content: string;
  kind: string | null;
  error: string | null;
  meta: string | null;
  metadata: string | null;
  created_at: string;
  updated_at: string;
}

export interface PaginatedMessages {
  data: MessageRow[];
  meta: { page: number; limit: number; total: number; before?: string };
}

export const messageRepo = {
  create(row: Omit<MessageRow, "created_at" | "updated_at"> & { created_at?: string }): MessageRow {
    const now = isoNow();
    const createdAt = row.created_at ?? now;
    db.prepare(
      `INSERT OR REPLACE INTO messages (id, session_id, role, content, kind, error, meta, metadata, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      row.id,
      row.session_id,
      row.role,
      row.content,
      row.kind ?? null,
      row.error ?? null,
      row.meta ?? null,
      row.metadata ?? null,
      createdAt,
      now
    );
    return { ...row, created_at: createdAt, updated_at: now };
  },

  findById(id: string): MessageRow | undefined {
    return db.prepare("SELECT * FROM messages WHERE id = ?").get(id) as MessageRow | undefined;
  },

  findBySession(sessionId: string, opts?: { limit?: number; offset?: number; before?: string }): PaginatedMessages {
    const limit = Math.min(opts?.limit ?? 50, 200);
    const offset = opts?.offset ?? 0;

    let countStmt = "SELECT COUNT(*) as total FROM messages WHERE session_id = ?";
    let selectStmt = "SELECT * FROM messages WHERE session_id = ?";
    const params: any[] = [sessionId];

    if (opts?.before) {
      countStmt += " AND created_at < (SELECT created_at FROM messages WHERE id = ?)";
      selectStmt += " AND created_at < (SELECT created_at FROM messages WHERE id = ?)";
      params.push(opts.before);
    }

    const countRow = db.prepare(countStmt).get(...params) as { total: number };

    const rows = db.prepare(
      `${selectStmt} ORDER BY created_at DESC LIMIT ? OFFSET ?`
    ).all(...params, limit, offset) as MessageRow[];

    return {
      data: rows,
      meta: { page: Math.floor(offset / limit) + 1, limit, total: countRow.total, before: opts?.before },
    };
  },

  update(id: string, patch: Partial<Pick<MessageRow, "content" | "kind" | "error" | "meta" | "metadata">>): MessageRow | undefined {
    const fields: string[] = [];
    const values: any[] = [];

    if (patch.content !== undefined) {
      fields.push("content = ?");
      values.push(patch.content);
    }
    if (patch.kind !== undefined) {
      fields.push("kind = ?");
      values.push(patch.kind);
    }
    if (patch.error !== undefined) {
      fields.push("error = ?");
      values.push(patch.error ? JSON.stringify(patch.error) : null);
    }
    if (patch.meta !== undefined) {
      fields.push("meta = ?");
      values.push(Array.isArray(patch.meta) ? JSON.stringify(patch.meta) : patch.meta);
    }
    if (patch.metadata !== undefined) {
      fields.push("metadata = ?");
      values.push(patch.metadata ? JSON.stringify(patch.metadata) : null);
    }
    if (fields.length === 0) return this.findById(id);

    fields.push("updated_at = ?");
    values.push(isoNow());
    values.push(id);

    db.prepare(`UPDATE messages SET ${fields.join(", ")} WHERE id = ?`).run(...values);
    return this.findById(id);
  },

  delete(id: string): boolean {
    const result = db.prepare("DELETE FROM messages WHERE id = ?").run(id);
    return (result.changes ?? 0) > 0;
  },

  deleteBySession(sessionId: string): void {
    db.prepare("DELETE FROM messages WHERE session_id = ?").run(sessionId);
  },
};
