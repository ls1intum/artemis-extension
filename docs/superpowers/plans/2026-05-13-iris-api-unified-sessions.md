# Iris API Migration to Unified Sessions — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the artemis-extension Iris API client to Artemis develop after PR #12504 unified the per-context chat session endpoints into one mode-aware surface.

**Architecture:** Three layers — strict DTO types, three thin HTTP primitives in `ArtemisApiService`, and a composition layer in `sessionSyncUtils` that orchestrates overview → filter → per-session messages. A shared `courseIdResolver` extracts the existing per-call-site resolution logic. The seven old per-context methods are deleted; all four callers (two service files, two test suites) migrate. End state: no reference to legacy URL patterns or method names anywhere under `extension/`.

**Tech Stack:** TypeScript, Mocha via `vscode-test --label unit` (tests are pre-compiled to `out/` by `npm run compile-tests`), sinon stubs, eslint, tsc.

**Spec:** `docs/superpowers/specs/2026-05-13-iris-api-unified-sessions-design.md` (commit `10b32d55`, codex-approved after 2 rounds).

**Conventions used throughout this plan:**
- All paths are repo-relative.
- `npm` scripts run inside `extension/` — every test command is `(cd extension && npm run compile-tests && npm run test:unit -- --grep "...")`. The `compile-tests` step is non-optional: `test:unit` executes compiled JS in `out/`, so skipping `compile-tests` runs stale code.
- `git` commands run from repo root. Never chain `git` after `cd extension`.
- Branch: `fix/iris-api-unified-sessions`. Small, atomic commits per task.

---

## File map

```
M  extension/src/shared/types/apiResponses.ts                                     (Task 1)
A  extension/src/extension/services/iris/context/contextChatMode.ts               (Task 2)
A  extension/test/unit/services/iris/context/contextChatMode.test.ts              (Task 2)
A  extension/src/extension/services/iris/context/courseIdResolver.ts              (Task 3)
A  extension/test/unit/services/iris/context/courseIdResolver.test.ts             (Task 3)
M  extension/src/extension/services/iris/chat/chatSessionService.ts               (Task 3, 5)
M  extension/src/extension/api/artemisApi.ts                                      (Task 4, 8)
M  extension/test/unit/api/artemisApi.test.ts                                     (Task 4, 8)
A  extension/test/unit/services/iris/context/sessionSyncUtils.test.ts             (Task 5)
M  extension/src/extension/services/iris/context/sessionSyncUtils.ts              (Task 5)
M  extension/src/extension/services/iris/chat/chatDiagnosticsService.ts           (Task 5)
M  extension/test/unit/services/chatSessionService.test.ts                        (Task 5)
M  extension/src/extension/services/iris/transport/irisWebSocketSessionClient.ts  (Task 6)
M  extension/test/unit/services/websocket.test.ts                                 (Task 6)
M  extension/test/e2e/uncommittedChanges.e2e.test.ts                              (Task 7)
M  CHANGELOG.md                                                                   (Task 9)
```

---

### Task 1: Add new TypeScript types

**Files:**
- Modify: `extension/src/shared/types/apiResponses.ts`

- [ ] **Step 1.1: Edit `extension/src/shared/types/apiResponses.ts`** — replace the `IrisChatSession` block (lines 113-119) with the following, and add the new sibling types directly below it:

```ts
export type IrisChatMode =
    | 'PROGRAMMING_EXERCISE_CHAT'
    | 'TEXT_EXERCISE_CHAT'
    | 'COURSE_CHAT'
    | 'LECTURE_CHAT';

/** Detail DTO returned by /api/iris/chat/sessions/current, /sessions, and /{courseId}/session/{sessionId}. */
export interface IrisChatSession {
    id: number;
    mode?: IrisChatMode;
    entityId?: number;
    userId?: number;
    title?: string;
    creationDate?: string;
    messages?: IrisChatMessage[];
    [key: string]: unknown;
}

/** Listing DTO returned by /api/iris/chat/{courseId}/sessions/overview. No messages. */
export interface IrisChatSessionSummary {
    id: number;
    entityId: number;
    entityName?: string;
    title?: string;
    creationDate: string;
    lastActivityDate?: string;
    mode: IrisChatMode;
    [key: string]: unknown;
}
```

- [ ] **Step 1.2: Run typecheck**

```bash
cd extension && npm run check-types
```

Expected: PASS. The change is additive (`mode`, `entityId`, `userId` are optional new fields; existing index signature already permitted them).

- [ ] **Step 1.3: Commit (from repo root)**

```bash
git add extension/src/shared/types/apiResponses.ts
git commit -m "feat(iris): add IrisChatMode and IrisChatSessionSummary types"
```

---

### Task 2: `contextChatMode` helper

**Files:**
- Create: `extension/src/extension/services/iris/context/contextChatMode.ts`
- Create: `extension/test/unit/services/iris/context/contextChatMode.test.ts`

- [ ] **Step 2.1: Ensure the new test directory exists**

```bash
mkdir -p extension/test/unit/services/iris/context
```

- [ ] **Step 2.2: Write the failing test** — create `extension/test/unit/services/iris/context/contextChatMode.test.ts`:

```ts
import * as assert from 'assert';
import { contextToIrisMode } from '../../../../../src/extension/services/iris/context/contextChatMode';

suite('contextToIrisMode', () => {
    test('maps course → COURSE_CHAT', () => {
        assert.strictEqual(contextToIrisMode('course'), 'COURSE_CHAT');
    });

    test('maps exercise → PROGRAMMING_EXERCISE_CHAT', () => {
        assert.strictEqual(contextToIrisMode('exercise'), 'PROGRAMMING_EXERCISE_CHAT');
    });
});
```

- [ ] **Step 2.3: Run compile + test, expect failure**

```bash
cd extension && npm run compile-tests && npm run test:unit -- --grep "contextToIrisMode"
```

