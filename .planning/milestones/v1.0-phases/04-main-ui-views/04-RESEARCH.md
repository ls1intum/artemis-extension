# Phase 4: Main UI Views - Research

**Researched:** 2026-02-23
**Domain:** React state management, WebSocket integration, skeleton loading UX, breadcrumb navigation
**Confidence:** HIGH

## Summary

Phase 4 migrates the core application flow (Dashboard → CourseList → CourseDetail → ExerciseDetail → ExerciseStarted) from HTML-string generation to React components with real-time WebSocket updates. This phase introduces Zustand for webview-side state management integrated with postMessage, skeleton loading states for navigation, and breadcrumb navigation for multi-level views. The research validates established patterns from Phase 3 (message contracts, ready-signal handshake, state persistence) and extends them with client-side state orchestration and real-time data synchronization.

Key technical domains: React 18 state management with Zustand, WebSocket real-time updates without re-render storms, skeleton placeholder patterns, sticky breadcrumb navigation, and component extraction for Phase 5 reuse.

**Primary recommendation:** Use Zustand stores as single source of truth for webview UI state, synchronized with extension host via postMessage. Implement RAF batching for high-frequency WebSocket updates. Extract ExerciseDetail components into composable primitives (not monolithic) for Phase 5 ExamExerciseDetail reuse.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Migration fidelity:**
- Match current layout with minor fixes for visual inconsistencies (alignment, spacing)
- Dashboard layout stays as-is — no structural changes
- Preserve current information density per list item — don't add or remove fields
- ExerciseDetail components extracted cleanly from the start for Phase 5 (ExamExerciseDetail) reuse — composable component design, not monolithic

**Real-time update behavior:**
- Build status changes (building → passed/failed) update silently in place — no animation or notification
- Submission results update the relevant section in place — same silent approach
- Re-fetch data when navigating to a view (not WebSocket-only)
- Match current build progress indicator for in-progress builds
- Subtle "Reconnecting..." banner at top when WebSocket connection drops

**Navigation flow:**
- Clickable breadcrumbs: each segment is a link (e.g., click "Dashboard" from ExerciseDetail to jump there)
- Abbreviated breadcrumb labels to save space (e.g., "SE" not "Software Engineering")
- Breadcrumbs scroll horizontally on overflow
- Breadcrumbs sticky at top of webview while content scrolls
- Breadcrumbs hidden on Dashboard (root level) — only appear when navigated deeper
- Instant view swaps — no transition animations
- Back navigation: re-fetch data but restore UI state (scroll position, expanded sections)

**Loading & error states:**
- Skeleton placeholders on every navigation (including revisits)
- Fixed skeleton count (not matching previous item count)
- In-place skeletons maintaining scroll position
- Skeletons replace stale content entirely until fresh data arrives
- Inline error message with "Retry" text link (not styled button) for data fetch failures
- Auto-retry once after short delay; if still fails, show error with manual retry
- Helpful empty state messages explaining why it's empty and what to do
- Reuse Phase 1 error boundary for unexpected React crashes (no new error boundary)

**ExerciseStarted view:**
- Match current layout with minor fixes (same approach as other views)
- Same skeleton loading pattern as all other views

**View-specific interactions:**
- Exercise categories in CourseDetail always expanded (not collapsible)
- Action buttons (start, submit, etc.) match current placement and styling
- Subtle hover state (background color change) on clickable list items (courses, exercises)
- Long exercise descriptions shown in full — no truncation or "Show more"

### Claude's Discretion

- ExerciseStarted auto-navigation behavior (redirect vs stay put)
- Exact skeleton placeholder design per view
- Error message wording for different failure scenarios
- Empty state message copy per view
- WebSocket reconnection banner timing and dismissal

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| VIEW-01 | All 14+ webview screens render through React components instead of HTML string generation | Phase 3 established coexistence router pattern; Phase 4 extends to 5 main views (Dashboard, CourseList, CourseDetail, ExerciseDetail, ExerciseStarted) |
| MSG-04 | Webview-side state is managed through Zustand stores with postMessage integration to extension host | Zustand provides selective subscriptions, immutable updates, and hook-based API. Integration pattern: stores hold UI state, postMessage syncs with extension host for data fetching/commands |

