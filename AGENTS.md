# Terranet Chat Interface Redesign Specification

## Design Philosophy

**Chat-First Architecture**: The chat is the "koko" (heart/core). Everything else is secondary, on-demand, and responsive. The chat interface should feel like a premium messaging experience - clean, focused, and fluid.

**Key Principles**:
1. Chat takes priority - full width when no panels open
2. Panels are on-demand overlays/sidebars that don't permanently split the space
3. Smooth transitions - panels slide in/out gracefully
4. Scene presence is indicated inline in chat, not as separate UI chrome
5. DeepSeek-style minimalism with thoughtful details

---

## 1. Layout Architecture

### Primary Layout (Chat Only)
```
┌─────────────────────────────────────────────────────────┐
│  Header (Terranet logo, Settings, User)                  │
├──────────┬──────────────────────────────────────────────┤
│          │                                                │
│ Sidebar  │   Chat Messages (full width, max-width: 768px)│
│ (260px)  │                                                │
│          │   ┌─────────────────────────────────────┐    │
│          │   │ User Message (light blue bubble)    │    │
│          │   └─────────────────────────────────────┘    │
│          │                                                │
│          │   ┌─────────────────────────────────────┐    │
│          │   │ AI Message + Scene Toolbar          │    │
│          │   │ (sparkles) scene-123 [OPEN] <> 👁   │    │
│          │   │                                     │    │
│          │   │ Message content in markdown...      │    │
│          │   │                                     │    │
│          │   │ ▼ Thought for 3.2 seconds            │    │
│          │   └─────────────────────────────────────┘    │
│          │                                                │
│          │   ┌─────────────────────────────────────┐    │
│          │   │ Composer (rounded, shadow)          │    │
│          │   └─────────────────────────────────────┘    │
│          │                                                │
└──────────┴──────────────────────────────────────────────┘
```

### With Preview Panel Open
```
┌─────────────────────────────────────────────────────────┐
│  Header (Terranet logo, Settings, User)                  │
├──────────┬───────────────────────────┬───────────────────┤
│          │                           │                   │
│ Sidebar  │   Chat (shrinks smoothly) │  Preview Panel   │
│ (260px)  │   (flex: 1, min-width)   │  (flex: 0 0 50%)  │
│          │                           │  or (0 0 600px)   │
│          │                           │                   │
│          │                           │  ┌─────────────┐   │
│          │                           │  │ Scene      │   │
│          │                           │  │ Viewer     │   │
│          │                           │  │ (iframe)   │   │
│          │                           │  └─────────────┘   │
└──────────┴───────────────────────────┴───────────────────┘
```

### Responsive Behavior
- **Desktop (>1200px)**: Panel opens at `flex: 0 0 45%` (max 700px)
- **Tablet (768px-1200px)**: Panel opens at `flex: 0 0 50%` (overlay option on smaller)
- **Mobile (<768px)**: Panel is full-screen overlay with backdrop

---

## 2. Scene Toolbar (Inline in Chat)

Based on the user's screenshot, this appears after AI messages that generate scenes:

```
┌────────────────────────────────────────────────────────┐
│  ✨  scene-1775396152369    [OPEN]    </>    👁        │
│     (sparkles)  (scene id)  (badge)  (code) (preview) │
└────────────────────────────────────────────────────────┘
```

**Components**:
1. **Sparkles Icon** - Indicates AI-generated scene
2. **Scene ID** - Truncated if too long (scene-...)
3. **OPEN Badge** - Green pill indicating scene is ready
4. **Code Button** - Opens code panel (replaces preview if open)
5. **Preview Button** - Opens preview panel (replaces code if open)

**Interaction**:
- Clicking Code when Preview is open → Panel switches to Code view
- Clicking Preview when Code is open → Panel switches to Preview view  
- Clicking same button again → Closes the panel entirely
- Chat smoothly resizes as panel opens/closes

---

## 3. Thought Process Component (DeepSeek-Style)

```
▼ Thought for 3.2 seconds
  ┌────────────────────────────────────┐
  │ PARSE_INTENT                       │
  │ Analyzing user request for 3D...   │
  │                                    │
  │ SELECT_SKILL                       │
  │ Scored: threejs=0.97, p5js=0.62   │
  │                                    │
  │ GENERATE_CODE                      │
  │ Building scene with lighting...    │
  └────────────────────────────────────┘
```

**Requirements**:
1. Collapsible with ▶/▼ indicator
2. Shows duration in seconds
3. Step labels in uppercase
4. Stacked vertically with subtle separators
5. Appears only when thoughts exist and AI is done thinking

---

## 4. Markdown Rendering for AI Messages

**Supported Elements**:
- Headers (h1-h4) - styled but smaller than typical
- Paragraphs - comfortable line-height (1.6)
- Bold/Italic - standard
- Inline Code - `monospace` with light background
- Code Blocks - with syntax highlighting, copy button
- Lists (ul/ol) - proper indentation
- Links - blue, underlined on hover
- Blockquotes - left border, muted color
- Tables - minimal styling, horizontal scroll if needed

**Styling**:
- Clean typography with system font stack
- Comfortable reading width (within message bubble constraints)
- Subtle color differences for inline vs block code

---

## 5. Panel System (Preview/Code)

### Animation
- **Open**: Slide in from right, 300ms ease-out
- **Close**: Slide out to right, 200ms ease-in
- **Switch**: Cross-fade content, 150ms
- **Chat Resize**: Smooth flex transition, 300ms