Expected: FAIL at the `compile-tests` step with a "Cannot find module" error for `contextChatMode` (or, on systems that skip strict resolution, at the Mocha layer). Either failure mode is acceptable — it proves the module is absent.

- [ ] **Step 2.4: Create `extension/src/extension/services/iris/context/contextChatMode.ts`**:

```ts
import type { ChatContextType } from '../../../../shared/types/context';
import type { IrisChatMode } from '../../../../shared/types/apiResponses';

/**
 * Maps the extension's ChatContextType to the Artemis IrisChatMode enum
 * expected by the unified /api/iris/chat endpoints. Single source of truth.
 */
export function contextToIrisMode(type: ChatContextType): IrisChatMode {
    return type === 'course' ? 'COURSE_CHAT' : 'PROGRAMMING_EXERCISE_CHAT';
}
```

- [ ] **Step 2.5: Run compile + test, expect PASS**

```bash
cd extension && npm run compile-tests && npm run test:unit -- --grep "contextToIrisMode"
```

Expected: 2/2 passing.

- [ ] **Step 2.6: Commit**

```bash
git add extension/src/extension/services/iris/context/contextChatMode.ts \
        extension/test/unit/services/iris/context/contextChatMode.test.ts
git commit -m "feat(iris): add contextToIrisMode helper"
```

---

### Task 3: Extract `courseIdResolver`

Lift the existing private `resolveCourseIdForExercise` (chatSessionService.ts lines 103-129) into a shared module. Behavior preserved exactly so existing `IrisChatSessionService` tests keep passing.

**Files:**
- Create: `extension/src/extension/services/iris/context/courseIdResolver.ts`
- Create: `extension/test/unit/services/iris/context/courseIdResolver.test.ts`
- Modify: `extension/src/extension/services/iris/chat/chatSessionService.ts`

- [ ] **Step 3.1: Write the failing tests** — create `extension/test/unit/services/iris/context/courseIdResolver.test.ts`:

```ts
import * as assert from 'assert';
import * as sinon from 'sinon';
import { resolveCourseIdFromContext } from '../../../../../src/extension/services/iris/context/courseIdResolver';
import type { ActiveContext } from '../../../../../src/shared/types/context';

function makeContextStore(overrides: any = {}): any {
    return {
        getExerciseById: sinon.stub().returns(undefined),
        registerExercise: sinon.stub(),
        ...overrides,
    };
}

function makeApi(overrides: any = {}): any {
    return {
        getExerciseDetails: sinon.stub().rejects(new Error('not stubbed')),
        ...overrides,
    };
}

const courseContext: ActiveContext = {
    type: 'course', id: 42, title: 'C', source: 'user-selected', locked: false, selectedAt: 0,
};
const exerciseContext: ActiveContext = {
    type: 'exercise', id: 123, title: 'E', source: 'user-selected', locked: false, selectedAt: 0,
};

suite('resolveCourseIdFromContext', () => {
    test('course context returns its own id', async () => {
        const id = await resolveCourseIdFromContext(courseContext, makeContextStore(), makeApi());
        assert.strictEqual(id, 42);
    });

    test('exercise context with courseId returns it directly', async () => {
        const ctx = { ...exerciseContext, courseId: 7 };
        const id = await resolveCourseIdFromContext(ctx, makeContextStore(), makeApi());
        assert.strictEqual(id, 7);
    });

    test('falls back to contextStore when context has no courseId', async () => {
        const store = makeContextStore({
            getExerciseById: sinon.stub().withArgs(123).returns({ id: 123, title: 'E', courseId: 9 }),
        });
        const id = await resolveCourseIdFromContext(exerciseContext, store, makeApi());
        assert.strictEqual(id, 9);
    });

    test('falls back to getExerciseDetails and registers exercise on success', async () => {
        const store = makeContextStore();
        const api = makeApi({
            getExerciseDetails: sinon.stub().withArgs(123).resolves({ exercise: { course: { id: 11 } } }),
        });
        const id = await resolveCourseIdFromContext(exerciseContext, store, api);
        assert.strictEqual(id, 11);
        assert.ok((store.registerExercise as sinon.SinonStub).calledOnceWith(
            sinon.match({ id: 123, courseId: 11 }),
        ));
    });

    test('returns undefined when nothing resolves', async () => {
        const store = makeContextStore();
        const api = makeApi({ getExerciseDetails: sinon.stub().resolves({}) });
        const id = await resolveCourseIdFromContext(exerciseContext, store, api);
        assert.strictEqual(id, undefined);
    });

    test('returns undefined when getExerciseDetails throws', async () => {
        const store = makeContextStore();
        const api = makeApi({ getExerciseDetails: sinon.stub().rejects(new Error('boom')) });
        const id = await resolveCourseIdFromContext(exerciseContext, store, api);
        assert.strictEqual(id, undefined);
    });
});
```

- [ ] **Step 3.2: Run compile + tests, expect failure**

```bash
cd extension && npm run compile-tests && npm run test:unit -- --grep "resolveCourseIdFromContext"
```

Expected: FAIL — module missing.

- [ ] **Step 3.3: Create `extension/src/extension/services/iris/context/courseIdResolver.ts`**:

