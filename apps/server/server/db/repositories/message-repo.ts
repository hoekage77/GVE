import { supabase, isoNow } from "../index.js";
import { sessionRepo } from "./session-repo.js";

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
  async create(row: Omit<MessageRow, "created_at" | "updated_at"> & { created_at?: string }): Promise<MessageRow> {
    const now = isoNow();
    const createdAt = row.created_at ?? now;

    // Ensure the parent session row exists before inserting (FK constraint).
    // This is a no-op if the session already exists (upsert).
    try {
      await sessionRepo.create(row.session_id, null);
    } catch {
      // Session may already exist — ignore duplicate key errors
    }

    const insertRow = {
      id: row.id,
      session_id: row.session_id,
      role: row.role,
      content: row.content,
      kind: row.kind ?? null,
      error: row.error ?? null,
      meta: row.meta ?? null,
      metadata: row.metadata ?? null,
      created_at: createdAt,
      updated_at: now,
    };
    const { error } = await supabase.from("messages").upsert(insertRow);
    if (error) {
      console.error("[messageRepo] create error:", error.message);
      throw error;
    }
    return { ...row, created_at: createdAt, updated_at: now };
  },

  async findById(id: string): Promise<MessageRow | undefined> {
    const { data, error } = await supabase.from("messages").select("*").eq("id", id).single();
    if (error || !data) return undefined;
    return data as MessageRow;
  },

  async findBySession(sessionId: string, opts?: { limit?: number; offset?: number; before?: string }): Promise<PaginatedMessages> {
    const limit = Math.min(opts?.limit ?? 50, 200);
    const offset = opts?.offset ?? 0;

    let query = supabase.from("messages").select("*", { count: "exact" }).eq("session_id", sessionId);

    if (opts?.before) {
      // Find the created_at of the before message
      const { data: beforeMsg } = await supabase.from("messages").select("created_at").eq("id", opts.before).single();
      if (beforeMsg) {
        query = query.lt("created_at", beforeMsg.created_at);
      }
    }

    const { data, error, count } = await query
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error("[messageRepo] findBySession error:", error.message);
      return { data: [], meta: { page: 1, limit, total: 0, before: opts?.before } };
    }

    return {
      data: (data ?? []) as MessageRow[],
      meta: { page: Math.floor(offset / limit) + 1, limit, total: count ?? 0, before: opts?.before },
    };
  },

  async update(
    id: string,
    patch: Partial<Pick<MessageRow, "content" | "kind" | "error" | "meta" | "metadata">>
  ): Promise<MessageRow | undefined> {
    const fields: Record<string, any> = { updated_at: isoNow() };
    if (patch.content !== undefined) fields.content = patch.content;
    if (patch.kind !== undefined) fields.kind = patch.kind;
    if (patch.error !== undefined) fields.error = patch.error ? JSON.stringify(patch.error) : null;
    if (patch.meta !== undefined) fields.meta = Array.isArray(patch.meta) ? JSON.stringify(patch.meta) : patch.meta;
    if (patch.metadata !== undefined) fields.metadata = patch.metadata ? JSON.stringify(patch.metadata) : null;

    const { error } = await supabase.from("messages").update(fields).eq("id", id);
    if (error) {
      console.error("[messageRepo] update error:", error.message);
      return undefined;
    }
    return this.findById(id);
  },

  async delete(id: string): Promise<boolean> {
    const { error } = await supabase.from("messages").delete().eq("id", id);
    if (error) {
      console.error("[messageRepo] delete error:", error.message);
      return false;
    }
    return true;
  },

  async deleteBySession(sessionId: string): Promise<void> {
    await supabase.from("messages").delete().eq("session_id", sessionId);
  },
};
