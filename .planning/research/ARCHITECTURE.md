# Architecture Research: React Webview Migration for VS Code Extension

**Domain:** VS Code Extension with React Webviews
**Researched:** 2026-02-23
**Confidence:** HIGH

## Standard Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                   VS Code Extension Host (Node.js)              │
│  ┌──────────────┐  ┌─────────────────┐  ┌──────────────────┐   │
│  │  Extension   │  │  Auth Manager   │  │ API Services     │   │
│  │  Activation  │  │  WebSocket Svc  │  │ Telemetry        │   │
│  └──────┬───────┘  └────────┬────────┘  └────────┬─────────┘   │
│         │                   │                     │             │
├─────────┴───────────────────┴─────────────────────┴─────────────┤
│                      Webview Providers                          │
│  ┌──────────────────────────┐  ┌──────────────────────────┐    │
│  │ ArtemisWebviewProvider   │  │  ChatWebviewProvider     │    │
│  │  - State management      │  │  - Chat state            │    │
│  │  - Message routing       │  │  - Session management    │    │
│  │  - View lifecycle        │  │  - Context tracking      │    │
│  └──────────┬───────────────┘  └──────────┬───────────────┘    │
│             │                              │                    │
│             │    postMessage Bridge        │                    │
│             ↓                              ↓                    │
├─────────────────────────────────────────────────────────────────┤
│                 Webview Runtime (Browser/Iframe)                │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  React App Root                                         │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │   │
│  │  │  View Router │  │ Message API  │  │ State Store  │  │   │
│  │  │  (State-     │  │  (Typed      │  │ (Context/    │  │   │
│  │  │   based)     │  │   Contract)  │  │  Zustand)    │  │   │
│  │  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  │   │
│  │         │                  │                  │          │   │
│  │  ┌──────┴──────────────────┴──────────────────┴───────┐ │   │
│  │  │           React Component Tree                     │ │   │
│  │  │  Login → Dashboard → CourseList → CourseDetail    │ │   │
│  │  │           ↓                                        │ │   │
│  │  │      ExerciseDetail ← ExamExerciseDetail          │ │   │
│  │  │           ↓                                        │ │   │
│  │  │  Shared Components (Button, Badge, Container...)  │ │   │
│  │  └────────────────────────────────────────────────────┘ │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|----------------|------------------------|
| **WebviewProvider** | Manages webview lifecycle, creates/destroys webview panels, handles provider-level state | Class implementing `vscode.WebviewViewProvider` with `resolveWebviewView()` |
| **Message Bridge** | Type-safe bidirectional communication between extension host and webview | Typed message contracts with discriminated unions, generic helper functions |
| **React App Root** | Single mount point for React app, manages routing and global state | `createRoot()` in webview entry point, wraps app in providers |
| **View Router** | Determines which React component to render based on app state | State-based conditional rendering (no URL routing needed in webviews) |
| **Shared Components** | Reusable UI components matching VS Code design language | React components using VS Code CSS variables, styled to match editor theme |
| **Build Pipeline** | Separate builds for extension host (Node.js) and webview (browser) | esbuild or Vite with dual contexts: platform 'node' + platform 'browser' |

## Recommended Project Structure