</phase_requirements>

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Zustand | ^5.0.10 | Client-side state management | Lightweight (1.25kb gzip), hook-based, selective subscriptions, no boilerplate. Uses React 18's useSyncExternalStore for predictable updates. Industry standard for webview-scale state management. |
| React | ^18.3.1 | UI framework | Already installed. Supports useSyncExternalStore (Zustand dependency), concurrent features, automatic batching. |
| react-dom | ^18.3.1 | DOM renderer | Already installed. Required for React webview rendering. |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| clsx | Already installed | Conditional CSS class composition | Combining dynamic classes for hover states, selection states, loading states |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Zustand | Redux Toolkit | Redux is overkill for webview state (no time-travel debugging needed). Adds 14kb vs 1.25kb. More boilerplate (actions, reducers, dispatchers). |
| Zustand | React Context + useReducer | Context causes re-renders for entire subtree when any value changes. No selective subscriptions. Zustand provides better performance isolation. |
| Zustand | Jotai/Recoil | Atomic state management is more complex than needed. Zustand's single-store approach fits webview's single-view-at-a-time navigation model. |
| RAF batching | useDeferredValue | useDeferredValue defers re-renders but doesn't batch messages. RAF batching consolidates 20 messages/sec into single setState per frame (60fps max). |

**Installation:**
```bash
npm install zustand
```

## Architecture Patterns

### Recommended Project Structure

```
src/views/webview/react/
├── stores/                    # Zustand stores
│   ├── useDashboardStore.ts   # Dashboard-specific state
│   ├── useCourseListStore.ts  # Course list state
│   ├── useCourseDetailStore.ts # Single course state
│   ├── useExerciseDetailStore.ts # Single exercise state
│   └── useNavigationStore.ts  # Breadcrumb trail, view history
├── views/
│   ├── Dashboard/
│   │   ├── DashboardView.tsx
│   │   ├── DashboardView.module.css
│   │   ├── types.ts           # View-specific types
│   │   └── components/        # View-specific components
│   │       ├── RecentCourses.tsx
│   │       └── QuickActions.tsx
│   ├── CourseList/
│   │   ├── CourseListView.tsx
│   │   └── CourseListView.module.css
│   ├── CourseDetail/
│   │   ├── CourseDetailView.tsx
│   │   ├── CourseDetailView.module.css
│   │   └── components/
│   │       ├── ExerciseList.tsx
│   │       └── ExerciseCategory.tsx
│   ├── ExerciseDetail/
│   │   ├── ExerciseDetailView.tsx
│   │   ├── ExerciseDetailView.module.css
│   │   └── components/        # EXTRACTED for Phase 5 reuse
│   │       ├── ProblemStatement.tsx
│   │       ├── ScoreInfo.tsx
│   │       └── TestResults.tsx
│   └── ExerciseStarted/
│       ├── ExerciseStartedView.tsx
│       └── ExerciseStartedView.module.css
├── components/                # Shared components (Phase 2)
│   ├── Breadcrumbs/
│   │   ├── Breadcrumbs.tsx
│   │   └── Breadcrumbs.module.css
│   ├── Skeleton/
│   │   ├── Skeleton.tsx
│   │   ├── SkeletonList.tsx
│   │   └── Skeleton.module.css
│   └── ReconnectBanner/
│       ├── ReconnectBanner.tsx
│       └── ReconnectBanner.module.css
└── hooks/
    ├── useWebSocketUpdates.ts  # Real-time update hook
    └── useMessageBatching.ts   # RAF batching hook
```

### Pattern 1: Zustand Store with postMessage Integration

**What:** Zustand store acts as single source of truth for webview UI state. postMessage fetches data from extension host, store holds results. Components subscribe to slices via selectors.

**When to use:** Every Phase 4 view (Dashboard, CourseList, CourseDetail, ExerciseDetail, ExerciseStarted)

**Example:**
```typescript
// Source: Zustand docs + VS Code webview pattern
import { create } from 'zustand';
import type { VsCodeApi } from '../../../shared/messageContracts';

interface CourseListState {
  courses: Course[];
  archivedCourses: Course[];
  isLoading: boolean;
  error: string | null;

  // Actions
  loadCourses: (vscodeApi: VsCodeApi) => void;
  setCourses: (courses: Course[], archived: Course[]) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
}

export const useCourseListStore = create<CourseListState>((set, get) => ({
  courses: [],
  archivedCourses: [],
  isLoading: false,
  error: null,

  loadCourses: (vscodeApi) => {
    set({ isLoading: true, error: null });
    vscodeApi.postMessage({
      type: 'command',
      command: 'loadCourses',
    });
  },

  setCourses: (courses, archived) => {
    set({ courses, archivedCourses: archived, isLoading: false });
  },

  setLoading: (loading) => {
    set({ isLoading: loading });
  },

  setError: (error) => {
    set({ error, isLoading: false });
  },
}));

// Component usage with selective subscription
function CourseListView({ vscodeApi }: CourseListViewProps) {
  // Subscribe only to courses slice — no re-render if isLoading changes
  const courses = useCourseListStore((state) => state.courses);
  const loadCourses = useCourseListStore((state) => state.loadCourses);

  useEffect(() => {
    loadCourses(vscodeApi);
  }, [loadCourses, vscodeApi]);

  return <div>{courses.map(c => <CourseItem key={c.id} course={c} />)}</div>;
}
```

