# CSS → Tailwind Migration Handoff Document

> **For: Agent Haiku**
> **From: Lead Orchestrator**
> **Project: Generative Visual Engine (GVE) — `apps/web`**
> **Tailwind Version: v4.2.2** (uses `@import "tailwindcss"` syntax, `@tailwindcss/postcss` plugin)

---

## 1. PROJECT CONTEXT

This is a React + TypeScript + Vite frontend at `/home/kage/visualruntime/apps/web`.
The app is a dark-themed chat interface for a generative visual engine. It uses Zustand for state, TanStack Router, Lucide icons, and Clerk for auth.

**The goal:** Migrate ALL remaining vanilla CSS files to inline Tailwind utility classes in the TSX components, then delete the vacated CSS files and remove their imports from `main.tsx`.

---

## 2. WHAT HAS ALREADY BEEN COMPLETED

The following work is DONE — do NOT touch these files:

| File | Status |
|---|---|
| `tailwind.config.ts` | ✅ Extended with custom tokens (surface colors, auth colors, animations, keyframes) |
| `components/ToastContainer.tsx` | ✅ Fully migrated to Tailwind |
| `pages/Auth.tsx` | ✅ Fully migrated to Tailwind |
| `components/login-form.tsx` | ✅ Fully migrated to Tailwind |
| `components/TypingIndicator.tsx` | ✅ Fully migrated to Tailwind |
| `components/MessageActions.tsx` | ✅ Fully migrated to Tailwind |
| `components/MessageTimestamp.tsx` | ✅ Fully migrated to Tailwind |
| `components/SlashCommandMenu.tsx` | ✅ Fully migrated to Tailwind |
| `components/ContextAwareSuggestions.tsx` | ✅ Fully migrated to Tailwind |
| `styles/toast.css` | ✅ Import removed from `main.tsx` (file can be deleted) |
| `styles/auth.css` | ✅ Import removed from `main.tsx` (file can be deleted) |
| `index.css` lines 3-68 | ✅ Keyframes + markdown-message prose added |
| `components/MarkdownMessage.css` | ✅ Consolidated into `index.css` (file can be deleted) |

**CSS files already removed from `main.tsx`:**
- `styles/toast.css`
- `styles/auth.css`

---

## 3. WHAT REMAINS — ORDERED BY PRIORITY

### Current `main.tsx` imports to eliminate:
```tsx
import "./index.css";              // KEEP (base resets + keyframes + markdown prose)
import "./styles/layout.css";      // MIGRATE then remove
import "./styles/chat.css";        // MIGRATE then remove
import "./styles/iteration.css";   // MIGRATE then remove
import "./styles/action-blocks.css"; // MIGRATE then remove
import "./styles/split-pane.css";  // MIGRATE then remove
import "./styles/messages.css";    // MIGRATE then remove
```

### 3A. DELETE ORPHANED CSS FILES (no import references remain)

These files are no longer imported anywhere. Delete them:

| File | Lines | Action |
|---|---|---|
| `components/TypingIndicator.css` | 239 | **DELETE** — component already migrated |
| `components/MarkdownMessage.css` | 185 | **DELETE** — styles consolidated into `index.css` |
| `components/MessageActions.css` | 107 | **DELETE** — component already migrated |
| `components/MessageTimestamp.css` | 136 | **DELETE** — component already migrated |
| `components/SlashCommandMenu.css` | 209 | **DELETE** — component already migrated |
| `components/ContextAwareSuggestions.css` | 196 | **DELETE** — component already migrated |
| `styles/toast.css` | 134 | **DELETE** — component already migrated |
| `styles/auth.css` | 316 | **DELETE** — component already migrated |

### 3B. MIGRATE `styles/messages.css` (195 lines)

**File:** `/home/kage/visualruntime/apps/web/src/styles/messages.css`
**Imported in:** `main.tsx` line 11

**What it contains:**
- `@keyframes fade-in`, `slide-down`, `row-fade` — animation keyframes
- `.animate-fade-in`, `.animate-slide-down`, `.animate-row-fade` — animation utility classes
- `.scrollbar` — custom scrollbar styling (webkit + Firefox)
- Mobile responsive overrides that target Tailwind utility classes (`.gap-3`, `.text-sm`, etc.) — **ANTI-PATTERN, remove these**