```ts
import type { ActiveContext } from '../../../../shared/types/context';
import { logger, LogCategory } from '../../loggingService';
import type { ArtemisApiService } from '../../../api';
import type { ContextStore } from './contextStore';

/**
 * Resolves the courseId for an ActiveContext, walking:
 *   1. context.courseId (or context.id when type === 'course')
 *   2. contextStore.getExerciseById(...).courseId
 *   3. api.getExerciseDetails(...).exercise.course.id (registers the exercise back into the store on success)
 *
 * Returns undefined if all three paths fail. Mirrors the legacy private
 * resolveCourseIdForExercise from chatSessionService.ts so behavior is preserved
 * across both the IrisChatSessionService and sessionSyncUtils call sites.
 */
export async function resolveCourseIdFromContext(
    context: ActiveContext,
    contextStore: ContextStore,
    api: ArtemisApiService | undefined,
): Promise<number | undefined> {
    if (context.type === 'course') {
        return context.id;
    }
    if (context.courseId) {
        return context.courseId;
    }
    const tracked = contextStore.getExerciseById(context.id);
    if (tracked?.courseId) {
        return tracked.courseId;
    }
    if (!api) {
        return undefined;
    }
    try {
        const details = await api.getExerciseDetails(context.id);
        const resolved = details?.exercise?.course?.id;
        if (resolved) {
            contextStore.registerExercise({
                id: context.id,
                title: context.title,
                shortName: context.shortName,
                courseId: resolved,
            });
        }
        return resolved;
    } catch (error) {
        logger.warn('Failed to resolve course from exercise details:', LogCategory.IRIS_CHAT, error);
        return undefined;
    }
}
```

- [ ] **Step 3.4: Run compile + tests, expect PASS**

```bash
cd extension && npm run compile-tests && npm run test:unit -- --grep "resolveCourseIdFromContext"
```

Expected: 6/6 passing.

- [ ] **Step 3.5: Delegate `chatSessionService.resolveCourseIdForExercise` to the shared helper** — in `extension/src/extension/services/iris/chat/chatSessionService.ts`:

  Add the import alongside other `../context/` imports near the top:

```ts
import { resolveCourseIdFromContext } from '../context/courseIdResolver';
```

  Replace the body of the private method (lines 103-129) with:

```ts
private async resolveCourseIdForExercise(context: ActiveContext): Promise<number | undefined> {
    return resolveCourseIdFromContext(context, this.deps.contextStore, this.deps.artemisApiService);
}
```

- [ ] **Step 3.6: Run compile + IrisChatSessionService suite, expect PASS**

```bash
cd extension && npm run compile-tests && npm run test:unit -- --grep "IrisChatSessionService"
```

Expected: all previously-passing tests still pass.

- [ ] **Step 3.7: Commit**

```bash
git add extension/src/extension/services/iris/context/courseIdResolver.ts \
        extension/test/unit/services/iris/context/courseIdResolver.test.ts \
        extension/src/extension/services/iris/chat/chatSessionService.ts
git commit -m "refactor(iris): extract resolveCourseIdFromContext into shared module"
```

---

### Task 4: Add new API primitives

Adds the three new methods to `ArtemisApiService` *alongside* the old ones. Old methods stay for now so callers and their tests keep building. Deletion is Task 8.

**Files:**
- Modify: `extension/src/extension/api/artemisApi.ts`
- Modify: `extension/test/unit/api/artemisApi.test.ts`

- [ ] **Step 4.1: Write the failing tests** — append the following three tests inside the `Artemis API Service` `suite(...)` block in `extension/test/unit/api/artemisApi.test.ts`:

```ts
test('should get current chat session via unified endpoint', async () => {
    const entityId = 42;
    global.fetch = async (url: any, options: any) => {
        assert.ok(url.includes('/api/iris/chat/sessions/current'));
        assert.ok(url.includes('mode=COURSE_CHAT'));
        assert.ok(url.includes(`entityId=${entityId}`));
        assert.strictEqual(options.method, 'POST');
        return { ok: true, status: 200, json: async () => ({ id: 123 }) } as any;
    };
    const session = await apiService.getCurrentChat('COURSE_CHAT', entityId);
    assert.strictEqual(session.id, 123);
});

test('should create chat session via unified endpoint', async () => {
    const entityId = 99;
    global.fetch = async (url: any, options: any) => {
        assert.ok(url.includes('/api/iris/chat/sessions'));
        assert.ok(!url.includes('/sessions/current'));
        assert.ok(url.includes('mode=PROGRAMMING_EXERCISE_CHAT'));
        assert.ok(url.includes(`entityId=${entityId}`));
        assert.strictEqual(options.method, 'POST');
        return { ok: true, status: 200, json: async () => ({ id: 7 }) } as any;
    };
    const session = await apiService.createChatSession('PROGRAMMING_EXERCISE_CHAT', entityId);
    assert.strictEqual(session.id, 7);
});

test('should list chat sessions for course via overview endpoint', async () => {
    const courseId = 5;
    const mockSummaries = [
        { id: 1, entityId: 5, mode: 'COURSE_CHAT', creationDate: '2026-05-13T00:00:00Z' },
        { id: 2, entityId: 123, mode: 'PROGRAMMING_EXERCISE_CHAT', creationDate: '2026-05-13T01:00:00Z' },
    ];
    global.fetch = async (url: any, options: any) => {
        assert.ok(url.includes(`/api/iris/chat/${courseId}/sessions/overview`));
        assert.ok(!options?.method || options.method === 'GET');
        return { ok: true, status: 200, json: async () => mockSummaries } as any;
    };
    const summaries = await apiService.listChatSessionsForCourse(courseId);
    assert.deepStrictEqual(summaries, mockSummaries);
});
```

- [ ] **Step 4.2: Run compile + tests, expect failure**

```bash
cd extension && npm run compile-tests && npm run test:unit -- --grep "unified endpoint|overview endpoint"
```

Expected: FAIL — methods don't exist.

- [ ] **Step 4.3: Add the three primitives** in `extension/src/extension/api/artemisApi.ts`. First, extend the type import line to include `IrisChatMode` and `IrisChatSessionSummary` from `apiResponses`. Then insert the new methods near the existing Iris block (just below `markMessageHelpful`):

