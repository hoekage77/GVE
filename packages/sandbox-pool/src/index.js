import { Daytona } from "@daytonaio/sdk";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parsePositiveIntEnv(rawValue, fallbackValue, minimum = 1) {
  const parsed = Number.parseInt(String(rawValue ?? ""), 10);
  if (!Number.isFinite(parsed)) {
    return fallbackValue;
  }

  return Math.max(minimum, parsed);
}

function parseBoundedFloatEnv(rawValue, fallbackValue, minimum = 0, maximum = 1) {
  const parsed = Number.parseFloat(String(rawValue ?? ""));
  if (!Number.isFinite(parsed)) {
    return fallbackValue;
  }

  return Math.min(maximum, Math.max(minimum, parsed));
}

function isRetryableProvisionError(error) {
  const message = String(error instanceof Error ? error.message : error ?? "").toLowerCase();
  const retryablePatterns = [
    "502",
    "503",
    "504",
    "bad gateway",
    "service unavailable",
    "gateway timeout",
    "connection reset",
    "connection refused",
    "connection error",
    "timeout",
    "not ready",
    "temporarily unavailable"
  ];

  return retryablePatterns.some((pattern) => message.includes(pattern));
}

function delayMs(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function average(list) {
  if (!Array.isArray(list) || list.length === 0) {
    return 0;
  }

  const total = list.reduce((sum, value) => sum + value, 0);
  return total / list.length;
}

function round(value, precision = 2) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  const scale = 10 ** precision;
  return Math.round(value * scale) / scale;
}

function percent(numerator, denominator) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
    return 0;
  }

  return (numerator / denominator) * 100;
}

export class SandboxPoolManager {
  constructor() {
    this.directCreateTimeoutSec = parsePositiveIntEnv(
      process.env.DAYTONA_DIRECT_CREATE_TIMEOUT_SECONDS,
      10,
      3
    );
    this.fallbackCreateTimeoutSec = parsePositiveIntEnv(
      process.env.DAYTONA_FALLBACK_CREATE_TIMEOUT_SECONDS,
      25,
      5
    );
    this.prewarmSize = parsePositiveIntEnv(
      process.env.DAYTONA_PREWARM_SIZE,
      0,
      0
    );
    this.prewarmReplenishThreshold = parseBoundedFloatEnv(
      process.env.DAYTONA_PREWARM_REPLENISH_THRESHOLD,
      1,
      0.05,
      1
    );
    this.prewarmCheckIntervalSec = parsePositiveIntEnv(
      process.env.DAYTONA_PREWARM_CHECK_INTERVAL_SECONDS,
      15,
      5
    );
    this.acquireRetryAttempts = parsePositiveIntEnv(
      process.env.DAYTONA_ACQUIRE_RETRY_ATTEMPTS,
      1,
      1
    );
    this.acquireRetryBaseDelayMs = parsePositiveIntEnv(
      process.env.DAYTONA_ACQUIRE_RETRY_BASE_DELAY_MS,
      250,
      50
    );
    this.metricsWindowSize = parsePositiveIntEnv(
      process.env.DAYTONA_METRICS_WINDOW_SIZE,
      120,
      20
    );
    this.metricsLogEvery = parsePositiveIntEnv(
      process.env.DAYTONA_METRICS_LOG_EVERY,
      20,
      1
    );
    this.idleSandboxes = [];
    this.pendingWarmups = 0;
    this.metrics = {
      acquireAttemptsTotal: 0,
      acquireSuccessTotal: 0,
      acquireFailuresTotal: 0,
      directAcquires: 0,
      fallbackAcquires: 0,
      prewarmAcquires: 0,
      prewarmProvisionSuccessTotal: 0,
      prewarmProvisionFailureTotal: 0,
      releaseReturnedToPoolTotal: 0,
      releaseDeletedTotal: 0,
      maintenanceRunsTotal: 0,
      allAcquireDurationsMs: [],
      directAcquireDurationsMs: [],
      fallbackAcquireDurationsMs: [],
      prewarmAcquireDurationsMs: [],
      lastAcquireAt: null,
      lastFailureAt: null,
      lastFailureReason: null,
      lastMaintenanceAt: null
    };

    this._startMaintenanceLoop();
  }

