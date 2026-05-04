import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

let preflightExecuted = false;

interface DaytonaPreflight {
  ok: boolean;
  warnings: string[];
  info: string[];
  summary: {
    hasApiKey: boolean;
    hasJwtToken: boolean;
    hasOrganization: boolean;
  };
}

function parseEnvValue(rawValue: string): string {
  const trimmed = rawValue.trim();

  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

function loadEnvFile(envPath: string): void {
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
// Try package-root .env first, then same-dir fallback for legacy layouts
const envPath = join(currentDir, "..", ".env");
const fallbackEnvPath = join(currentDir, ".env");
const loadedEnvPath = existsSync(envPath) ? envPath : fallbackEnvPath;
loadEnvFile(loadedEnvPath);
console.log("[Env] Loaded .env from", loadedEnvPath);

// Startup security check: warn if .env file looks like it contains real secrets
function warnIfEnvContainsSecrets(path: string): void {
  if (!existsSync(path)) return;
  const content = readFileSync(path, "utf8");
  const secretPatterns = [
    /sk-[a-zA-Z0-9]{20,}/,          // OpenAI-style keys
    /dtn_[a-f0-9]{40,}/,            // Daytona keys
    /gsk_[a-zA-Z0-9]{20,}/,         // Groq keys
    /AIza[a-zA-Z0-9_-]{20,}/,      // Gemini keys
    /fw_[a-zA-Z0-9]{10,}/,          // Fireworks keys
    /sk_test_[a-zA-Z0-9]{10,}/,     // Clerk test keys
    /pk_test_[a-zA-Z0-9]{10,}/,     // Clerk publishable keys
  ];
  let matchCount = 0;
  for (const pattern of secretPatterns) {
    if (pattern.test(content)) matchCount++;
  }
  if (matchCount >= 2) {
    console.warn(
      "[Env][SECURITY] The .env file appears to contain real API keys on disk. " +
      "Ensure .env files are excluded from version control and backups. " +
      "If this machine is shared or imaged, rotate your keys immediately."
    );
  }
}
warnIfEnvContainsSecrets(loadedEnvPath);

function hasValue(value: string | undefined | null): boolean {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

export function getDaytonaEnvPreflight(): DaytonaPreflight {
  const hasApiKey = hasValue(process.env.DAYTONA_API_KEY);
  const hasJwtToken = hasValue(process.env.DAYTONA_JWT) || hasValue(process.env.DAYTONA_TOKEN);
  const hasOrganization = hasValue(process.env.DAYTONA_ORGANIZATION_ID)
    || hasValue(process.env.DAYTONA_ORG_ID)
    || hasValue(process.env.DAYTONA_ORG);

  const warnings: string[] = [];
  const info: string[] = [];

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

export function runDaytonaEnvPreflight(logger: Pick<Console, "info" | "warn"> = console): DaytonaPreflight {
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

  // Log token limit configuration.
  const sessionLimit = process.env.TOKEN_LIMIT_PER_SESSION;
  const userDailyLimit = process.env.TOKEN_LIMIT_PER_USER_DAILY;
  if (sessionLimit || userDailyLimit) {
    logger.info?.(`[Env][TokenLimits] Session=${sessionLimit ?? "unlimited"}, UserDaily=${userDailyLimit ?? "unlimited"}`);
  }

  // Log dedicated sandbox configuration.
  if (hasValue(process.env.DEDICATED_SANDBOX_ENABLED)) {
    logger.info?.(`[Env][DedicatedSandbox] DEDICATED_SANDBOX_ENABLED=${process.env.DEDICATED_SANDBOX_ENABLED}`);
  }

  return preflight;
}
