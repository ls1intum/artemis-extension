---
phase: 06-iris-chat-with-streaming
plan: 03
subsystem: chat-view-assembly
tags: [iris-chat, react-integration, message-handling, webview-provider, side-menu]

dependency_graph:
  requires: [phase-06-plan-01-chat-store, phase-06-plan-02-chat-components, phase-03-react-setup]
  provides: [iris-chat-view, chat-webview-react-integration]
  affects: [iris-chat-functionality]

tech_stack:
  added: []
  patterns: [extension-webview-bidirectional-messaging, legacy-command-format, context-switch-animation, state-persistence]

key_files:
  created:
    - iris-thaumantias/src/views/webview/react/views/IrisChat/IrisChatView.tsx
    - iris-thaumantias/src/views/webview/react/views/IrisChat/IrisChatView.module.css
  modified:
    - iris-thaumantias/src/views/webview/react/views/IrisChat/index.ts
    - iris-thaumantias/src/views/webview/react/App.tsx
    - iris-thaumantias/src/provider/chatWebviewProvider.ts

decisions:
  - key: Context switch animation
    choice: Fade out/skeleton/fade in on context ID change
    rationale: Provides visual feedback during loading, prevents jarring transition
    alternatives: [instant switch (jarring), loading spinner (less informative)]

  - key: State persistence scope
    choice: Persist only forceContextPicker flag, not search or transient UI state
    rationale: Matches legacy behavior, avoids stale state on tab restore
    alternatives: [persist all UI state (stale search), no persistence (loses picker mode)]

  - key: Side menu implementation
    choice: Simple dropdown with click-outside-to-close, not full drawer
    rationale: Compact UI appropriate for webview panel, matches VS Code patterns
    alternatives: [full side drawer (too heavy), modal dialog (breaks flow)]

  - key: Help popup implementation
    choice: VS Code showInformationMessage with modal option
    rationale: Native VS Code UI, no need for custom help view component
    alternatives: [custom webview panel (overengineered), quick pick (less readable)]

  - key: Banner priority
    choice: Disabled banner > WebSocket banner > normal UI
    rationale: Critical issues block chat functionality, must be shown first
    alternatives: [show all banners simultaneously (cluttered)]

metrics:
  duration: 283
  tasks_completed: 2
  files_created: 2
  files_modified: 3
  commits: 2
  completed_at: 2026-02-24
---

# Phase 6 Plan 3: Iris Chat View Assembly Summary

**One-liner:** Assembled complete IrisChatView from Plan 02 components with extension-webview bidirectional messaging, wired ChatWebviewProvider to render React instead of legacy HTML, added irisChat route to App.tsx, and implemented full message handling including side menu, banners, and context switch animations.

## What Was Built

### Task 1: IrisChatView Component Assembly

**Created IrisChatView.tsx** - Main chat view component (414 lines):

**Layout Structure:**
- Header: Iris SVG icon + title + hamburger menu button
- Context selector section (using ContextSelector component)
- Disabled banner (when Iris unavailable or .noai detected)
- WebSocket status banner (with reconnect button)
- Messages section with context switch animation
- Input section: ReferencedFiles + ChatInput + disclaimer

**Message Listener:**
- `window.addEventListener('message', handler)` receives extension messages
- Handles 10 message commands in legacy format (uses `message.command`, not `message.type`):
  - `updateIrisState` - Updates store with context, sessions, exercises, courses
  - `showContextPicker` - Forces context picker mode
  - `addMessage` - Adds single message with generated localId
  - `loadMessages` - Loads message history with localIds
  - `clearChatMessages` - Clears all messages
  - `updateReferencedFiles` - Updates referenced files display
  - `updateWebSocketStatus` - Updates connection state
  - `showDisabledState` / `hideDisabledState` - Shows/hides disabled banner
  - `updateNoAiStatus` - Updates .noai detection state
- Extracts `showDiagnostics` flag from `updateIrisState` message

**Command Dispatch:**
- `sendCommand(command, payload)` helper sends messages in legacy format
- Commands sent to extension:
  - `sendMessage` - Sends user message (optimistic display, starts streaming)
  - `selectChatContext` - Selects course/exercise context
  - `switchSession` - Switches to different session
  - `createNewSession` - Creates new session in current context
  - `switchToWorkspaceContext` - Switches to workspace exercise
  - `resetChatSessions` - Resets and syncs sessions
  - `reconnectWebSocket` - Reconnects WebSocket
  - `messageFeedback` - Sends thumbs up/down feedback
  - `openFile` - Opens file in editor
  - `openSettings` - Opens VS Code settings (with optional setting ID)
  - `openHelpPopup` - Opens help guide modal
  - `openDiagnostics` - Opens diagnostics report
  - `debugSessions` - Opens raw session data

**Side Menu:**
- Hamburger button in header opens dropdown menu
- Click-outside-to-close with useEffect + mousedown listener
- Menu items:
  - "Reset & Sync Sessions" - Syncs with server
  - "Chat Context Guide" - Opens help popup
  - Diagnostics items (conditional on showDiagnostics flag):
    - "Diagnostics" - Opens diagnostics report
    - "Debug Sessions (Raw)" - Opens raw session JSON
  - About section with description

**Banners:**
- Disabled banner: Shows when `disabledMessage` or `isNoAiDetected` is true
- WebSocket banner: Shows when `isWebSocketConnected === false` with reconnect button
- Priority: Disabled > WebSocket > normal UI

