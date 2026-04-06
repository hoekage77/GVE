import { useState, useMemo } from "react";
import { ChevronUp, ChevronDown, Brain, Sparkles, Code, Eye, History } from "lucide-react";
import type { SessionMessage } from "@visual-runtime/shared";

interface ThoughtsBarProps {
  thoughts?: SessionMessage[];
  liveThought?: {
    text: string;
    step: string;
  } | null;
  isThinking?: boolean;
}

// Agent personas for dialogue view
const AGENT_PERSONAS = {
  planner: { name: "Planner", icon: Sparkles, color: "#8B5CF6", bgColor: "rgba(139, 92, 246, 0.12)" },
  coder: { name: "Coder", icon: Code, color: "#3B82F6", bgColor: "rgba(59, 130, 246, 0.12)" },
  reviewer: { name: "Reviewer", icon: Eye, color: "#10B981", bgColor: "rgba(16, 185, 129, 0.12)" }
};

// Determine agent based on step type
function getAgentForStep(step: string): { name: string; icon: any; color: string; bgColor: string } {
  const plannerSteps = ["parse_intent", "select_skill", "turn_started", "intent_parsed"];
  const coderSteps = ["build_prompt", "generate_code", "code_generated", "code_modified"];
  const reviewerSteps = ["validate_code", "validation_failed", "execute_code", "executing", "execution_skipped"];
  
  if (plannerSteps.includes(step)) return AGENT_PERSONAS.planner;
  if (coderSteps.includes(step)) return AGENT_PERSONAS.coder;
  if (reviewerSteps.includes(step)) return AGENT_PERSONAS.reviewer;
  return AGENT_PERSONAS.coder;
}

function formatStep(step: string): string {
  const labels: Record<string, string> = {
    parse_intent: "Understanding",
    select_skill: "Selecting",
    build_prompt: "Preparing",
    generate_code: "Coding",
    validate_code: "Reviewing",
    execute_code: "Running",
    sync_state: "Saving",
    turn_started: "Starting",
    turn_complete: "Done",
    turn_error: "Error"
  };
  return labels[step] || step.replace(/_/g, " ");
}

