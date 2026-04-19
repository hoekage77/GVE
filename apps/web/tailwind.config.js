const config = {
    darkMode: "class",
    content: ["./index.html", "./src/**/*.{ts,tsx}"],
    theme: {
        extend: {
            colors: {
                border: "hsl(var(--border))",
                input: "hsl(var(--input))",
                ring: "hsl(var(--ring))",
                background: "hsl(var(--background))",
                foreground: "hsl(var(--foreground))",
                primary: {
                    DEFAULT: "hsl(var(--primary))",
                    foreground: "hsl(var(--primary-foreground))"
                },
                secondary: {
                    DEFAULT: "hsl(var(--secondary))",
                    foreground: "hsl(var(--secondary-foreground))"
                },
                muted: {
                    DEFAULT: "hsl(var(--muted))",
                    foreground: "hsl(var(--muted-foreground))"
                },
                accent: {
                    DEFAULT: "hsl(var(--accent))",
                    foreground: "hsl(var(--accent-foreground))"
                },
                card: {
                    DEFAULT: "hsl(var(--card))",
                    foreground: "hsl(var(--card-foreground))"
                },
                // GVE design system tokens
                surface: {
                    DEFAULT: "#18181b",
                    "2": "#202024",
                    "3": "#27272a"
                },
                "meta-border": "#2f2f35",
                "meta-text": "#f5f5f5",
                "meta-muted": "#a1a1aa",
                "auth-bg": "#0B0D10",
                "auth-surface": "#1A1D23",
                "auth-ink": "#E2E8F0",
                "auth-muted": "#94A3B8",
                "auth-accent": "#FF6A3D",
                "auth-accent-strong": "#FF8A5B"
            },
            borderRadius: {
                lg: "var(--radius)",
                md: "calc(var(--radius) - 2px)",
                sm: "calc(var(--radius) - 4px)"
            },
            animation: {
                "fade-in": "fade-in 0.24s ease-out",
                "slide-down": "slide-down 0.3s ease-out",
                "slide-in-right": "slide-in-right 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
                "pulse-icon": "pulse-icon 3s ease-in-out infinite",
                "blink-dot": "blink-dot 1.2s ease-in-out infinite",
                "drift-x": "drift-x 30s linear infinite"
            },
            keyframes: {
                "fade-in": {
                    from: { opacity: "0" },
                    to: { opacity: "1" }
                },
                "slide-down": {
                    from: { opacity: "0", transform: "translateY(-4px)" },
                    to: { opacity: "1", transform: "translateY(0)" }
                },
                "slide-in-right": {
                    from: { transform: "translateX(400px)", opacity: "0" },
                    to: { transform: "translateX(0)", opacity: "1" }
                },
                "pulse-icon": {
                    "0%, 100%": { opacity: "0.3", transform: "scale(1)" },
                    "50%": { opacity: "0.6", transform: "scale(1.1)" }
                },
                "blink-dot": {
                    "0%, 100%": { opacity: "0.3" },
                    "50%": { opacity: "1" }
                },
                "drift-x": {
                    "0%": { transform: "translateX(0) scale(1.05)" },
                    "50%": { transform: "translateX(-2%) scale(1.05)" },
                    "100%": { transform: "translateX(0) scale(1.05)" }
                }
            }
        }
    },
    plugins: []
};
export default config;
