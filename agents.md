# CLAUDE.md


Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

## Project-Specific Guidelines: Clerk Authentication

This project uses Clerk for authentication. The backend (`apps/server`) uses `@clerk/express` and the frontend (`apps/web`) uses `@clerk/clerk-react` (conditionally loaded via `apps/web/src/lib/clerk.tsx`).

**Critical rules:**
- Every API request from the web app MUST include a Clerk JWT token in the `Authorization: Bearer <token>` header. The shared `requestJson` helper (`packages/shared/src/index.ts`) reads from a global auth token provider that is set by the web app.
- The global auth token provider is set via `setAuthTokenProvider(() => getToken())` in `MainLayout.tsx` (or equivalent root component). This must happen BEFORE any API calls.
- Use `useAuth()` from `apps/web/src/lib/clerk.tsx` to get `getToken`. Do NOT use `useUser()` for API authentication — `useUser` only reflects cached UI state, not a valid session token. A cached user object can exist while the session cookie/token is missing or expired.
- `MainLayout` must wait for `useAuth().isLoaded && useAuth().isSignedIn` before calling `initialize()` and making API requests. This prevents 401 race conditions on first load.
- `sessionsError` must be cleared (`useChatStore.setState({ sessionsError: null })`) before retrying initialization after an auth error. The `sessionSlice` already clears it on `refreshSessions` success.
- In dev mode (when Clerk keys are missing or set to the dummy fallback), both frontend and backend bypass real auth. The token provider still sends a mock token, which the server ignores.
- The server CORS config (`apps/server/server/create-app.ts`) already allows the `Authorization` header.
- If you add a new API function in `packages/shared/src/index.ts`, ensure it routes through `requestJson` so the auth token is attached automatically.

NOTE: examples are in the examples.md folder. 