export function parseBooleanEnv(rawValue: string | undefined, fallbackValue: boolean): boolean {
  if (rawValue === undefined || rawValue === null || rawValue === "") {
    return fallbackValue;
  }
  const normalized = String(rawValue).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallbackValue;
}

export function parseRetryDelays(rawValue: string | undefined, fallbackValue: number[]): number[] {
  if (rawValue === undefined || rawValue === null || String(rawValue).trim() === "") {
    return fallbackValue;
  }
  const parsed = String(rawValue)
    .split(",")
    .map((value) => Number.parseInt(value.trim(), 10))
    .filter((value) => Number.isFinite(value) && value >= 0);
  return parsed.length > 0 ? parsed : fallbackValue;
}

export function parsePositiveIntEnv(rawValue: string | undefined, fallbackValue: number, minimum = 1): number {
  const parsed = Number.parseInt(String(rawValue ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallbackValue;
  return Math.max(minimum, parsed);
}

export function parseTemperature(value: any, fallback: number): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

export function truncateDiagnostic(text: string, maxLength = 1000): string {
  if (!text) return "";
  const normalized = String(text);
  if (normalized.length <= maxLength) return normalized;
  
  const half = Math.floor(maxLength / 2);
  return `${normalized.slice(0, half)}\n...[TRUNCATED]...\n${normalized.slice(-half)}`;
}
