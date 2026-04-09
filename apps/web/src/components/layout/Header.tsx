import { UserButton } from '@clerk/clerk-react';
import { Link } from '@tanstack/react-router';
import { Sparkles, Settings } from 'lucide-react';
import { useChatStore, type Session, type SessionMessage } from '../../stores';

function compactSceneName(sceneId: string): string {
  const normalized = sceneId.trim();
  if (!normalized) return sceneId;
  if (normalized.length <= 16) return normalized;
  if (normalized.startsWith('scene-')) return `scene-${normalized.slice(-6)}`;
  return `${normalized.slice(0, 8)}...${normalized.slice(-4)}`;
}

function deriveSessionTitle(session: Session, messages: SessionMessage[]): string {
  const latestUserMessage = [...messages].reverse().find((message) => message.role === 'user' && message.content.trim().length > 0);
  if (latestUserMessage) return latestUserMessage.content;
  if (session.currentScene?.sceneId) return compactSceneName(session.currentScene.sceneId);
  return `Session ${session.sessionId.slice(0, 8)}`;
}

export default function Header() {
  const activeSessionId = useChatStore((state) => state.activeSessionId);
  const sessions = useChatStore((state) => state.sessions);
  const messages = useChatStore((state) => state.messages);
  
  const activeSession = sessions.find((s) => s.sessionId === activeSessionId);
  const sessionMessages = activeSessionId ? (messages[activeSessionId] ?? []) : [];
  
  const title = activeSession ? deriveSessionTitle(activeSession, sessionMessages) : null;

  return (
    <header className="app-header">
      <div className="app-header-brand">
        <Link to="/chat">
          <Sparkles className="h-5 w-5" />
          <span>GenVis</span>
        </Link>
        {title && (
          <>
            <span className="app-header-divider">/</span>
            <span className="app-header-title" title={title}>
              {title}
            </span>
          </>
        )}
      </div>
      
      <div className="app-header-actions">
        <Link to="/profile" className="app-header-button" aria-label="Settings">
          <Settings className="h-4 w-4" />
        </Link>
        <UserButton afterSignOutUrl="/" />
      </div>
    </header>
  );
}
