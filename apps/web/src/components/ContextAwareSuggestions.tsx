import { useMemo } from "react";
import { Sparkles, Palette, RotateCw, Box, Lightbulb, Code, Image, Type, Shapes } from "lucide-react";

type SuggestionCategory = "color" | "animation" | "shape" | "lighting" | "camera" | "material" | "general";

interface Suggestion {
  id: string;
  label: string;
  prompt: string;
  category: SuggestionCategory;
  icon?: React.ReactNode;
}

interface ContextAwareSuggestionsProps {
  skill?: string | null;
  hasScene?: boolean;
  onSuggestionClick: (prompt: string) => void;
  className?: string;
}

const SKILL_SUGGESTIONS: Record<string, Suggestion[]> = {
  threejs: [
    { id: "color-red", label: "Make it red", prompt: "Change the color to red", category: "color", icon: <Palette className="h-3 w-3" /> },
    { id: "color-blue", label: "Make it blue", prompt: "Change the color to blue", category: "color", icon: <Palette className="h-3 w-3" /> },
    { id: "rotate", label: "Add rotation", prompt: "Add continuous rotation animation", category: "animation", icon: <RotateCw className="h-3 w-3" /> },
    { id: "bigger", label: "Make bigger", prompt: "Make it 2x bigger", category: "shape", icon: <Box className="h-3 w-3" /> },
    { id: "smaller", label: "Make smaller", prompt: "Make it half the size", category: "shape", icon: <Box className="h-3 w-3" /> },
    { id: "lighting", label: "Better lighting", prompt: "Add better lighting with ambient and directional lights", category: "lighting", icon: <Lightbulb className="h-3 w-3" /> },
    { id: "wireframe", label: "Wireframe mode", prompt: "Show it in wireframe mode", category: "material", icon: <Code className="h-3 w-3" /> },
    { id: "texture", label: "Add texture", prompt: "Add a texture to the surface", category: "material", icon: <Image className="h-3 w-3" /> },
  ],
  p5js: [
    { id: "color-change", label: "Random colors", prompt: "Use random colors", category: "color", icon: <Palette className="h-3 w-3" /> },
    { id: "animate", label: "Animate it", prompt: "Add animation to make it move", category: "animation", icon: <RotateCw className="h-3 w-3" /> },
    { id: "interactive", label: "Mouse follow", prompt: "Make it follow the mouse", category: "animation", icon: <Sparkles className="h-3 w-3" /> },
    { id: "pattern", label: "More patterns", prompt: "Add more patterns to the background", category: "shape", icon: <Shapes className="h-3 w-3" /> },
  ],
  d3js: [
    { id: "colors", label: "Better colors", prompt: "Use a better color scheme", category: "color", icon: <Palette className="h-3 w-3" /> },
    { id: "labels", label: "Add labels", prompt: "Add data labels to the chart", category: "general", icon: <Type className="h-3 w-3" /> },
    { id: "animate", label: "Animate bars", prompt: "Animate the bars growing", category: "animation", icon: <RotateCw className="h-3 w-3" /> },
  ],
  animejs: [
    { id: "faster", label: "Faster", prompt: "Make the animation faster", category: "animation", icon: <RotateCw className="h-3 w-3" /> },
    { id: "slower", label: "Slower", prompt: "Make the animation slower and smoother", category: "animation", icon: <RotateCw className="h-3 w-3" /> },
    { id: "loop", label: "Loop forever", prompt: "Make it loop forever", category: "animation", icon: <RotateCw className="h-3 w-3" /> },
  ],
  default: [
    { id: "simple", label: "Simpler version", prompt: "Create a simpler version", category: "general" },
    { id: "complex", label: "More complex", prompt: "Make it more complex and detailed", category: "general" },
    { id: "explain", label: "Explain code", prompt: "Explain how this code works", category: "general" },
  ]
};

export function ContextAwareSuggestions({
  skill,
  hasScene = false,
  onSuggestionClick,
  className = ""
}: ContextAwareSuggestionsProps) {
  const suggestions = useMemo(() => {
    if (!hasScene) {
      return [
        { id: "3d-cube", label: "3D Cube", prompt: "Create a rotating 3D cube", category: "general" as const },
        { id: "sphere", label: "Sphere", prompt: "Create a 3D sphere", category: "general" as const },
        { id: "particles", label: "Particles", prompt: "Create a particle explosion effect", category: "general" as const },
        { id: "chart", label: "Bar Chart", prompt: "Create a simple bar chart with random data", category: "general" as const },
      ];
    }

    const skillKey = skill && SKILL_SUGGESTIONS[skill] ? skill : "default";
    return SKILL_SUGGESTIONS[skillKey] || SKILL_SUGGESTIONS.default;
  }, [skill, hasScene]);

  if (suggestions.length === 0) return null;

  return (
    <div className={`p-2 px-3 bg-slate-800/40 rounded-xl border border-slate-600/30 animate-fade-in ${className}`}>
      <div className="flex items-center gap-1.5 mb-2 text-slate-400/70 text-[0.7rem] font-semibold uppercase tracking-[0.05em]">
        <Sparkles className="h-3 w-3" />
        <span>Try these</span>
      </div>

      <div className="flex flex-wrap gap-1.5 max-sm:gap-1">
        {suggestions.map((suggestion) => (
          <button
            key={suggestion.id}
            type="button"
            className="inline-flex items-center gap-1.5 py-1.5 px-2.5 max-sm:py-1 max-sm:px-2 border border-slate-600/40 rounded-full bg-slate-800/60 text-slate-300/85 text-[0.72rem] max-sm:text-[0.68rem] font-medium cursor-pointer transition-all duration-150 whitespace-nowrap hover:bg-blue-500/15 hover:border-blue-500/40 hover:text-blue-300/90 hover:-translate-y-px active:translate-y-0"
            onClick={() => onSuggestionClick(suggestion.prompt)}
            title={suggestion.prompt}
          >
            {suggestion.icon && (
              <span className="inline-flex text-current opacity-70 max-sm:hidden">{suggestion.icon}</span>
            )}
            <span className="leading-none">{suggestion.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// Compact inline version for message cards
export function InlineSuggestions({
  skill,
  onSuggestionClick,
  className = ""
}: {
  skill?: string | null;
  onSuggestionClick: (prompt: string) => void;
  className?: string;
}) {
  const suggestions = useMemo(() => {
    const skillKey = skill && SKILL_SUGGESTIONS[skill] ? skill : "default";
    const allSuggestions = SKILL_SUGGESTIONS[skillKey] || SKILL_SUGGESTIONS.default;
    return allSuggestions.slice(0, 3);
  }, [skill]);

  return (
    <div className={`inline-flex items-center gap-1.5 mt-2 py-1.5 ${className}`}>
      <span className="text-slate-400/60 text-[0.7rem] font-medium mr-0.5">Try:</span>
      {suggestions.map((suggestion) => (
        <button
          key={suggestion.id}
          type="button"
          className="inline-flex items-center py-1 px-2 border border-slate-600/40 rounded-full bg-slate-800/50 text-slate-300/80 text-[0.68rem] font-medium cursor-pointer transition-all duration-150 hover:bg-blue-500/12 hover:border-blue-500/35 hover:text-blue-300/85"
          onClick={() => onSuggestionClick(suggestion.prompt)}
        >
          {suggestion.label}
        </button>
      ))}
    </div>
  );
}
