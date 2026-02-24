---
phase: 06-iris-chat-with-streaming
plan: 02
subsystem: chat-ui-components
tags: [react-components, css-modules, streamdown, shiki, message-rendering, chat-interaction]

dependency_graph:
  requires: [phase-06-plan-01-chat-store, phase-03-react-setup, phase-02-component-library]
  provides: [message-bubble, streaming-message, code-block, chat-input, context-selector, message-list]
  affects: [chat-view-plan-03]

tech_stack:
  added: []
  patterns: [react-memo-custom-comparator, streamdown-progressive-markdown, shiki-syntax-highlighting, textarea-autosize, click-outside-handler, dual-mode-dropdown]

key_files:
  created:
    - iris-thaumantias/src/views/webview/react/views/IrisChat/components/MessageBubble.tsx
    - iris-thaumantias/src/views/webview/react/views/IrisChat/components/MessageBubble.module.css
    - iris-thaumantias/src/views/webview/react/views/IrisChat/components/StreamingMessage.tsx
    - iris-thaumantias/src/views/webview/react/views/IrisChat/components/StreamingMessage.module.css
    - iris-thaumantias/src/views/webview/react/views/IrisChat/components/CodeBlock.tsx
    - iris-thaumantias/src/views/webview/react/views/IrisChat/components/CodeBlock.module.css
    - iris-thaumantias/src/views/webview/react/views/IrisChat/components/ThinkingIndicator.tsx
    - iris-thaumantias/src/views/webview/react/views/IrisChat/components/ThinkingIndicator.module.css
    - iris-thaumantias/src/views/webview/react/views/IrisChat/components/ChatInput.tsx
    - iris-thaumantias/src/views/webview/react/views/IrisChat/components/ChatInput.module.css
    - iris-thaumantias/src/views/webview/react/views/IrisChat/components/ContextSelector.tsx
    - iris-thaumantias/src/views/webview/react/views/IrisChat/components/ContextSelector.module.css
    - iris-thaumantias/src/views/webview/react/views/IrisChat/components/ChatMessageList.tsx
    - iris-thaumantias/src/views/webview/react/views/IrisChat/components/ChatMessageList.module.css
    - iris-thaumantias/src/views/webview/react/views/IrisChat/components/WelcomeState.tsx
    - iris-thaumantias/src/views/webview/react/views/IrisChat/components/WelcomeState.module.css
    - iris-thaumantias/src/views/webview/react/views/IrisChat/components/ReferencedFiles.tsx
    - iris-thaumantias/src/views/webview/react/views/IrisChat/components/ReferencedFiles.module.css
  modified: []

decisions:
  - key: React.memo with custom comparator for MessageBubble
    choice: Custom equality check on localId, content, helpful, status, isStreaming, streamingChunks length
    rationale: Prevents re-renders when only unrelated props change, critical for performance with many messages
    alternatives: [Default React.memo (too eager to re-render), useMemo per field (verbose)]

  - key: Streamdown for progressive markdown
    choice: Use Streamdown with mode="streaming" and parseIncompleteMarkdown=true
    rationale: Purpose-built for AI streaming, handles incomplete markdown gracefully, built-in fade-in animation
    alternatives: [react-markdown with manual incomplete handling (complex), plain text until complete (poor UX)]

  - key: Shiki singleton highlighter
    choice: Module-level Promise singleton, lazy initialization
    rationale: Shiki initialization is expensive, singleton ensures one instance across all code blocks
    alternatives: [Per-component highlighter (wasteful), React context (unnecessary complexity)]

  - key: Bouncing dots thinking indicator
    choice: Three spans with staggered animation-delay (0s, 0.2s, 0.4s)
    rationale: Matches industry-standard streaming UI pattern, clear visual feedback before first chunk
    alternatives: [Spinner (less appropriate for text streaming), pulsing dot (less dynamic)]

  - key: ContextSelector dual-mode dropdown
    choice: Single component with showContextPicker state toggle between session list and context picker
    rationale: Reduces duplication, cleaner state management than two separate dropdowns
    alternatives: [Two separate components (more code), tabs (less intuitive)]

  - key: Click-outside-to-close dropdown
    choice: useEffect with document mousedown listener, cleanup on unmount
    rationale: Standard dropdown UX pattern, prevents stale listeners with cleanup
    alternatives: [Focus trap (overengineered), manual close button (less intuitive)]

  - key: ESM import workaround
    choice: "@ts-expect-error" comments for shiki and streamdown imports
    rationale: TypeScript Node16 resolution strict about ESM/CJS, but esbuild handles it at bundle time
    alternatives: [Dynamic import (unnecessary async complexity), change tsconfig (affects all files)]