**Migration strategy:**
1. The keyframes `fade-in` and `slide-down` already exist in `index.css` (lines 3-20) and `tailwind.config.ts`. Add `row-fade` keyframe to `index.css` if not already present.
2. Move the `.scrollbar` styling block to `index.css` as a global utility (it targets `::-webkit-scrollbar` which can't be done in Tailwind).
3. Delete all the mobile `@media` overrides that modify Tailwind classes like `.gap-3`, `.text-sm`, `.border-white\/10` — these are harmful because they override Tailwind's utility specificity.
4. Remove the import from `main.tsx` and delete the file.

**Scrollbar block to preserve (add to `index.css`):**
```css
/* ─── Custom scrollbar utility ─── */
.scrollbar::-webkit-scrollbar { width: 6px; height: 6px; }
.scrollbar::-webkit-scrollbar-track { background: transparent; }
.scrollbar::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.1); border-radius: 4px; }
.scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(255, 255, 255, 0.2); }
.scrollbar { scrollbar-color: rgba(255, 255, 255, 0.1) transparent; scrollbar-width: thin; }
```

### 3C. MIGRATE `styles/action-blocks.css` (660 lines)

**File:** `/home/kage/visualruntime/apps/web/src/styles/action-blocks.css`
**Imported in:** `main.tsx` line 9
**Used by TSX files:**
- `components/chat/ActionBlock.tsx`
- `components/chat/ActionBlockGroup.tsx`
- `components/chat/ActionStep.tsx`
- `components/workspace/TaskReferencePanel.tsx`

**What it contains:**
- `.action-block` — collapsible card with status variants (pending/running/completed/failed)
- `.action-block__header`, `__body`, `__steps` — BEM structure
- `.action-step` — individual step items with grid layout
- `.task-checkpoint` — checklist items for task reference panel
- `.task-reference-panel` — side panel container
- Each has light/dark mode via `@media (prefers-color-scheme: dark)` — **this app is always dark**, so use dark mode colors directly

**Migration strategy:**
1. Open each TSX file that uses these classes
2. Replace every CSS class with equivalent Tailwind utilities inline
3. Since the app is dark-only, use the dark mode colors directly (e.g., `bg-slate-800` not `bg-white` then dark override)
4. Status variants should be driven by a lookup object pattern:
```tsx
const STATUS_STYLES = {
  pending: { border: 'border-slate-700', bg: 'bg-slate-800', accent: 'text-slate-400' },
  running: { border: 'border-amber-900', bg: 'bg-amber-950', accent: 'text-amber-500' },
  completed: { border: 'border-emerald-900', bg: 'bg-emerald-950/50', accent: 'text-emerald-500' },
  failed: { border: 'border-red-900', bg: 'bg-red-950/50', accent: 'text-red-500' },
};
```
5. The `@keyframes terranet-task-spin` is just `animate-spin` in Tailwind.
6. The `@keyframes slideDown` for body expansion can use `animate-[slideDown_0.2s_ease-out]` referencing the keyframe already in `index.css`.
7. Remove import from `main.tsx`, delete the file.

### 3D. MIGRATE `styles/split-pane.css` (205 lines)

**File:** `/home/kage/visualruntime/apps/web/src/styles/split-pane.css`
**Imported in:** `main.tsx` line 10

**What it contains:**
- `.chat-layout` — flex container with `--full` and `--split` modifiers
- `.chat-layout__chat-pane` — main chat area
- `.chat-layout__reference-pane` — side reference panel (30% width, slides in)
- `.chat-layout__divider-toggle` — toggle button between panes
- Responsive: on mobile (`<768px`), split layout goes vertical
- `@keyframes slideInRight`, `slideInUp`, `slideOutRight`, `slideOutUp`

**Migration strategy:**
1. Find the TSX component(s) that use `chat-layout` classes — likely `ChatContainer.tsx` or a layout wrapper
2. Replace with Tailwind: `flex w-full h-full flex-1` for `.chat-layout`, etc.
3. Reference pane: `flex-[0_0_30%] min-w-[300px] max-w-[40%] md:max-w-[45%]`
4. The slide animations need keyframes in `index.css` — add `slideInRight` and `slideInUp` if not already present
5. Mobile behavior: use `md:flex-row flex-col` pattern
6. Remove import from `main.tsx`, delete the file.

### 3E. MIGRATE `styles/iteration.css` (467 lines)

**File:** `/home/kage/visualruntime/apps/web/src/styles/iteration.css`
**Imported in:** `main.tsx` line 8
**Used by:** `components/iteration/IterationPanel.tsx`

**What it contains:**
- `.iteration-panel` — container card
- `.iteration-header`, `.iteration-phase-bar`, `.iteration-score-bar` — quality loop UI
- `.iteration-list`, `.iteration-item` — list of iteration attempts
- `.quality-badge`, `.quality-breakdown`, `.quality-metric` — quality score display
- `.iteration-patch-goals` — fix suggestions list
- Light mode + dark mode + `.terranet-chat-shell--legacy` overrides

**Migration strategy:**
1. Open `IterationPanel.tsx`
2. This app is dark-only, so use dark mode values directly
3. The `.terranet-chat-shell--legacy` overrides indicate a legacy theme mode — use the legacy dark values (semi-transparent backgrounds like `bg-white/[0.04]`, `border-white/[0.08]`) since those match the current app theme
4. Quality badge colors should be inline via style prop or conditional classes
5. Remove import from `main.tsx`, delete the file.

### 3F. MIGRATE `agents/agents.css` (672 lines)

**File:** `/home/kage/visualruntime/apps/web/src/components/agents/agents.css`
**Imported in:** Each agent component directly (`import './agents.css'`)
**Used by:**
- `agents/AgentAnalysisPanel.tsx`
- `agents/AgentCard.tsx`
- `agents/AgentBadge.tsx`
- `agents/AgentConfidenceMeter.tsx`
- `agents/AgentMemoryTimeline.tsx`
- `agents/AgentRecommendations.tsx`

**What it contains:**
- CSS custom properties: `--agent-bg: #0f172a`, `--agent-surface: #1e293b`, etc.
- `.agent-card` — collapsible card with header, content, details sections
- `.agent-confidence-meter` — circular SVG gauge with info section
- `.agent-recommendations` — grid list of recommendation items
- `.agent-analysis-panel` — fixed side panel with tabs
- `.agent-badge` — inline badge component
- `.agent-memory-timeline` — timeline items with left accent border
- `@keyframes slideInRight` for panel, `spin` for loading

**Migration strategy:**
1. Open each of the 6 TSX components
2. Replace CSS custom properties with direct Tailwind colors:
   - `--agent-bg` → `bg-slate-900`
   - `--agent-surface` → `bg-slate-800`
   - `--agent-surface-alt` → `bg-slate-700`
   - `--agent-border` → `border-slate-700`
   - `--agent-text-primary` → `text-slate-200`
   - `--agent-text-secondary` → `text-slate-400`
   - `--agent-accent` → `text-blue-400`
3. Remove `import './agents.css'` from each file
4. Delete the CSS file

### 3G. MIGRATE `styles/chat.css` (3,630 lines) — LARGEST FILE

**File:** `/home/kage/visualruntime/apps/web/src/styles/chat.css`
**Imported in:** `main.tsx` line 7

**What it contains (major sections):**
- **Meta Chat Scaffold** (lines 1-60): `.meta-chat-screen`, `.meta-chat-screen__frame`, `.meta-chat-thread-scaffold`
- **Topbar** (lines 64-180): `.meta-chat-topbar` with left/right sections
- **Thread/Messages** (lines 180-800): `.meta-chat-thread`, `.bubble-card`, `.assistant-message`, `.user-message`
- **Composer** (lines 800-1400): `.composer-shell`, `.composer-input-group`, `.composer-pill-bar`
- **Scene Viewer** (lines 1400-2000): `.scene-viewer-*` classes
- **Workspace Panel** (lines 2000-2800): `.workspace-panel-*`, version navigation
- **Welcome Screen** (lines 2800-3200): `.meta-chat-welcome-*`
- **Code Preview** (lines 3200-3630): `.code-preview-*` blocks

**This is the most complex file.** The CSS variables at the top define the dark color palette:
```
--meta-chat-surface: #18181b
--meta-chat-surface-2: #202024
--meta-chat-border: #2f2f35
--meta-chat-text: #f5f5f5
--meta-chat-muted: #a1a1aa
```

**Migration strategy:**
1. This file styles nearly EVERY component in the chat flow
2. Work component-by-component through the TSX files that use these classes
3. Key components to migrate (check each for CSS class usage):
   - `components/chat/ChatContainer.tsx` — main orchestrator
   - `components/chat/Composer.tsx` — input area
   - `components/chat/MessageComponents.tsx` — message bubbles
   - `components/workspace/WorkspacePanel.tsx` — side workspace
   - `components/SceneViewer.tsx` — 3D/canvas viewer
4. Map the CSS variables to the custom Tailwind tokens already in `tailwind.config.ts`:
   - `var(--meta-chat-surface)` → `bg-surface` 
   - `var(--meta-chat-border)` → `border-meta-border`
   - `var(--meta-chat-text)` → `text-meta-text`
   - `var(--meta-chat-muted)` → `text-meta-muted`
5. Remove import from `main.tsx`, delete the file.

### 3H. MIGRATE `styles/layout.css` (5,122 lines) — SECOND LARGEST

**File:** `/home/kage/visualruntime/apps/web/src/styles/layout.css`
**Imported in:** `main.tsx` line 6

**What it contains (major sections):**
- **App Layout** (lines 1-100): `.app-layout`, `.app-header`, `.app-header-brand`
- **Sidebar** (lines 100-800): `.sidebar`, `.sidebar-item`, `.sidebar-nav`, `.sidebar-icon`
- **App Body** (lines 800-1500): `.app-body`, `.app-body--chat`, `.app-main`
- **Workspace Layout** (lines 1500-2500): workspace containers, collapsed states
- **Responsive** (lines 2500-4000): extensive media queries for mobile/tablet/desktop
- **Scrollbar** (lines 4000-4200): custom scrollbar for sidebar
- **Animations** (lines 4200-5122): various keyframes, hover effects

**Migration strategy:**
1. Key components to migrate:
   - `components/layout/MainLayout.tsx` — already partially Tailwind (has `className="relative z-10 h-[100dvh]..."`)
   - `components/layout/Sidebar.tsx` — heavily CSS-dependent
2. The sidebar is a thin icon-only sidebar (`--sidebar-width: 3rem`) with tooltip labels on hover
3. `MainLayout.tsx` already uses some Tailwind but also references `.app-body`, `.app-body--chat`, `.app-main` from this CSS
4. Remove import from `main.tsx`, delete the file.

### 3I. CLEAN UP `index.css`

**File:** `/home/kage/visualruntime/apps/web/src/index.css` (currently ~2000 lines)

After all CSS files are migrated, `index.css` should contain ONLY:
1. `@import url(...)` — Google Fonts
2. `@import "tailwindcss"` — Tailwind base
3. Animation `@keyframes` blocks (typing-bounce, typing-pulse, typing-wave, slash-menu-appear, row-fade, slideInRight, slideInUp, slideOutRight, slideOutUp, slideDown)
4. `.markdown-message` prose styles (descendant selectors that can't be Tailwind utilities)
5. `.scrollbar` custom scrollbar styles
6. Base resets (`:root` vars, `* { box-sizing }`, `html/body/#root`, `body { font-family }`)

**Everything else** in `index.css` (scene viewer styles, sidebar overrides, workspace panel styles, etc.) should be migrated into the respective TSX components and deleted from this file.

---

## 4. MIGRATION RULES

### 4.1 Core Principles

1. **This app is DARK MODE ONLY.** Do not use `@media (prefers-color-scheme: dark)` patterns. Use dark mode colors directly in Tailwind classes.
2. **Use the custom tokens** already defined in `tailwind.config.ts`:
   - Colors: `surface`, `surface-2`, `surface-3`, `meta-border`, `meta-text`, `meta-muted`, `auth-*`
   - Animations: `animate-fade-in`, `animate-slide-down`, `animate-slide-in-right`, `animate-drift-x`
3. **Shared style patterns** — extract repeated class strings into `const` variables at the top of the component file.
4. **Don't create new CSS files.** Inline everything as Tailwind utilities.
5. **Preserve all existing component logic** — only change `className` values, never alter state, props, event handlers, or JSX structure.
6. **For pseudo-elements and descendant selectors** that Tailwind can't handle, keep them as small blocks in `index.css`.

### 4.2 Common Pattern Conversions

| CSS Pattern | Tailwind |
|---|---|
| `background: #18181b` | `bg-surface` |
| `background: #202024` | `bg-surface-2` |
| `border: 1px solid #2f2f35` | `border border-meta-border` |
| `color: #f5f5f5` | `text-meta-text` |
| `color: #a1a1aa` | `text-meta-muted` |
| `border: 1px solid rgba(255,255,255,0.06)` | `border border-white/[0.06]` |
| `background: rgba(255,255,255,0.04)` | `bg-white/[0.04]` |
| `backdrop-filter: blur(16px)` | `backdrop-blur-2xl` |
| `backdrop-filter: blur(24px)` | `backdrop-blur-3xl` |
| `border-radius: 0.75rem` | `rounded-xl` |
| `border-radius: 999px` | `rounded-full` |
| `font-size: 0.75rem` | `text-xs` |
| `font-size: 0.875rem` | `text-sm` |
| `font-size: 0.65rem` | `text-[0.65rem]` |
| `font-weight: 600` | `font-semibold` |
| `font-weight: 700` | `font-bold` |
| `letter-spacing: 0.05em` | `tracking-wide` |
| `text-transform: uppercase` | `uppercase` |
| `transition: all 0.2s ease` | `transition-all duration-200 ease-out` |
| `display: flex; align-items: center; gap: 0.5rem` | `flex items-center gap-2` |
| `display: grid; grid-template-columns: auto 1fr auto` | `grid grid-cols-[auto_1fr_auto]` |
| `white-space: nowrap; overflow: hidden; text-overflow: ellipsis` | `truncate` |
| `position: sticky; top: 0; z-index: 40` | `sticky top-0 z-40` |
| `animation: spin 1s linear infinite` | `animate-spin` |
| `@media (max-width: 768px)` | `md:` prefix (or `max-md:` for max-width) |
| `@media (max-width: 640px)` | `sm:` prefix (or `max-sm:` for max-width) |

### 4.3 Handling Complex Cases

**Conditional classes with status/state:**
```tsx
const statusStyles: Record<string, string> = {
  pending: 'border-slate-700 bg-slate-800 text-slate-400',
  running: 'border-amber-900 bg-amber-950 text-amber-500',
  completed: 'border-emerald-900 bg-emerald-950/50 text-emerald-500',
  failed: 'border-red-900 bg-red-950/50 text-red-500',
};

<div className={`border rounded-md overflow-hidden ${statusStyles[status]}`}>
```

**Hover-reveal patterns (show actions on parent hover):**
```tsx
// Parent must have "group" class
<div className="group ...">
  <div className="opacity-0 group-hover:opacity-100 transition-opacity">
    {/* actions */}
  </div>
</div>
```

**CSS that targets descendant elements (keep in index.css):**
```css
/* Can't be Tailwind — targets arbitrary children */
.markdown-message h1 { ... }
.markdown-message code { ... }
```

---

## 5. EXECUTION ORDER

Execute in this exact sequence:

```
Step 1: Delete orphaned CSS files (Section 3A)
Step 2: Migrate messages.css → index.css + delete (Section 3B)
Step 3: Migrate action-blocks.css → TSX components + delete (Section 3C)
Step 4: Migrate split-pane.css → TSX components + delete (Section 3D)
Step 5: Migrate iteration.css → IterationPanel.tsx + delete (Section 3E)
Step 6: Migrate agents.css → 6 agent TSX components + delete (Section 3F)
Step 7: Migrate chat.css → chat TSX components + delete (Section 3G)
Step 8: Migrate layout.css → layout TSX components + delete (Section 3H)
Step 9: Clean up index.css (Section 3I)
Step 10: Update main.tsx to remove all deleted CSS imports
Step 11: Run `cd /home/kage/visualruntime/apps/web && npx tsc --noEmit` to verify
Step 12: Run `cd /home/kage/visualruntime/apps/web && npm run build` to verify
```

---

## 6. FILE MAP

### CSS files (all under `apps/web/src/`)

| File | Lines | Status | TSX Consumers |
|---|---|---|---|
| `index.css` | 2000 | KEEP + clean | Global |
| `styles/layout.css` | 5122 | **MIGRATE** | `layout/MainLayout.tsx`, `layout/Sidebar.tsx` |
| `styles/chat.css` | 3630 | **MIGRATE** | `chat/ChatContainer.tsx`, `chat/Composer.tsx`, `chat/MessageComponents.tsx`, `workspace/WorkspacePanel.tsx`, `SceneViewer.tsx` |
| `styles/iteration.css` | 467 | **MIGRATE** | `iteration/IterationPanel.tsx` |
| `styles/action-blocks.css` | 660 | **MIGRATE** | `chat/ActionBlock.tsx`, `chat/ActionBlockGroup.tsx`, `chat/ActionStep.tsx`, `workspace/TaskReferencePanel.tsx` |
| `styles/split-pane.css` | 205 | **MIGRATE** | Chat layout components |
| `styles/messages.css` | 195 | **MIGRATE** | Global animation classes |
| `agents/agents.css` | 672 | **MIGRATE** | 6 agent components |
| `styles/toast.css` | 134 | **DELETE** | Already migrated |
| `styles/auth.css` | 316 | **DELETE** | Already migrated |
| `components/*.css` (6 files) | ~1072 | **DELETE** | Already migrated |

### Key TSX components to modify

| Component | Path | Current Styling |
|---|---|---|
| `ChatContainer.tsx` | `components/chat/ChatContainer.tsx` | Mix of CSS classes + some Tailwind |
| `Composer.tsx` | `components/chat/Composer.tsx` | CSS classes from `chat.css` |
| `MessageComponents.tsx` | `components/chat/MessageComponents.tsx` | Already mostly Tailwind |
| `WorkspacePanel.tsx` | `components/workspace/WorkspacePanel.tsx` | Already mostly Tailwind |
| `SceneViewer.tsx` | `components/SceneViewer.tsx` | CSS classes from `chat.css` + `index.css` |
| `MainLayout.tsx` | `components/layout/MainLayout.tsx` | Partial Tailwind + CSS classes |
| `Sidebar.tsx` | `components/layout/Sidebar.tsx` | CSS classes from `layout.css` |
| `ActionBlock.tsx` | `components/chat/ActionBlock.tsx` | CSS classes from `action-blocks.css` |
| `ActionBlockGroup.tsx` | `components/chat/ActionBlockGroup.tsx` | CSS classes from `action-blocks.css` |
| `ActionStep.tsx` | `components/chat/ActionStep.tsx` | CSS classes from `action-blocks.css` |
| `TaskReferencePanel.tsx` | `components/workspace/TaskReferencePanel.tsx` | CSS classes from `action-blocks.css` |
| `IterationPanel.tsx` | `components/iteration/IterationPanel.tsx` | CSS classes from `iteration.css` |
| 6 Agent components | `components/agents/*.tsx` | CSS classes from `agents.css` |

---

## 7. TAILWIND CONFIG REFERENCE

The current `tailwind.config.ts` at `/home/kage/visualruntime/apps/web/tailwind.config.ts` includes:

**Custom colors:**
- `surface` / `surface-2` / `surface-3` — dark background tiers
- `meta-border`, `meta-text`, `meta-muted` — chat UI palette
- `auth-bg`, `auth-surface`, `auth-ink`, `auth-muted`, `auth-accent`, `auth-accent-strong` — auth page
- Standard shadcn tokens: `border`, `input`, `ring`, `background`, `foreground`, `primary`, `secondary`, `muted`, `accent`, `card`

**Custom animations:**
- `animate-fade-in` — 0.24s ease-out
- `animate-slide-down` — 0.3s ease-out
- `animate-slide-in-right` — 0.3s cubic-bezier
- `animate-pulse-icon` — 3s infinite
- `animate-blink-dot` — 1.2s infinite
- `animate-drift-x` — 30s linear infinite

**Custom keyframes (in index.css, not config):**
- `typing-bounce`, `typing-pulse`, `typing-wave` — typing indicator
- `slash-menu-appear` — slash command menu popup

---

## 8. VERIFICATION CHECKLIST

After completing all migration:

- [ ] `npx tsc --noEmit` passes with no errors
- [ ] `npm run build` completes successfully
- [ ] No `.css` file imports remain in any TSX/TS file (except `main.tsx` importing `index.css`)
- [ ] `main.tsx` only imports `./index.css`
- [ ] `index.css` contains only: fonts import, tailwind import, keyframes, markdown prose, scrollbar utility, and base resets
- [ ] All deleted CSS files are actually removed from disk
- [ ] No broken `className` references (grep for any old CSS class names still in TSX files)
