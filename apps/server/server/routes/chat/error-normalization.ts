export type RuntimeSnapshot = {
  status?: string | null;
  warning?: string | null;
  warningCode?: string | null;
  error?: string | null;
  errorCode?: string | null;
  outputKind?: string | null;
  mediaType?: string | null;
  mediaUrl?: string | null;
  mediaArtifactId?: string | null;
  mediaDurationMs?: number | null;
  mediaFps?: number | null;
  mediaResolution?: string | null;
  mediaBytes?: number | null;
  skillId?: string | null;
  previewUrl?: string | null;
  success?: boolean;
  acquireDiagnostics?: unknown;
};

export type ErrorDiagnostics = {
  stage: string | null;
  requestId: string | null;
  sessionId: string | null;
  messageId: string | null;
  message: string;
  name: string | null;
  code: string | null;
  status: number | null;
  cause: string | null;
  stack: string | null;
  timestamp: string;
  runtime?: {
    status: string | null;
    warningCode: string | null;
    acquireDiagnostics: unknown;
  };
};

export type StructuredTurnError = {
  code: string;
  title: string;
  userMessage: string;
  retryable: boolean;
  suggestedAction: string;
  technicalDetail: string;
  stage: string;
  diagnostics: ErrorDiagnostics;
};

export function truncateDiagnosticText(value: unknown, maxLength = 320): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  const text = String(value);
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

export function extractErrorDiagnostics(
  error: unknown,
  context: {
    stage?: string;
    requestId?: string;
    sessionId?: string;
    messageId?: string;
  } = {}
): ErrorDiagnostics {
  const diagnostics: ErrorDiagnostics = {
    stage: context.stage ?? null,
    requestId: context.requestId ?? null,
    sessionId: context.sessionId ?? null,
    messageId: context.messageId ?? null,
    message: "Unknown error",
    name: null,
    code: null,
    status: null,
    cause: null,
    stack: null,
    timestamp: new Date().toISOString()
  };

  if (error instanceof Error) {
    const errorWithMeta = error as Error & { code?: unknown; status?: unknown; cause?: unknown };
    diagnostics.message = truncateDiagnosticText(error.message) ?? diagnostics.message;
    diagnostics.name = truncateDiagnosticText(error.name, 80);
    diagnostics.code = truncateDiagnosticText(errorWithMeta.code, 96);
    diagnostics.status = Number.isFinite(errorWithMeta.status) ? Number(errorWithMeta.status) : null;
    diagnostics.cause = truncateDiagnosticText(
      errorWithMeta.cause instanceof Error ? errorWithMeta.cause.message : errorWithMeta.cause,
      240
    );
    diagnostics.stack = truncateDiagnosticText(error.stack?.split("\n").slice(0, 3).join(" | "), 500);
    return diagnostics;
  }

  diagnostics.message = truncateDiagnosticText(error, 320) ?? diagnostics.message;
  return diagnostics;
}

export function buildStructuredTurnError({
  stage = "execution",
  errorMessage = "Unknown error",
  runtime = null,
  error = null,
  diagnostics = null
}: {
  stage?: string;
  errorMessage?: string;
  runtime?: RuntimeSnapshot | null;
  error?: unknown;
  diagnostics?: ErrorDiagnostics | null;
}): StructuredTurnError {
  const normalizedDiagnostics = diagnostics ?? extractErrorDiagnostics(error, { stage });
  const baseDetail = String(
    errorMessage || runtime?.error || runtime?.warning || normalizedDiagnostics?.message || "Unknown error"
  );

  const diagnosticFragments = [baseDetail];
  if (normalizedDiagnostics?.code) diagnosticFragments.push(`code:${normalizedDiagnostics.code}`);
  if (normalizedDiagnostics?.status) diagnosticFragments.push(`status:${normalizedDiagnostics.status}`);
  if (normalizedDiagnostics?.cause) diagnosticFragments.push(`cause:${normalizedDiagnostics.cause}`);

  const technicalDetail = diagnosticFragments.join(" | ");
  const technicalDetailLower = technicalDetail.toLowerCase();

  let code = "EXECUTION_FAILED";
  let title = "Scene execution failed";
  let userMessage = "I could not run this generated scene successfully.";
  let retryable = false;
  let suggestedAction = "Try generating again with a slightly simpler request.";

  if (/(acquire budget exhausted|runtime budget exhausted|budget exhausted before)/i.test(technicalDetailLower)) {
    code = "SANDBOX_ACQUIRE_BUDGET_EXHAUSTED";
    title = "Turn budget exhausted during sandbox setup";
    userMessage = "I ran out of turn budget while preparing the execution sandbox.";
    retryable = false;
    suggestedAction = "Retry with a simpler request or start a fresh turn.";
  } else if (/(eai_again|getaddrinfo|enotfound|dns|resolver|enetunreach)/i.test(technicalDetailLower)) {
    code = "SANDBOX_DNS_UNAVAILABLE";
    title = "Sandbox DNS issue";
    userMessage = "I could not resolve the sandbox endpoint due to a temporary DNS issue.";
    retryable = true;
    suggestedAction = "Retry in a few seconds.";
  } else if (/(timed out|timeout|504|503|service unavailable|failed to create and start sandbox within)/i.test(technicalDetailLower)) {
    code = "SANDBOX_ACQUIRE_TIMEOUT";
    title = "Sandbox startup timed out";
    userMessage = "The execution sandbox did not become ready before the timeout.";
    retryable = true;
    suggestedAction = "Retry now or simplify the request to reduce setup time.";
  } else if (/(econnreset|econnrefused|network)/i.test(technicalDetailLower)) {
    code = "SANDBOX_NETWORK_UNAVAILABLE";
    title = "Sandbox network issue";
    userMessage = "I could not reach the execution sandbox due to a temporary network issue.";
    retryable = true;
    suggestedAction = "Retry now.";
  } else if (/(validation failed|whitelist|syntax|parse error|unsafe)/i.test(technicalDetailLower)) {
    code = "CODE_VALIDATION_FAILED";
    title = "Generated code failed validation";
    userMessage = "The generated code did not pass safety or syntax checks.";
    retryable = true;
    suggestedAction = "Try regenerating with tighter constraints.";
  } else if (/(is not a function|is not a constructor|undefined)/i.test(technicalDetailLower)) {
    code = "RUNTIME_API_MISMATCH";
    title = "Runtime API mismatch";
    userMessage = "The generated scene called an API that failed at runtime.";
    retryable = true;
    suggestedAction = "Retry generation or ask for a compatibility-safe version.";
  } else if (/(moonshot.*429|engine is currently overloaded|overloaded)/i.test(technicalDetailLower)) {
    code = "MODEL_OVERLOADED";
    title = "Model is overloaded";
    userMessage = "The model is temporarily overloaded and could not complete this turn.";
    retryable = true;
    suggestedAction = "Retry in a few seconds.";
  }

  return { code, title, userMessage, retryable, suggestedAction, technicalDetail, stage, diagnostics: normalizedDiagnostics };
}