```
iris-thaumantias/
├── src/
│   ├── extension.ts                    # Extension entry point (Node.js)
│   ├── provider/                       # Webview providers (Node.js)
│   │   ├── artemisWebviewProvider.ts   # Main UI provider
│   │   └── chatWebviewProvider.ts      # Chat UI provider
│   ├── views/                          # View layer
│   │   ├── webview/                    # NEW: React webview code (Browser)
│   │   │   ├── apps/                   # NEW: React app roots
│   │   │   │   ├── main/               # Main UI React app
│   │   │   │   │   ├── index.tsx       # Entry point for ArtemisWebviewProvider
│   │   │   │   │   ├── App.tsx         # Root component with routing
│   │   │   │   │   ├── router.tsx      # State-based view router
│   │   │   │   │   ├── store/          # State management (Zustand/Context)
│   │   │   │   │   ├── views/          # View components (Login, Dashboard, etc.)
│   │   │   │   │   └── messaging/      # Typed postMessage API
│   │   │   │   └── chat/               # Chat UI React app
│   │   │   │       ├── index.tsx       # Entry point for ChatWebviewProvider
│   │   │   │       ├── App.tsx         # Chat root component
│   │   │   │       └── store/          # Chat-specific state
│   │   │   ├── components/             # NEW: Shared React components
│   │   │   │   ├── Button/             # Migrated from buttonComponent.ts
│   │   │   │   ├── Badge/              # Migrated from badgeComponent.ts
│   │   │   │   ├── Container/          # Migrated from containerComponent.ts
│   │   │   │   ├── BackLink/           # Migrated from backLinkComponent.ts
│   │   │   │   └── ListItem/           # Migrated from listItemComponent.ts
│   │   │   └── shared/                 # NEW: Shared utilities
│   │   │       ├── types.ts            # Message contracts, shared types
│   │   │       └── hooks.ts            # Shared React hooks
│   │   ├── app/                        # EXISTING: Extension-side view logic (Node.js)
│   │   │   ├── appStateManager.ts      # KEEP: Extension-side state
│   │   │   ├── viewRouter.ts           # REMOVE: Replaced by React routing
│   │   │   └── webViewMessageHandler.ts # KEEP: Message dispatch to commands
│   │   └── [legacy views]/             # REMOVE GRADUALLY: Old HTML generators
│   ├── api/                            # API services (Node.js)
│   ├── auth/                           # Auth manager (Node.js)
│   ├── services/                       # Business logic services (Node.js)
│   └── types/                          # Shared TypeScript types
├── dist/
│   ├── extension.js                    # Compiled extension (CJS, Node.js)
│   ├── webview-main.js                 # Compiled main React app (IIFE, Browser)
│   ├── webview-chat.js                 # Compiled chat React app (IIFE, Browser)
│   └── views/                          # CSS files (copied by build)
├── esbuild.js                          # MODIFIED: Add React app builds
└── package.json
```

### Structure Rationale

- **`src/views/webview/apps/`**: Separate React apps for each webview provider enables independent state management and code splitting
- **`src/views/webview/components/`**: Shared components used by both main and chat apps, following component-per-folder pattern
- **`src/views/webview/shared/`**: Type definitions and hooks that cross app boundaries
- **Keep extension-side code separate**: Providers, services, and API clients stay in Node.js context
- **Gradual migration**: Legacy view generators can coexist during migration, removed view-by-view

## Architectural Patterns

### Pattern 1: Dual Webview Providers with Independent React Apps

**What:** Each `WebviewViewProvider` mounts its own React application in the webview it creates. The main UI provider mounts the `main` app, and the chat provider mounts the `chat` app.

**When to use:** When you have multiple webviews with distinct purposes and state (e.g., main UI vs. chat panel).

**Trade-offs:**
- **Pro**: Complete isolation between webviews, independent state management
- **Pro**: Smaller bundle sizes per webview (only loads what's needed)
- **Con**: Shared components must be carefully managed to avoid duplication
- **Con**: Cross-webview communication requires extension host as intermediary

**Example:**

```typescript
// src/provider/artemisWebviewProvider.ts (Node.js)
export class ArtemisWebviewProvider implements vscode.WebviewViewProvider {
    public async resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        // Serve React app HTML
        webviewView.webview.html = this._getReactAppHtml(webviewView.webview);

        // Set up message handler
        webviewView.webview.onDidReceiveMessage(
            message => this._messageHandler.handleMessage(message),
            undefined,
            []
        );
    }

    private _getReactAppHtml(webview: vscode.Webview): string {
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview-main.js')
        );

        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <meta http-equiv="Content-Security-Policy"
                  content="default-src 'none'; script-src ${webview.cspSource}; style-src ${webview.cspSource} 'unsafe-inline';">
            <title>Artemis Extension</title>
        </head>
        <body>
            <div id="root"></div>
            <script src="${scriptUri}"></script>
        </body>
        </html>`;
    }
}

// src/views/webview/apps/main/index.tsx (Browser)
import { createRoot } from 'react-dom/client';
import { App } from './App';

const container = document.getElementById('root');
const root = createRoot(container!);
root.render(<App />);
```

### Pattern 2: Typed Message Contracts with Discriminated Unions

**What:** Define a strict TypeScript contract for all messages between extension host and webview using discriminated unions. Each message type has a unique `command` field and typed payload.

**When to use:** Always. Critical for type safety in VS Code webview extensions.

**Trade-offs:**
- **Pro**: Compile-time type checking prevents runtime message errors
- **Pro**: IntelliSense auto-completion for message payloads
- **Pro**: Refactoring is safe (TypeScript catches broken references)
- **Con**: Requires discipline to maintain type definitions

**Example:**

```typescript
// src/views/webview/shared/types.ts (Shared between Node.js and Browser)

