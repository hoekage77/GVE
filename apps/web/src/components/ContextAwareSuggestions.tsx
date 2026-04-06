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

// Skill-specific suggestion generators
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
      // Initial suggestions when no scene exists
      return [
        { id: "3d-cube", label: "3D Cube", prompt: "Create a rotating 3D cube", category: "general" as const },
        { id: "sphere", label: "Sphere", prompt: "Create a 3D sphere", category: "general" as const },
        { id: "particles", label: "Particles", prompt: "Create a particle explosion effect", category: "general" as const },
        { id: "chart", label: "Bar Chart", prompt: "Create a simple bar chart with random data", category: "general" as const },
      ];
    }

    // Get skill-specific suggestions
    const skillKey = skill && SKILL_SUGGESTIONS[skill] ? skill : "default";
    return SKILL_SUGGESTIONS[skillKey] || SKILL_SUGGESTIONS.default;
  }, [skill, hasScene]);

  // Group suggestions by category
  const groupedSuggestions = useMemo(() => {
    const groups: Record<string, Suggestion[]> = {};
    suggestions.forEach(s => {
      if (!groups[s.category]) groups[s.category] = [];
      groups[s.category].push(s);
    });
    return groups;
  }, [suggestions]);

  const categoryLabels: Record<string, string> = {
    color: "Colors",
    animation: "Animation",
    shape: "Shape",
    lighting: "Lighting",
    camera: "Camera",
    material: "Material",
    general: "Quick Actions"
  };

  if (suggestions.length === 0) return null;

  return (
    <div className={`context-suggestions ${className}`}>
      <div className="context-suggestions__header">
        <Sparkles className="h-3 w-3" />
        <span>Try these</span>
      </div>
      
      <div className="context-suggestions__chips">
        {suggestions.map((suggestion) => (
          <button
            key={suggestion.id}
            type="button"
            className="context-suggestion-chip"
            onClick={() => onSuggestionClick(suggestion.prompt)}
            title={suggestion.prompt}
          >
            {suggestion.icon && (
              <span className="context-suggestion-chip__icon">{suggestion.icon}</span>
            )}
            <span className="context-suggestion-chip__label">{suggestion.label}</span>
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
    // Return top 3 suggestions
    return allSuggestions.slice(0, 3);
  }, [skill]);

  return (
    <div className={`inline-suggestions ${className}`}>
      <span className="inline-suggestions__label">Try:</span>
      {suggestions.map((suggestion) => (
        <button
          key={suggestion.id}
          type="button"
          className="inline-suggestion-chip"
          onClick={() => onSuggestionClick(suggestion.prompt)}
        >
          {suggestion.label}
        </button>
      ))}
    </div>
  );
}