  _startMaintenanceLoop() {
    if (this.prewarmSize <= 0 || this.prewarmCheckIntervalSec <= 0) {
      return;
    }

    const intervalMs = this.prewarmCheckIntervalSec * 1000;
    this._maintenanceTimer = setInterval(() => {
      this.metrics.maintenanceRunsTotal += 1;
      this.metrics.lastMaintenanceAt = new Date().toISOString();
      this._ensurePrewarmCapacity("maintenance", { force: false });
    }, intervalMs);

    if (typeof this._maintenanceTimer.unref === "function") {
      this._maintenanceTimer.unref();
    }

    this._ensurePrewarmCapacity("startup", { force: true });
  }

  _pushRollingMetric(list, value) {
    if (!Array.isArray(list) || !Number.isFinite(value)) {
      return;
    }

    list.push(value);
    if (list.length > this.metricsWindowSize) {
      list.splice(0, list.length - this.metricsWindowSize);
    }
  }

  _recordAcquireSuccess(mode, durationMs) {
    const normalizedDuration = Math.max(0, Number(durationMs) || 0);
    this.metrics.acquireSuccessTotal += 1;
    this.metrics.lastAcquireAt = new Date().toISOString();
    this._pushRollingMetric(this.metrics.allAcquireDurationsMs, normalizedDuration);

    if (mode === "direct") {
      this.metrics.directAcquires += 1;
      this._pushRollingMetric(this.metrics.directAcquireDurationsMs, normalizedDuration);
    } else if (mode === "fallback") {
      this.metrics.fallbackAcquires += 1;
      this._pushRollingMetric(this.metrics.fallbackAcquireDurationsMs, normalizedDuration);
    } else if (mode === "prewarm") {
      this.metrics.prewarmAcquires += 1;
      this._pushRollingMetric(this.metrics.prewarmAcquireDurationsMs, normalizedDuration);
    }

    this._maybeLogMetricsSummary();
  }

  _recordAcquireFailure(error, durationMs) {
    this.metrics.acquireFailuresTotal += 1;
    this.metrics.lastFailureAt = new Date().toISOString();
    this.metrics.lastFailureReason = truncateForLog(error instanceof Error ? error.message : String(error));
    const elapsed = Math.max(0, Number(durationMs) || 0);
    console.warn(
      `[Daytona][Metrics] Acquire failure #${this.metrics.acquireFailuresTotal} after ${elapsed}ms: ${this.metrics.lastFailureReason}`
    );
  }

  _buildMetricsSnapshot() {
    const acquireSuccessTotal = this.metrics.acquireSuccessTotal;
    const prewarmHitRatePct = round(percent(this.metrics.prewarmAcquires, acquireSuccessTotal));
    const fallbackRatePct = round(percent(this.metrics.fallbackAcquires, acquireSuccessTotal));

    return {
      acquireAttemptsTotal: this.metrics.acquireAttemptsTotal,
      acquireSuccessTotal,
      acquireFailuresTotal: this.metrics.acquireFailuresTotal,
      directAcquires: this.metrics.directAcquires,
      fallbackAcquires: this.metrics.fallbackAcquires,
      prewarmAcquires: this.metrics.prewarmAcquires,
      prewarmHitRatePct,
      fallbackRatePct,
      rollingWindowSize: this.metricsWindowSize,
      avgAcquireMs: round(average(this.metrics.allAcquireDurationsMs), 1),
      avgDirectAcquireMs: round(average(this.metrics.directAcquireDurationsMs), 1),
      avgFallbackAcquireMs: round(average(this.metrics.fallbackAcquireDurationsMs), 1),
      avgPrewarmAcquireMs: round(average(this.metrics.prewarmAcquireDurationsMs), 1),
      prewarmProvisionSuccessTotal: this.metrics.prewarmProvisionSuccessTotal,
      prewarmProvisionFailureTotal: this.metrics.prewarmProvisionFailureTotal,
      releaseReturnedToPoolTotal: this.metrics.releaseReturnedToPoolTotal,
      releaseDeletedTotal: this.metrics.releaseDeletedTotal,
      maintenanceRunsTotal: this.metrics.maintenanceRunsTotal,
      idleSandboxes: this.idleSandboxes.length,
      pendingWarmups: this.pendingWarmups,
      configuredPrewarmSize: this.prewarmSize,
      prewarmReplenishThreshold: this.prewarmReplenishThreshold,
      prewarmCheckIntervalSec: this.prewarmCheckIntervalSec,
      acquireRetryAttempts: this.acquireRetryAttempts,
      acquireRetryBaseDelayMs: this.acquireRetryBaseDelayMs,
      lastAcquireAt: this.metrics.lastAcquireAt,
      lastFailureAt: this.metrics.lastFailureAt,
      lastFailureReason: this.metrics.lastFailureReason,
      lastMaintenanceAt: this.metrics.lastMaintenanceAt
    };
  }

