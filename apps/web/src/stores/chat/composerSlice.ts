import type { StateCreator } from "zustand";
import type { ChatState, WorkspacePanelView, ComposerImageAttachment, AgentFileEntry, AgentToolLogEntry } from "./types";
import type { WorkspaceRecord } from "../../api";

export interface ComposerSlice {
  composerValue: string;
  composerImage: ComposerImageAttachment | null;
  isSlashMenuOpen: boolean;
  isSidebarCollapsed: boolean;
  panelOpen: boolean;
  panelView: WorkspacePanelView | null;
  panelWidth: number;
  activeArtifactId: string | null;
  workspaceRecord: WorkspaceRecord | null;
  selectedWorkspaceFile: string | null;
  workspaceOpen: boolean;
  agentFiles: AgentFileEntry[];
  agentToolLog: AgentToolLogEntry[];

  setComposerValue: (value: string) => void;
  setComposerImage: (image: ComposerImageAttachment | null) => void;
  clearComposerImage: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  cycleTheaterArtifact: (direction: "next" | "prev") => void;
  openPanel: (view: WorkspacePanelView) => void;
  closePanel: () => void;
  togglePanel: (view: WorkspacePanelView) => void;
  setPanelWidth: (width: number) => void;
  openTheaterMode: (artifactId: string) => void;
  closeTheaterMode: () => void;
  setWorkspaceRecord: (record: WorkspaceRecord | null) => void;
  selectWorkspaceFile: (path: string) => void;
  openWorkspace: () => void;
  closeWorkspace: () => void;
  toggleWorkspace: () => void;
  addAgentFile: (file: AgentFileEntry) => void;
  clearAgentFiles: () => void;
  addAgentToolLog: (entry: AgentToolLogEntry) => void;
  clearAgentToolLog: () => void;
}

export const createComposerSlice: StateCreator<ChatState, [], [], ComposerSlice> = (set, get) => ({
  composerValue: "",
  composerImage: null,
  isSlashMenuOpen: false,
  isSidebarCollapsed:
    typeof window !== "undefined"
      ? window.sessionStorage.getItem("terranet.sidebar.collapsed.v2") === "1"
      : false,
  panelOpen: false,
  panelView: null,
  panelWidth: 600,
  activeArtifactId: null,
  workspaceRecord: null,
  selectedWorkspaceFile: null,
  workspaceOpen: false,
  agentFiles: [],
  agentToolLog: [],

  setComposerValue: (value) => set({ composerValue: value }),

  setComposerImage: (image) => set({ composerImage: image }),

  clearComposerImage: () => set({ composerImage: null }),

  setSidebarCollapsed: (collapsed) => {
    set({ isSidebarCollapsed: collapsed });
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem("terranet.sidebar.collapsed.v2", collapsed ? "1" : "0");
    }
  },

  cycleTheaterArtifact: (direction) => {
    const { activeArtifactId, activeSessionId, sessions } = get() as any;
    if (!activeArtifactId || !activeSessionId) return;
    const session = (sessions || []).find((s: any) => s?.sessionId === activeSessionId);
    if (!session || !session.versions || session.versions.length <= 1) return;
    const currentIndex = session.versions.findIndex((v: any) => v.versionId === activeArtifactId);
    if (currentIndex === -1) return;
    const nextIndex =
      direction === "next"
        ? (currentIndex + 1) % session.versions.length
        : (currentIndex - 1 + session.versions.length) % session.versions.length;
    const nextVersion = session.versions[nextIndex];
    if (nextVersion) set({ activeArtifactId: nextVersion.versionId } as any);
  },

  openPanel: (view) => {
    const { panelView, panelOpen } = get();
    set({
      panelOpen: true,
      panelView: view,
      isSidebarCollapsed: true,
    });
  },

  closePanel: () => set({ panelOpen: false }),

  togglePanel: (view) => {
    const { panelView, panelOpen } = get();
    if (panelOpen && panelView === view) {
      set({ panelOpen: false });
    } else {
      set({ panelOpen: true, panelView: view, isSidebarCollapsed: true });
    }
  },

  setPanelWidth: (width) => set({ panelWidth: width }),

  openTheaterMode: (artifactId) => set({ activeArtifactId: artifactId } as any),

  closeTheaterMode: () => set({ activeArtifactId: null } as any),

  setWorkspaceRecord: (record) => set({ workspaceRecord: record, selectedWorkspaceFile: null }),

  selectWorkspaceFile: (path) => set({ selectedWorkspaceFile: path }),

  openWorkspace: () => set({ workspaceOpen: true }),

  closeWorkspace: () => set({ workspaceOpen: false }),

  toggleWorkspace: () => {
    const { workspaceOpen } = get();
    set({ workspaceOpen: !workspaceOpen });
  },

  addAgentFile: (file) =>
    set((state) => ({
      agentFiles: [...state.agentFiles, file],
    })),

  clearAgentFiles: () => set({ agentFiles: [] }),

  addAgentToolLog: (entry: AgentToolLogEntry) =>
    set((state) => ({
      agentToolLog: [...state.agentToolLog, entry],
    })),

  clearAgentToolLog: () => set({ agentToolLog: [] }),
});