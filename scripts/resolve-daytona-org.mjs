#!/usr/bin/env node
/**
 * Standalone script to resolve Daytona Organization ID via API.
 *
 * Usage:
 *   node scripts/resolve-daytona-org.mjs
 *
 * Environment (or .env file):
 *   DAYTONA_API_KEY   – required, your Daytona API key
 *   DAYTONA_API_URL   – optional, defaults to https://app.daytona.io/api
 *
 * Output:
 *   Prints the resolved organization ID to stdout so you can eval it:
 *
 *   export DAYTONA_ORGANIZATION_ID=$(node scripts/resolve-daytona-org.mjs)
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Load .env file if present ─────────────────────────────────────────────
function loadDotEnv() {
  const envPaths = [
    resolve(__dirname, "../apps/server/server/.env"),
    resolve(__dirname, "../.env"),
    resolve(process.cwd(), ".env"),
  ];
  for (const path of envPaths) {
    if (!existsSync(path)) continue;
    try {
      const text = readFileSync(path, "utf-8");
      for (const line of text.split(/\r?\n/)) {
        const match = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
        if (!match) continue;
        const [, key, rawValue] = match;
        const value = rawValue.replace(/^["']|["']$/g, "").trim();
        if (value && !process.env[key]) {
          process.env[key] = value;
        }
      }
    } catch {}
  }
}
loadDotEnv();

const API_KEY = process.env.DAYTONA_API_KEY || process.env.DAYTONA_API_TOKEN;
const API_BASE = (process.env.DAYTONA_API_URL || "https://app.daytona.io/api").replace(/\/+$/, "");

if (!API_KEY || API_KEY === "your_daytona_api_key_here") {
  console.error("[resolve-daytona-org] Error: DAYTONA_API_KEY is required.");
  console.error("  1. Get your key from https://app.daytona.io/dashboard/settings/api-keys");
  console.error("  2. Set it in apps/server/server/.env:");
  console.error('     DAYTONA_API_KEY=your_real_key_here');
  console.error("  3. Run this script again.");
  process.exit(1);
}

async function resolveOrganizationId() {
  try {
    const headers = {
      Authorization: `Bearer ${API_KEY.trim()}`,
      "Content-Type": "application/json",
    };

    // Try /organizations first (admin keys)
    const orgResponse = await fetch(`${API_BASE}/organizations`, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(10000),
    });

    if (orgResponse.ok) {
      const payload = await orgResponse.json();
      const orgs = Array.isArray(payload) ? payload : payload.items || [];
      if (orgs.length > 0) {
        const orgId = orgs[0]?.id ?? orgs[0]?.organizationId ?? null;
        if (orgId) {
          console.log(String(orgId).trim());
          return;
        }
      }
    }

    // Fallback: read org ID from first sandbox (API keys with sandbox scope)
    const sandboxResponse = await fetch(`${API_BASE}/sandbox?limit=1`, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(20000),
    });

    if (!sandboxResponse.ok) {
      const text = await sandboxResponse.text().catch(() => "unknown");
      console.error(`[resolve-daytona-org] API error ${sandboxResponse.status}: ${text}`);
      process.exit(1);
    }

    const payload = await sandboxResponse.json();
    const items = Array.isArray(payload) ? payload : payload.items || [];

    if (items.length === 0) {
      console.error("[resolve-daytona-org] No sandboxes found. Cannot infer organization ID.");
      console.error("  Create at least one sandbox in your Daytona dashboard, or use a key with org-list scope.");
      process.exit(1);
    }

    const orgId = items[0]?.organizationId ?? null;
    if (!orgId) {
      console.error("[resolve-daytona-org] Sandbox missing organizationId field:", JSON.stringify(items[0], null, 2));
      process.exit(1);
    }

    console.log(String(orgId).trim());
  } catch (err) {
    console.error(`[resolve-daytona-org] Network/request failed: ${err.message}`);
    process.exit(1);
  }
}

resolveOrganizationId();
