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
    return <div className="flex h-full w-full flex-1 flex-col">{chatPanel}</div>;
  }

  return (
    <div className="flex h-full w-full flex-1 flex-col md:flex-row">
      {/* Chat Panel */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-slate-900">
        {chatPanel}
      </div>

      {/* Divider with collapse toggle */}
      {collapsible && (
        <button
          className="relative flex h-10 w-full shrink-0 items-center justify-center border-b border-slate-700 bg-slate-800 text-slate-400 transition-colors duration-200 hover:bg-slate-700 hover:text-slate-200 active:bg-slate-600 md:h-auto md:w-10 md:border-b-0 md:border-r"
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
        <div className="max-h-[35vh] w-full flex-col overflow-hidden border-t border-slate-700 bg-slate-800 animate-[slideInUp_0.3s_ease-out] md:max-h-none md:min-w-[300px] md:flex-[0_0_30%] md:max-w-[45%] md:border-l md:border-t-0 md:animate-[slideInRight_0.3s_ease-out] lg:max-w-[40%]">
          {referencePanel}
        </div>
      )}
    </div>
  );
}
