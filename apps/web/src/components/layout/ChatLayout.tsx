import { ReactNode, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface ChatLayoutProps {
  chatPanel: ReactNode;
  referencePanel?: ReactNode;
  collapsible?: boolean;
  defaultCollapsed?: boolean;
}

export default function ChatLayout({
  chatPanel,
  referencePanel,
  collapsible = true,
  defaultCollapsed = false
}: ChatLayoutProps) {
  const [isReferenceCollapsed, setIsReferenceCollapsed] = useState(defaultCollapsed);

  if (!referencePanel) {
    return <div className="chat-layout chat-layout--full">{chatPanel}</div>;
  }

  return (
    <div className={`chat-layout chat-layout--split ${isReferenceCollapsed ? 'chat-layout--reference-collapsed' : ''}`}>
      {/* Chat Panel */}
      <div className="chat-layout__chat-pane">
        {chatPanel}
      </div>

      {/* Divider with collapse toggle */}
      {collapsible && (
        <button
          className="chat-layout__divider-toggle"
          onClick={() => setIsReferenceCollapsed(!isReferenceCollapsed)}
          aria-label={isReferenceCollapsed ? 'Show reference panel' : 'Hide reference panel'}
          title={isReferenceCollapsed ? 'Show reference panel' : 'Hide reference panel'}
        >
          {isReferenceCollapsed ? (
            <ChevronLeft className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </button>
      )}

      {/* Reference Panel */}
      {!isReferenceCollapsed && (
        <div className="chat-layout__reference-pane">
          {referencePanel}
        </div>
      )}
    </div>
  );
}
