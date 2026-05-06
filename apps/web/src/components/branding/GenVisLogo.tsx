interface GenVisLogoProps {
  className?: string;
  size?: number;
  color?: string;
}

export function GenVisLogo({ className = "", size = 32, color = "currentColor" }: GenVisLogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      {/* Outer hexagonal frame — represents a viewport/canvas */}
      <path
        d="M16 2L28 9v14L16 30 4 23V9L16 2z"
        stroke={color}
        strokeWidth="1.5"
        strokeLinejoin="round"
        fill="none"
        opacity="0.9"
      />
      
      {/* Inner aperture / eye shape — the "vision" */}
      <path
        d="M16 8c4.5 0 8.5 3 10 7.5-1.5 4.5-5.5 7.5-10 7.5S7.5 20 6 15.5C7.5 11 11.5 8 16 8z"
        stroke={color}
        strokeWidth="1.5"
        fill="none"
        opacity="0.6"
      />
      
      {/* Central pupil / data node */}
      <circle
        cx="16"
        cy="15.5"
        r="3.5"
        fill={color}
        opacity="0.85"
      />
      
      {/* Radial scan lines — AI processing */}
      <path
        d="M16 2v6M16 23v7M4 9l4 3M24 20l4 3M4 23l4-3M24 12l4-3"
        stroke={color}
        strokeWidth="1"
        strokeLinecap="round"
        opacity="0.35"
      />
      
      {/* Data pulse dots */}
      <circle cx="16" cy="15.5" r="6" stroke={color} strokeWidth="0.5" fill="none" opacity="0.25" />
      <circle cx="16" cy="15.5" r="8.5" stroke={color} strokeWidth="0.5" fill="none" opacity="0.15" />
    </svg>
  );
}

export function GenVisLogoMinimal({ className = "", size = 24, color = "currentColor" }: GenVisLogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      {/* Hexagonal viewport */}
      <path
        d="M16 3L27 9.5v13L16 29 5 22.5v-13L16 3z"
        stroke={color}
        strokeWidth="1.5"
        strokeLinejoin="round"
        fill="none"
      />
      
      {/* Eye / vision core */}
      <path
        d="M16 9.5c4 0 7.5 2.6 8.8 6.5-1.3 3.9-4.8 6.5-8.8 6.5S8.5 19.9 7.2 16c1.3-3.9 4.8-6.5 8.8-6.5z"
        fill={color}
        fillOpacity="0.15"
        stroke={color}
        strokeWidth="1.2"
      />
      
      {/* Central core */}
      <circle cx="16" cy="16" r="3" fill={color} fillOpacity="0.9" />
    </svg>
  );
}
