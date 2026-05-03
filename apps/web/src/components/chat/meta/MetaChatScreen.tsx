import { useState, useEffect } from 'react';
import { Activity } from 'lucide-react';
import { ChatContainer } from "../ChatContainer";
import { MetaChatSurfaceFrame } from "./MetaChatSurfaceFrame";
import { AgentAnalysisPanel } from "../../agents";
import { useChatStore } from "../../../stores/chat/store";

export function MetaChatScreen() {
  const agentState = useChatStore(s => s.agentState);
  const [showPanel, setShowPanel] = useState(false);
  useEffect(() => { if (agentState?.isAnalyzing) setShowPanel(true); }, [agentState?.isAnalyzing]);

  return (
    <MetaChatSurfaceFrame>
      <ChatContainer />
      {agentState && !showPanel && Object.keys(agentState.results || {}).length > 0 && (
        <button onClick={() => setShowPanel(true)}
          className="fixed bottom-4 right-4 z-30 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white shadow-lg hover:bg-blue-500">
          Agent Analysis ({agentState.consensus}%)
        </button>
      )}
      {agentState && showPanel && (
        <AgentAnalysisPanel agentState={agentState} onClose={() => setShowPanel(false)} />
      )}
    </MetaChatSurfaceFrame>
  );
}