// Messages FROM extension host TO webview
export type HostToWebviewMessage =
    | { command: 'loginSuccess'; user: UserInfo }
    | { command: 'updateCourses'; courses: CourseData[] }
    | { command: 'updateExercise'; exerciseId: number; data: ExerciseData }
    | { command: 'newSubmission'; submission: Submission }
    | { command: 'showLoading'; message: string }
    | { command: 'hideLoading' };

// Messages FROM webview TO extension host
export type WebviewToHostMessage =
    | { command: 'login'; username: string; password: string; serverUrl: string }
    | { command: 'logout' }
    | { command: 'openCourse'; courseId: number }
    | { command: 'openExercise'; exerciseId: number }
    | { command: 'cloneRepository'; exerciseId: number; repositoryUrl: string }
    | { command: 'submitExercise'; exerciseId: number };

export interface UserInfo {
    username: string;
    serverUrl: string;
    user?: any;
}

export interface CourseData {
    id: number;
    title: string;
    exercises: ExerciseData[];
}

export interface ExerciseData {
    id: number;
    title: string;
    type: string;
    dueDate?: string;
    // ... other fields
}

// src/views/webview/apps/main/messaging/api.ts (Browser)
import type { WebviewToHostMessage, HostToWebviewMessage } from '../../../shared/types';

type VsCodeApi = {
    postMessage: (message: any) => void;
    getState: () => any;
    setState: (state: any) => void;
};

declare function acquireVsCodeApi(): VsCodeApi;

const vscode = acquireVsCodeApi();

// Type-safe message sender
export function sendMessage<T extends WebviewToHostMessage>(message: T): void {
    vscode.postMessage(message);
}

// Type-safe message listener with discriminated union
export function onMessage(callback: (message: HostToWebviewMessage) => void): () => void {
    const handler = (event: MessageEvent<HostToWebviewMessage>) => {
        const message = event.data;
        callback(message);
    };

    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
}

// Usage in React component:
import { sendMessage, onMessage } from './messaging/api';

function LoginView() {
    const handleLogin = (username: string, password: string) => {
        // TypeScript enforces correct message shape
        sendMessage({
            command: 'login',
            username,
            password,
            serverUrl: 'https://artemis.example.com'
        });
    };

    useEffect(() => {
        const unsubscribe = onMessage((message) => {
            // TypeScript narrows type based on command
            if (message.command === 'loginSuccess') {
                console.log('Logged in as', message.user.username);
            }
        });
        return unsubscribe;
    }, []);
}
```

### Pattern 3: State-Based Routing Without URLs

**What:** Use component state to determine which view to render rather than URL-based routing (React Router). The extension host controls view state via messages.

**When to use:** Always in VS Code webviews (no meaningful URLs in iframes).

**Trade-offs:**
- **Pro**: Simpler than URL routing, no history management needed
- **Pro**: Extension host has full control over navigation
- **Pro**: No router library dependency (smaller bundle)
- **Con**: No browser back/forward buttons (acceptable in VS Code context)
- **Con**: Deep linking not possible (not needed in VS Code)

**Example:**

```typescript
// src/views/webview/apps/main/store/viewStore.ts (Browser)
import { create } from 'zustand';

export type ViewType =
    | 'login'
    | 'dashboard'
    | 'courseList'
    | 'courseDetail'
    | 'exerciseDetail'
    | 'examExerciseDetail';

interface ViewState {
    currentView: ViewType;
    courseId?: number;
    exerciseId?: number;
    examContext?: ExamContext;
}

interface ViewStore extends ViewState {
    setView: (view: ViewType, params?: Partial<ViewState>) => void;
}

export const useViewStore = create<ViewStore>((set) => ({
    currentView: 'login',
    setView: (view, params = {}) => set({ currentView: view, ...params }),
}));

// src/views/webview/apps/main/App.tsx (Browser)
import { useViewStore } from './store/viewStore';
import { LoginView } from './views/LoginView';
import { DashboardView } from './views/DashboardView';
import { CourseDetailView } from './views/CourseDetailView';
import { ExerciseDetailView } from './views/ExerciseDetailView';

export function App() {
    const currentView = useViewStore((state) => state.currentView);

    // State-based routing - simple switch statement
    switch (currentView) {
        case 'login':
            return <LoginView />;
        case 'dashboard':
            return <DashboardView />;
        case 'courseList':
            return <CourseListView />;
        case 'courseDetail':
            return <CourseDetailView />;
        case 'exerciseDetail':
            return <ExerciseDetailView />;
        case 'examExerciseDetail':
            return <ExamExerciseDetailView />;
        default:
            return <LoginView />;
    }
}