metrics:
  duration: 524
  tasks_completed: 2
  files_created: 18
  files_modified: 0
  commits: 2
  completed_at: 2026-02-24
---

# Phase 6 Plan 2: Chat UI Components Summary

**One-liner:** Built 9 React chat components with CSS Modules: MessageBubble (memoized, role-based alignment, feedback), StreamingMessage (Streamdown progressive markdown), CodeBlock (Shiki syntax highlighting, copy button), ThinkingIndicator (bouncing dots), ChatInput (auto-expanding textarea), ContextSelector (dual-mode dropdown), ChatMessageList (auto-scroll integration), WelcomeState (greeting + prompts), ReferencedFiles (collapsible file list).

## What Was Built

### Task 1: Message Rendering Components

**1. CodeBlock component**
- Shiki syntax highlighting with singleton highlighter (lazy initialization)
- Bundled languages: java, python, c, javascript, typescript, sql, shellscript
- Theme: github-dark (VS Code compatible)
- Header bar with language label and copy-to-clipboard button
- Copy button shows "Copied!" feedback for 2 seconds
- Horizontal scroll for overflow, rounded corners
- CSS: VS Code editor background, rounded corners, border

**2. StreamingMessage component**
- Progressive markdown rendering via Streamdown
- Mode: "streaming" with parseIncompleteMarkdown=true
- Built-in fade-in animation (150ms duration per chunk)
- Code block override: delegates to CodeBlock component
- Inline code gets textCodeBlock background
- Full markdown support: headings, lists, blockquotes, links

**3. ThinkingIndicator component**
- Three bouncing dots with staggered animation delays (0s, 0.2s, 0.4s)
- Bounce animation: translateY(-8px) at 40%, 1.2s infinite ease-in-out
- Opacity animation: 0.4 base to 1.0 at peak
- 8px diameter dots, 4px gap
- Left-aligned in message-bubble-like container
- Conditional render based on isVisible prop

**4. MessageBubble component**
- React.memo with custom comparator (checks localId, content, helpful, status, isStreaming, streamingChunks length)
- Role-based alignment: user right with accent background, assistant left with subtle background
- Iris bot icon (SVG) next to assistant messages only
- Hover shows timestamp with relative time (e.g., "2 min ago")
- Feedback buttons (thumbs up/down) appear on hover over assistant messages
- Feedback persists visually when selected (filled icon, highlighted)
- For streaming messages: renders StreamingMessage with chunks
- For completed messages: renders static Streamdown markdown
- Error state: shows error message with retry button
- Code blocks delegated to CodeBlock component via Streamdown override

**Commit:** b14bdb6

### Task 2: Interaction Components

**1. ChatInput component**
- react-textarea-autosize: minRows=1, maxRows=6
- Enter sends message (calls onSend and clears input immediately for optimistic UX)
- Shift+Enter inserts newline (default textarea behavior)
- Send button always visible on right side
- Send button disabled/greyed when input empty or disabled prop true
- Send button active with accent color when text present
- Disabled state: placeholder "Select a course or exercise to start chatting"
- Inline SVG arrow icon for send button

**2. ContextSelector component**
- Dual-mode dropdown (session list vs context picker)
- Top bar shows: context icon (exercise/course), title, message count, lock icon if workspace
- Click-outside-to-close with useEffect + document mousedown listener
- Search input at top filters all exercises/courses

**Session List Mode** (when context exists and not force-picking):
- Sessions sorted by lastActivity
- Active session highlighted with check icon
- Session items show: preview text, message count, last activity relative time
- "New Conversation" button (disabled if current session has no messages)
- "Switch to Workspace" button (visible if workspace exercise exists)
- "Switch to Different Context" button (opens context picker)

**Context Picker Mode** (when no context OR force-picking OR searching):
- Recent Exercises section (max 3, or filtered results when searching)
- Recent Courses section (max 3, or filtered results when searching)
- Workspace exercises show lock icon
- Click item calls onSelectContext(type, id, title, shortName)

**3. ChatMessageList component**
- Uses useAutoScroll hook from Plan 01
- Attaches scrollRef to scroll container, contentRef to content wrapper
- Maps through messages array rendering MessageBubble for each
- For currently streaming message: passes isStreaming=true and streamingChunks
- Shows ThinkingIndicator when streaming.isStreaming && streaming.visibleChunks.length === 0
- Shows WelcomeState when messages array empty
- Auto-scrolls on new messages or streaming chunks via useEffect

