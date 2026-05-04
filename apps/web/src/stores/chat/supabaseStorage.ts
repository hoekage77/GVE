import type { StateStorage } from "zustand/middleware";
import { supabase } from "../../lib/supabase";

function safeLocalStorageSetItem(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch (err) {
    if (err instanceof DOMException && err.name === "QuotaExceededError") {
      // Evict oldest entries (anything prefixed with the same namespace)
      const prefix = key.split("-")[0] ?? key;
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(prefix)) {
          keysToRemove.push(k);
        }
      }
      // Sort by least recently used isn't available; just remove first few
      for (const k of keysToRemove.slice(0, 3)) {
        try {
          localStorage.removeItem(k);
        } catch {
          // ignore
        }
      }
      try {
        localStorage.setItem(key, value);
      } catch {
        // Still failing — silently drop persistence for this write
      }
    }
  }
}

function safeLocalStorageGetItem(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeLocalStorageRemoveItem(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

export function createSupabaseStorage(name: string): StateStorage {
  const localKey = name;

  return {
    getItem: async (key) => {
      const fullKey = `${localKey}-${key}`;

      // Try Supabase first
      if (supabase) {
        try {
          const { data, error } = await supabase
            .from("chat_store_state")
            .select("value")
            .eq("key", fullKey)
            .single();

          if (!error && data?.value) {
            return data.value;
          }
        } catch {
          // Supabase failed — fall through to localStorage
        }
      }

      return safeLocalStorageGetItem(fullKey);
    },

    setItem: async (key, value) => {
      const fullKey = `${localKey}-${key}`;

      if (supabase) {
        try {
          const { error } = await supabase.from("chat_store_state").upsert(
            {
              key: fullKey,
              value,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "key" }
          );

          if (!error) {
            // Also write to localStorage as a hot cache / offline fallback
            safeLocalStorageSetItem(fullKey, value);
            return;
          }
        } catch {
          // Supabase failed — fall through to localStorage
        }
      }

      safeLocalStorageSetItem(fullKey, value);
    },

    removeItem: async (key) => {
      const fullKey = `${localKey}-${key}`;

      if (supabase) {
        try {
          await supabase.from("chat_store_state").delete().eq("key", fullKey);
        } catch {
          // ignore
        }
      }

      safeLocalStorageRemoveItem(fullKey);
    },
  };
}