// Message handler triggers state changes
useEffect(() => {
    const unsubscribe = onMessage((message) => {
        if (message.command === 'loginSuccess') {
            useViewStore.getState().setView('dashboard');
        } else if (message.command === 'showCourseDetail') {
            useViewStore.getState().setView('courseDetail', {
                courseId: message.courseId
            });
        }
    });
    return unsubscribe;
}, []);
```

### Pattern 4: Shared Component Extraction with Composition

**What:** Extract common UI elements between ExerciseDetail and ExamExerciseDetail into shared React components with composition patterns.

**When to use:** When two views share significant UI structure but differ in context (exam vs. regular exercise).

**Trade-offs:**
- **Pro**: Single source of truth for shared components (no duplication)
- **Pro**: Changes to shared UI automatically apply to all consumers
- **Pro**: Better testability (test component once, use everywhere)
- **Con**: Over-abstraction can make components hard to understand
- **Con**: Props explosion if not carefully designed

**Example:**

```typescript
// src/views/webview/components/ExerciseHeader/ExerciseHeader.tsx
interface ExerciseHeaderProps {
    title: string;
    type: string;
    dueDate?: string;
    isExam?: boolean;
    examTimeRemaining?: string;
    onBack: () => void;
    onFullscreen?: () => void;
}

export function ExerciseHeader({
    title,
    type,
    dueDate,
    isExam = false,
    examTimeRemaining,
    onBack,
    onFullscreen
}: ExerciseHeaderProps) {
    return (
        <div className="exercise-header">
            <BackLink onClick={onBack} label={isExam ? "Back to Exam" : "Back to Course"} />
            <div className="exercise-title-row">
                <Badge variant={type}>{type}</Badge>
                <h1>{title}</h1>
                {onFullscreen && <FullscreenButton onClick={onFullscreen} />}
            </div>
            {isExam && examTimeRemaining && (
                <div className="exam-timer">Time Remaining: {examTimeRemaining}</div>
            )}
            {!isExam && dueDate && (
                <div className="due-date">Due: {formatDate(dueDate)}</div>
            )}
        </div>
    );
}

// src/views/webview/components/SubmissionStatus/SubmissionStatus.tsx
interface SubmissionStatusProps {
    participation: Participation;
    latestResult?: Result;
    buildInProgress?: boolean;
}

export function SubmissionStatus({
    participation,
    latestResult,
    buildInProgress
}: SubmissionStatusProps) {
    if (buildInProgress) {
        return <BuildProgress />;
    }

    if (!latestResult) {
        return <NoSubmissionYet />;
    }

    return (
        <div className="submission-status">
            <ResultBadge result={latestResult} />
            <SubmissionDetails result={latestResult} />
            <FeedbackList feedbacks={latestResult.feedbacks} />
        </div>
    );
}

// Usage in ExerciseDetailView.tsx
export function ExerciseDetailView({ exerciseData }: Props) {
    const { sendMessage } = useMessaging();

    return (
        <div className="exercise-detail">
            <ExerciseHeader
                title={exerciseData.exercise.title}
                type={exerciseData.exercise.type}
                dueDate={exerciseData.exercise.dueDate}
                onBack={() => sendMessage({ command: 'backToCourseDetails' })}
                onFullscreen={() => sendMessage({
                    command: 'openFullscreen',
                    exerciseId: exerciseData.exercise.id
                })}
            />
            <SubmissionStatus
                participation={exerciseData.participation}
                latestResult={exerciseData.latestResult}
            />
            {/* Rest of exercise-specific UI */}
        </div>
    );
}

// Usage in ExamExerciseDetailView.tsx
export function ExamExerciseDetailView({ exerciseData, examContext }: Props) {
    const { sendMessage } = useMessaging();

    return (
        <div className="exam-exercise-detail">
            <ExerciseHeader
                title={exerciseData.exercise.title}
                type={exerciseData.exercise.type}
                isExam={true}
                examTimeRemaining={examContext.timeRemaining}
                onBack={() => sendMessage({ command: 'backToExam' })}
                // No fullscreen in exam mode
            />
            <SubmissionStatus
                participation={exerciseData.participation}
                latestResult={exerciseData.latestResult}
            />
            {/* Exam-specific UI differences */}
        </div>
    );
}
```

## Data Flow

### Request Flow (User Action → Extension Host → Backend)

```
[User clicks "Clone Repository"]
    ↓
[React Component] → calls sendMessage({ command: 'cloneRepository', ... })
    ↓
[postMessage API] → serializes and sends to extension host
    ↓
[WebviewProvider.onDidReceiveMessage()] → receives message
    ↓
[WebViewMessageHandler] → routes based on message.command
    ↓
