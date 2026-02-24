# Phase 6: Iris Chat with Streaming - Context

**Gathered:** 2026-02-24
**Status:** Ready for planning

<domain>
## Phase Boundary

Migrate the Iris chat webview (~2,000 lines of HTML-string generation) to React with optimized message streaming. Delivers: IrisChatView rendering through React with ChatWebviewProvider, smooth token-by-token message streaming with React.memo optimization, context switching with message history, and code syntax highlighting. Does NOT include new chat features, file sharing, or changes to the Artemis API/WebSocket protocol.

</domain>

<decisions>
## Implementation Decisions

### Streaming appearance
- Fade-in chunks approach: buffer tokens until sentence boundary (~50 tokens or punctuation/newline), then fade in the chunk
- Subtle opacity fade transition (~150ms) when new chunks appear
- Animated dots (three bouncing/pulsing dots in a message bubble) as thinking indicator before first chunk arrives
- Smooth transition from thinking dots to first chunk (dots fade out, first chunk fades in at same position)
- Smart auto-scroll: auto-scroll if user is near bottom, stop if they've scrolled up to read history, resume on new user message
- Optimistic message display: user messages appear instantly, sent to server in background; show error on the message if server fails
- Input clears immediately on send (matches optimistic pattern)
- Progressive markdown rendering during streaming (bold, italic, lists render as tokens arrive)
- Progressive code block rendering during streaming (syntax highlighting applied incrementally as code grows)
- No stop generating button
- No progress/elapsed time indicator
- Inline error display for streaming failures (error shown where the message was streaming, with retry option)

### Code syntax highlighting
- Support basic/common language set (Java, Python, C, JavaScript, TypeScript, SQL, shell, etc.)
- Copy-to-clipboard button on code blocks (small icon in top-right corner)
- Language label shown in code block header/corner (e.g., "Java", "Python")
- No line numbers on code blocks
- Highlighting renders progressively during streaming

### Chat input experience
- Auto-expanding textarea: starts single line, grows as user types, caps at ~6 lines then scrolls internally
- Enter sends message, Shift+Enter for new line
- Send button always visible, disabled/greyed when input is empty, active when there's text
- Input disabled with placeholder prompt ("Select a course to start chatting") when no context selected
- Referenced files displayed as collapsible chip/tag list above input (collapsed by default showing count, expandable to see file names)
- No character limit indicator
- Text-only paste (no image/file paste support)

### Message display & feedback
- Bubble alignment: user messages right-aligned with accent background, assistant messages left-aligned with subtle background
- Iris icon/logo next to assistant messages only; no avatar for user messages
- Feedback buttons (thumbs up/down) appear on hover over assistant messages
- Relative timestamps shown on hover (e.g., "2 min ago")
- Compact dropdown bar for context selector at top (slim bar showing current context with dropdown to switch, minimizes vertical space)
- Smooth context-switch transition: messages fade out, new session messages fade in, brief loading state if fetching history
- Welcome/empty state: Iris greeting with 2-3 suggested prompts/questions to lower barrier to start chatting
- Message history loading: skeleton placeholders (message-shaped shimmers) while loading, then fade in real messages
- Side menu (reset sessions, help, about) as compact dropdown from burger icon

### Claude's Discretion
- Exact fade timing and animation easing curves
- Syntax highlighting library choice (Prism, Shiki, highlight.js, etc.)
- Exact sentence boundary detection algorithm for chunk buffering
- Skeleton placeholder design for message history loading
- Specific suggested prompts in welcome state
- Internal scroll behavior details for auto-expanding textarea

</decisions>

<specifics>
## Specific Ideas

- Streaming should feel like modern chat UIs (ChatGPT/Claude web) but with sentence-level chunks rather than token-by-token for a smoother reading experience
- Code blocks should look polished with language label + copy button header bar, similar to GitHub/ChatGPT code blocks
- Message bubbles follow classic chat alignment pattern (user right, assistant left) for immediate visual distinction
- Context switching should feel intentional with smooth transitions, not jarring instant swaps
- Welcome state with suggested prompts to help students know what to ask Iris

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 06-iris-chat-with-streaming*
*Context gathered: 2026-02-24*
