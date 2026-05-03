import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import CodebaseAgentPanel from './CodebaseAgentPanel';

export default function CodebaseAgentTrigger() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button
        className="animate-agent-pulse group flex items-center gap-1.5 rounded-lg border border-[#06b6d4]/30 bg-[#164e63]/60 px-2.5 py-1.5 text-[11px] font-semibold text-[#67e8f9] transition-all duration-200 hover:border-[#06b6d4]/60 hover:bg-[#164e63] active:scale-[0.97]"
        onClick={() => setIsOpen(true)}
        aria-label="Scan codebase"
        title="Run codebase analysis"
      >
        <ShieldCheck size={14} />
        <span className="hidden sm:inline">Scan</span>
      </button>

      {isOpen && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-30 bg-black/30 backdrop-blur-sm transition-opacity duration-200"
            onClick={() => setIsOpen(false)}
            aria-label="Close codebase scanner backdrop"
          />
          <CodebaseAgentPanel onClose={() => setIsOpen(false)} />
        </>
      )}
    </>
  );
}