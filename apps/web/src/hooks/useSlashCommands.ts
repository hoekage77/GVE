import { useState, useCallback, useEffect } from "react";

export interface SlashCommand {
  id: string;
  command: string;
  description: string;
  icon?: string;
  shortcut?: string;
  handler: () => void | Promise<void>;
}

export interface UseSlashCommandsOptions {
  commands: SlashCommand[];
  onClose?: () => void;
}

export interface UseSlashCommandsReturn {
  isOpen: boolean;
  filteredCommands: SlashCommand[];
  selectedIndex: number;
  inputValue: string;
  openMenu: () => void;
  closeMenu: () => void;
  handleInput: (value: string, cursorPosition: number) => void;
  handleSelect: (command: SlashCommand) => void;
  handleKeyDown: (event: React.KeyboardEvent) => boolean;
}

export function useSlashCommands({
  commands,
  onClose
}: UseSlashCommandsOptions): UseSlashCommandsReturn {
  const [isOpen, setIsOpen] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [triggerPosition, setTriggerPosition] = useState<number | null>(null);

  // Filter commands based on input
  const filteredCommands = inputValue.slice(1).trim()
    ? commands.filter(cmd =>
        cmd.command.toLowerCase().includes(inputValue.slice(1).toLowerCase()) ||
        cmd.description.toLowerCase().includes(inputValue.slice(1).toLowerCase())
      )
    : commands;

  const openMenu = useCallback(() => {
    setIsOpen(true);
    setSelectedIndex(0);
  }, []);

  const closeMenu = useCallback(() => {
    setIsOpen(false);
    setInputValue("");
    setTriggerPosition(null);
    onClose?.();
  }, [onClose]);

  const handleInput = useCallback((value: string, cursorPosition: number) => {
    // Check if we just typed /
    const charBeforeCursor = value[cursorPosition - 1];
    const charTwoBefore = value[cursorPosition - 2];
    
    // Open menu when typing / at start or after space
    if (charBeforeCursor === "/" && (!charTwoBefore || charTwoBefore === " ")) {
      setIsOpen(true);
      setTriggerPosition(cursorPosition - 1);
      setInputValue("/");
      setSelectedIndex(0);
      return;
    }

    // Update filter if menu is open
    if (isOpen && triggerPosition !== null) {
      const query = value.slice(triggerPosition, cursorPosition);
      // Close if user types space after command or deletes the /
      if (query.includes(" ") || cursorPosition < triggerPosition) {
        closeMenu();
      } else {
        setInputValue(query);
        setSelectedIndex(0);
      }
    }
  }, [isOpen, triggerPosition, closeMenu]);

  const handleSelect = useCallback(async (command: SlashCommand) => {
    await command.handler();
    closeMenu();
  }, [closeMenu]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent): boolean => {
    if (!isOpen) return false;

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setSelectedIndex(prev => 
          prev < filteredCommands.length - 1 ? prev + 1 : 0
        );
        return true;

      case "ArrowUp":
        event.preventDefault();
        setSelectedIndex(prev => 
          prev > 0 ? prev - 1 : filteredCommands.length - 1
        );
        return true;

      case "Enter":
        event.preventDefault();
        if (filteredCommands[selectedIndex]) {
          handleSelect(filteredCommands[selectedIndex]);
        }
        return true;

      case "Escape":
        event.preventDefault();
        closeMenu();
        return true;

      case "Tab":
        event.preventDefault();
        if (filteredCommands[selectedIndex]) {
          handleSelect(filteredCommands[selectedIndex]);
        }
        return true;

      default:
        return false;
    }
  }, [isOpen, filteredCommands, selectedIndex, handleSelect, closeMenu]);

  // Reset selected index when filtered commands change
  useEffect(() => {
    setSelectedIndex(0);
  }, [filteredCommands.length]);

  return {
    isOpen,
    filteredCommands,
    selectedIndex,
    inputValue,
    openMenu,
    closeMenu,
    handleInput,
    handleSelect,
    handleKeyDown
  };
}