**4. WelcomeState component**
- When no context: "Select a course or exercise to start chatting with Iris."
- When context but no messages:
  - Iris greeting: "Hi! I'm Iris, your AI tutor. How can I help you today?"
  - 3 suggested prompt buttons:
    - "Explain the exercise requirements"
    - "Help me debug my code"
    - "What are the test cases checking?"
- Prompt buttons styled as rounded pills, click calls onSendPrompt
- Centered layout with Iris avatar (SVG bot icon)

**5. ReferencedFiles component**
- Hidden when files === null or totalCount === 0
- Header: file icon + "{included}/{total} files referenced" + chevron
- Collapsed by default, click header to expand/collapse
- Expanded shows:
  - Included files: file icon + filename + "Will be sent" status (green)
  - Divider if both included and excluded exist
  - Excluded files: close icon + filename + reason text (grey)
- Click on file calls onOpenFile(path)
- Chevron rotates 180deg when expanded

**Commit:** 8e7874a

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added @ts-expect-error for ESM imports**
- **Found during:** Task 1 TypeScript compilation
- **Issue:** TypeScript Node16 module resolution complains about importing ES modules `shiki` and `streamdown` in CommonJS context (TS1479 error)
- **Fix:** Added `@ts-expect-error` comments with explanation that esbuild handles ESM imports at bundle time (same pattern as use-stick-to-bottom from Plan 01)
- **Files modified:** CodeBlock.tsx, StreamingMessage.tsx, MessageBubble.tsx
- **Commit:** Included in b14bdb6 (Task 1 commit)

## Verification Results

1. **TypeScript compilation:** `npx tsc --noEmit` passes (excluding streamdown's optional mermaid dependency warning)
2. **All 9 components created:** MessageBubble, StreamingMessage, CodeBlock, ThinkingIndicator, ChatInput, ContextSelector, ChatMessageList, WelcomeState, ReferencedFiles
3. **CSS Modules:** All 9 components have matching .module.css files with camelCase class names
4. **MessageBubble uses React.memo:** Custom comparator checks 6 props for equality
5. **StreamingMessage uses Streamdown:** Mode="streaming", parseIncompleteMarkdown=true, animated fade-in
6. **CodeBlock uses Shiki:** Singleton highlighter, 7 bundled languages, copy button with feedback
7. **ChatInput uses react-textarea-autosize:** minRows=1, maxRows=6, Enter/Shift+Enter handling
8. **ContextSelector has dual modes:** Session list vs context picker toggle via showContextPicker state
9. **ChatMessageList integrates useAutoScroll:** scrollRef, contentRef, auto-scroll on message/chunk changes

## Dependencies

**Provides for downstream plans:**
- All 9 components ready for IrisChatView assembly in Plan 03
- MessageBubble accepts streaming state from useChatStore
- ChatMessageList coordinates ThinkingIndicator and StreamingMessage transitions
- ContextSelector manages both session navigation and context switching

**Consumed from upstream:**
- Phase 06 Plan 01: useChatStore (streaming state, messages), useAutoScroll (smart scroll), types (ChatMessage, ChatSession, etc.)
- Phase 03: React setup, esbuild, CSS Modules
- Phase 02: clsx, Button (pattern reference)
- Dependencies: streamdown, shiki, react-textarea-autosize (installed in Plan 01)

## Open Items

None. All tasks complete, all verification passing. Ready for Plan 03 (IrisChatView top-level component assembly and message handler integration).

## Self-Check: PASSED

All files and commits verified:

**Task 1 files:**
- ✓ MessageBubble.tsx
- ✓ MessageBubble.module.css
- ✓ StreamingMessage.tsx
- ✓ StreamingMessage.module.css
- ✓ CodeBlock.tsx
- ✓ CodeBlock.module.css
- ✓ ThinkingIndicator.tsx
- ✓ ThinkingIndicator.module.css
- ✓ Task 1 commit (b14bdb6)

**Task 2 files:**
- ✓ ChatInput.tsx
- ✓ ChatInput.module.css
- ✓ ContextSelector.tsx
- ✓ ContextSelector.module.css
- ✓ ChatMessageList.tsx
- ✓ ChatMessageList.module.css
- ✓ WelcomeState.tsx
- ✓ WelcomeState.module.css
- ✓ ReferencedFiles.tsx
- ✓ ReferencedFiles.module.css
- ✓ Task 2 commit (8e7874a)
