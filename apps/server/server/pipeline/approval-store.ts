/**
 * Approval Store — Deferred promise registry for mid-flight agent approvals.
 *
 * When an agent needs user consent (e.g., before expensive npm install or execution),
 * it calls requestApproval(). This:
 *   1. Broadcasts `agent:approval_request` over WebSocket
 *   2. Creates a Deferred promise keyed by (sessionId, stepId)
 *   3. Waits for the user to send `user:approve` or `user:reject`
 *   4. Resolves or rejects the Deferred, allowing the agent to continue
 */

export interface ApprovalRequest {
  sessionId: string;
  stepId: string;
  step: string;
  description: string;
  deadline: number; // timestamp ms
}

interface Deferred {
  resolve: (value: boolean) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const approvalStore = new Map<string, Deferred>();

function key(sessionId: string, stepId: string): string {
  return `${sessionId}:${stepId}`;
}

export async function requestApproval(
  sessionId: string,
  stepId: string,
  step: string,
  description: string,
  options: { timeoutMs?: number; broadcast?: (event: string, payload: any) => void } = {}
): Promise<boolean> {
  const { timeoutMs = 300_000, broadcast } = options;
  const k = key(sessionId, stepId);

  // Clean up any stale request for this session+step
  const existing = approvalStore.get(k);
  if (existing) {
    clearTimeout(existing.timer);
    existing.reject(new Error("Superseded by new approval request"));
    approvalStore.delete(k);
  }

  const deadline = Date.now() + timeoutMs;

  const promise = new Promise<boolean>((resolve, reject) => {
    const timer = setTimeout(() => {
      approvalStore.delete(k);
      reject(new Error(`Approval timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    approvalStore.set(k, {
      resolve: (approved: boolean) => {
        clearTimeout(timer);
        approvalStore.delete(k);
        resolve(approved);
      },
      reject: (reason: Error) => {
        clearTimeout(timer);
        approvalStore.delete(k);
        reject(reason);
      },
      timer
    });
  });

  broadcast?.("agent:approval_request", {
    sessionId,
    stepId,
    step,
    description,
    deadline
  });

  return promise;
}

export function resolveApproval(
  sessionId: string,
  stepId: string,
  approved: boolean
): boolean {
  const k = key(sessionId, stepId);
  const deferred = approvalStore.get(k);
  if (!deferred) return false;
  deferred.resolve(approved);
  return true;
}

export function rejectApproval(
  sessionId: string,
  stepId: string,
  reason: string
): boolean {
  const k = key(sessionId, stepId);
  const deferred = approvalStore.get(k);
  if (!deferred) return false;
  deferred.reject(new Error(reason));
  return true;
}

export function listPendingApprovals(sessionId: string): Array<{ stepId: string; deadline: number }> {
  const pending: Array<{ stepId: string; deadline: number }> = [];
  const prefix = `${sessionId}:`;
  for (const [k, def] of approvalStore.entries()) {
    if (k.startsWith(prefix)) {
      const stepId = k.slice(prefix.length);
      // We don't store deadline in Deferred, so we compute it from timer
      // For simplicity, just return stepId
      pending.push({ stepId, deadline: 0 });
    }
  }
  return pending;
}
