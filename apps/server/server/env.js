import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

let preflightExecuted = false;

function parseEnvValue(rawValue) {
  const trimmed = rawValue.trim();

  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

function loadEnvFile(envPath) {
  if (!existsSync(envPath)) {
    return;
  }

  const content = readFileSync(envPath, "utf8");

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    const key = trimmed.slice(0, separatorIndex).trim();
    const value = parseEnvValue(trimmed.slice(separatorIndex + 1));

    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

const currentDir = dirname(fileURLToPath(import.meta.url));
loadEnvFile(join(currentDir, ".env"));

function hasValue(value) {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

export function getDaytonaEnvPreflight() {
  const hasApiKey = hasValue(process.env.DAYTONA_API_KEY);
  const hasJwtToken = hasValue(process.env.DAYTONA_JWT) || hasValue(process.env.DAYTONA_TOKEN);
  const hasOrganization = hasValue(process.env.DAYTONA_ORGANIZATION_ID)
    || hasValue(process.env.DAYTONA_ORG_ID)
    || hasValue(process.env.DAYTONA_ORG);

  const warnings = [];
  const info = [];

  if (!hasApiKey && !hasJwtToken) {
    warnings.push(
      "No Daytona credentials detected. Set DAYTONA_API_KEY or DAYTONA_JWT/DAYTONA_TOKEN before starting runtime execution."
    );
  }

  if (hasJwtToken && !hasOrganization) {
    warnings.push(
      "DAYTONA_JWT/DAYTONA_TOKEN is set without an organization id. Add DAYTONA_ORGANIZATION_ID (or DAYTONA_ORG_ID) to avoid 'Organization ID is required when using JWT token'."
    );
  }

  if (hasApiKey && hasJwtToken) {
    info.push("Both DAYTONA_API_KEY and JWT token are set; Daytona SDK may choose one auth path based on SDK config.");
  }

  return {
    ok: warnings.length === 0,
    warnings,
    info,
    summary: {
      hasApiKey,
      hasJwtToken,
      hasOrganization
    }
  };
}

export function runDaytonaEnvPreflight(logger = console) {
  if (preflightExecuted) {
    return getDaytonaEnvPreflight();
  }

  preflightExecuted = true;
  const preflight = getDaytonaEnvPreflight();

  for (const message of preflight.info) {
    logger.info?.(`[Env][Daytona] ${message}`);
  }

  for (const message of preflight.warnings) {
    logger.warn?.(`[Env][Daytona] ${message}`);
  }

  return preflight;
}