**Benefits:**
- Selective subscriptions prevent unnecessary re-renders
- Immutable updates via `set()` ensure predictable state changes
- Store actions co-locate state logic, not scattered across components
- No prop drilling — any component can access state via hook

### Pattern 2: WebSocket Real-Time Updates with RAF Batching

**What:** WebSocket messages trigger 20+ updates/second. Buffer messages in `useRef`, flush to Zustand store once per animation frame using `requestAnimationFrame`. Prevents re-render storms.

**When to use:** Build status updates, submission result updates (high-frequency WebSocket events)

**Example:**
```typescript
// Source: SitePoint "Streaming Backends & React" article
import { useEffect, useRef } from 'react';
import { useExerciseDetailStore } from '../stores/useExerciseDetailStore';

interface WebSocketUpdate {
  type: 'buildStatus' | 'submissionResult';
  payload: unknown;
}

export function useWebSocketUpdates(vscodeApi: VsCodeApi) {
  const messageBuffer = useRef<WebSocketUpdate[]>([]);
  const rafId = useRef<number | null>(null);
  const updateBuildStatus = useExerciseDetailStore((s) => s.updateBuildStatus);
  const updateSubmission = useExerciseDetailStore((s) => s.updateSubmission);

  useEffect(() => {
    const flushBuffer = () => {
      if (messageBuffer.current.length === 0) {
        rafId.current = requestAnimationFrame(flushBuffer);
        return;
      }

      // Process all buffered messages in single batch
      const messages = messageBuffer.current;
      messageBuffer.current = [];

      messages.forEach((msg) => {
        if (msg.type === 'buildStatus') {
          updateBuildStatus(msg.payload);
        } else if (msg.type === 'submissionResult') {
          updateSubmission(msg.payload);
        }
      });

      rafId.current = requestAnimationFrame(flushBuffer);
    };

    rafId.current = requestAnimationFrame(flushBuffer);

    const messageHandler = (event: MessageEvent) => {
      const message = event.data;

      // WebSocket updates go to buffer, not directly to store
      if (message.type === 'websocketUpdate') {
        messageBuffer.current.push(message.payload);
      }
    };

    window.addEventListener('message', messageHandler);

    return () => {
      window.removeEventListener('message', messageHandler);
      if (rafId.current) {
        cancelAnimationFrame(rafId.current);
      }
    };
  }, [updateBuildStatus, updateSubmission]);
}
```

**Benefits:**
- 20 messages/sec → max 60 state updates/sec (RAF runs at 60fps)
- Single `setState` per frame, not per message
- No visible lag — 16ms frame time sufficient for UI responsiveness
- Prevents React from scheduling hundreds of redundant renders

### Pattern 3: Skeleton Placeholder with Fixed Count

**What:** Fixed-count skeleton loaders replace stale content during navigation. Maintain scroll position, prevent layout shift.

**When to use:** All navigation transitions (Dashboard → CourseList, CourseList → CourseDetail, etc.)

**Example:**
```typescript
// Source: Material UI Skeleton + react-loading-skeleton patterns
import styles from './Skeleton.module.css';

interface SkeletonProps {
  width?: string;
  height?: string;
  variant?: 'text' | 'circular' | 'rectangular';
  className?: string;
}

export function Skeleton({ width = '100%', height = '20px', variant = 'text', className }: SkeletonProps) {
  const variantClass = styles[`skeleton${variant.charAt(0).toUpperCase()}${variant.slice(1)}`];

  return (
    <div
      className={clsx(styles.skeleton, variantClass, className)}
      style={{ width, height }}
      aria-busy="true"
      aria-live="polite"
    />
  );
}

// List skeleton with fixed count (not matching previous data length)
export function SkeletonList({ count = 5 }: { count?: number }) {
  return (
    <div className={styles.skeletonList}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className={styles.skeletonListItem}>
          <Skeleton variant="circular" width="40px" height="40px" />
          <div className={styles.skeletonListContent}>
            <Skeleton width="60%" height="16px" />
            <Skeleton width="40%" height="14px" />
          </div>
        </div>
      ))}
    </div>
  );
}

// Usage in view
function CourseListView() {
  const isLoading = useCourseListStore((s) => s.isLoading);
  const courses = useCourseListStore((s) => s.courses);

  if (isLoading) {
    return <SkeletonList count={5} />;
  }

  return <div>{courses.map(c => <CourseItem key={c.id} course={c} />)}</div>;
}
```

