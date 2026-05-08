import { useState, useCallback } from "react";
import type { AgentFileEntry, AgentToolLogEntry } from "../../stores/chat/types";

type ConsoleTab = "files" | "terminal" | "code" | "browser";

export interface ConsoleState {
  activeTab: ConsoleTab;
  isExpanded: boolean;
  isCollapsed: boolean;
  filesOpen: boolean;
  toolsOpen: boolean;
}

export function useConsoleState(defaultTab: ConsoleTab = "files"): {
  state: ConsoleState;
  setTab: (tab: ConsoleTab) => void;
  toggleExpanded: () => void;
  toggleCollapsed: () => void;
  toggleFiles: () => void;
  toggleTools: () => void;
} {
  const [activeTab, setActiveTab] = useState<ConsoleTab>(defaultTab);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [filesOpen, setFilesOpen] = useState(true);
  const [toolsOpen, setToolsOpen] = useState(true);

  const setTab = useCallback((tab: ConsoleTab) => setActiveTab(tab), []);
  const toggleExpanded = useCallback(() => setIsExpanded((v) => !v), []);
  const toggleCollapsed = useCallback(() => {
    setIsCollapsed((v) => {
      if (!v) setIsExpanded(false);
      return !v;
    });
  }, []);
  const toggleFiles = useCallback(() => setFilesOpen((v) => !v), []);
  const toggleTools = useCallback(() => setToolsOpen((v) => !v), []);

  return {
    state: { activeTab, isExpanded, isCollapsed, filesOpen, toolsOpen },
    setTab,
    toggleExpanded,
    toggleCollapsed,
    toggleFiles,
    toggleTools,
  };
}

export type { ConsoleTab };
export type { AgentFileEntry, AgentToolLogEntry };
