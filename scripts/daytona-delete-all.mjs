#!/usr/bin/env node
/**
 * Daytona Sandbox Batch Deletion
 *
 * Deletes sandboxes in parallel batches to avoid rate limiting.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnvFile(filePath) {
  try {
    const text = readFileSync(filePath, "utf-8");
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim();
      if (process.env[key] === undefined) process.env[key] = value;
    }
  } catch { /* ignore */ }
}

// Load from project .env if available
loadEnvFile(join(__dirname, "..", "apps", "server", "server", ".env"));
loadEnvFile(join(__dirname, "..", ".env"));

const API_BASE = (process.env.DAYTONA_API_URL || process.env.DAYTONA_SERVER_URL || "https://app.daytona.io/api").replace(/\/+$/, "");
const TOKEN = (process.env.DAYTONA_API_KEY || process.env.DAYTONA_API_TOKEN || "").trim();
const ORG_ID = (process.env.DAYTONA_ORGANIZATION_ID || process.env.DAYTONA_ORG_ID || "").trim();

const BATCH_SIZE = 20; // parallel deletes
const BATCH_DELAY_MS = 500;

async function api(path, options = {}) {
  const url = `${API_BASE}${path}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  if (!response.ok && response.status !== 404) {
    const text = await response.text().catch(() => "unknown");
    throw new Error(`API ${path} returned ${response.status}: ${text}`);
  }
  if (response.status === 204) return null;
  return response.json();
}

async function listAllSandboxes() {
  const all = [];
  let page = 1;
  const limit = 100;
  while (true) {
    const qs = new URLSearchParams({ limit: String(limit), page: String(page) });
    if (ORG_ID) qs.set("organizationId", ORG_ID);
    const payload = await api(`/sandbox?${qs.toString()}`);
    const items = Array.isArray(payload) ? payload : (payload.items || payload.sandboxes || []);
    if (items.length === 0) break;
    all.push(...items);
    if (items.length < limit) break;
    page += 1;
  }
  return all;
}

async function deleteSandbox(id) {
  try {
    const response = await fetch(`${API_BASE}/sandbox/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    return response.ok || response.status === 404;
  } catch (err) {
    console.error(`  Failed ${id}: ${err.message}`);
    return false;
  }
}

async function main() {
  if (!TOKEN) {
    console.error("❌ No DAYTONA_API_KEY found (checked env and .env files)");
    console.error(`   API_BASE: ${API_BASE}`);
    console.error(`   ORG_ID: ${ORG_ID || "not set"}`);
    process.exit(1);
  }

  console.log(`🔍 Fetching sandboxes from ${API_BASE}...`);
  const sandboxes = await listAllSandboxes();
  console.log(`📦 Found ${sandboxes.length} sandboxes`);

  if (sandboxes.length === 0) {
    console.log("✅ Nothing to delete.");
    return;
  }

  let totalDisk = 0;
  const states = {};
  for (const s of sandboxes) {
    const state = s.state || "unknown";
    states[state] = (states[state] || 0) + 1;
    totalDisk += s.disk || 0;
  }
  console.log(`💾 Total disk: ${totalDisk} GB (limit: 300 GB)`);
  console.log("States:", states);

  let deleted = 0;
  let failed = 0;
  const ids = sandboxes.map((s) => s.id || s.sandboxId).filter(Boolean);

  console.log(`\n🗑️  Deleting ${ids.length} sandboxes in batches of ${BATCH_SIZE}...`);

  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batch = ids.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(batch.map((id) => deleteSandbox(id)));
    const batchDeleted = results.filter(Boolean).length;
    const batchFailed = results.length - batchDeleted;
    deleted += batchDeleted;
    failed += batchFailed;
    process.stdout.write(`\r  Progress: ${deleted}/${ids.length} deleted, ${failed} failed`);
    if (i + BATCH_SIZE < ids.length) {
      await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
    }
  }

  console.log(`\n✅ Done. Deleted ${deleted}, failed ${failed}`);
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