```ts
// Unified Iris chat session endpoints (Artemis develop, PR #12504).
async getCurrentChat(mode: IrisChatMode, entityId: number): Promise<IrisChatSession> {
    const params = new URLSearchParams({ mode, entityId: String(entityId) });
    const response = await this.makeRequest(
        `/api/iris/chat/sessions/current?${params.toString()}`,
        { method: 'POST' },
    );
    return response.json() as Promise<IrisChatSession>;
}

async createChatSession(mode: IrisChatMode, entityId: number): Promise<IrisChatSession> {
    const params = new URLSearchParams({ mode, entityId: String(entityId) });
    const response = await this.makeRequest(
        `/api/iris/chat/sessions?${params.toString()}`,
        { method: 'POST' },
    );
    return response.json() as Promise<IrisChatSession>;
}

async listChatSessionsForCourse(courseId: number): Promise<IrisChatSessionSummary[]> {
    const response = await this.makeRequest(`/api/iris/chat/${courseId}/sessions/overview`);
    return response.json() as Promise<IrisChatSessionSummary[]>;
}
```

- [ ] **Step 4.4: Run compile + tests, expect PASS**

```bash
cd extension && npm run compile-tests && npm run test:unit -- --grep "unified endpoint|overview endpoint"
```

Expected: 3/3 passing.

  Also confirm the rest of the API suite still passes:

```bash
cd extension && npm run compile-tests && npm run test:unit -- --grep "Artemis API Service"
```

Expected: all previously-passing tests still pass.

- [ ] **Step 4.5: Commit**

```bash
git add extension/src/extension/api/artemisApi.ts \
        extension/test/unit/api/artemisApi.test.ts
git commit -m "feat(iris-api): add unified chat session primitives"
```

---

### Task 5: Rewrite `sessionSyncUtils` + migrate all consumers of the old composite

This task is intentionally larger than the others: the new function signature, production call sites, and the entire `chatSessionService.test.ts` stub set must all flip together to keep a green build. **Single commit at the end.**

**Files:**
- Create: `extension/test/unit/services/iris/context/sessionSyncUtils.test.ts`
- Modify: `extension/src/extension/services/iris/context/sessionSyncUtils.ts`
- Modify: `extension/src/extension/services/iris/chat/chatSessionService.ts` (caller at line 449)
- Modify: `extension/src/extension/services/iris/chat/chatDiagnosticsService.ts` (caller at line 134)
- Modify: `extension/test/unit/services/chatSessionService.test.ts` (~20 stubs migrated)

- [ ] **Step 5.1: Write the failing tests** — create `extension/test/unit/services/iris/context/sessionSyncUtils.test.ts`:

```ts
import * as assert from 'assert';
import * as sinon from 'sinon';
import { fetchSessionsWithMessages } from '../../../../../src/extension/services/iris/context/sessionSyncUtils';
import type { ActiveContext } from '../../../../../src/shared/types/context';

function makeApi(stubs: Partial<Record<string, sinon.SinonStub>> = {}): any {
    return {
        listChatSessionsForCourse: sinon.stub().resolves([]),
        getChatMessages: sinon.stub().resolves([]),
        getExerciseDetails: sinon.stub().rejects(new Error('not stubbed')),
        ...stubs,
    };
}

function makeStore(stubs: Partial<Record<string, sinon.SinonStub>> = {}): any {
    return {
        getExerciseById: sinon.stub().returns(undefined),
        registerExercise: sinon.stub(),
        ...stubs,
    };
}

const exerciseCtx: ActiveContext = {
    type: 'exercise', id: 123, courseId: 42, title: 'E', source: 'user-selected', locked: false, selectedAt: 0,
};
const courseCtx: ActiveContext = {
    type: 'course', id: 42, title: 'C', source: 'user-selected', locked: false, selectedAt: 0,
};

suite('fetchSessionsWithMessages', () => {
    test('filters summaries by mode + entityId before fetching messages', async () => {
        const summaries = [
            { id: 1, entityId: 42, mode: 'COURSE_CHAT',                creationDate: 't1' },
            { id: 2, entityId: 123, mode: 'PROGRAMMING_EXERCISE_CHAT', creationDate: 't2' },
            { id: 3, entityId: 999, mode: 'PROGRAMMING_EXERCISE_CHAT', creationDate: 't3' },
            { id: 4, entityId: 123, mode: 'LECTURE_CHAT',              creationDate: 't4' },
        ];
        const getChatMessages = sinon.stub().resolves([{ id: 100, sender: 'USER' }]);
        const api = makeApi({
            listChatSessionsForCourse: sinon.stub().withArgs(42).resolves(summaries),
            getChatMessages,
        });

        const result = await fetchSessionsWithMessages(api, makeStore(), exerciseCtx);

        assert.strictEqual(result.length, 1);
        assert.strictEqual(result[0].id, 2);
        assert.ok(getChatMessages.calledOnceWith(2));
        assert.ok(getChatMessages.neverCalledWith(1));
        assert.ok(getChatMessages.neverCalledWith(3));
        assert.ok(getChatMessages.neverCalledWith(4));
    });

    test('course context uses its own id as courseId and filters by COURSE_CHAT', async () => {
        const summaries = [
            { id: 10, entityId: 42, mode: 'COURSE_CHAT',                creationDate: 't1' },
            { id: 11, entityId: 7,  mode: 'PROGRAMMING_EXERCISE_CHAT', creationDate: 't2' },
        ];
        const listStub = sinon.stub().resolves(summaries);
        const api = makeApi({ listChatSessionsForCourse: listStub });

        const result = await fetchSessionsWithMessages(api, makeStore(), courseCtx);

        assert.ok(listStub.calledOnceWith(42));
        assert.strictEqual(result.length, 1);
        assert.strictEqual(result[0].id, 10);
    });

    test('resolves courseId from contextStore when context.courseId is missing', async () => {
        const ctx: ActiveContext = { ...exerciseCtx, courseId: undefined };
        const listStub = sinon.stub().resolves([]);
        const store = makeStore({
            getExerciseById: sinon.stub().withArgs(123).returns({ id: 123, title: 'E', courseId: 77 }),
        });
        const api = makeApi({ listChatSessionsForCourse: listStub });

        await fetchSessionsWithMessages(api, store, ctx);

        assert.ok(listStub.calledOnceWith(77));
    });

    test('returns [] when courseId is fully unresolvable', async () => {
        const ctx: ActiveContext = { ...exerciseCtx, courseId: undefined };
        const listStub = sinon.stub().resolves([]);
        const api = makeApi({
            listChatSessionsForCourse: listStub,
            getExerciseDetails: sinon.stub().resolves({}),
        });

        const result = await fetchSessionsWithMessages(api, makeStore(), ctx);

        assert.deepStrictEqual(result, []);
        assert.ok(listStub.notCalled);
    });

    test('per-session fetch failure yields a session with empty messages', async () => {
        const summaries = [
            { id: 1, entityId: 123, mode: 'PROGRAMMING_EXERCISE_CHAT', creationDate: 't1' },
            { id: 2, entityId: 123, mode: 'PROGRAMMING_EXERCISE_CHAT', creationDate: 't2' },
        ];
        const getChatMessages = sinon.stub();
        getChatMessages.withArgs(1).rejects(new Error('boom'));
        getChatMessages.withArgs(2).resolves([{ id: 999, sender: 'USER' }]);
        const api = makeApi({
            listChatSessionsForCourse: sinon.stub().resolves(summaries),
            getChatMessages,
        });

        const result = await fetchSessionsWithMessages(api, makeStore(), exerciseCtx);

        assert.strictEqual(result.length, 2);
        assert.deepStrictEqual(result.find(s => s.id === 1)?.messages, []);
        assert.strictEqual(result.find(s => s.id === 2)?.messages?.length, 1);
    });
});
```

