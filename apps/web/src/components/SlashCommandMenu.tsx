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
      <div className={`slash-command-menu ${className}`}>
        <div className="slash-command-menu__empty">
          No commands found
        </div>
      </div>
    );
  }

  return (
    <div className={`slash-command-menu ${className}`}>
      <div className="slash-command-menu__header">
        <span>Commands</span>
      </div>
      <ul className="slash-command-menu__list" role="listbox">
        {commands.map((command, index) => {
          const isSelected = index === selectedIndex;
          return (
            <li
              key={command.id}
              role="option"
              aria-selected={isSelected}
              className={`slash-command-menu__item ${isSelected ? "slash-command-menu__item--selected" : ""}`}
              onClick={() => onSelect(command)}
              onMouseEnter={() => {}} // Could track hover state here
            >
              <span className="slash-command-menu__icon">
                {command.icon && iconMap[command.icon] ? iconMap[command.icon] : <Command className="h-4 w-4" />}
              </span>
              <div className="slash-command-menu__content">
                <span className="slash-command-menu__command">/{command.command}</span>
                <span className="slash-command-menu__description">{command.description}</span>
              </div>
              {command.shortcut && (
                <kbd className="slash-command-menu__shortcut">{command.shortcut}</kbd>
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
    {
      id: "undo",
      command: "undo",
      description: "Undo last change",
      icon: "undo",
      shortcut: "Ctrl+Z",
      handler: handlers.onUndo || (() => {})
    },
    {
      id: "redo",
      command: "redo",
      description: "Redo last undone change",
      icon: "redo",
      shortcut: "Ctrl+Y",
      handler: handlers.onRedo || (() => {})
    },
    {
      id: "clear",
      command: "clear",
      description: "Clear conversation",
      icon: "clear",
      handler: handlers.onClear || (() => {})
    },
    {
      id: "export",
      command: "export",
      description: "Export code to file",
      icon: "export",
      handler: handlers.onExport || (() => {})
    },
    {
      id: "screenshot",
      command: "screenshot",
      description: "Download scene screenshot",
      icon: "image",
      handler: handlers.onScreenshot || (() => {})
    },
    {
      id: "explain",
      command: "explain",
      description: "Explain the generated code",
      icon: "sparkles",
      handler: handlers.onExplain || (() => {})
    },
    {
      id: "help",
      command: "help",
      description: "Show available commands",
      icon: "help",
      shortcut: "?",
      handler: handlers.onHelp || (() => {})
    }
  ];
}