**CSS pattern (pulse animation):**
```css
/* Skeleton.module.css */
.skeleton {
  background: var(--vscode-editor-background);
  position: relative;
  overflow: hidden;
  border-radius: 4px;
}

.skeleton::after {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: linear-gradient(
    90deg,
    transparent,
    var(--vscode-widget-border),
    transparent
  );
  animation: shimmer 1.5s infinite;
}

@keyframes shimmer {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(100%); }
}
```

**Benefits:**
- Fixed count prevents layout shift when data length changes
- Shimmer animation improves perceived performance
- Maintains scroll position (skeleton rendered in same container as content)
- Replaces stale content completely (no "old data while loading" confusion)

### Pattern 4: Sticky Breadcrumb Navigation with Horizontal Scroll

**What:** Breadcrumb trail at top of webview, sticky during scroll. Clickable segments for multi-level navigation. Horizontal scroll for overflow (long course names).

**When to use:** All views except Dashboard (root level)

**Example:**
```typescript
// Source: Material UI Breadcrumbs + sticky header patterns
import styles from './Breadcrumbs.module.css';

interface BreadcrumbSegment {
  label: string;
  onClick: () => void;
}

interface BreadcrumbsProps {
  segments: BreadcrumbSegment[];
}

export function Breadcrumbs({ segments }: BreadcrumbsProps) {
  if (segments.length === 0) return null;

  return (
    <nav className={styles.breadcrumbs} aria-label="Breadcrumb navigation">
      <div className={styles.breadcrumbsInner}>
        {segments.map((segment, index) => (
          <span key={index} className={styles.breadcrumbSegment}>
            {index < segments.length - 1 ? (
              <>
                <button
                  className={styles.breadcrumbLink}
                  onClick={segment.onClick}
                  type="button"
                >
                  {segment.label}
                </button>
                <span className={styles.breadcrumbSeparator} aria-hidden="true">
                  /
                </span>
              </>
            ) : (
              <span className={styles.breadcrumbCurrent} aria-current="page">
                {segment.label}
              </span>
            )}
          </span>
        ))}
      </div>
    </nav>
  );
}
```

**CSS pattern (sticky + horizontal scroll):**
```css
/* Breadcrumbs.module.css */
.breadcrumbs {
  position: sticky;
  top: 0;
  z-index: 10;
  background: var(--vscode-editor-background);
  border-bottom: 1px solid var(--vscode-widget-border);
  padding: 8px 16px;
}

.breadcrumbsInner {
  display: flex;
  align-items: center;
  gap: 4px;
  overflow-x: auto;
  overflow-y: hidden;
  white-space: nowrap;
  scrollbar-width: thin;
}

.breadcrumbsInner::-webkit-scrollbar {
  height: 4px;
}

.breadcrumbsInner::-webkit-scrollbar-thumb {
  background: var(--vscode-scrollbarSlider-background);
}

.breadcrumbLink {
  background: none;
  border: none;
  color: var(--vscode-textLink-foreground);
  cursor: pointer;
  font-size: 13px;
  padding: 0;
}

.breadcrumbLink:hover {
  color: var(--vscode-textLink-activeForeground);
  text-decoration: underline;
}

.breadcrumbCurrent {
  color: var(--vscode-foreground);
  font-size: 13px;
  font-weight: 500;
}

.breadcrumbSeparator {
  color: var(--vscode-descriptionForeground);
  margin: 0 4px;
}
```

**Abbreviated label pattern:**
```typescript
// Navigation store manages breadcrumb trail
interface NavigationState {
  breadcrumbs: BreadcrumbSegment[];
  pushBreadcrumb: (label: string, fullLabel: string, view: string) => void;
  popToBreadcrumb: (index: number) => void;
}

export const useNavigationStore = create<NavigationState>((set, get) => ({
  breadcrumbs: [],

  pushBreadcrumb: (label, fullLabel, view) => {
    set((state) => ({
      breadcrumbs: [
        ...state.breadcrumbs,
        {
          label: abbreviateLabel(label), // "Software Engineering" → "SE"
          fullLabel,
          view,
          onClick: () => get().popToBreadcrumb(state.breadcrumbs.length),
        },
      ],
    }));
  },

  popToBreadcrumb: (index) => {
    const breadcrumbs = get().breadcrumbs.slice(0, index + 1);
    set({ breadcrumbs });
    // Trigger navigation to view
    const target = breadcrumbs[index];
    // postMessage to extension host
  },
}));

function abbreviateLabel(label: string): string {
  // Keep first 20 chars + ellipsis if longer
  if (label.length <= 20) return label;
  return label.slice(0, 17) + '...';
}
```

**Benefits:**
- Sticky positioning keeps breadcrumbs visible during content scroll
- Horizontal scroll handles long course names without wrapping
- Clickable segments enable fast multi-level navigation
- Abbreviated labels save space (full label in title attribute for tooltip)