- [ ] **Step 5.2: Run compile + sessionSyncUtils tests, expect failure**

```bash
cd extension && npm run compile-tests && npm run test:unit -- --grep "fetchSessionsWithMessages"
```

Expected: FAIL — the new signature isn't implemented (or, more precisely, the current `(api, context)` function is called with three args).

- [ ] **Step 5.3: Rewrite `extension/src/extension/services/iris/context/sessionSyncUtils.ts`** — replace the file contents with:

```ts
import { ArtemisApiService } from '../../../api';
import { ContextStore } from './contextStore';
import { contextToIrisMode } from './contextChatMode';
import { resolveCourseIdFromContext } from './courseIdResolver';
import { extractIrisMessageContent } from '../chat/messageUtils';
import { logger, LogCategory } from '../../loggingService';
import type { ActiveContext, IrisChatSession, IrisChatMessage } from '../../../types';
import type { ExtensionToWebviewMessage } from '../../../../shared/messageContracts';

/**
 * Shared dependency bag for Iris services. Bundles common params so
 * constructors stay short and wiring is DRY.
 */
export interface IrisServiceDeps {
    contextStore: ContextStore;
    artemisApiService: ArtemisApiService | undefined;
    postMessage: (message: ExtensionToWebviewMessage) => void;
    postSnapshot: () => void;
}

/**
 * Lists Iris chat sessions for the given context and hydrates each with messages.
 *
 * The unified /api/iris/chat/{courseId}/sessions/overview endpoint returns
 * lightweight summaries across all modes for the course. We filter to the
 * relevant mode + entityId before fanning out to /api/iris/sessions/{id}/messages
 * so unrelated sessions are never fetched.
 */
export async function fetchSessionsWithMessages(
    api: ArtemisApiService,
    contextStore: ContextStore,
    context: ActiveContext,
): Promise<IrisChatSession[]> {
    const courseId = await resolveCourseIdFromContext(context, contextStore, api);
    if (courseId === undefined) {
        logger.warn(
            `Cannot list sessions: unable to resolve courseId for context ${context.type}:${context.id}`,
            LogCategory.IRIS_CHAT,
        );
        return [];
    }
    const mode = contextToIrisMode(context.type);
    const summaries = await api.listChatSessionsForCourse(courseId);
    const filtered = summaries.filter(s => s.mode === mode && s.entityId === context.id);

    return Promise.all(filtered.map(async (summary) => {
        const base = {
            id: summary.id,
            title: summary.title,
            creationDate: summary.creationDate,
            mode: summary.mode,
            entityId: summary.entityId,
        };
        try {
            const messages = await api.getChatMessages(summary.id);
            return { ...base, messages };
        } catch (error) {
            logger.warn(
                `Failed to fetch messages for session ${summary.id}: ${error}`,
                LogCategory.API,
            );
            return { ...base, messages: [] };
        }
    }));
}

/**
 * Sorts sessions newest-first, extracts preview from first user message,
 * and imports each session into the context store.
 *
 * Returns the number of sessions actually imported. Empty server sessions
 * (no messages) are skipped — callers rely on this count to decide whether
 * to fall back to creating a fresh session.
 *
 * NOTE: createSessionWithDetails() prepends sessions. Since we iterate
 * newest-first and prepend each time, the stored array ends up oldest-first.
 * Existing behavior, preserved intentionally.
 */
export function importSessionsToStore(
    sessions: IrisChatSession[],
    contextStore: ContextStore,
): number {
    if (sessions.length === 0) {
        return 0;
    }

    sessions.sort((a, b) => {
        const timeA = a.creationDate ? new Date(a.creationDate).getTime() : 0;
        const timeB = b.creationDate ? new Date(b.creationDate).getTime() : 0;
        return timeB - timeA;
    });

    let imported = 0;
    for (const session of sessions) {
        const messageCount = session.messages?.length || 0;
        if (messageCount === 0) {
            continue;
        }

        const createdAt = session.creationDate ? new Date(session.creationDate).getTime() : Date.now();

        let preview = 'New conversation';
        if (session.messages && session.messages.length > 0) {
            const firstUserMsg = session.messages.find((m: IrisChatMessage) => m.sender === 'USER');
            if (firstUserMsg) {
                const content = extractIrisMessageContent(firstUserMsg.content);
                if (content && content !== 'undefined' && content !== 'null') {
                    preview = content.substring(0, 50);
                }
            }
        }

        logger.info(`Importing session ${session.id}: ${messageCount} messages, preview: "${preview}"`, LogCategory.IRIS_CHAT);

        contextStore.createSessionWithDetails(
            preview,
            messageCount,
            createdAt,
            session.id,
            session.messages || [],
            typeof session.title === 'string' ? session.title : undefined,
        );
        imported++;
    }

    return imported;
}
```