[RepositoryCommandModule] → handles 'cloneRepository' command
    ↓
[Git Service] → executes git clone
    ↓
[Response] ← success/error
    ↓
[WebviewProvider] ← webview.postMessage({ command: 'repositoryCloned', ... })
    ↓
[React Message Listener] ← receives confirmation
    ↓
[State Update] ← React state updated
    ↓
[UI Re-render] ← Component shows "Cloned successfully"
```

### State Management (Extension Host Controls View State)

```
Extension Host State (AppStateManager)
    ↓ (on state change)
[webview.postMessage({ command: 'updateView', view: 'exerciseDetail', data: {...} })]
    ↓
React App Message Listener
    ↓
Zustand Store Update (or Context update)
    ↓
useViewStore() hook triggers
    ↓
Component Re-renders with New View
```

### Real-time Update Flow (WebSocket → UI)

```
[Artemis Server] → sends submission result via WebSocket
    ↓
[ArtemisWebsocketService] (Node.js) → receives message
    ↓
[WebviewProvider._handleNewResult()] → processes result
    ↓
[webview.postMessage({ command: 'newResult', result: {...} })]
    ↓
[React Message Listener] → receives result
    ↓
[Exercise Store] → updates cached exercise data
    ↓
[ExerciseDetailView] → re-renders with new result
    ↓
[SubmissionStatus Component] → shows updated score/feedback
```

### Key Data Flows

1. **Authentication Flow**: Login form → extension host → API → success → extension sends user info → React updates state → navigates to dashboard
2. **Navigation Flow**: User clicks course → React sends openCourse message → extension fetches course data → sends updateView message → React renders CourseDetailView
3. **Real-time Build Updates**: WebSocket receives build progress → extension forwards to webview → React updates build progress bar → no full page reload

## Build Pipeline Configuration

### esbuild Setup for Dual Targets

```javascript
// esbuild.js
const esbuild = require("esbuild");