### Pattern 5: Component Extraction for Reuse (Phase 5 ExamExerciseDetail)

**What:** ExerciseDetail view components extracted into composable primitives (ProblemStatement, ScoreInfo, TestResults) that accept typed props. ExamExerciseDetail (Phase 5) reuses these via composition, not code duplication.

**When to use:** ExerciseDetail components that will be reused in ExamExerciseDetail (Phase 5)

**Example:**
```typescript
// Extracted component with typed props (not domain model imports)
interface ProblemStatementProps {
  markdown: string;
  downloadLinks?: Array<{ name: string; url: string }>;
  onDownload?: (url: string) => void;
}

export function ProblemStatement({ markdown, downloadLinks, onDownload }: ProblemStatementProps) {
  // Process markdown (existing utility)
  const { html } = processMarkdown(markdown);

  return (
    <Container header="Problem Statement">
      <div dangerouslySetInnerHTML={{ __html: html }} />
      {downloadLinks && downloadLinks.length > 0 && (
        <div className={styles.downloads}>
          {downloadLinks.map((link) => (
            <Button
              key={link.url}
              variant="link"
              onClick={() => onDownload?.(link.url)}
            >
              {link.name}
            </Button>
          ))}
        </div>
      )}
    </Container>
  );
}

// Reuse in ExerciseDetailView
function ExerciseDetailView() {
  const exercise = useExerciseDetailStore((s) => s.exercise);

  return (
    <div>
      <ProblemStatement
        markdown={exercise.problemStatement || ''}
        downloadLinks={exercise.downloadLinks}
        onDownload={handleDownload}
      />
    </div>
  );
}

// Phase 5: ExamExerciseDetailView reuses same component
function ExamExerciseDetailView() {
  const examExercise = useExamExerciseDetailStore((s) => s.exercise);

  return (
    <div>
      <ProblemStatement
        markdown={examExercise.problemStatement || ''}
        downloadLinks={examExercise.downloadLinks}
        onDownload={handleDownload}
      />
    </div>
  );
}
```

**Benefits:**
- Typed props (not domain model imports) enable clean reuse across contexts
- Composition pattern (not monolithic component) allows mixing/matching in Phase 5
- Single source of truth for rendering logic (no duplication)
- Easier testing (props-in, JSX-out, no side effects)

### Anti-Patterns to Avoid

- **Storing vscodeApi in Zustand store:** vscodeApi is acquired once via `acquireVsCodeApi()`. Store in component state or pass as prop, not in Zustand store (causes serialization issues).
- **Direct WebSocket messages to setState:** High-frequency WebSocket events (20+/sec) cause re-render storms. Always buffer + RAF batch before updating store.
- **Matching previous data length in skeletons:** User expects fixed skeleton count. Matching old data length creates visual "flash" when count changes during load.
- **Prop drilling through breadcrumb segments:** Use Zustand navigation store to manage breadcrumb trail centrally. Components push/pop segments, not pass breadcrumb data through props.
- **Monolithic ExerciseDetail component:** Extract components NOW (Phase 4), not later. Phase 5 ExamExerciseDetail reuse depends on composable primitives, not refactoring monolith.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| State management library | Custom Context + useReducer with selective subscriptions | Zustand | Zustand handles selective subscriptions, immutable updates, devtools integration. Custom solution misses edge cases (stale closures, concurrent updates, middleware). |
| WebSocket message batching | Manual setTimeout/debounce | requestAnimationFrame loop | RAF guarantees 60fps cap (16ms budget). setTimeout is imprecise, debounce delays updates unnecessarily. RAF is browser-optimized for render timing. |
| Skeleton loader library | Custom shimmer CSS with complex keyframes | Simple pulse animation (single @keyframes) | Complex shimmer animations (gradients, multiple layers) add bundle size. Simple pulse is sufficient, uses VS Code theme variables, lighter CSS. |
| Breadcrumb navigation library | use-react-router-breadcrumbs or React Router integration | Manual breadcrumb stack in Zustand store | Webviews aren't SPAs — extension controls navigation via postMessage. React Router breadcrumbs assume client-side routing. Manual stack matches extension-controlled navigation model. |

**Key insight:** Webview state management differs from web app state management. Webviews have single-view-at-a-time navigation (controlled by extension host), not client-side routing. Zustand provides enough structure without over-engineering. RAF batching is critical for WebSocket updates — browser-native optimization, not library needed.

## Common Pitfalls

### Pitfall 1: Re-render Storms from WebSocket Updates

**What goes wrong:** WebSocket fires 20 messages/sec (build logs streaming). Each message calls `store.setState()`, triggering 20 re-renders/sec minimum. UI becomes laggy, unresponsive.