- [ ] **Step 5.4: Update the two production call sites**

  In `extension/src/extension/services/iris/chat/chatSessionService.ts:449`:

```ts
const sessions = await fetchSessionsWithMessages(this.deps.artemisApiService!, this.deps.contextStore, targetContext);
```

  In `extension/src/extension/services/iris/chat/chatDiagnosticsService.ts:134`:

```ts
const artemisSessionsListFromServer = await fetchSessionsWithMessages(this._artemisApiService, this._contextStore, activeContext);
```

- [ ] **Step 5.5: Migrate every stub in `extension/test/unit/services/chatSessionService.test.ts`**

  The existing stubs target `getCourseChatSessionsWithMessages` / `getExerciseChatSessionsWithMessages` / `getExerciseChatSessions`. After Task 5.3, the internal path is `listChatSessionsForCourse` → filter → per-summary `getChatMessages`. Migrate per the patterns below.

  **Pattern A — replace a "with messages" stub:**

  Old:
  ```ts
  mockApiService.getCourseChatSessionsWithMessages.resolves([
      { id: 1, messages: [{ id: 100, sender: 'USER', content: [{ textContent: 'hi', type: 'text' }] }], creationDate: '2026-01-01' },
  ]);
  ```

  New:
  ```ts
  mockApiService.listChatSessionsForCourse.resolves([
      { id: 1, entityId: 101, mode: 'COURSE_CHAT', creationDate: '2026-01-01' },
  ]);
  mockApiService.getChatMessages.withArgs(1).resolves([
      { id: 100, sender: 'USER', content: [{ textContent: 'hi', type: 'text' }] },
  ]);
  ```

  For exercise contexts use `mode: 'PROGRAMMING_EXERCISE_CHAT'` and `entityId: <exercise id, typically 123>`. Make sure the `ActiveContext` fixture sets `courseId` so the resolver succeeds (e.g. `{ type: 'exercise', id: 123, courseId: 42, ... }`).

  **Pattern B — assertion fixes:**

  - `mockApiService.getCourseChatSessionsWithMessages.calledOnceWith(courseId)` → `mockApiService.listChatSessionsForCourse.calledOnceWith(courseId)`.
  - `mockApiService.getExerciseChatSessionsWithMessages.calledOnceWith(exerciseId)` → `mockApiService.listChatSessionsForCourse.calledOnceWith(courseId)`. Note: the new method takes **courseId**, not exerciseId — drop the exerciseId assertion or replace with `entityId` checks on the summary returned.
  - `mockApiService.getExerciseChatSessions.notCalled` → drop (covered by `listChatSessionsForCourse.notCalled`).
  - `mockApiService.getCourseChatSessionsWithMessages.notCalled` → `mockApiService.listChatSessionsForCourse.notCalled`.

  **Pattern C — rejection / fake / multiple-call semantics:**

  - `mockApiService.getCourseChatSessionsWithMessages.rejects(...)` → `mockApiService.listChatSessionsForCourse.rejects(...)`.
  - `mockApiService.getCourseChatSessionsWithMessages.callsFake(async () => {...})` → `mockApiService.listChatSessionsForCourse.callsFake(...)`.

  **Pattern D — dual `getChatMessages` semantics (important):**

  In the new code path, `getChatMessages` is called twice per session: once during the import phase (inside `fetchSessionsWithMessages`) and again later during active-session hydration. Tests that previously distinguished those phases via different mock methods must now distinguish via call order.

  Specifically, around `chatSessionService.test.ts:810`, `'emits LoadMessagesError after posting snapshot so the webview accepts the error'` expects the LATER fetch to fail. A naive `getChatMessages.rejects(...)` would now cause the IMPORT phase to swallow the failure, the test never reaches `LoadMessagesError`. Use call-order discrimination:

  ```ts
  const failingSessionFetch = mockApiService.getChatMessages.withArgs(<sessionId>);
  failingSessionFetch.onFirstCall().resolves([
      { id: 999, sender: 'USER', content: [{ textContent: 'previous turn', type: 'text' }] },
  ]);
  failingSessionFetch.onSecondCall().rejects(new Error('Server error during hydration'));
  ```

  The first call satisfies the import phase (so the session gets imported as expected). The second call is the active-session hydration that the test is actually asserting against.

  Apply the same `onFirstCall()/onSecondCall()` pattern to any test that previously assumed the import returned messages but later hydration failed (or vice versa). Around line 685 (the `LoadMessages` success path) the import returns messages and the hydration also returns messages — there `withArgs(id).resolves([...])` is sufficient because both calls get the same answer.

- [ ] **Step 5.6: Compile + run all affected suites, expect PASS**

```bash
cd extension && npm run compile-tests && npm run test:unit -- --grep "fetchSessionsWithMessages|IrisChatSessionService"
```

Expected: all tests pass (5 new + the entire IrisChatSessionService suite).

- [ ] **Step 5.7: Commit (single atomic commit covering all four files)**

