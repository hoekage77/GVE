export type TurnSummaryMetadata = {
  assistantSource?: string | null;
  assistantWarning?: boolean | null;
  assistantLlm?: string | null;
};

export type TurnResultSummary = {
  sceneId: string | null;
  sceneVersion: number | null;
  skill: string | null;
  explanation: string | null;
  modifyOutcome: string | null;
  noopReason: string | null;
  diff: Record<string, unknown> | null;
  runtimeStatus: string | null;
  runtimeWarning: string | null;
  runtimeWarningCode: string | null;
  runtimeErrorCode: string | null;
  runtimeAcquireDiagnostics: unknown;
  outputKind: string | null;
  mediaType: string | null;
  mediaUrl: string | null;
  mediaArtifactId: string | null;
  mediaDurationMs: number | null;
  mediaFps: number | null;
  mediaResolution: string | null;
  mediaBytes: number | null;
  assetPlan: unknown;
  generationSource: string | null;
  generationWarning: string | null;
  assistantSource: string | null;
  assistantWarning: boolean | null;
  assistantLlm: string | null;
  llmTrace: unknown;
};

function compactModifyDiff(diff: unknown): Record<string, unknown> | null {
  if (!diff || typeof diff !== "object") {
    return null;
  }

  const record = diff as Record<string, unknown>;
  return {
    instruction: record.instruction ?? null,
    currentVersion: Number.isFinite(record.currentVersion) ? record.currentVersion : null,
    changed: typeof record.changed === "boolean" ? record.changed : null,
    changeSummary: record.changeSummary ?? null,
    source: record.source ?? null,
    addedLines: Number.isFinite(record.addedLines) ? record.addedLines : null,
    removedLines: Number.isFinite(record.removedLines) ? record.removedLines : null,
    changedLines: Number.isFinite(record.changedLines) ? record.changedLines : null
  };
}

export function buildTurnResultSummary(
  mode: string,
  result: Record<string, any> | null | undefined,
  sceneState: Record<string, any> | null | undefined,
  metadata: TurnSummaryMetadata = {}
): TurnResultSummary {
  const currentScene = sceneState?.currentScene ?? null;
  const assistantSource = metadata.assistantSource ?? null;
  const assistantWarning = metadata.assistantWarning ?? null;
  const assistantLlm = metadata.assistantLlm ?? null;

  if (!result || (mode !== "generate" && mode !== "modify" && mode !== "image-to-code")) {
    return {
      sceneId: null,
      sceneVersion: null,
      skill: null,
      explanation: null,
      modifyOutcome: null,
      noopReason: null,
      diff: null,
      runtimeStatus: null,
      runtimeWarning: null,
      runtimeWarningCode: null,
      runtimeErrorCode: null,
      runtimeAcquireDiagnostics: null,
      outputKind: null,
      mediaType: null,
      mediaUrl: null,
      mediaArtifactId: null,
      mediaDurationMs: null,
      mediaFps: null,
      mediaResolution: null,
      mediaBytes: null,
      assetPlan: null,
      generationSource: null,
      generationWarning: null,
      assistantSource,
      assistantWarning,
      assistantLlm,
      llmTrace: null
    };
  }

  const resolvedOutputKind = result.outputKind ?? result.runtime?.outputKind ?? currentScene?.outputKind ?? null;
  const resolvedMediaUrl =
    result.mediaUrl
    ?? result.runtime?.mediaUrl
    ?? currentScene?.mediaUrl
    ?? (resolvedOutputKind === "media" ? (result.previewUrl ?? currentScene?.previewUrl ?? null) : null);

  return {
    sceneId: result.sceneId ?? null,
    sceneVersion: sceneState?.currentScene?.version ?? result.sceneVersion ?? null,
    skill: result.skill ?? result.runtime?.skillId ?? null,
    explanation: result.explanation ?? null,
    modifyOutcome: result.modifyOutcome ?? null,
    noopReason: result.noopReason ?? null,
    diff: compactModifyDiff(result.diff),
    runtimeStatus: result.runtime?.status ?? null,
    runtimeWarning: result.runtime?.warning ?? null,
    runtimeWarningCode: result.runtime?.warningCode ?? null,
    runtimeErrorCode: result.runtime?.errorCode ?? null,
    runtimeAcquireDiagnostics: result.runtime?.acquireDiagnostics ?? null,
    outputKind: resolvedOutputKind,
    mediaType: result.mediaType ?? result.runtime?.mediaType ?? currentScene?.mediaType ?? null,
    mediaUrl: resolvedMediaUrl,
    mediaArtifactId: result.mediaArtifactId ?? result.runtime?.mediaArtifactId ?? currentScene?.mediaArtifactId ?? null,
    mediaDurationMs: result.mediaDurationMs ?? result.runtime?.mediaDurationMs ?? currentScene?.mediaDurationMs ?? null,
    mediaFps: result.mediaFps ?? result.runtime?.mediaFps ?? currentScene?.mediaFps ?? null,
    mediaResolution: result.mediaResolution ?? result.runtime?.mediaResolution ?? currentScene?.mediaResolution ?? null,
    mediaBytes: result.mediaBytes ?? result.runtime?.mediaBytes ?? currentScene?.mediaBytes ?? null,
    assetPlan: result.assetPlan ?? currentScene?.assetPlan ?? null,
    generationSource: result.generationSource ?? null,
    generationWarning: result.generationWarning ?? null,
    assistantSource,
    assistantWarning,
    assistantLlm,
    llmTrace: result.llmTrace ?? null
  };
}

export function buildTurnLifecyclePayload(turnSummary: TurnResultSummary | null | undefined) {
  return {
    sceneId: turnSummary?.sceneId ?? null,
    sceneVersion: turnSummary?.sceneVersion ?? null,
    skill: turnSummary?.skill ?? null,
    explanation: turnSummary?.explanation ?? null,
    modifyOutcome: turnSummary?.modifyOutcome ?? null,
    noopReason: turnSummary?.noopReason ?? null,
    diff: turnSummary?.diff ?? null,
    runtimeStatus: turnSummary?.runtimeStatus ?? null,
    runtimeWarning: turnSummary?.runtimeWarning ?? null,
    runtimeWarningCode: turnSummary?.runtimeWarningCode ?? null,
    runtimeErrorCode: turnSummary?.runtimeErrorCode ?? null,
    runtimeAcquireDiagnostics: turnSummary?.runtimeAcquireDiagnostics ?? null,
    outputKind: turnSummary?.outputKind ?? null,
    mediaType: turnSummary?.mediaType ?? null,
    mediaUrl: turnSummary?.mediaUrl ?? null,
    mediaArtifactId: turnSummary?.mediaArtifactId ?? null,
    mediaDurationMs: turnSummary?.mediaDurationMs ?? null,
    mediaFps: turnSummary?.mediaFps ?? null,
    mediaResolution: turnSummary?.mediaResolution ?? null,
    mediaBytes: turnSummary?.mediaBytes ?? null,
    assetPlan: turnSummary?.assetPlan ?? null,
    generationSource: turnSummary?.generationSource ?? null,
    generationWarning: turnSummary?.generationWarning ?? null,
    assistantSource: turnSummary?.assistantSource ?? null,
    assistantWarning: turnSummary?.assistantWarning ?? null,
    assistantLlm: turnSummary?.assistantLlm ?? null,
    llmTrace: turnSummary?.llmTrace ?? null
  };
}
