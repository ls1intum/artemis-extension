---
phase: 06-iris-chat-with-streaming
plan: 01
subsystem: chat-infrastructure
tags: [zustand, streaming, hooks, message-contracts, dependencies]

dependency_graph:
  requires: [phase-03-react-setup, phase-04-zustand-pattern]
  provides: [chat-store, streaming-pipeline, message-contracts]
  affects: [chat-ui-plan-02]

tech_stack:
  added: [streamdown, shiki, react-textarea-autosize, use-stick-to-bottom]
  patterns: [zustand-state, RAF-buffering, sentence-boundary-flushing, smart-auto-scroll]

key_files:
  created:
    - iris-thaumantias/src/views/webview/react/stores/useChatStore.ts
    - iris-thaumantias/src/views/webview/react/hooks/useStreamingMessage.ts
    - iris-thaumantias/src/views/webview/react/hooks/useAutoScroll.ts
    - iris-thaumantias/src/views/webview/react/views/IrisChat/types.ts
    - iris-thaumantias/src/views/webview/react/views/IrisChat/index.ts
  modified:
    - iris-thaumantias/package.json
    - iris-thaumantias/package-lock.json
    - iris-thaumantias/src/shared/messageContracts.ts

decisions:
  - key: RAF-based token buffering
    choice: useStreamingMessage buffers tokens in ref, flushes via requestAnimationFrame at 60Hz
    rationale: Prevents re-render per token, smooth 60fps updates
    alternatives: [setState per token (too slow), debounce (uneven timing)]

  - key: Sentence boundary detection
    choice: Flush when buffer > 200 chars OR ends with .!?\n
    rationale: Progressive rendering at natural breakpoints, balances speed and coherence
    alternatives: [fixed chunk size (awkward breaks), word boundaries (too frequent)]

  - key: use-stick-to-bottom for auto-scroll
    choice: Wrap library hook with useAutoScroll wrapper
    rationale: Battle-tested library handles momentum scrolling, touch events, user intent
    alternatives: [hand-rolled IntersectionObserver (more code, less robust)]

  - key: ES module import workaround
    choice: "@ts-expect-error" for use-stick-to-bottom import
    rationale: TypeScript Node16 resolution strict about ESM/CJS, but esbuild handles it at bundle time
    alternatives: [dynamic import (unnecessary complexity), change tsconfig (affects all files)]

  - key: OpenSettingsCommand payload
    choice: Made payload optional to avoid breaking existing code
    rationale: Iris Chat needs payload for specific settings, existing views don't provide it
    alternatives: [create separate command (duplication), force all callers to update (breaking)]

metrics:
  duration: 269
  tasks_completed: 2
  files_created: 5
  files_modified: 3
  commits: 2
  completed_at: 2026-02-24
---

# Phase 6 Plan 1: Chat State Infrastructure Summary

**One-liner:** Installed streaming dependencies (streamdown, shiki, react-textarea-autosize, use-stick-to-bottom), built Zustand chat store with streaming state, RAF-based token buffering hook with sentence boundary detection, and smart auto-scroll hook.

## What Was Built

### Task 1: Dependencies and Message Contracts
- **Installed 4 npm packages:** streamdown (progressive markdown), shiki (syntax highlighting), react-textarea-autosize (expanding textarea), use-stick-to-bottom (smart auto-scroll)
- **Created chat types** (types.ts): ChatMessage, ChatSession, ChatContext, ContextItem, ReferencedFilesData, StreamingState
- **Added 9 Iris chat message contracts** to messageContracts.ts: updateIrisState, showContextPicker, addMessage, loadMessages, clearChatMessages, updateReferencedFiles, updateWebSocketStatus, showDisabledState, hideDisabledState, updateNoAiStatus
- **Added 13 Iris chat commands**: sendMessage, selectChatContext, switchSession, createNewSession, switchToWorkspaceContext, switchContext, resetChatSessions, reconnectWebSocket, messageFeedback, openFile, openSettings (enhanced), openDiagnostics, debugSessions, openHelpPopup
- **Updated type guards** to include new message types
- **Commit:** 950aa07