```bash
git add extension/test/unit/services/iris/context/sessionSyncUtils.test.ts \
        extension/src/extension/services/iris/context/sessionSyncUtils.ts \
        extension/src/extension/services/iris/chat/chatSessionService.ts \
        extension/src/extension/services/iris/chat/chatDiagnosticsService.ts \
        extension/test/unit/services/chatSessionService.test.ts
git commit -m "refactor(iris): orchestrate sessions via unified overview + per-session messages"
```

---

### Task 6: Migrate `irisWebSocketSessionClient` + its tests

**Files:**
- Modify: `extension/src/extension/services/iris/transport/irisWebSocketSessionClient.ts`
- Modify: `extension/test/unit/services/websocket.test.ts`

- [ ] **Step 6.1: Update production code**

  In `extension/src/extension/services/iris/transport/irisWebSocketSessionClient.ts`, add at the top alongside other context-module imports:

```ts
import { contextToIrisMode } from '../context/contextChatMode';
```

  Replace the get-current branch (around lines 102-108):

  Old:
  ```ts
  if (context.type === 'course') {
      session = await this._artemisApiService.getCurrentCourseChat(context.id);
  } else if (context.type === 'exercise') {
      session = await this._artemisApiService.getCurrentExerciseChat(context.id);
  }
  ```

  New:
  ```ts
  const mode = contextToIrisMode(context.type);
  session = await this._artemisApiService.getCurrentChat(mode, context.id);
  ```

  Replace the create branch (around lines 121-128):

  Old:
  ```ts
  if (context.type === 'course') {
      newSession = await this._artemisApiService.createCourseChatSession(context.id);
  } else if (context.type === 'exercise') {
      newSession = await this._artemisApiService.createExerciseChatSession(context.id);
  }
  ```

  New (reuse `mode` from outer scope if available; otherwise recompute):
  ```ts
  const mode = contextToIrisMode(context.type);
  newSession = await this._artemisApiService.createChatSession(mode, context.id);
  ```

- [ ] **Step 6.2: Migrate test stubs in `extension/test/unit/services/websocket.test.ts`**

  Lines 539-540, 663-664, and 834 currently stub the old methods:

  Old (apply at every occurrence):
  ```ts
  apiService.getCurrentExerciseChat.resolves({ id: 123 });
  apiService.getCurrentCourseChat.resolves({ id: 456 });
  ```

  New:
  ```ts
  apiService.getCurrentChat
      .withArgs('PROGRAMMING_EXERCISE_CHAT', sinon.match.any).resolves({ id: 123 } as any);
  apiService.getCurrentChat
      .withArgs('COURSE_CHAT', sinon.match.any).resolves({ id: 456 } as any);
  ```

  And at line 665:

  Old:
  ```ts
  apiService.createExerciseChatSession.resolves({ id: 789 });
  ```

  New:
  ```ts
  apiService.createChatSession
      .withArgs('PROGRAMMING_EXERCISE_CHAT', sinon.match.any).resolves({ id: 789 } as any);
  ```

  (`as any` is acceptable because the old stubs already used `{ id: N }` without the full `IrisChatSession` shape; the production code only reads `.id`.)

- [ ] **Step 6.3: Compile + run affected suites, expect PASS**

```bash
cd extension && npm run compile-tests && npm run test:unit -- --grep "WebSocket|IrisWebSocketSessionClient"
```

Expected: all tests pass.

- [ ] **Step 6.4: Commit**

```bash
git add extension/src/extension/services/iris/transport/irisWebSocketSessionClient.ts \
        extension/test/unit/services/websocket.test.ts
git commit -m "refactor(iris): dispatch WebSocket session client via contextToIrisMode"
```

---

### Task 7: Migrate the e2e helper

The existing helper omits `method` on the current-session fetch (defaults to GET) — a latent bug masked by the old endpoint. The new endpoint is strictly `@PostMapping`. Both URLs become the unified form.

**Files:**
- Modify: `extension/test/e2e/uncommittedChanges.e2e.test.ts` (lines 133-160 area)

- [ ] **Step 7.1: Rewrite the `getOrCreateSession` helper body**

  Replace the function body with:

```ts
async getOrCreateSession(exerciseId: number): Promise<number | null> {
    logger.info(`[E2E] Getting/creating Iris session for exercise ${exerciseId}...`, LogCategory.TEST);

    const params = new URLSearchParams({
        mode: 'PROGRAMMING_EXERCISE_CHAT',
        entityId: String(exerciseId),
    });

    // Try to get current session
    let response = await fetch(
        `${this.baseUrl}/api/iris/chat/sessions/current?${params.toString()}`,
        { method: 'POST', headers: this.getHeaders() },
    );

    if (response.ok) {
        const data = await response.json() as { id: number };
        logger.info(`[E2E] Found existing session: ${data.id}`, LogCategory.TEST);
        return data.id;
    }

    // Create new session
    response = await fetch(
        `${this.baseUrl}/api/iris/chat/sessions?${params.toString()}`,
        { method: 'POST', headers: this.getHeaders() },
    );

    if (response.ok) {
        const data = await response.json() as { id: number };
        logger.info(`[E2E] Created new session: ${data.id}`, LogCategory.TEST);
        return data.id;
    }
    // Keep any existing tail of the function (return null / error log) unchanged.
}
```

  e2e is not part of `npm run test:unit` (it requires a live Artemis server). Typecheck is sufficient.

- [ ] **Step 7.2: Run typecheck**

```bash
cd extension && npm run check-types
```

Expected: PASS.

- [ ] **Step 7.3: Commit**

```bash
git add extension/test/e2e/uncommittedChanges.e2e.test.ts
git commit -m "test(e2e): point uncommittedChanges helper at unified Iris API"
```

---

### Task 8: Delete the seven old API methods and their tests

By this point every caller has been migrated. Old methods are dead weight.

**Files:**
- Modify: `extension/src/extension/api/artemisApi.ts`
- Modify: `extension/test/unit/api/artemisApi.test.ts`

