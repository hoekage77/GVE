#!/usr/bin/env node
/**
 * Daytona Sandbox Inspector & Cleanup
 *
 * Lists all sandboxes in the Daytona organization and optionally deletes them.
 *
 * Usage:
 *   node scripts/daytona-cleanup.mjs
 *   node scripts/daytona-cleanup.mjs --delete
 *   node scripts/daytona-cleanup.mjs --delete --yes
 */

const API_BASE = process.env.DAYTONA_API_URL || process.env.DAYTONA_SERVER_URL || "https://app.daytona.io/api";
const TOKEN = (process.env.DAYTONA_API_KEY || process.env.DAYTONA_API_TOKEN || "").trim();
const ORG_ID = (process.env.DAYTONA_ORGANIZATION_ID || process.env.DAYTONA_ORG_ID || "").trim();

const DELETE_MODE = process.argv.includes("--delete");
const SKIP_CONFIRM = process.argv.includes("--yes");

async function api(path, options = {}) {
  const url = `${API_BASE.replace(/\/+$/, "")}${path}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "unknown");
    throw new Error(`API ${path} returned ${response.status}: ${text}`);
  }
  if (response.status === 204) return null;
  return response.json();
}

async function listAllSandboxes() {
  // Daytona list endpoint — paginated
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

async function deleteSandbox(sandbox) {
  const id = sandbox.id || sandbox.sandboxId || sandbox.workspaceId;
  if (!id) {
    console.warn("  ⚠️ Cannot delete: no id found", Object.keys(sandbox));
    return false;
  }
  try {
    await api(`/sandbox/${id}`, { method: "DELETE" });
    return true;
  } catch (err) {
    console.error(`  ❌ Failed to delete ${id}: ${err.message}`);
    return false;
  }
}

async function main() {
  if (!TOKEN) {
    console.error("❌ No DAYTONA_API_KEY or DAYTONA_API_TOKEN found in environment.");
    process.exit(1);
  }

  console.log(`🔍 Fetching sandboxes from ${API_BASE}...`);
  if (ORG_ID) console.log(`   Organization: ${ORG_ID}`);

  const sandboxes = await listAllSandboxes();

  if (sandboxes.length === 0) {
    console.log("✅ No sandboxes found.");
    return;
  }

  console.log(`\n📦 Found ${sandboxes.length} sandbox(es):\n`);

  let totalDisk = 0;
  for (const s of sandboxes) {
    const id = s.id || s.sandboxId || s.workspaceId || "unknown";
    const state = s.state || s.status || "unknown";
    const image = s.image || s.imageRef || "default";
    const created = s.createdAt || s.created_at || "unknown";
    const disk = s.resources?.disk ?? s.diskSize ?? s.disk ?? 0;
    totalDisk += Number(disk) || 0;
    console.log(`  • ${id}`);
    console.log(`    state: ${state}, image: ${image}, created: ${created}, disk: ${disk || "?"}`);
  }

  console.log(`\n💾 Estimated total disk: ${totalDisk} GB (Daytona limit: 300 GB)`);

  if (DELETE_MODE) {
    if (!SKIP_CONFIRM) {
      const readline = (await import("node:readline")).createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      const answer = await new Promise((resolve) => {
        readline.question(`\n⚠️  Delete ALL ${sandboxes.length} sandboxes? Type "yes" to confirm: `, resolve);
      });
      readline.close();
      if (answer.trim().toLowerCase() !== "yes") {
        console.log("❌ Aborted.");
        return;
      }
    }

    console.log(`\n🗑️  Deleting ${sandboxes.length} sandboxes...`);
    let deleted = 0;
    let failed = 0;
    for (const s of sandboxes) {
      const id = s.id || s.sandboxId || s.workspaceId;
      process.stdout.write(`  Deleting ${id}... `);
      const ok = await deleteSandbox(s);
      if (ok) {
        deleted += 1;
        console.log("✅");
      } else {
        failed += 1;
        console.log("❌");
      }
      // Small delay to avoid rate limiting
      await new Promise((r) => setTimeout(r, 300));
    }
    console.log(`\n✅ Deleted ${deleted}/${sandboxes.length} sandboxes. Failed: ${failed}`);
  } else {
    console.log(`\n💡 Run with --delete to clean them up, or --delete --yes to skip confirmation.`);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});