  _maybeLogMetricsSummary(force = false) {
    if (!force && this.metrics.acquireSuccessTotal > 0 && this.metrics.acquireSuccessTotal % this.metricsLogEvery !== 0) {
      return;
    }

    const snapshot = this._buildMetricsSnapshot();
    console.log(
      `[Daytona][Metrics] acquires=${snapshot.acquireSuccessTotal}/${snapshot.acquireAttemptsTotal} failures=${snapshot.acquireFailuresTotal} prewarmHit=${snapshot.prewarmHitRatePct}% fallbackRate=${snapshot.fallbackRatePct}% avgMs=${snapshot.avgAcquireMs} directAvgMs=${snapshot.avgDirectAcquireMs} fallbackAvgMs=${snapshot.avgFallbackAcquireMs} idle=${snapshot.idleSandboxes}/${snapshot.configuredPrewarmSize}`
    );
  }

  getMetricsSnapshot() {
    return this._buildMetricsSnapshot();
  }

  async _getDaytonaClient() {
    if (!this.daytona) {
      try {
        this.daytona = new Daytona();
      } catch (err) {
        console.error("[Daytona] Initialization Failed:", err.message);
        throw err;
      }
    }
    return this.daytona;
  }

  async _provisionWorkspace({ skillId = "unknown", reason = "acquire" } = {}) {
    const daytona = await this._getDaytonaClient();
    const acquireStartedAt = Date.now();
    let workspace;
    let workspaceId = `gve-${crypto.randomUUID().slice(0, 8)}`;
    let directCreateDurationMs = 0;

    try {
      const directCreateStartedAt = Date.now();
      workspace = await daytona.create({
        id: workspaceId,
        image: "node:20-alpine" // Lightweight node container
      }, { timeout: this.directCreateTimeoutSec });
      directCreateDurationMs = Date.now() - directCreateStartedAt;
      console.log(
        `[Daytona] Workspace ${workspaceId} created in ${directCreateDurationMs}ms (${reason}, skill=${skillId}).`
      );
      return {
        workspace,
        workspaceId,
        creationMode: "direct",
        acquireDurationMs: Date.now() - acquireStartedAt
      };
    } catch (err) {
      directCreateDurationMs = Math.max(0, Date.now() - acquireStartedAt);
      console.warn(
        `[Daytona] Failed to create workspace with direct options after ${directCreateDurationMs}ms, trying default... (${err.message})`
      );

      const fallbackCreateStartedAt = Date.now();
      try {
        workspace = await daytona.create(undefined, { timeout: this.fallbackCreateTimeoutSec });
        workspaceId = workspace.id;
        const fallbackDurationMs = Date.now() - fallbackCreateStartedAt;
        const totalAcquireMs = Date.now() - acquireStartedAt;
        console.log(
          `[Daytona] Fallback workspace ${workspaceId} created in ${fallbackDurationMs}ms (total acquire ${totalAcquireMs}ms, ${reason}, skill=${skillId}).`
        );
        return {
          workspace,
          workspaceId,
          creationMode: "fallback",
          acquireDurationMs: totalAcquireMs
        };
      } catch (fallbackErr) {
        const totalDurationMs = Date.now() - acquireStartedAt;
        const fallbackMessage = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
        const directMessage = err instanceof Error ? err.message : String(err);
        throw new Error(
          `Daytona acquire failed after ${totalDurationMs}ms. direct=${truncateForLog(directMessage)} | fallback=${truncateForLog(fallbackMessage)}`
        );
      }
    }
  }