- [ ] **Step 8.1: Delete the seven methods from `extension/src/extension/api/artemisApi.ts`**

  Remove (identify by name; each is a small block):

  - `getCurrentCourseChat`
  - `getCurrentExerciseChat`
  - `getExerciseChatSessions`
  - `getCourseChatSessionsWithMessages`
  - `getExerciseChatSessionsWithMessages`
  - `createCourseChatSession`
  - `createExerciseChatSession`

- [ ] **Step 8.2: Delete the corresponding test cases from `extension/test/unit/api/artemisApi.test.ts`**

  Remove the `test('should ...')` blocks whose fetch assertions reference `course-chat/`, `programming-exercise-chat/`, or `chat-history/`. After this, only the three new tests from Task 4 plus the unchanged message/setting tests remain in the Iris section.

- [ ] **Step 8.3: Run typecheck**

```bash
cd extension && npm run check-types
```

Expected: PASS. If a reference remains, fix the missed caller before continuing.

- [ ] **Step 8.4: Compile + run the full unit suite**

```bash
cd extension && npm run compile-tests && npm run test:unit
```

Expected: all tests pass.

- [ ] **Step 8.5: Commit**

```bash
git add extension/src/extension/api/artemisApi.ts \
        extension/test/unit/api/artemisApi.test.ts
git commit -m "refactor(iris-api): remove legacy per-context session methods"
```

---

### Task 9: Final acceptance + CHANGELOG + PR

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 9.1: Verify no legacy endpoint strings remain under `extension/`**

```bash
cd extension && ! grep -rn 'course-chat/\|programming-exercise-chat/\|chat-history/' src test
```

Expected: command exits 0 (the `!` flips a "no matches" exit-1 from `grep` into success). Any match means the command exits non-zero — investigate and fix before continuing.

- [ ] **Step 9.2: Verify no legacy method names remain under `extension/`**

```bash
cd extension && ! grep -rn 'getCurrentCourseChat\|getCurrentExerciseChat\|getExerciseChatSessions\|getCourseChatSessionsWithMessages\|getExerciseChatSessionsWithMessages\|createCourseChatSession\|createExerciseChatSession' src test
```

Expected: exits 0.

- [ ] **Step 9.3: Full quality gate — lint, typecheck, full unit suite, knip**

```bash
cd extension && npm run lint && npm run check-types && npm run compile-tests && npm run test:unit && npm run knip
```

Expected: all pass.

- [ ] **Step 9.4: Add CHANGELOG entry** — open `CHANGELOG.md` (repo root) and insert under `[Unreleased]`:

```
- **Iris API**: Adapted to Artemis PR #12504 (unified chat session endpoints). The
  extension now uses `/api/iris/chat/sessions{,/current}?mode=…&entityId=…` and
  `/api/iris/chat/{courseId}/sessions/overview` instead of the legacy per-context
  routes. Course resolution for exercise contexts is extracted into a shared helper.
```

- [ ] **Step 9.5: Commit**

```bash
git add CHANGELOG.md
git commit -m "chore(changelog): note Iris API migration to unified sessions"
```

- [ ] **Step 9.6: Push and open PR (from repo root)**

```bash
git push -u origin fix/iris-api-unified-sessions
gh pr create --base dev --title "fix(iris): adapt API client to unified session endpoints (Artemis #12504)" --body "$(cat <<'EOF'
## Summary

- Replaces 7 per-context Iris session methods with 3 unified primitives (`getCurrentChat`, `createChatSession`, `listChatSessionsForCourse`) targeting Artemis develop after [PR #12504](https://github.com/ls1intum/Artemis/pull/12504).
- Extracts `resolveCourseIdFromContext` and `contextToIrisMode` as shared helpers so both `IrisChatSessionService` and `sessionSyncUtils` share resolution semantics.
- Filters the new course-scoped overview by mode + entityId before fanning out to per-session message fetches, so unrelated sessions are never fetched.

Spec: `docs/superpowers/specs/2026-05-13-iris-api-unified-sessions-design.md` (codex-approved, 2 rounds).
Plan: `docs/superpowers/plans/2026-05-13-iris-api-unified-sessions.md` (codex-approved).

## Test plan

- [x] `npm run lint && npm run check-types && npm run compile-tests && npm run test:unit && npm run knip` clean
- [ ] Manual smoke against a Helios test server: open chat in course context, open in exercise context, send messages, see WebSocket replies, reopen and verify history.
- [ ] Note: e2e (`uncommittedChanges.e2e.test.ts`) requires a live Artemis develop server; verify before merge.
EOF
)"
```

---

## Self-review notes

Spec sections each map to a task:

- **Types** (Task 1) — `IrisChatMode`, `IrisChatSession`, `IrisChatSessionSummary` with `[key: string]: unknown` index signatures.
- **API primitives** (Tasks 4, 8) — three thin methods added, seven legacy methods deleted.
- **Composition layer** (Task 5) — `fetchSessionsWithMessages(api, contextStore, context)` with filter-before-fetch + the entire `chatSessionService.test.ts` stub migration in the same atomic commit.
- **Helpers** (Tasks 2, 3) — `contextToIrisMode` and `resolveCourseIdFromContext` with focused tests.
- **Callers** (Tasks 5, 6) — `chatSessionService`, `chatDiagnosticsService`, `irisWebSocketSessionClient`.
- **Tests** (Tasks 4, 5, 6, 7, 8) — every affected suite migrated; one new dedicated suite.
- **Acceptance** (Task 9) — two grep guards (with `!` to flip semantics), lint, typecheck, full unit suite, knip, CHANGELOG.

Build-stays-green discipline: new API methods added in Task 4 *alongside* old; production rewrite and the stub migration that depends on it ship together in Task 5; old methods deleted only in Task 8 after every caller has switched. Each numbered task ends on a green build.
