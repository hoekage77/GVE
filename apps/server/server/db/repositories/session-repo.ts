import { supabase, isoNow } from "../index.js";

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
  async create(id: string, ownerId: string | null, title?: string | null): Promise<SessionRow> {
    const now = isoNow();
    const row: SessionRow = {
      id,
      owner_id: ownerId ?? null,
      title: title ?? null,
      status: "idle",
      archived: 0,
      created_at: now,
      updated_at: now,
    };
    const { error } = await supabase.from("sessions").upsert(row);
    if (error) {
      console.error("[sessionRepo] create error:", error.message);
      throw error;
    }
    return row;
  },

  async findById(id: string): Promise<SessionRow | undefined> {
    const { data, error } = await supabase.from("sessions").select("*").eq("id", id).single();
    if (error || !data) return undefined;
    return data as SessionRow;
  },

  async getAll(): Promise<{ data: SessionRow[] | null; error: Error | null }> {
    const { data, error } = await supabase.from("sessions").select("*").order("updated_at", { ascending: false });
    if (error) return { data: null, error: error };
    return { data: data as SessionRow[], error: null };
  },

  async findByOwner(ownerId: string, opts?: { limit?: number; offset?: number; archived?: boolean }): Promise<PaginatedSessions> {
    const limit = Math.min(opts?.limit ?? 20, 100);
    const offset = opts?.offset ?? 0;
    const archived = opts?.archived ?? false;

    // Include sessions owned by this user OR unowned (owner_id IS NULL)
    const ownerFilter = `owner_id.eq.${ownerId},owner_id.is.null`;

    const { count, error: countError } = await supabase
      .from("sessions")
      .select("*", { count: "exact", head: true })
      .or(ownerFilter)
      .eq("archived", archived ? 1 : 0);

    if (countError) {
      console.error("[sessionRepo] findByOwner count error:", countError.message);
    }

    const { data, error } = await supabase
      .from("sessions")
      .select("*")
      .or(ownerFilter)
      .eq("archived", archived ? 1 : 0)
      .order("updated_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error("[sessionRepo] findByOwner error:", error.message);
      return { data: [], meta: { page: 1, limit, total: 0 } };
    }

    return {
      data: (data ?? []) as SessionRow[],
      meta: { page: Math.floor(offset / limit) + 1, limit, total: count ?? 0 },
    };
  },

  async update(id: string, patch: Partial<Pick<SessionRow, "title" | "status" | "archived">>): Promise<SessionRow | undefined> {
    const fields: Record<string, any> = { updated_at: isoNow() };
    if (patch.title !== undefined) fields.title = patch.title;
    if (patch.status !== undefined) fields.status = patch.status;
    if (patch.archived !== undefined) fields.archived = patch.archived ? 1 : 0;

    const { error } = await supabase.from("sessions").update(fields).eq("id", id);
    if (error) {
      console.error("[sessionRepo] update error:", error.message);
      return undefined;
    }
    return this.findById(id);
  },

  async delete(id: string): Promise<boolean> {
    const { error } = await supabase.from("sessions").delete().eq("id", id);
    if (error) {
      console.error("[sessionRepo] delete error:", error.message);
      return false;
    }
    return true;
  },

  async touch(id: string): Promise<void> {
    await supabase.from("sessions").update({ updated_at: isoNow() }).eq("id", id);
  },
};