async function main() {
    // Build 1: Extension host (Node.js, CJS)
    const extensionCtx = await esbuild.context({
        entryPoints: ['src/extension.ts'],
        bundle: true,
        format: 'cjs',
        platform: 'node',
        outfile: 'dist/extension.js',
        external: ['vscode'],
        minify: production,
        sourcemap: !production,
    });

    // Build 2: Main React app (Browser, IIFE)
    const mainWebviewCtx = await esbuild.context({
        entryPoints: ['src/views/webview/apps/main/index.tsx'],
        bundle: true,
        format: 'iife',
        platform: 'browser',
        outfile: 'dist/webview-main.js',
        jsx: 'automatic',  // React 17+ automatic JSX transform
        jsxDev: !production,
        minify: production,
        sourcemap: !production,
        loader: {
            '.tsx': 'tsx',
            '.ts': 'ts',
            '.css': 'css',
        },
    });

    // Build 3: Chat React app (Browser, IIFE)
    const chatWebviewCtx = await esbuild.context({
        entryPoints: ['src/views/webview/apps/chat/index.tsx'],
        bundle: true,
        format: 'iife',
        platform: 'browser',
        outfile: 'dist/webview-chat.js',
        jsx: 'automatic',
        jsxDev: !production,
        minify: production,
        sourcemap: !production,
    });

    if (watch) {
        await extensionCtx.watch();
        await mainWebviewCtx.watch();
        await chatWebviewCtx.watch();
    } else {
        await extensionCtx.rebuild();
        await mainWebviewCtx.rebuild();
        await chatWebviewCtx.rebuild();
        await extensionCtx.dispose();
        await mainWebviewCtx.dispose();
        await chatWebviewCtx.dispose();
    }
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});
```

### Key Build Considerations

| Concern | Solution |
|---------|----------|
| **Separate Node.js vs Browser code** | Three esbuild contexts with different `platform` settings |
| **React JSX transform** | `jsx: 'automatic'` for React 17+ (no need to import React) |
| **CSS bundling** | esbuild handles CSS with `loader: { '.css': 'css' }` or separate plugin |
| **Development speed** | `watch: true` for hot reload, `sourcemap: true` for debugging |
| **Bundle size** | `minify: true` in production, tree-shaking enabled by default |
| **VS Code CSP compliance** | Use `webview.asWebviewUri()` for script tags, no inline scripts/styles |

## Integration Points Between React and Extension Host

### Extension Host → React (Provider Responsibilities)

| Integration Point | Implementation | Notes |
|-------------------|----------------|-------|
| **Initial HTML** | Provider's `_getReactAppHtml()` returns minimal HTML with root div + script tag | CSP meta tag required, script URI must use `asWebviewUri()` |
| **Message sending** | `webview.postMessage(message)` with typed message contracts | Extension decides when to push state updates to webview |
| **State push** | Extension sends view changes via messages (e.g., `{ command: 'updateView', ... }`) | Extension host is source of truth for backend-derived state |
| **Resource URIs** | Extension provides webview with URIs for scripts, styles, images via `asWebviewUri()` | Required for CSP compliance |

### React → Extension Host (Webview Responsibilities)

| Integration Point | Implementation | Notes |
|-------------------|----------------|-------|
| **Message sending** | `vscode.postMessage(message)` via typed API wrapper | React app sends commands/requests, extension host handles them |
| **User actions** | Button clicks, form submits trigger messages to extension | All backend interactions go through extension host |
| **State queries** | Request current state via message if needed | Generally avoid - extension should push state proactively |

## Component Migration Strategy

### New Components Needed

| Component | Source | Purpose | Complexity |
|-----------|--------|---------|------------|
| **Button** | `buttonComponent.ts` → `Button.tsx` | Primary, secondary, icon, ghost button variants | Low |
| **Badge** | `badgeComponent.ts` → `Badge.tsx` | Status badges (success, warning, error) | Low |
| **BackLink** | `backLinkComponent.ts` → `BackLink.tsx` | Navigation back links with icon | Low |
| **Container** | `containerComponent.ts` → `Container.tsx` | Card-style containers with optional headers | Low |
| **ListItem** | `listItemComponent.ts` → `ListItem.tsx` | Clickable list items for courses/exercises | Medium |
| **ExerciseHeader** | Extracted from exerciseDetailView | Shared header for exercise/exam exercise views | Medium |
| **SubmissionStatus** | `submissionStatusComponent.ts` → `SubmissionStatus.tsx` | Shows latest submission result, score, feedback | High |
| **BuildProgress** | `buildProgressComponent.ts` → `BuildProgress.tsx` | Real-time build progress with WebSocket updates | High |
| **ParticipationActions** | `participationActionsComponent.ts` → `ParticipationActions.tsx` | Clone repo, submit, open workspace buttons | High |

### Modified Extension Components

| Component | Current State | Migration Change | Rationale |
|-----------|---------------|------------------|-----------|
| **ArtemisWebviewProvider** | Returns HTML string from ViewRouter | Returns minimal React mount HTML | Provider no longer generates views, just hosts React app |
| **ChatWebviewProvider** | Returns HTML string from IrisChatView | Returns minimal React mount HTML | Same as above |
| **ViewRouter** | Switch statement generating HTML strings | REMOVED | Replaced by React app's state-based routing |
| **AppStateManager** | Manages extension-side state | KEEP, modify message sending | Still manages extension state, but sends state updates via messages |
| **WebViewMessageHandler** | Routes messages to command modules | KEEP unchanged | Command modules remain Node.js-based, no change needed |
| **Command Modules** | Handle business logic (auth, nav, repo, etc.) | KEEP unchanged | Business logic stays in extension host |

### Data Flow Changes

| Flow | Before (HTML Strings) | After (React) |
|------|----------------------|---------------|
| **View rendering** | Provider calls ViewRouter.getHtml() → returns full HTML string → assigns to webview.html | Provider sets HTML once with React mount point → React app handles all view changes |
| **State updates** | AppStateManager changes → calls ViewRouter.getHtml() → full webview reload | AppStateManager changes → sends postMessage to webview → React state update → partial re-render |
| **User interaction** | Inline `<script>` in HTML → vscode.postMessage() → provider receives → handler processes | React component → sendMessage() → provider receives → handler processes (same) |
| **WebSocket updates** | Provider receives → webview.postMessage() → inline script updates DOM directly | Provider receives → webview.postMessage() → React message listener → state update → re-render |

## Build Order for Migration Phases

### Phase 1: Foundation (Week 1-2)
**Goal:** Set up React infrastructure without breaking existing views.

1. **Install dependencies**: `react`, `react-dom`, `@types/react`, `zustand` (or chosen state lib)
2. **Configure esbuild**: Add webview build targets with `jsx: 'automatic'`, `platform: 'browser'`
3. **Create project structure**: `src/views/webview/apps/`, `components/`, `shared/`
4. **Define message contracts**: Create `shared/types.ts` with all message discriminated unions
5. **Create messaging API**: Typed `sendMessage()` and `onMessage()` wrappers
6. **Test build pipeline**: Ensure both extension.js and webview-main.js compile successfully

**Validation:** Extension still works with old views, new React files compile.

### Phase 2: Shared Components (Week 2-3)
**Goal:** Port existing UI components to React.

**Order** (simple → complex, most reused first):
1. **Button** (used everywhere, simple)
2. **Badge** (used everywhere, simple)
3. **BackLink** (simple)
4. **Container** (medium, used widely)
5. **ListItem** (medium, used in course/exercise lists)
6. **Input** (if exists, medium)
7. **Dropdown** (if exists, medium)

**Validation:** Each component has TypeScript props interface, matches existing visual design.

### Phase 3: Simple Views (Week 3-4)
**Goal:** Migrate standalone views with minimal dependencies.

**Order** (least state → most state):
1. **LoginView** (minimal state, good test case)
2. **ServiceStatusView** (simple, read-only)
3. **GitCredentialsView** (simple form)
4. **RecommendedExtensionsView** (list view, no backend state)

**Validation:** Each view works in React app, can switch between views, messages work.

### Phase 4: Main UI Views (Week 4-6)
**Goal:** Migrate core application views.

**Order** (dependency order):
1. **DashboardView** (landing page after login)
2. **CourseListView** (depends on dashboard navigation)
3. **CourseDetailView** (depends on course list, shows exercises)
4. **ExerciseDetailView** (complex, depends on course detail)
5. **ExamExerciseDetailView** (reuses ExerciseDetail components, different context)

**Validation:** Full navigation flow works, real-time updates work, WebSocket integration works.

### Phase 5: Chat UI (Week 6-7)
**Goal:** Migrate Iris chat webview to React.

**Dependencies:**
- Chat has separate state management (session, context, messages)
- Streaming message rendering must be smooth
- File monitoring integration required

**Order:**
1. **IrisChatView** layout and shell
2. **Context picker** (exercise/course selection)
3. **Message list** with streaming
4. **Session management** (create, switch, delete)

**Validation:** Chat works smoothly, no flicker on message streaming, context switching works.

### Phase 6: Exam Views (Week 7-8)
**Goal:** Migrate exam-related views (time-sensitive).

**Order:**
1. **ExamStartView** (simple, starts exam)
2. **ExamConductionView** (complex, timer, navigation)
3. **ExamExerciseDetailView** (already done in Phase 4, integrate with exam context)

**Critical:** Exam timer must be accurate, no regressions in time tracking.

**Validation:** Timer counts down correctly, submission deadlines enforced, no time drift.

### Phase 7: Cleanup (Week 8)
**Goal:** Remove legacy code, optimize bundles.

1. **Remove old view generators** (exerciseDetailView.ts, courseDetailView.ts, etc.)
2. **Remove ViewRouter** (replaced by React routing)
3. **Remove unused CSS** (now in React components)
4. **Remove old webview/components.ts** (legacy string component system)
5. **Optimize bundle**: Tree-shaking analysis, code splitting if needed
6. **Update documentation**: Reflect new React architecture

**Validation:** Extension still works, smaller bundle size, no dead code warnings.

## Anti-Patterns

### Anti-Pattern 1: Using React Router for Webview Navigation

**What people do:** Install `react-router-dom` and use URL-based routing in the webview.

**Why it's wrong:** VS Code webviews don't have meaningful URLs (they're iframes). URL changes don't persist, back/forward buttons don't work as expected, and it adds unnecessary bundle size.

**Do this instead:** Use state-based routing with a view store (Zustand/Context) where the extension host controls view state via messages.

### Anti-Pattern 2: Fetching Data Directly from React Components

**What people do:** Use `fetch()` or axios in React components to call backend APIs directly.

**Why it's wrong:** Violates VS Code extension architecture. Webviews run in a sandboxed iframe with CSP restrictions. All backend communication must go through the extension host, which has access to Node.js APIs, authentication, and the Artemis API.

**Do this instead:** React components send messages to extension host, extension host handles API calls, extension host sends results back via postMessage.

### Anti-Pattern 3: Full Webview Reloads on State Changes

**What people do:** On every state change, regenerate full HTML and assign to `webview.html`.

**Why it's wrong:** Destroys webview DOM, loses scroll position, disrupts user input, breaks real-time updates, and causes flicker. This is what the current HTML string approach does.

**Do this instead:** Set webview HTML once on creation (React mount point), then use postMessage to update React state, which triggers surgical re-renders of only changed components.

### Anti-Pattern 4: Inline Scripts and Styles in HTML

**What people do:** Embed `<script>` and `<style>` tags directly in the HTML string with inline JavaScript.

**Why it's wrong:** Violates Content Security Policy (CSP). VS Code webviews require `script-src` to reference external files via `asWebviewUri()`, not inline scripts.

**Do this instead:** Use external bundled JavaScript files loaded via `<script src="${scriptUri}">` where `scriptUri` is created with `webview.asWebviewUri()`.

### Anti-Pattern 5: Duplicating Component Logic Between ExerciseDetail and ExamExerciseDetail

**What people do:** Copy-paste entire view components for similar views (e.g., regular exercise vs. exam exercise), maintaining two versions of the same UI.

**Why it's wrong:** Changes to shared UI require editing two places, bugs get fixed in one but not the other, tests must cover both versions.

**Do this instead:** Extract shared components (ExerciseHeader, SubmissionStatus, etc.) and compose them with variant props (`isExam`, `examContext`).

### Anti-Pattern 6: Mixing Extension Host and Webview Code

**What people do:** Import Node.js modules (`fs`, `path`, `vscode`) in React components or mix browser APIs in extension host code.

**Why it's wrong:** Build fails or runtime errors. Extension host is Node.js (has `vscode` API, file system), webview is browser sandbox (no Node.js APIs).

**Do this instead:** Strict separation. Extension host code in `src/provider/`, `src/services/`. Webview code in `src/views/webview/`. Use shared types in `src/views/webview/shared/types.ts`.

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| **0-20 views (current)** | Single React app per provider, state-based routing, Zustand/Context for state. Keep it simple. |
| **20-50 views** | Consider code splitting with React.lazy() for large views. Separate state stores for different domains (courses vs. exercises vs. chat). |
| **50+ views** | Module federation or micro-frontends if views become independently deployable. Unlikely for this extension. |

### Scaling Priorities

1. **First bottleneck: Initial load time** → Code split large views (exam conduction, exercise detail) with `React.lazy()` and `Suspense`. Measure with esbuild's metafile analyzer.

2. **Second bottleneck: Message latency** → If messages become slow, batch state updates (e.g., send one "updateMultipleExercises" message instead of N "updateExercise" messages). Use message queuing if needed.

3. **Third bottleneck: State complexity** → If Zustand store becomes unwieldy, split into domain stores (coursesStore, exercisesStore, authStore) and use selector hooks to prevent unnecessary re-renders.

## Sources

### VS Code Extension Architecture
- [Webview API | Visual Studio Code Extension API](https://code.visualstudio.com/api/extension-guides/webview)
- [How to Build a VS Code Extension using React Webviews](https://medium.com/snowflake/how-to-build-a-vs-code-extension-using-react-webviews-0e2481ce1ba2)
- [Reactception: extending a VS Code extension with Webviews and React](https://medium.com/younited-tech-blog/reactception-extending-vs-code-extension-with-webviews-and-react-12be2a5898fd)

### Build Configuration
- [Using React in Visual Studio Code Webviews - Ken Muse](https://www.kenmuse.com/blog/using-react-in-vs-code-webviews/)
- [Create advanced VSCode extension w/ React webview, esbuild bundler](https://medium.com/@aga1laoui/create-advanced-vscode-extension-w-react-webview-esbuild-bundler-eslint-airbnb-and-prettier-2ba2e3893667)
- [GitHub - githubnext/vscode-react-webviews](https://github.com/githubnext/vscode-react-webviews)
- [esbuild - Getting Started](https://esbuild.github.io/getting-started/)

### Typed Message Contracts
- [Simplify Visual Studio Code extension webview communication](https://www.eliostruyf.com/simplify-communication-visual-studio-code-extension-webview/)
- [Typed Async postMessage: Iframes & React Native](https://medium.com/@dm_borisov/say-goodbye-to-untyped-communication-between-windows-iframes-and-react-native-webviews-6b8f5f826a4d)
- [A pattern for strongly-typed IFrame messaging](https://www.nickwhite.cc/blog/strongly-typed-iframe-messaging/)

### State-Based Routing
- [React Routing without Router](https://rixong.medium.com/react-routing-without-router-e8db7052a1e)
- [React: Navigation Without React-Router](https://ncoughlin.com/posts/react-navigation-without-react-router)
- [You might not need React Router](https://www.freecodecamp.org/news/you-might-not-need-react-router-38673620f3d/)

### UI Components & Styling
- [GitHub Next | React Webview UI Toolkit for VS Code](https://githubnext.com/projects/react-webview-ui-toolkit/)
- [GitHub - microsoft/vscode-webview-ui-toolkit](https://github.com/microsoft/vscode-webview-ui-toolkit)

---
*Architecture research for: VS Code Extension React Webview Migration*
*Researched: 2026-02-23*