### Task 2: State Management and Streaming Hooks
- **Created useChatStore.ts** - Zustand store managing:
  - Context (course/exercise, sessions, recent/all items)
  - Messages array with optimistic updates
  - Streaming state (isStreaming, messageLocalId, visibleChunks)
  - UI state (loading, WebSocket status, disabled message, .noai detection, referenced files)
  - 17 actions for state management
- **Created useStreamingMessage.ts** - Token buffering hook:
  - Buffers tokens in mutable ref (no re-render per token)
  - RAF-based flush loop at 60Hz display cadence
  - Sentence boundary detection (flush if > 200 chars OR ends with .!?\n)
  - Force flush on cleanup or streaming end
- **Created useAutoScroll.ts** - Smart auto-scroll wrapper:
  - Wraps use-stick-to-bottom library
  - Auto-scrolls when user is at bottom
  - Stops scrolling when user scrolls up to read history
  - Resume on message send (scrollOnSend callback)
- **Commit:** c14e5b4

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed OpenSettingsCommand breaking change**
- **Found during:** Task 1 TypeScript compilation
- **Issue:** New OpenSettingsCommand interface had required `payload: { setting: string }`, but existing code calls `openSettings` without payload (6 call sites across views)
- **Fix:** Made `payload` optional on the existing OpenSettingsCommand interface (changed from `payload: { setting: string }` to `payload?: { setting: string }`)
- **Files modified:** iris-thaumantias/src/shared/messageContracts.ts
- **Commit:** Included in 950aa07 (Task 1 commit)

**2. [Rule 3 - Blocking] Temporarily disabled IrisChatView barrel export**
- **Found during:** Task 1 TypeScript compilation
- **Issue:** Barrel export imports './IrisChatView' which doesn't exist yet (will be created in Plan 02)
- **Fix:** Commented out the export with note "IrisChatView will be created in Plan 02"
- **Files modified:** iris-thaumantias/src/views/webview/react/views/IrisChat/index.ts
- **Commit:** Included in 950aa07 (Task 1 commit)

**3. [Rule 3 - Blocking] Added @ts-expect-error for use-stick-to-bottom import**
- **Found during:** Task 2 TypeScript compilation
- **Issue:** TypeScript Node16 module resolution complains about importing ES module `use-stick-to-bottom` in CommonJS context (TS1479 error)
- **Fix:** Added `@ts-expect-error` comment with explanation that esbuild handles ESM imports at bundle time
- **Files modified:** iris-thaumantias/src/views/webview/react/hooks/useAutoScroll.ts
- **Commit:** Included in c14e5b4 (Task 2 commit)

## Verification Results

1. **TypeScript compilation:** `npx tsc --noEmit` passes with no errors
2. **Dependencies installed:** package.json includes all 4 streaming packages
3. **useChatStore exports:** Zustand store with 17 actions for chat, streaming, and UI state
4. **useStreamingMessage:** Buffers in ref, RAF loop, sentence boundary detection implemented
5. **useAutoScroll:** Wraps use-stick-to-bottom, provides scrollRef/contentRef/isAtBottom/scrollOnSend
6. **Message contracts:** 9 Iris chat messages + 13 commands added to shared/messageContracts.ts

## Dependencies

**Provides for downstream plans:**
- `useChatStore` - Chat state management (Plan 02 IrisChatView component)
- `useStreamingMessage` - Token buffering for streaming display (Plan 02 message rendering)
- `useAutoScroll` - Smart scroll behavior (Plan 02 message list)
- Chat message contracts - Typed communication (Plan 02 message handlers)

**Consumed from upstream:**
- Phase 03: React setup, esbuild bundling, CSS Modules
- Phase 04: Zustand pattern (useDashboardStore established the pattern)

## Open Items

None. All tasks complete, all verification passing. Ready for Plan 02 (IrisChatView component).

## Self-Check: PASSED

All files and commits verified:

- ✓ useChatStore.ts
- ✓ useStreamingMessage.ts
- ✓ useAutoScroll.ts
- ✓ types.ts
- ✓ index.ts
- ✓ Task 1 commit (950aa07)
- ✓ Task 2 commit (c14e5b4)
