import { Command, Undo2, Redo2, Trash2, Download, Image, Settings, HelpCircle, Sparkles } from "lucide-react";
import type { SlashCommand } from "../hooks/useSlashCommands";

interface SlashCommandMenuProps {
  commands: SlashCommand[];
  selectedIndex: number;
  onSelect: (command: SlashCommand) => void;
  className?: string;
}

const iconMap: Record<string, React.ReactNode> = {
  command: <Command className="h-4 w-4" />,
  undo: <Undo2 className="h-4 w-4" />,
  redo: <Redo2 className="h-4 w-4" />,
  clear: <Trash2 className="h-4 w-4" />,
  export: <Download className="h-4 w-4" />,
  image: <Image className="h-4 w-4" />,
  settings: <Settings className="h-4 w-4" />,
  help: <HelpCircle className="h-4 w-4" />,
  sparkles: <Sparkles className="h-4 w-4" />,
};

export function SlashCommandMenu({
  commands,
  selectedIndex,
  onSelect,
  className = ""
}: SlashCommandMenuProps) {
  if (commands.length === 0) {
    return (
      <div className={`absolute bottom-full left-0 right-0 mb-2 bg-slate-950/[0.98] border border-slate-600/40 rounded-xl shadow-[0_20px_48px_-36px_rgba(0,0,0,0.5),0_4px_12px_-6px_rgba(0,0,0,0.3)] max-h-80 overflow-hidden flex flex-col z-[100] animate-[slash-menu-appear_150ms_ease-out] ${className}`}>
        <div className="p-4 text-center text-slate-400/70 text-xs">
          No commands found
        </div>
      </div>
    );
  }

  return (
    <div className={`absolute bottom-full left-0 right-0 mb-2 bg-slate-950/[0.98] border border-slate-600/40 rounded-xl shadow-[0_20px_48px_-36px_rgba(0,0,0,0.5),0_4px_12px_-6px_rgba(0,0,0,0.3)] max-h-80 overflow-hidden flex flex-col z-[100] animate-[slash-menu-appear_150ms_ease-out] ${className}`}>
      <div className="flex items-center justify-between px-3 pt-2.5 pb-1.5 border-b border-slate-600/30">
        <span className="text-[0.65rem] font-bold uppercase tracking-[0.08em] text-slate-400/70">Commands</span>
      </div>
      <ul className="list-none m-0 p-1.5 overflow-y-auto flex-1 scrollbar-thin" role="listbox">
        {commands.map((command, index) => {
          const isSelected = index === selectedIndex;
          return (
            <li
              key={command.id}
              role="option"
              aria-selected={isSelected}
              className={`flex items-center gap-2.5 py-2 px-2.5 rounded-lg cursor-pointer transition-all duration-[120ms] border border-transparent ${isSelected ? "bg-blue-500/15 border-blue-500/25" : "hover:bg-blue-500/15 hover:border-blue-500/25"}`}
              onClick={() => onSelect(command)}
            >
              <span className={`inline-flex items-center justify-center w-[1.6rem] h-[1.6rem] rounded-md shrink-0 transition-colors ${isSelected ? "bg-blue-500/25 text-blue-300/90" : "bg-slate-800/80 text-slate-400/80"}`}>
                {command.icon && iconMap[command.icon] ? iconMap[command.icon] : <Command className="h-4 w-4" />}
              </span>
              <div className="flex flex-col gap-px flex-1 min-w-0">
                <span className="text-[0.8rem] font-semibold text-slate-200/90">/{command.command}</span>
                <span className="text-[0.68rem] text-slate-400/75">{command.description}</span>
              </div>
              {command.shortcut && (
                <kbd className="inline-flex items-center px-1.5 py-px border border-slate-600/40 rounded bg-slate-800/80 text-slate-400/80 text-[0.6rem] font-semibold shrink-0">{command.shortcut}</kbd>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// Default commands factory
export function createDefaultSlashCommands(
  handlers: {
    onUndo?: () => void;
    onRedo?: () => void;
    onClear?: () => void;
    onExport?: () => void;
    onScreenshot?: () => void;
    onHelp?: () => void;
    onExplain?: () => void;
  }
): SlashCommand[] {
  return [
    { id: "undo", command: "undo", description: "Undo last change", icon: "undo", shortcut: "Ctrl+Z", handler: handlers.onUndo || (() => {}) },
    { id: "redo", command: "redo", description: "Redo last undone change", icon: "redo", shortcut: "Ctrl+Y", handler: handlers.onRedo || (() => {}) },
    { id: "clear", command: "clear", description: "Clear conversation", icon: "clear", handler: handlers.onClear || (() => {}) },
    { id: "export", command: "export", description: "Export code to file", icon: "export", handler: handlers.onExport || (() => {}) },
    { id: "screenshot", command: "screenshot", description: "Download scene screenshot", icon: "image", handler: handlers.onScreenshot || (() => {}) },
    { id: "explain", command: "explain", description: "Explain the generated code", icon: "sparkles", handler: handlers.onExplain || (() => {}) },
    { id: "help", command: "help", description: "Show available commands", icon: "help", shortcut: "?", handler: handlers.onHelp || (() => {}) }
  ];
}
