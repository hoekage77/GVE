import { supabase, isoNow } from "../index.js";
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
  async generate(userId: string, name: string, scopes?: string[]): Promise<{ row: ApiKeyRow; plainKey: string }> {
    const id = `ak_${randomBytes(16).toString("hex")}`;
    const plainKey = `genvis_${randomBytes(32).toString("base64url")}`;
    const keyHash = hashKey(plainKey);
    const scopeStr = JSON.stringify(scopes?.length ? scopes : ["*"]);

    const now = isoNow();
    const row: ApiKeyRow = {
      id,
      user_id: userId,
      name,
      key_hash: keyHash,
      scopes: scopeStr,
      created_at: now,
      expires_at: null,
      last_used_at: null,
      revoked: 0,
    };

    const { error } = await supabase.from("api_keys").insert(row);
    if (error) {
      console.error("[apiKeyRepo] generate error:", error.message);
      throw error;
    }

    return { row, plainKey };
  },

  async findByHash(keyHash: string): Promise<ApiKeyRow | undefined> {
    const { data, error } = await supabase
      .from("api_keys")
      .select("*")
      .eq("key_hash", keyHash)
      .eq("revoked", 0)
      .or(`expires_at.is.null,expires_at.gt.${isoNow()}`)
      .single();

    if (error || !data) return undefined;
    return data as ApiKeyRow;
  },

  async findById(id: string): Promise<ApiKeyRow | undefined> {
    const { data, error } = await supabase.from("api_keys").select("*").eq("id", id).single();
    if (error || !data) return undefined;
    return data as ApiKeyRow;
  },

  async listByUser(userId: string): Promise<ApiKeyResponse[]> {
    const { data, error } = await supabase
      .from("api_keys")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (error || !data) return [];

    return (data as ApiKeyRow[]).map((r) => ({
      id: r.id,
      name: r.name,
      scopes: JSON.parse(r.scopes),
      created_at: r.created_at,
      expires_at: r.expires_at,
      last_used_at: r.last_used_at,
      revoked: Boolean(r.revoked),
    }));
  },

  async touch(id: string): Promise<void> {
    await supabase.from("api_keys").update({ last_used_at: isoNow() }).eq("id", id);
  },

  async revoke(id: string, userId: string): Promise<boolean> {
    const { error } = await supabase
      .from("api_keys")
      .update({ revoked: 1 })
      .eq("id", id)
      .eq("user_id", userId);

    if (error) {
      console.error("[apiKeyRepo] revoke error:", error.message);
      return false;
    }
    return true;
  },

  async delete(id: string, userId: string): Promise<boolean> {
    const { error } = await supabase.from("api_keys").delete().eq("id", id).eq("user_id", userId);
    if (error) {
      console.error("[apiKeyRepo] delete error:", error.message);
      return false;
    }
    return true;
  },

  checkScope(row: ApiKeyRow, requiredScope: string): boolean {
    const scopes: string[] = JSON.parse(row.scopes);
    if (scopes.includes("*")) return true;
    return scopes.includes(requiredScope);
  },

  hash: hashKey,
};