**Why it happens:** Direct WebSocket → setState pipeline ignores browser's render budget (16ms/frame at 60fps). React schedules render for each setState, not batched automatically across message events.

**How to avoid:** Buffer WebSocket messages in `useRef` (mutable, doesn't trigger renders). Flush buffer to Zustand store once per animation frame using `requestAnimationFrame` loop. Max 60 updates/sec (one per frame).

**Warning signs:**
- FPS drops below 30 during active WebSocket streaming
- UI interactions (clicks, scrolls) feel sluggish during real-time updates
- React DevTools profiler shows hundreds of renders per second

### Pitfall 2: Stale Data During Skeleton Loading

**What goes wrong:** User navigates CourseList → CourseDetail. Skeleton shows while new data loads, but old CourseList data still visible behind skeleton (transparent skeleton). Confusing UX.

**Why it happens:** Skeleton rendered alongside old data, not replacing it. User sees "ghosted" old content during load.

**How to avoid:** Conditional rendering — `if (isLoading) return <Skeleton />`, not `{isLoading && <Skeleton />}`. Skeleton replaces content entirely, no overlay pattern.

**Warning signs:**
- User reports seeing "wrong course" during navigation
- Old data flickers before new data appears
- Skeleton appears translucent over previous view

### Pitfall 3: Layout Shift from Variable Skeleton Count

**What goes wrong:** User navigates from view with 10 courses to view with 3 courses. Skeleton shows 10 items (matching old data), then collapses to 3 when new data loads. Jarring layout shift.

**Why it happens:** Skeleton count derived from `previousData.length` or `store.data.length` before load completes.

**How to avoid:** Fixed skeleton count (5 items) regardless of previous or new data length. User expects consistent loading experience, not "ghost echo" of previous view.

**Warning signs:**
- Skeleton list is sometimes tall (10+ items), sometimes short (1-2 items)
- Scroll position jumps when data loads after skeleton
- User reports "skeleton count matches old data"

### Pitfall 4: Multiple acquireVsCodeApi Calls

**What goes wrong:** `acquireVsCodeApi()` throws error if called more than once. Zustand store tries to acquire vscodeApi in action, component also acquires it. Extension crashes with "acquireVsCodeApi can only be called once" error.

**Why it happens:** vscodeApi is singleton per webview. Once acquired, must be stored and reused, not re-acquired.

**How to avoid:** Acquire vscodeApi once in top-level view component. Pass as prop to child components, not acquired in each component. Store in component state (`useState`), not in Zustand store (serialization issues).

**Warning signs:**
- Error: "acquireVsCodeApi can only be called once"
- Webview crashes on mount
- postMessage calls fail silently

### Pitfall 5: Breadcrumb Navigation Loop

**What goes wrong:** User clicks breadcrumb segment "Dashboard". Breadcrumb onClick triggers `popToBreadcrumb()`, which updates Zustand store, which triggers re-render, which re-creates breadcrumb segments with new onClick handlers, which triggers another navigation. Infinite loop.

**Why it happens:** Breadcrumb segments re-created on every render with new function references. `useEffect` watching breadcrumb segments triggers side effects on every render.

**How to avoid:** Store breadcrumb state in Zustand navigation store, not derived in component. onClick handlers reference stable store actions (`get().popToBreadcrumb`), not inline functions. No `useEffect` watching breadcrumbs — navigation triggered by onClick, not effect.

**Warning signs:**
- Browser freezes when clicking breadcrumb
- React DevTools shows hundreds of renders in quick succession
- "Maximum update depth exceeded" error

## Code Examples

Verified patterns from official sources and existing codebase:

### Zustand Store Setup

```typescript
// Source: Zustand docs (https://zustand.docs.pmnd.rs/)
import { create } from 'zustand';

interface DashboardState {
  recentCourses: Course[];
  isLoading: boolean;
  error: string | null;

  loadDashboard: (vscodeApi: VsCodeApi) => void;
  setDashboard: (courses: Course[]) => void;
  setError: (error: string | null) => void;
}

export const useDashboardStore = create<DashboardState>((set, get) => ({
  recentCourses: [],
  isLoading: false,
  error: null,

  loadDashboard: (vscodeApi) => {
    set({ isLoading: true, error: null });
    vscodeApi.postMessage({
      type: 'command',
      command: 'loadDashboard',
    });
  },

  setDashboard: (courses) => {
    set({ recentCourses: courses, isLoading: false });
  },

  setError: (error) => {
    set({ error, isLoading: false });
  },
}));
```

### Message Handler with Store Integration

```typescript
// Pattern from Phase 3 LoginView + Zustand integration
function DashboardView({ vscodeApi }: DashboardViewProps) {
  const loadDashboard = useDashboardStore((s) => s.loadDashboard);
  const setDashboard = useDashboardStore((s) => s.setDashboard);
  const setError = useDashboardStore((s) => s.setError);

  // Load data on mount
  useEffect(() => {
    loadDashboard(vscodeApi);
  }, [loadDashboard, vscodeApi]);

  // Message handler for extension responses
  useEffect(() => {
    const messageHandler = (event: MessageEvent) => {
      const message = event.data;

      switch (message.type) {
        case 'dashboardData':
          setDashboard(message.payload.courses);
          break;
        case 'dashboardError':
          setError(message.payload.error);
          break;
      }
    };

    window.addEventListener('message', messageHandler);
    return () => window.removeEventListener('message', messageHandler);
  }, [setDashboard, setError]);

  const recentCourses = useDashboardStore((s) => s.recentCourses);
  const isLoading = useDashboardStore((s) => s.isLoading);
  const error = useDashboardStore((s) => s.error);

  if (isLoading) return <SkeletonList count={3} />;
  if (error) return <ErrorMessage error={error} onRetry={() => loadDashboard(vscodeApi)} />;

  return <div>{recentCourses.map(c => <CourseCard key={c.id} course={c} />)}</div>;
}
```

### WebSocket Reconnection Banner

```typescript
// Source: User constraints + VS Code notification patterns
function ReconnectBanner() {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const messageHandler = (event: MessageEvent) => {
      const message = event.data;

      if (message.type === 'websocketDisconnected') {
        setIsVisible(true);
      } else if (message.type === 'websocketConnected') {
        // Dismiss after 2 seconds
        setTimeout(() => setIsVisible(false), 2000);
      }
    };

    window.addEventListener('message', messageHandler);
    return () => window.removeEventListener('message', messageHandler);
  }, []);

  if (!isVisible) return null;

  return (
    <div className={styles.reconnectBanner}>
      <span>Reconnecting to Artemis...</span>
    </div>
  );
}
```

**CSS:**
```css
.reconnectBanner {
  position: sticky;
  top: 0;
  z-index: 100;
  background: var(--vscode-inputValidation-warningBackground);
  color: var(--vscode-inputValidation-warningForeground);
  border-bottom: 1px solid var(--vscode-inputValidation-warningBorder);
  padding: 4px 16px;
  font-size: 12px;
  text-align: center;
}
```

### Error Handling with Inline Retry

```typescript
// Source: User constraints (inline retry, not button)
interface ErrorMessageProps {
  error: string;
  onRetry: () => void;
}

function ErrorMessage({ error, onRetry }: ErrorMessageProps) {
  return (
    <div className={styles.errorContainer}>
      <div className={styles.errorMessage}>{error}</div>
      <div className={styles.errorActions}>
        <button className={styles.retryLink} onClick={onRetry} type="button">
          Retry
        </button>
      </div>
    </div>
  );
}
```

**CSS (text link, not button):**
```css
.retryLink {
  background: none;
  border: none;
  color: var(--vscode-textLink-foreground);
  cursor: pointer;
  font-size: 13px;
  padding: 0;
  text-decoration: underline;
}

.retryLink:hover {
  color: var(--vscode-textLink-activeForeground);
}
```

### Empty State with Helpful Message

```typescript
// Source: User constraints + VS Code empty state patterns
interface EmptyStateProps {
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}

function EmptyState({ title, message, actionLabel, onAction }: EmptyStateProps) {
  return (
    <div className={styles.emptyState}>
      <div className={styles.emptyStateIcon}>📭</div>
      <h3 className={styles.emptyStateTitle}>{title}</h3>
      <p className={styles.emptyStateMessage}>{message}</p>
      {actionLabel && onAction && (
        <Button variant="primary" onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </div>
  );
}

// Usage
function CourseListView() {
  const courses = useCourseListStore((s) => s.courses);

  if (courses.length === 0) {
    return (
      <EmptyState
        title="No Courses Found"
        message="You're not enrolled in any Artemis courses yet. Check with your instructor or browse available courses on the Artemis website."
        actionLabel="Open Artemis Website"
        onAction={handleOpenWebsite}
      />
    );
  }

  return <div>{courses.map(c => <CourseItem key={c.id} course={c} />)}</div>;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| HTML string generation with inline JS | React components with Zustand stores | Phase 1-4 (2026) | Type safety, no XSS, testable components, proper state lifecycle |
| Full webview reload on data change | Zustand + postMessage for partial updates | Phase 4 (2026) | Real-time updates without losing scroll position, form state |
| Direct WebSocket → DOM manipulation | RAF batching → Zustand store → React re-render | Phase 4 (2026) | 20+ messages/sec don't cause re-render storms |
| Global CSS with !important overrides | CSS Modules with VS Code theme variables | Phase 2 (2026) | No style conflicts, theme-aware, scoped styles |
| Monolithic ExerciseDetailView | Composable exercise components | Phase 4 (2026) | Clean reuse in ExamExerciseDetail (Phase 5), no duplication |

**Deprecated/outdated:**
- `generateXxxHtml()` functions: Replaced by React views (Phase 3-6)
- Inline `<script>` tags with vscode.postMessage: Replaced by typed message contracts (Phase 1)
- Manual state persistence via localStorage: Replaced by vscodeApi.getState/setState (Phase 3)
- Global event listeners without cleanup: Replaced by React useEffect cleanup (Phase 1)

## Open Questions

1. **WebSocket subscription lifecycle:**
   - What we know: Extension host manages WebSocket connection via `ArtemisWebsocketService`
   - What's unclear: Should webviews subscribe/unsubscribe to specific topics (e.g., exercise build updates) or receive all messages and filter client-side?
   - Recommendation: Extension host filters messages by view context (current exercise ID, current course ID) before forwarding to webview. Webview receives only relevant updates. Less client-side filtering logic, cleaner message contracts.

2. **Breadcrumb navigation state persistence:**
   - What we know: User constraints require restoring scroll position on back navigation
   - What's unclear: Should breadcrumb trail persist across webview hide/show cycles, or rebuild from scratch?
   - Recommendation: Persist breadcrumb trail in vscodeApi.setState (durable state). Rebuilding from scratch loses context when webview is hidden/shown. User expects breadcrumb to match previous navigation path.

3. **Exercise category collapsing in CourseDetail:**
   - What we know: User constraints specify "always expanded (not collapsible)"
   - What's unclear: Does this mean no collapse UI at all, or collapse UI exists but defaults to expanded?
   - Recommendation: No collapse UI at all. User constraints say "always expanded" — remove accordion/collapse pattern entirely. Simpler code, matches fidelity goal (preserve current behavior).

## Sources

### Primary (HIGH confidence)

- **Zustand Documentation**: https://zustand.docs.pmnd.rs/ — State management API, useSyncExternalStore integration, selective subscriptions
- **React 18 Documentation**: https://react.dev/ — Hooks, useEffect cleanup, concurrent features
- **VS Code Webview API**: https://code.visualstudio.com/api/extension-guides/webview — postMessage patterns, CSP, acquireVsCodeApi
- **Existing Codebase**: Phase 1-3 patterns (message contracts, ready-signal handshake, LoginView component structure, CSS Modules)

### Secondary (MEDIUM confidence)

- [Zustand GitHub Repository](https://github.com/pmndrs/zustand) — Latest version (5.0.10), React 18 compatibility
- [WebSocket Real-Time Updates with React](https://oneuptime.com/blog/post/2026-01-15-websockets-react-real-time-applications/view) — Custom hooks, message batching patterns
- [Streaming Backends & React: Controlling Re-render Chaos](https://www.sitepoint.com/streaming-backends-react-controlling-re-render-chaos/) — RAF batching for high-frequency updates
- [Material UI Skeleton Documentation](https://mui.com/material-ui/react-skeleton/) — Skeleton animation variants, accessibility patterns
- [React Loading Skeleton](https://github.com/dvtng/react-loading-skeleton) — Shimmer effect CSS, responsive skeleton patterns
- [Material UI Breadcrumbs](https://mui.com/material-ui/react-breadcrumbs/) — Breadcrumb navigation structure, ARIA attributes
- [React Component Composition Patterns](https://namastedev.com/blog/implementing-component-composition-and-reusability-in-react/) — Compound components, custom hooks, reusability strategies

### Tertiary (LOW confidence)

- [Building Reusable React Components in 2026](https://medium.com/@romko.kozak/building-reusable-react-components-in-2026-a461d30f8ce4) — SOLID principles for React
- [React Design Patterns for 2026](https://www.sayonetech.com/blog/react-design-patterns/) — HOCs, render props, composition

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — Zustand is established (5.0.10 stable), React 18 already installed, clsx already in use
- Architecture: HIGH — Patterns verified in Phase 3 (message contracts, state persistence), extended with Zustand (official docs)
- Pitfalls: HIGH — Derived from known WebSocket re-render issues (SitePoint article), stale data patterns (existing codebase Phase 3), VS Code API constraints (official docs)
- WebSocket batching: MEDIUM — RAF pattern verified in article, not yet implemented in codebase (new pattern for Phase 4)
- Component extraction: HIGH — User constraints explicit, Phase 2 established composition patterns, Phase 5 dependency clear

**Research date:** 2026-02-23
**Valid until:** ~30 days (Zustand stable, React 18 stable, patterns mature)