  async _provisionWorkspaceWithRetry({ skillId = "unknown", reason = "acquire" } = {}) {
    let lastError = null;

    for (let attempt = 1; attempt <= this.acquireRetryAttempts; attempt += 1) {
      try {
        return await this._provisionWorkspace({ skillId, reason });
      } catch (error) {
        lastError = error;
        const canRetry = attempt < this.acquireRetryAttempts && isRetryableProvisionError(error);
        if (!canRetry) {
          throw error;
        }

        const backoffMs = this.acquireRetryBaseDelayMs * (2 ** (attempt - 1));
        console.warn(
          `[Daytona] Acquire retry ${attempt}/${this.acquireRetryAttempts} in ${backoffMs}ms for skill ${skillId}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
        await delayMs(backoffMs);
      }
    }

    throw lastError ?? new Error("Daytona acquire failed after retries.");
  }

  _ensurePrewarmCapacity(skillId = "unknown", { force = false } = {}) {
    if (this.prewarmSize <= 0) {
      return;
    }

    const available = this.idleSandboxes.length + this.pendingWarmups;
    const replenishBelow = Math.max(1, Math.ceil(this.prewarmSize * this.prewarmReplenishThreshold));
    if (!force && available >= replenishBelow) {
      return;
    }

    const deficit = this.prewarmSize - available;
    if (deficit <= 0) {
      return;
    }

    for (let index = 0; index < deficit; index += 1) {
      this.pendingWarmups += 1;

      void this._provisionWorkspaceWithRetry({ skillId, reason: "prewarm" })
        .then(({ workspace, workspaceId, creationMode, acquireDurationMs }) => {
          this.metrics.prewarmProvisionSuccessTotal += 1;
          if (this.idleSandboxes.length >= this.prewarmSize) {
            void this._deleteWorkspace(workspace, workspaceId, "prewarm_overflow");
            return;
          }

          this.idleSandboxes.push({ workspace, workspaceId });
          console.log(
            `[Daytona] Prewarmed sandbox ${workspaceId} ready via ${creationMode} in ${acquireDurationMs}ms. idle=${this.idleSandboxes.length}/${this.prewarmSize}`
          );
        })
        .catch((error) => {
          this.metrics.prewarmProvisionFailureTotal += 1;
          console.warn(`[Daytona] Prewarm failed: ${error instanceof Error ? error.message : String(error)}`);
        })
        .finally(() => {
          this.pendingWarmups = Math.max(0, this.pendingWarmups - 1);
        });
    }
  }

  _createSandboxHandle({ workspaceId, workspace, source = "ondemand" }) {
    const handle = {
      workspaceId,
      _workspace: workspace,
      _reusable: true,
      _source: source,
      execute: async (payloadStr) => {
        const runnerPath = path.join(__dirname, "runner-script.js");
        const runnerScript = await fs.readFile(runnerPath, "utf-8");

        // We run node via -e. We wrap the payload string into base64 to avoid quote escaping hell inside bash
        const payloadB64 = Buffer.from(payloadStr).toString("base64");

        // Let runner-script decode process.argv[1] from base64
        const execCode = `
          ${runnerScript}
          let str = Buffer.from(process.argv[1], 'base64').toString('utf-8');
          try {
            const result = executePayload(str);
            console.log('__DAYTONA_RESULT__' + result + '__DAYTONA_RESULT_END__');
          } catch(err) {
            console.log('__DAYTONA_RESULT__' + JSON.stringify({ success: false, error: err.message }) + '__DAYTONA_RESULT_END__');
          }
        `;

        console.log(`[Daytona] Executing payload on ${workspaceId}...`);

        let execResult;
        const bashCmd = `node --input-type=module -e "$(echo '${Buffer.from(execCode).toString("base64")}' | base64 -d)" "${payloadB64}"`;

        console.log(`[Daytona] [TRACE] Command:\n${bashCmd.slice(0, 500)}${bashCmd.length > 500 ? "..." : ""}`);

        const executionStartedAt = Date.now();
        try {
          execResult = await workspace.process.executeCommand(bashCmd);
        } catch (err) {
          handle._reusable = false;
          console.error(`[Daytona] [ERROR] Execution failed after ${Date.now() - executionStartedAt}ms:`, err.message);
          throw new Error(`Failed to execute on Daytona workspace: ${err.message}`);
        }

        console.log(`[Daytona] [TRACE] Execution finished in ${Date.now() - executionStartedAt}ms.`);

        const out = execResult.result || execResult.stdout || execResult.output || "";
        console.log(`[Daytona] [TRACE] Raw result (first 200 chars):\n${out.slice(0, 200)}...`);

        const m = out.match(/__DAYTONA_RESULT__(.*)__DAYTONA_RESULT_END__/s);
        if (m && m[1]) {
          return JSON.parse(m[1].trim());
        }

        handle._reusable = false;
        throw new Error(`Invalid output from Daytona sandbox. Output: ${out.slice(0, 100)}...`);
      }
    };

    return handle;
  }

  async acquire(requirements) {
    const normalizedSkillId = requirements?.skillId ?? "unknown";
    this.metrics.acquireAttemptsTotal += 1;
    const acquireStartedAt = Date.now();
    this._ensurePrewarmCapacity(normalizedSkillId, { force: false });

    if (this.idleSandboxes.length > 0) {
      const reused = this.idleSandboxes.pop();
      console.log(
        `[Daytona] Reusing prewarmed sandbox ${reused.workspaceId} for skill ${normalizedSkillId}. idle=${this.idleSandboxes.length}/${this.prewarmSize}`
      );
      this._ensurePrewarmCapacity(normalizedSkillId, { force: true });
      this._recordAcquireSuccess("prewarm", Date.now() - acquireStartedAt);
      return this._createSandboxHandle({
        workspaceId: reused.workspaceId,
        workspace: reused.workspace,
        source: "prewarm"
      });
    }

    console.log(
      `[Daytona] Acquiring on-demand sandbox for skill ${normalizedSkillId} (direct timeout=${this.directCreateTimeoutSec}s, fallback timeout=${this.fallbackCreateTimeoutSec}s)...`
    );

    let provisioned;
    try {
      provisioned = await this._provisionWorkspaceWithRetry({
        skillId: normalizedSkillId,
        reason: "acquire"
      });
    } catch (error) {
      this._recordAcquireFailure(error, Date.now() - acquireStartedAt);
      throw error;
    }

    this._recordAcquireSuccess(provisioned.creationMode, Date.now() - acquireStartedAt);

    this._ensurePrewarmCapacity(normalizedSkillId, { force: false });

    return this._createSandboxHandle({
      workspaceId: provisioned.workspaceId,
      workspace: provisioned.workspace,
      source: provisioned.creationMode
    });
  }

  async _deleteWorkspace(workspace, workspaceId, reason = "release") {
    try {
      const daytona = await this._getDaytonaClient();
      await daytona.delete(workspace);
      console.log(`[Daytona] Deleted sandbox ${workspaceId} (${reason}).`);
    } catch (err) {
      console.error(`[Daytona] Error deleting workspace ${workspaceId}:`, err.message);
    }
  }

  async release(sandboxEnv) {
    if (!sandboxEnv || !sandboxEnv._workspace) return;

    const reusable = sandboxEnv._reusable !== false;
    if (this.prewarmSize > 0 && reusable && this.idleSandboxes.length < this.prewarmSize) {
      this.idleSandboxes.push({
        workspaceId: sandboxEnv.workspaceId,
        workspace: sandboxEnv._workspace
      });
      this.metrics.releaseReturnedToPoolTotal += 1;
      console.log(
        `[Daytona] Returned sandbox ${sandboxEnv.workspaceId} to warm pool. idle=${this.idleSandboxes.length}/${this.prewarmSize}`
      );
      this._ensurePrewarmCapacity("release", { force: false });
      return;
    }

    console.log(`[Daytona] Releasing/Deleting sandbox ${sandboxEnv.workspaceId}...`);
    this.metrics.releaseDeletedTotal += 1;
    await this._deleteWorkspace(sandboxEnv._workspace, sandboxEnv.workspaceId, reusable ? "release" : "unhealthy");
    this._ensurePrewarmCapacity("release", { force: false });
  }
}

function truncateForLog(value, maxLength = 220) {
  const text = String(value ?? "");
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}