### Panel Header
```
┌────────────────────────────────────────┐
│  👁 Preview    [x]                     │
│  ─────────────────────────────────────  │
└────────────────────────────────────────┘
```

Simple header with:
- Icon + Label (Preview or Code)
- Close button (x)
- Optional: Tab switcher if we want both in panel

### Responsive Panel
- Desktop: Fixed width (min 400px, max 50%)
- Tablet: 50% width
- Mobile: Full screen overlay

---

## 6. Scene Viewer (Iframe Integration)

**Requirements**:
1. Actual iframe rendering of generated scenes
2. Sandbox security attributes
3. Loading state while scene renders
4. Error handling for failed renders
5. Control bar for zoom/rotate/reset (3D scenes)

**Iframe Source**:
- Use `srcDoc` with generated HTML/JS code
- Wrap in proper HTML structure with skill CDN imports
- Example: Three.js scenes get Three.js CDN, p5.js gets p5 CDN

**Wrapper HTML Template**:
```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Terranet Scene</title>
  <style>body{margin:0;overflow:hidden;background:#1a1a2e}</style>
  <!-- Skill-specific CDN imports -->
  <script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
</head>
<body>
  <div id="scene-container"></div>
  <script>
    // User generated code here
    try {
      ${userCode}
    } catch (err) {
      parent.postMessage({type: 'scene:error', error: err.message}, '*');
    }
  </script>
</body>
</html>
```

---

## 7. Dark Mode

All components must support dark mode via `prefers-color-scheme`:

**Key Color Mappings**:
- Background: `#0f172a` (slate-950)
- Surface: `#1e293b` (slate-800)
- Border: `#334155` (slate-700)
- Text Primary: `#e2e8f0` (slate-200)
- Text Secondary: `#94a3b8` (slate-400)
- Accent: `#60a5fa` (blue-400)
- User Bubble: `#1e3a8a` (dark blue)

---

## 8. Implementation Checklist

### Phase 1: Remove Redundancy
- [ ] Remove Preview/Code buttons from Header.tsx
- [ ] Remove drawer from Header.tsx (keep it simple)
- [ ] Remove Preview/Code buttons from ChatContainer.tsx header
- [ ] Remove workspace panel from ChatContainer.tsx

### Phase 2: New Panel System
- [ ] Create WorkspacePanel component (slides from right)
- [ ] Create useWorkspace hook in chatStore
- [ ] Implement smooth resize for chat content

### Phase 3: Scene Toolbar
- [ ] Create SceneToolbar component
- [ ] Integrate into AIMessage when scene exists
- [ ] Wire up open/close/toggle logic

### Phase 4: Markdown
- [ ] Install react-markdown + remark-gfm
- [ ] Create MarkdownRenderer component
- [ ] Style all markdown elements

### Phase 5: Thought Component
- [ ] Enhance ThoughtProcess with duration
- [ ] Collapsible with smooth animation
- [ ] Step-by-step display

### Phase 6: Scene Viewer
- [ ] Create iframe wrapper with CDN imports
- [ ] Implement sandbox security
- [ ] Add loading/error states
- [ ] Test with actual Three.js/p5.js scenes

### Phase 7: Dark Mode
- [ ] Audit all components for dark mode
- [ ] Add prefers-color-scheme media queries
- [ ] Test all interactions in dark mode

---

## 9. CSS Architecture

```
styles/
├── base.css           # Reset, variables, utilities
├── layout.css         # App layout, sidebar, header (simplified)
├── chat.css           # Messages, composer, scene toolbar
├── markdown.css       # Markdown rendering styles
├── panels.css         # Workspace panel, animations
├── scene-viewer.css   # Iframe, controls, loading
└── dark-mode.css      # All dark mode overrides
```

---

## 10. File Structure

```
components/
├── chat/
│   ├── ChatContainer.tsx
│   ├── MessageComponents.tsx
│   ├── Composer.tsx
│   ├── SceneToolbar.tsx        # NEW
│   └── MarkdownRenderer.tsx    # NEW
├── layout/
│   ├── MainLayout.tsx
│   ├── Header.tsx              # SIMPLIFIED
│   └── Sidebar.tsx
├── workspace/
│   └── WorkspacePanel.tsx      # NEW
├── SceneViewer.tsx             # ENHANCED
└── CodeEditor.tsx
```

---

## 11. State Management

New store properties:
```typescript
interface ChatState {
  // ... existing ...
  
  // Workspace panel state
  panelOpen: boolean;
  panelView: 'preview' | 'code' | null;
  panelWidth: number; // user-resizable, default 45%
  
  // Actions
  openPanel: (view: 'preview' | 'code') => void;
  closePanel: () => void;
  togglePanel: (view: 'preview' | 'code') => void;
  setPanelWidth: (width: number) => void;
}
```

---

## 12. Animation Specs

**Panel Slide**:
- Duration: 300ms
- Easing: cubic-bezier(0.4, 0, 0.2, 1)
- Transform: translateX(100%) → translateX(0)

**Chat Resize**:
- Duration: 300ms
- Easing: ease-out
- Property: flex-basis or width

**Backdrop Fade**:
- Duration: 200ms
- Opacity: 0 → 0.3

**Thought Expand**:
- Duration: 200ms
- Height animation with overflow hidden

---

This specification ensures:
1. Chat is always the focus
2. Panels are responsive and on-demand
3. Scene presence is shown inline
4. Transitions are smooth and premium
5. Dark mode works throughout
6. Markdown renders beautifully
7. Iframe scenes work securely