**Context Switch Animation:**
- Detects context ID change with useRef to track previous ID
- Sets `contextSwitching` state flag on change
- Shows 3 skeleton placeholders during transition (fade out/in via CSS)
- Resets after 500ms timeout

**State Persistence:**
- Only persists `forceContextPicker` flag via `vscodeApi.setState/getState`
- Does not persist search query or transient UI state

**Disclaimer:**
- Static text at bottom with "configurable" link
- Link opens `artemis.iris.sendUncommittedChanges` setting

**Created IrisChatView.module.css** - Complete styling (210 lines):
- Layout: Flex column with header, context, messages, input sections
- Header with logo, title, hamburger menu button
- Side menu dropdown with VS Code menu colors
- Banners styled with VS Code validation colors
- Context switch animation with opacity fade and skeleton pulse
- Disclaimer with link styling

**Updated index.ts:**
- Enabled IrisChatView barrel export (was commented out from Plan 01)

**Commit:** 9513d5b

### Task 2: ChatWebviewProvider React Integration

**Updated App.tsx:**
- Added `IrisChatView` import
- Added `case 'irisChat': return <IrisChatView vscodeApi={vscodeApi} />;` to router

**Updated ChatWebviewProvider.ts:**

**Removed legacy HTML generation:**
- Removed `import { IrisChatView } from '../views/irisChat/irisChatView'`
- Removed `private _irisChatView?: IrisChatView` field
- Removed `_getOrCreateIrisChatView()` method
- Added `import { getReactWebviewHtml } from '../utils/webviewHelpers'`

**Updated resolveWebviewView():**
- Changed from `this._getOrCreateIrisChatView().generateHtml(webviewView.webview, showDeveloperTools)`
- To: `getReactWebviewHtml(webviewView.webview, this._extensionUri, 'irisChat')`
- Removed `showDeveloperTools` variable (now passed via state message)

**Updated refreshTheme():**
- Changed from `this._getOrCreateIrisChatView().generateHtml(this._view.webview, showDeveloperTools)`
- To: `getReactWebviewHtml(this._view.webview, this._extensionUri, 'irisChat')`

**Updated _postSnapshot():**
- Added developer mode config check: `config.get<boolean>('developerMode', false)`
- Included `showDiagnostics` flag in `updateIrisState` message payload
- React view extracts this flag and stores it

**Updated _handleMessage():**
- Added React ready signal handler at top:
  ```typescript
  if (message.type === 'ready') {
      this._postSnapshot();
      this._postNoAiStatus(this._noAiDetectionService.isNoAiEnabled);
      return;
  }
  ```
- Keeps legacy `case 'chatViewReady'` for backward compatibility
- Added `case 'openHelpPopup'` command

**Added _handleOpenHelpPopup():**
- Opens VS Code information modal with help text
- Documentation covers context selection, workspace detection, tips, sessions, referenced files
- Uses `vscode.window.showInformationMessage` with `{ modal: true, detail: helpMessage }`

**Commit:** 8162398

## Deviations from Plan

None - plan executed exactly as written. All components assembled correctly, all message handlers implemented, all commands wired, TypeScript compilation passes.

## Verification Results

1. **TypeScript compilation:** `npx tsc --noEmit` passes (only streamdown's optional mermaid warning)
2. **App.tsx:** Has `case 'irisChat'` routing to IrisChatView
3. **ChatWebviewProvider:** Uses `getReactWebviewHtml` instead of legacy HTML generation
4. **Ready signal:** Handles both React `{ type: 'ready' }` and legacy `{ command: 'chatViewReady' }`
5. **IrisChatView message listener:** Handles all 10 extension message commands
6. **IrisChatView command dispatch:** Sends all 13 commands in legacy format
7. **Side menu:** Implemented with conditional diagnostics items
8. **Banners:** Disabled, WebSocket, disclaimer all present
9. **Context switch animation:** Skeleton placeholders with fade out/in
10. **State persistence:** forceContextPicker persisted via setState/getState

## Dependencies

**Provides for downstream:**
- Complete working Iris Chat interface rendered via React
- Bidirectional message passing between extension and React webview
- Ready for Phase 7 (Streaming Integration) to connect WebSocket events

**Consumed from upstream:**
- Phase 06 Plan 01: useChatStore, useAutoScroll, useStreamingMessage, types
- Phase 06 Plan 02: All 9 chat components (MessageBubble, ChatInput, ContextSelector, etc.)
- Phase 03: React setup, getReactWebviewHtml, CSS Modules
- Phase 04: Zustand pattern

## Open Items

None. All tasks complete, all verification passing. Iris Chat is fully migrated to React and ready for final streaming integration in Phase 7.

## Self-Check: PASSED

All files and commits verified:

**Task 1:**
- ✓ IrisChatView.tsx created (414 lines)
- ✓ IrisChatView.module.css created (210 lines)
- ✓ index.ts updated (barrel export enabled)
- ✓ Commit 9513d5b

**Task 2:**
- ✓ App.tsx updated (irisChat route added)
- ✓ ChatWebviewProvider.ts updated (React HTML generation, ready signal handler, openHelpPopup)
- ✓ Legacy IrisChatView removed
- ✓ Commit 8162398

**Verification:**
- ✓ TypeScript compilation passes
- ✓ All message handlers present
- ✓ All command dispatchers present
- ✓ Side menu with conditional diagnostics
- ✓ Banners styled correctly
- ✓ Context switch animation implemented
