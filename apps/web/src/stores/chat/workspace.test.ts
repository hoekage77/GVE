import { describe, expect, it, beforeEach } from "vitest";
import { create } from "zustand";
import type { ChatState } from "./types";
import type { InfraSlice } from "./infraSlice";
import { createSessionSlice } from "./sessionSlice";
import { createComposerSlice } from "./composerSlice";
import { createPipelineSlice } from "./pipelineSlice";
import { createInfraSlice } from "./infraSlice";
import { buildClientSession } from "./helpers";

type TestChatState = ChatState & InfraSlice;

function createTestStore() {
  return create<TestChatState>()((...args) => ({
    ...createSessionSlice(...args),
    ...createComposerSlice(...args),
    ...createPipelineSlice(...args),
    ...createInfraSlice(...args),
    initialize: async () => {},
    connectWebSocket: () => {},
    sendSceneCommand: async () => {},
    setSessionsError: () => {},
    setPendingApproval: () => {},
    setWorkspaceRecord: (record) => args[0]({ workspaceRecord: record }),
    selectWorkspaceFile: (path) => args[0]({ selectedWorkspaceFile: path }),
  } as TestChatState));
}

describe("buildClientSession", () => {
  it("returns null for null/undefined input", () => {
    expect(buildClientSession(null)).toBeNull();
    expect(buildClientSession(undefined)).toBeNull();
  });

  it("normalizes a minimal API session", () => {
    const raw = {
      sessionId: "sess-1",
      sceneId: null,
      versionCount: 0,
      versions: [],
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
    };
    const s = buildClientSession(raw);
    expect(s).not.toBeNull();
    expect(s!.sessionId).toBe("sess-1");
    expect(s!.versionCount).toBe(0);
    expect(s!.canUndo).toBe(false);
    expect(s!.canRedo).toBe(false);
    expect(s!.currentScene).toBeNull();
  });

  it("normalizes a full API session with scene", () => {
    const raw = {
      sessionId: "sess-2",
      sceneId: "scene-1",
      versionCount: 3,
      versionPointer: 2,
      currentScene: {
        versionId: "v-1",
        version: 1,
        sceneId: "scene-1",
        code: "const x = 1;",
        previewUrl: "about:blank",
        skill: "threejs",
        outputKind: "code",
        explanation: "test",
        source: "llm",
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z",
      },
      versions: [],
      canUndo: true,
      canRedo: false,
      canPreviousArtifact: false,
      canNextArtifact: true,
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-02T00:00:00.000Z",
    };
    const s = buildClientSession(raw);
    expect(s!.sceneId).toBe("scene-1");
    expect(s!.versionPointer).toBe(2);
    expect(s!.canUndo).toBe(true);
    expect(s!.canNextArtifact).toBe(true);
    expect(s!.currentScene!.skill).toBe("threejs");
  });
});

describe("WebSocket workspace event handlers", () => {
  let store: ReturnType<typeof createTestStore>;

  beforeEach(() => {
    store = createTestStore();
    store.getState().setWorkspaceRecord(null);
  });

  it("handleWorkspaceUpdate replaces workspaceRecord", () => {
    const ws = {
      files: {
        "src/index.js": {
          path: "src/index.js",
          content: "console.log(1);",
          purpose: "entry",
          skill: "threejs",
        },
      },
      entryPoint: "src/index.js",
      dependencies: ["three"],
    };
    store.getState().handleWorkspaceUpdate({ workspace: ws });
    expect(store.getState().workspaceRecord).toEqual(ws);
  });

  it("handleFilePatched updates an existing file's content", () => {
    store.getState().setWorkspaceRecord({
      files: {
        "src/index.js": {
          path: "src/index.js",
          content: "const x = 1;",
          purpose: "entry",
          skill: "threejs",
        },
      },
      entryPoint: "src/index.js",
      dependencies: [],
    });

    store.getState().handleFilePatched({
      path: "src/index.js",
      kind: "modify",
      patchedContent: "const x = 2;",
      explanation: "updated value",
    });

    expect(store.getState().workspaceRecord!.files["src/index.js"].content).toBe(
      "const x = 2;"
    );
    expect(store.getState().workspaceRecord!.files["src/index.js"].purpose).toBe(
      "updated value"
    );
  });

  it("handleFilePatched removes a file", () => {
    store.getState().setWorkspaceRecord({
      files: {
        "src/old.js": {
          path: "src/old.js",
          content: "// old",
          purpose: "legacy",
          skill: "threejs",
        },
      },
      entryPoint: "src/old.js",
      dependencies: [],
    });

    store.getState().handleFilePatched({
      path: "src/old.js",
      kind: "remove",
    });

    expect(
      store.getState().workspaceRecord!.files["src/old.js"]
    ).toBeUndefined();
  });

  it("handleFilePatched is a no-op when no workspaceRecord exists", () => {
    expect(() =>
      store.getState().handleFilePatched({
        path: "src/x.js",
        kind: "modify",
        patchedContent: "x",
      })
    ).not.toThrow();
  });
});
