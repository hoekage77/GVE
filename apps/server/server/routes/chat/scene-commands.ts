import { metrics } from "../../lib/metrics.js";
import {
  buildSceneUpdatePayload,
  createSession,
  nextArtifactVersion,
  nextRevision,
  nextSceneVersion,
  previousArtifactVersion,
  previousRevision,
  previousSceneVersion,
  redoSceneVersion,
  undoSceneVersion
} from "../../session-state.js";
import { broadcastEvent } from "../../ws/streaming.js";

export type SceneCommand =
  | "undo"
  | "redo"
  | "revision.previous"
  | "revision.next"
  | "version.previous"
  | "version.next"
  | "artifact.previous"
  | "artifact.next";

export function normalizeSceneCommand(rawCommand: unknown): SceneCommand | null {
  const normalized = String(rawCommand ?? "").trim().toLowerCase();
  if (["undo", "redo", "revision.previous", "revision.next", "version.previous", "version.next", "artifact.previous", "artifact.next"].includes(normalized)) {
    return normalized as SceneCommand;
  }
  return null;
}

export function executeSceneCommandMutation(sessionId: string, command: unknown) {
  const normalizedSessionId = String(sessionId ?? "").trim();
  const normalizedCommand = normalizeSceneCommand(command);

  if (!normalizedSessionId || !normalizedCommand) {
    return {
      success: false,
      errorCode: "VALIDATION_ERROR",
      message: "Valid sessionId and command are required.",
      command: normalizedCommand ?? null,
      sceneState: null
    };
  }

  let result: any;
  switch (normalizedCommand) {
    case "undo":
      metrics.undos += 1;
      result = undoSceneVersion(normalizedSessionId);
      break;
    case "redo":
      metrics.redos += 1;
      result = redoSceneVersion(normalizedSessionId);
      break;
    case "revision.previous":
      metrics.revisionNavigations += 1;
      result = previousRevision(normalizedSessionId);
      break;
    case "revision.next":
      metrics.revisionNavigations += 1;
      result = nextRevision(normalizedSessionId);
      break;
    case "version.previous":
      metrics.versionNavigations += 1;
      result = previousSceneVersion(normalizedSessionId);
      break;
    case "version.next":
      metrics.versionNavigations += 1;
      result = nextSceneVersion(normalizedSessionId);
      break;
    case "artifact.previous":
      metrics.artifactNavigations += 1;
      result = previousArtifactVersion(normalizedSessionId);
      break;
    case "artifact.next":
      metrics.artifactNavigations += 1;
      result = nextArtifactVersion(normalizedSessionId);
      break;
    default:
      result = {
        success: false,
        reason: "Unsupported scene command",
        state: createSession(normalizedSessionId)
      };
  }

  if (!result.success) {
    return {
      success: false,
      errorCode: "SCENE_COMMAND_FAILED",
      message: result.reason ?? "Scene command failed.",
      command: normalizedCommand,
      sceneState: result.state ?? null
    };
  }

  broadcastEvent("scene:update", buildSceneUpdatePayload(result.state));

  if (normalizedCommand === "undo" || normalizedCommand === "revision.previous") {
    broadcastEvent("version:undo", {
      sessionId: normalizedSessionId,
      versionPointer: result.state.versionPointer,
      versionCount: result.state.versionCount
    });
  } else if (normalizedCommand === "redo" || normalizedCommand === "revision.next") {
    broadcastEvent("version:redo", {
      sessionId: normalizedSessionId,
      versionPointer: result.state.versionPointer,
      versionCount: result.state.versionCount
    });
  } else if (normalizedCommand === "version.previous" || normalizedCommand === "version.next") {
    broadcastEvent("version:navigate", {
      sessionId: normalizedSessionId,
      direction: normalizedCommand === "version.previous" ? "previous" : "next",
      versionPointer: result.state.versionPointer,
      versionCount: result.state.versionCount,
      artifactPointer: result.state.artifactPointer,
      artifactCount: result.state.artifactCount,
      currentArtifactId: result.state.currentArtifactId
    });
  } else {
    broadcastEvent("artifact:navigate", {
      sessionId: normalizedSessionId,
      direction: normalizedCommand === "artifact.previous" ? "previous" : "next",
      artifactPointer: result.state.artifactPointer,
      artifactCount: result.state.artifactCount,
      currentArtifactId: result.state.currentArtifactId
    });
  }

  return {
    success: true,
    errorCode: null,
    message: null,
    command: normalizedCommand,
    sceneState: result.state
  };
}