function formatTime(timestamp: number | string): string {
  const date = typeof timestamp === "string" ? new Date(timestamp) : new Date(timestamp);
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

// Group thoughts by turn
interface TurnGroup {
  turnNumber: number;
  timestamp: number;
  entries: Array<{
    id: string;
    agent: { name: string; icon: any; color: string; bgColor: string };
    text: string;
    step: string;
    timestamp: number;
    isTransition: boolean;
  }>;
}

function groupThoughtsByTurn(
  thoughts: SessionMessage[],
  liveThought: { text: string; step: string } | null
): TurnGroup[] {
  const turns: TurnGroup[] = [];
  let currentTurn: TurnGroup | undefined = undefined;
  let turnCounter = 0;
  let lastAgentName = "";

  const sortedThoughts = [...thoughts].sort((a, b) => {
    const aTime = a.createdAt ? Date.parse(a.createdAt) : 0;
    const bTime = b.createdAt ? Date.parse(b.createdAt) : 0;
    return aTime - bTime;
  });

  for (const thought of sortedThoughts) {
    const step = thought.meta?.[0] || thought.kind || "thought";
    
    // New turn starts with turn_started
    if (step === "turn_started" || step === "parse_intent") {
      if (currentTurn && currentTurn.entries.length > 0) {
        turns.push(currentTurn);
      }
      turnCounter++;
      currentTurn = {
        turnNumber: turnCounter,
        timestamp: thought.createdAt ? Date.parse(thought.createdAt) : Date.now(),
        entries: []
      };
      lastAgentName = "";
    }

    if (!currentTurn) {
      // First thought without turn_started
      turnCounter = 1;
      currentTurn = {
        turnNumber: 1,
        timestamp: thought.createdAt ? Date.parse(thought.createdAt) : Date.now(),
        entries: []
      };
    }

    const agent = getAgentForStep(step);
    const isTransition = agent.name !== lastAgentName;
    
    currentTurn.entries.push({
      id: thought.id,
      agent,
      text: thought.content,
      step: formatStep(step),
      timestamp: thought.createdAt ? Date.parse(thought.createdAt) : Date.now(),
      isTransition
    });
    
    lastAgentName = agent.name;
  }

  // Add current turn if it has entries
  if (typeof currentTurn !== "undefined" && currentTurn.entries.length > 0) {
    turns.push(currentTurn);
  }

  // Add live thought to current turn
  if (liveThought) {
    const agent = getAgentForStep(liveThought.step);
    const lastTurn = turns[turns.length - 1];
    
    if (lastTurn && lastTurn.entries.length > 0) {
      const lastEntry = lastTurn.entries[lastTurn.entries.length - 1];
      const isTransition = agent.name !== lastEntry.agent.name;
      lastTurn.entries.push({
        id: "live",
        agent,
        text: liveThought.text,
        step: formatStep(liveThought.step),
        timestamp: Date.now(),
        isTransition
      });
    }
  }

  return turns;
}

export default function ThoughtsBar({
  thoughts = [],
  liveThought = null,
  isThinking = false
}: ThoughtsBarProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const turns = useMemo(() => {
    return groupThoughtsByTurn(thoughts, liveThought);
  }, [thoughts, liveThought]);

  // Get current state for collapsed view
  const currentTurn = turns[turns.length - 1];
  const currentEntry = currentTurn?.entries[currentTurn.entries.length - 1];
  const hasHistory = turns.length > 1 || (currentTurn && currentTurn.entries.length > 1);

  // Don't show if no thoughts
  if (turns.length === 0 && !liveThought && !isThinking) {
    return null;
  }

  return (
    <div className={`thoughts-bar ${isExpanded ? "thoughts-bar--expanded" : ""}`}>
      {/* Collapsed View */}
      {!isExpanded && (
        <div className="thoughts-bar__collapsed">
          <div className="thoughts-bar__current">
            {currentEntry && (
              <>
                <div 
                  className="thoughts-bar__current-avatar"
                  style={{ background: currentEntry.agent.color }}
                >
                  <currentEntry.agent.icon className="h-3 w-3" />
                  {isThinking && <span className="thoughts-bar__current-pulse" />}
                </div>
                <div className="thoughts-bar__current-info">
                  <span className="thoughts-bar__current-agent">{currentEntry.agent.name}</span>
                  <span className="thoughts-bar__current-step">{currentEntry.step}</span>
                </div>
                {hasHistory && (
                  <span className="thoughts-bar__history-badge">
                    <History className="h-3 w-3" />
                    {turns.length > 1 ? `${turns.length} turns` : `${currentTurn?.entries.length || 0} steps`}
                  </span>
                )}
              </>
            )}
            {!currentEntry && isThinking && (
              <span className="thoughts-bar__thinking">Thinking...</span>
            )}
          </div>
          
          <button
            type="button"
            className="thoughts-bar__toggle"
            onClick={() => setIsExpanded(true)}
            aria-label="Show agent dialogue"
          >
            <ChevronUp className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Expanded View - Shows full turn history */}
      {isExpanded && (
        <div className="thoughts-bar__expanded">
          <div className="thoughts-bar__header">
            <Brain className="h-3.5 w-3.5" />
            <span>Agent Thoughts</span>
            <button
              type="button"
              className="thoughts-bar__toggle"
              onClick={() => setIsExpanded(false)}
              aria-label="Hide agent dialogue"
            >
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="thoughts-bar__dialogue">
            {turns.map((turn, turnIndex) => (
              <div key={turn.turnNumber} className="thoughts-bar__turn">
                {/* Turn Header */}
                {turns.length > 1 && (
                  <div className="thoughts-bar__turn-header">
                    <span className="thoughts-bar__turn-number">Turn {turn.turnNumber}</span>
                    <span className="thoughts-bar__turn-time">{formatTime(turn.timestamp)}</span>
                  </div>
                )}
                
                {/* Turn Entries */}
                <div className="thoughts-bar__turn-entries">
                  {turn.entries.map((entry, entryIndex) => {
                    const Icon = entry.agent.icon;
                    const isLastEntry = turnIndex === turns.length - 1 && entryIndex === turn.entries.length - 1;
                    
                    return (
                      <div 
                        key={entry.id} 
                        className={`thoughts-bar__entry ${entry.isTransition ? "thoughts-bar__entry--transition" : ""} ${isLastEntry && isThinking ? "thoughts-bar__entry--live" : ""}`}
                      >
                        {/* Agent Transition */}
                        {entry.isTransition && entryIndex > 0 && (
                          <div className="thoughts-bar__handoff">
                            <span className="thoughts-bar__handoff-line" />
                            <span className="thoughts-bar__handoff-text">Handoff</span>
                            <span className="thoughts-bar__handoff-line" />
                          </div>
                        )}
                        
                        <div className="thoughts-bar__entry-main">
                          <div 
                            className="thoughts-bar__entry-avatar"
                            style={{ 
                              background: entry.agent.bgColor,
                              borderColor: entry.agent.color 
                            }}
                          >
                            <Icon className="h-3 w-3" style={{ color: entry.agent.color }} />
                            {isLastEntry && isThinking && (
                              <span 
                                className="thoughts-bar__entry-pulse"
                                style={{ borderColor: entry.agent.color }}
                              />
                            )}
                          </div>
                          
                          <div className="thoughts-bar__entry-content">
                            <div className="thoughts-bar__entry-header">
                              <span 
                                className="thoughts-bar__entry-name"
                                style={{ color: entry.agent.color }}
                              >
                                {entry.agent.name}
                              </span>
                              <span className="thoughts-bar__entry-step">{entry.step}</span>
                              <span className="thoughts-bar__entry-time">
                                {formatTime(entry.timestamp)}
                              </span>
                            </div>
                            
                            <p className="thoughts-bar__entry-text">
                              {entry.text.length > 100 
                                ? entry.text.slice(0, 100) + "..." 
                                : entry.text
                              }
                            </p>
                            
                            {isLastEntry && isThinking && (
                              <div className="thoughts-bar__entry-typing">
                                <span className="thoughts-bar__typing-dot" style={{ background: entry.agent.color }} />
                                <span className="thoughts-bar__typing-dot" style={{ background: entry.agent.color }} />
                                <span className="thoughts-bar__typing-dot" style={{ background: entry.agent.color }} />
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                
                {/* Turn Separator (except for last turn) */}
                {turnIndex < turns.length - 1 && (
                  <div className="thoughts-bar__turn-separator">
                    <span className="thoughts-bar__turn-separator-line" />
                    <span className="thoughts-bar__turn-separator-icon">◆</span>
                    <span className="thoughts-bar__turn-separator-line" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
