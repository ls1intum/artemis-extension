# Proactive Intervention — Slice 5c: AskIris card-state matrix + §14 availability banner — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the AskIris proactive control tell the truth about *why* proactive help is or isn't available, by replacing 5b's single "Available" assumption with the full **four-state card matrix** from spec §12.2 — **Available** / **Off (disabled for this course)** / **Unavailable** / **Degraded** — plus the §14 case-2/3 **Exercise-Detail banner** that explains a full shut-off, and the **AI-opt-in / `.noai` gating** of the switch. The card states are derived host-side from the real availability signals and pushed to the webview; the webview renders the matching control + (for "Unavailable") disables the Ask button and shows the banner.

**Sequencing.** Builds on **5b** (the `ProactiveControlCommandModule`, the `requestProactiveControl`/`UpdateProactiveControl` messages, the `proactiveControl` seam capability on `StruggleEngineHandle`, the `proactivePreference` service, the AskIris switch+badge) and **5a** (the course-level `proactiveStruggleEnabled` setting, whose *client read* this slice adds). Slices execute in order; a review against un-applied `HEAD` will see 5a/5b absent (no `ProactiveControlCommandModule`, no `UpdateProactiveControl`, no `proactiveStruggleEnabled` anywhere) — expected. Where this plan says "extend the 5b X", X is defined by the 5b plan (`docs/superpowers/plans/2026-06-26-proactive-slice5b-askiris-control.md`).

**Architecture.** A **pure** `deriveProactiveCardState(signals)` (new always-bundled module) maps five signals to one of five card states (`available`/`off-course`/`unavailable`/`degraded`/`hidden`), one term per §14 row. The host gathers the signals in the (now `async`) `ProactiveControlCommandModule._push`:
- **`irisAvailability` + `courseProactiveEnabled`** from a **shared** `classifyIrisCourseAvailability(api, resolveCourseId)` extracted from `IrisChatSessionService.checkAndLoadIrisSettings` (the user's "thorough" choice: the card mirrors the *exact* §14 classification the manual chat uses — Iris-profile-off / settings-403 / `enabled===false` all collapse to `disabled`, which is also how a missing LLM opt-in surfaces; transient infra blips stay `unavailable`). The chat path is refactored to *delegate* to the shared helper; the returned `availability.kind` is identical for every input (the only contract callers depend on — `reason` is logging-only), so the manual chat is unaffected.
- **`noAi`** from `IChatWebviewProvider.isNoAiEnabled()` (already implemented on the chat provider; this slice adds it + `whenNoAiReady()` to the interface) via the existing `providerRegistry`; `_push` awaits readiness so the first render can't fail-open.
- **`degraded`** (no proactive-egress consent **or** a 404-latched server) folds into one new seam method `StruggleEngineHandle.isProactiveDegraded()` (the engine already owns both `isEgressEnabled()` and `_serverAvailable`).
- **`enginePresent`** from an explicit `StruggleEngineHandle.enginePresent` flag (full build `true`, no-op `false`) — **not** `!!context.proactiveControl`, because the clean build passes a real no-op control object, not `undefined`. False → card `hidden`, i.e. plain AskIris with no proactive control, exactly as on `CourseDetailView`.

The webview renders the pushed `cardState`: **Available** = the 5b On/Off switch+badge; **Off (course)** = switch shown but disabled + a "disabled for this course" note (Ask works); **Unavailable** = no switch, **Ask button disabled**, + the Exercise-Detail banner; **Degraded** = switch still settable + a "proactive help is limited right now" note (Ask works); **hidden** = unchanged AskIris.

**Tech Stack:** Extension (TypeScript + React, Vitest `test/logic` + `test/react`). No Artemis/Pyris change (5a already shipped the server `proactiveStruggleEnabled`; this slice only *reads* it client-side).

Spec refs: §12.2 (the four card states + their division of labor), §14 (the availability matrix rows 1-6 + the cases-2/3 banner), §13 (the course `proactiveStruggleEnabled` whose client read this adds).

## Global Constraints

- **Branch:** `feat/struggle-v3-integration`. Not `dev`/`main`.
- **Commit messages:** Conventional Commits. **No AI attribution** (no `Co-Authored-By`, no `🤖`, no "Generated with"). Overrides any default trailer.
- **Staging:** exact files only. `git` from the repo root `/Users/liamberger/Documents/private/MA/artemis-extension`; run `npx vitest`/`npm run` from `extension/`. Never `git add -A`/`.`.
- **Verification:** targeted Vitest green + `npm run check-types` (eslint misses TS6133; `check-types` is the real gate).
- **Clean-build seam (`@telemetry`):** the only seam touches are `isProactiveDegraded()` and the `enginePresent: boolean` flag on `StruggleEngineHandle` (real engine + no-op). `deriveProactiveCardState` and the command-module changes are **plain always-bundled code** that import **nothing** from `services/struggle|struggleIntervention` (so `scripts/verify-clean-bundle.js` stays green). `classifyIrisCourseAvailability` lives in `services/iris/chat` (core Iris, always bundled).
- **Invariants:** Desktop = Cookie auth, Theia = Bearer (untouched). No `^`/`~` added. CSS-module lookups static camelCase.
- **Default On (§12.2)** stays from 5b: an unset preference is On; the card state only *gates* whether that switch is shown/usable.

---

## File structure

- Create: `extension/src/extension/services/proactiveCardState.ts` — the pure `deriveProactiveCardState` + `ProactiveCardSignals`.
- Modify: `extension/src/shared/messageContracts/extensionMessages.ts` — `ProactiveCardState`/`ProactiveCardReason` unions; extend `UpdateProactiveControl`.
- Modify: `extension/src/shared/messageContracts/webviewCommands.ts` — extend `requestProactiveControl` payload with `courseId?`.
- Modify: `extension/src/extension/services/iris/chat/chatSessionService.ts` — extract + export `classifyIrisCourseAvailability`; `checkAndLoadIrisSettings` delegates.
- Modify: `extension/src/shared/types/apiResponses.ts` — `settings.proactiveStruggleEnabled?: boolean`.
- Modify: `extension/src/extension/telemetry/contract.ts`, `telemetry/noop.ts`, `telemetry/index.ts` — `isProactiveDegraded` on the handle.
- Modify: `extension/src/extension/services/struggleIntervention/struggleInterventionService.ts` — `isProactiveDegraded()`.
- Modify: `extension/src/extension.ts` — destructure `isProactiveDegraded`, fold into the `proactiveControl` capability.
- Modify: `extension/src/extension/controller/commands/types.ts` — `proactiveControl.isProactiveDegraded`.
- Modify: `extension/src/extension/types/IChatWebviewProvider.ts` — `isNoAiEnabled(): boolean` + `whenNoAiReady(): Promise<void>`.
- Modify: `extension/src/extension/provider/chatWebviewProvider.ts` — implement `whenNoAiReady` (delegate to `NoAiDetectionService.waitForInitialization`).
- Modify: `extension/src/extension/controller/commands/proactiveControlCommands.ts` — async `_push` gathers + derives + sends the card state.
- Modify: `extension/src/webview/components/AskIris/AskIris.tsx` (+ `.module.css`) — the four card states + Ask-button gating.
- Modify: `extension/src/webview/views/ExerciseDetail/ExerciseDetailView.tsx`, `extension/src/webview/stores/useExerciseDetailStore.ts` — request with `courseId`, store `cardState`/`reason`, render the §14 banner.
- Test: `extension/test/logic/proactiveCardState.test.ts`, `extension/test/logic/iris/chat/classifyIrisCourseAvailability.test.ts`, `extension/test/logic/struggleIntervention/struggleInterventionService.test.ts` (extend), `extension/test/logic/commands/proactiveControlCommands.test.ts`, `extension/test/react/AskIris.cardState.test.tsx`.

---

### Task 1: Pure card-state derivation (`deriveProactiveCardState`) + contract types

**Files:**
- Create: `extension/src/extension/services/proactiveCardState.ts`
- Modify: `extension/src/shared/messageContracts/extensionMessages.ts` (the `ProactiveCardState`/`ProactiveCardReason` unions only; the message field extension is Task 4)
- Test: `extension/test/logic/proactiveCardState.test.ts`

**Interfaces:**
- Produces: `type ProactiveCardState = 'available' | 'off-course' | 'unavailable' | 'degraded' | 'hidden'` and `type ProactiveCardReason = 'noai' | 'iris-off' | 'course-off' | 'limited'` (exported from `@shared/messageContracts`); `interface ProactiveCardSignals { enginePresent: boolean; irisAvailability: 'enabled' | 'disabled' | 'unavailable'; noAi: boolean; courseProactiveEnabled: boolean | undefined; degraded: boolean }`; `function deriveProactiveCardState(s: ProactiveCardSignals): { state: ProactiveCardState; reason?: ProactiveCardReason }`.
- Consumes: nothing (pure).

- [ ] **Step 1: Add the wire unions to the contract**

In `extension/src/shared/messageContracts/extensionMessages.ts`, near the other exported message types, add:
```ts
/** Which proactive-availability state the AskIris card renders (spec §12.2, one term per §14 row). */
export type ProactiveCardState = 'available' | 'off-course' | 'unavailable' | 'degraded' | 'hidden';
/** Why a non-"available" card is in that state (drives the §14 banner / note copy). */
export type ProactiveCardReason = 'noai' | 'iris-off' | 'course-off' | 'limited';
```
(Re-export them from the messageContracts barrel if the file isn't already the barrel — check the existing `export` style in the file and match it; `UpdateProactiveControl` from 5b lives here too.)

- [ ] **Step 2: Failing test**

`extension/test/logic/proactiveCardState.test.ts`:
```ts
import { describe, expect, it } from 'vitest';

import { deriveProactiveCardState, type ProactiveCardSignals } from '@extension/services/proactiveCardState';

const base: ProactiveCardSignals = {
    enginePresent: true,
    irisAvailability: 'enabled',
    noAi: false,
    courseProactiveEnabled: true,
    degraded: false,
};

describe('deriveProactiveCardState (§14 matrix)', () => {
    it('all signals ok → available', () => {
        expect(deriveProactiveCardState(base)).toEqual({ state: 'available', reason: undefined });
    });

    it('no engine (clean build) → hidden, short-circuits everything', () => {
        expect(deriveProactiveCardState({ ...base, enginePresent: false, noAi: true, irisAvailability: 'disabled' }))
            .toEqual({ state: 'hidden', reason: undefined });
    });

    it('.noai present → unavailable/noai (§14 case 3), beats iris-off', () => {
        expect(deriveProactiveCardState({ ...base, noAi: true, irisAvailability: 'disabled' }))
            .toEqual({ state: 'unavailable', reason: 'noai' });
    });

    it('iris disabled / no LLM opt-in → unavailable/iris-off (§14 case 2)', () => {
        expect(deriveProactiveCardState({ ...base, irisAvailability: 'disabled' }))
            .toEqual({ state: 'unavailable', reason: 'iris-off' });
    });

    it('course proactive off (Iris on) → off-course (§14 case 1)', () => {
        expect(deriveProactiveCardState({ ...base, courseProactiveEnabled: false }))
            .toEqual({ state: 'off-course', reason: 'course-off' });
    });

    it('no consent / 404 → degraded (§14 cases 4-5)', () => {
        expect(deriveProactiveCardState({ ...base, degraded: true }))
            .toEqual({ state: 'degraded', reason: 'limited' });
    });

    it('transient unavailable (§14 case 6) self-heals → available (no false "off")', () => {
        // settings could not be read this tick → courseProactiveEnabled undefined; not degraded/off/disabled.
        expect(deriveProactiveCardState({ ...base, irisAvailability: 'unavailable', courseProactiveEnabled: undefined }))
            .toEqual({ state: 'available', reason: undefined });
    });

    it('precedence: course-off is checked only after iris is confirmed enabled', () => {
        // disabled + course-off → unavailable (iris-off wins; you cannot be "off for the course" if Iris is off)
        expect(deriveProactiveCardState({ ...base, irisAvailability: 'disabled', courseProactiveEnabled: false }))
            .toEqual({ state: 'unavailable', reason: 'iris-off' });
    });
});
```

- [ ] **Step 3: Run to verify failure**

```bash
( cd /Users/liamberger/Documents/private/MA/artemis-extension/extension && npx vitest run test/logic/proactiveCardState.test.ts ) 2>&1 | tail -20
```
Expected: FAIL — module missing.

- [ ] **Step 4: Implement the pure derivation**

`extension/src/extension/services/proactiveCardState.ts`:
```ts
import type { ProactiveCardReason, ProactiveCardState } from '@shared/messageContracts';

/** Inputs to the AskIris card-state decision (spec §12.2 / §14). All gathered host-side. */
export interface ProactiveCardSignals {
    /** The proactive engine seam capability is present (false in the clean Open-VSX build). */
    enginePresent: boolean;
    /** The chat's §14 classification: enabled / disabled (iris-off OR no LLM opt-in) / unavailable (transient). */
    irisAvailability: 'enabled' | 'disabled' | 'unavailable';
    /** A `.noai` marker is present in the workspace (§11.5 widening: disables the whole feature). */
    noAi: boolean;
    /** Course-level `proactiveStruggleEnabled` (§13). `undefined` = unknown this tick (settings unread). */
    courseProactiveEnabled: boolean | undefined;
    /** No proactive-egress consent OR a 404-latched server (§14 cases 4-5). */
    degraded: boolean;
}

/**
 * Map the gathered signals to exactly one AskIris card state (spec §12.2), one term per §14 row.
 * Order encodes precedence: a more total shut-off wins over a partial one.
 */
export function deriveProactiveCardState(s: ProactiveCardSignals): { state: ProactiveCardState; reason?: ProactiveCardReason } {
    // Clean build: no engine at all → render plain AskIris (no proactive control).
    if (!s.enginePresent) {
        return { state: 'hidden', reason: undefined };
    }
    // §14 cases 2-3: the whole feature (incl. manual chat) is off → Unavailable + banner.
    if (s.noAi) {
        return { state: 'unavailable', reason: 'noai' };
    }
    if (s.irisAvailability === 'disabled') {
        return { state: 'unavailable', reason: 'iris-off' };
    }
    // §14 case 1: Iris on, but the course turned proactive off → its own "Off (course)" state (Ask works).
    if (s.courseProactiveEnabled === false) {
        return { state: 'off-course', reason: 'course-off' };
    }
    // §14 cases 4-5: no egress consent / 404 → degrade to the no-AI fallback (Ask works, proactive limited).
    if (s.degraded) {
        return { state: 'degraded', reason: 'limited' };
    }
    // Happy path AND §14 case 6 (transient blip self-heals on the next refresh; never a false "off").
    return { state: 'available', reason: undefined };
}
```

- [ ] **Step 5: Run green + type-check + commit**

```bash
( cd /Users/liamberger/Documents/private/MA/artemis-extension/extension && npx vitest run test/logic/proactiveCardState.test.ts && npm run check-types ) 2>&1 | tail -15
git -C /Users/liamberger/Documents/private/MA/artemis-extension add \
    extension/src/extension/services/proactiveCardState.ts \
    extension/src/shared/messageContracts/extensionMessages.ts \
    extension/test/logic/proactiveCardState.test.ts
git -C /Users/liamberger/Documents/private/MA/artemis-extension commit -m "feat(struggle): pure AskIris card-state derivation from §14 availability signals"
```

---

### Task 2: Shared §14 availability classifier (reused by chat + card)

**Files:**
- Modify: `extension/src/extension/services/iris/chat/chatSessionService.ts`
- Modify: `extension/src/shared/types/apiResponses.ts`
- Test: `extension/test/logic/iris/chat/classifyIrisCourseAvailability.test.ts`

**Interfaces:**
- Produces: `export async function classifyIrisCourseAvailability(api, resolveCourseId): Promise<{ availability: IrisAvailability; settings?: IrisSettingsResponse }>` where `api: Pick<ArtemisApiService, 'getProfileInfo' | 'isIrisProfileActive' | 'getIrisCourseChatSettings'>` and `resolveCourseId: () => Promise<number | undefined>`. Adds `proactiveStruggleEnabled?: boolean` to the client `IrisSettingsResponse['settings']`.
- Consumes: the existing module-level `classifyAvailabilityFromError` + the `IrisAvailability` type (both already in `chatSessionService.ts`).

This extracts the profile-probe + settings-fetch + classify core (today inline in `checkAndLoadIrisSettings`, lines 121-194) into one exported helper, so the AskIris card and the manual chat share **one** §14 classification. `checkAndLoadIrisSettings` keeps its context-type handling + course-id resolution and *delegates*.

**What is preserved (codex r1 Medium, claim-corrected):** the returned `availability.kind` for every input is **identical** (the precedence and all branch outcomes match the original) — that is the only contract any caller depends on. The chat surfaces a *fixed* `UNAVAILABLE_USER_MESSAGE` constant to the user (line 36), **not** `availability.reason`, so `reason` is logging-only. This refactor therefore does **not** claim byte-identical logs/reason strings: the per-branch `info`/`warn` logs are consolidated into one post-classification log, and the "could not resolve course" reason becomes context-agnostic. No behavioural consumer reads either. If a pre-existing test asserts an exact `reason` string or a specific log call, update it to the new wording (the `kind` must not change).

- [ ] **Step 1: Add the client settings field**

In `extension/src/shared/types/apiResponses.ts`, extend `IrisSettingsResponse['settings']` (it has `enabled?` + an index signature today):
```ts
export interface IrisSettingsResponse {
    settings?: {
        enabled?: boolean;
        /** Course-level proactive struggle detection toggle (spec §13; admin-only, default off). */
        proactiveStruggleEnabled?: boolean;
        [key: string]: unknown;
    };
    effectiveRateLimit?: {
        requests?: number;
        timeframeHours?: number;
        [key: string]: unknown;
    };
    [key: string]: unknown;
}
```

- [ ] **Step 2: Failing test for the extracted helper**

`extension/test/logic/iris/chat/classifyIrisCourseAvailability.test.ts`:
```ts
import { describe, expect, it, vi } from 'vitest';

import { classifyIrisCourseAvailability } from '@extension/services/iris/chat/chatSessionService';

function api(over: Partial<{ profileActive: boolean; settings: unknown; settingsThrows: unknown; profileThrows: unknown }>) {
    return {
        getProfileInfo: vi.fn(async () => {
            if (over.profileThrows) { throw over.profileThrows; }
            return {} as never;
        }),
        isIrisProfileActive: vi.fn(() => over.profileActive ?? true),
        getIrisCourseChatSettings: vi.fn(async () => {
            if (over.settingsThrows) { throw over.settingsThrows; }
            return over.settings as never;
        }),
    };
}
const courseId = async () => 7;

describe('classifyIrisCourseAvailability (§14, shared by chat + card)', () => {
    it('profile inactive → disabled', async () => {
        const r = await classifyIrisCourseAvailability(api({ profileActive: false }), courseId);
        expect(r.availability).toEqual({ kind: 'disabled' });
    });

    it('profile probe throws → unavailable', async () => {
        const r = await classifyIrisCourseAvailability(api({ profileThrows: new Error('net') }), courseId);
        expect(r.availability.kind).toBe('unavailable');
    });

    it('course resolution undefined → unavailable', async () => {
        const r = await classifyIrisCourseAvailability(api({ settings: { settings: { enabled: true } } }), async () => undefined);
        expect(r.availability.kind).toBe('unavailable');
    });

    it('enabled=false → disabled', async () => {
        const r = await classifyIrisCourseAvailability(api({ settings: { settings: { enabled: false } } }), courseId);
        expect(r.availability).toEqual({ kind: 'disabled' });
    });

    it('enabled=true → enabled, and returns the settings body (incl. proactiveStruggleEnabled)', async () => {
        const r = await classifyIrisCourseAvailability(
            api({ settings: { settings: { enabled: true, proactiveStruggleEnabled: false } } }), courseId);
        expect(r.availability).toEqual({ kind: 'enabled' });
        expect(r.settings?.settings?.proactiveStruggleEnabled).toBe(false);
    });

    it('malformed settings → unavailable', async () => {
        const r = await classifyIrisCourseAvailability(api({ settings: { settings: {} } }), courseId);
        expect(r.availability.kind).toBe('unavailable');
    });
});
```

- [ ] **Step 3: Run to verify failure**

```bash
( cd /Users/liamberger/Documents/private/MA/artemis-extension/extension && npx vitest run test/logic/iris/chat/classifyIrisCourseAvailability.test.ts ) 2>&1 | tail -20
```
Expected: FAIL — `classifyIrisCourseAvailability` not exported.

- [ ] **Step 4: Extract the helper + delegate from `checkAndLoadIrisSettings`**

In `chatSessionService.ts`, add the import for the api type and export the helper (place it near the existing module-level `classifyAvailabilityFromError`, ~line 735, so they share scope):
```ts
import type { ArtemisApiService } from '@extension/api';
```
```ts
/**
 * The §14 availability classification shared by the manual chat ({@link IrisChatSessionService.checkAndLoadIrisSettings})
 * and the AskIris proactive card ({@link ProactiveControlCommandModule}). Profile probe → resolve course → settings,
 * with the exact precedence both surfaces must agree on. Returns the raw settings too, so the card can read
 * `proactiveStruggleEnabled` (§13) from the same fetch.
 */
export async function classifyIrisCourseAvailability(
    api: Pick<ArtemisApiService, 'getProfileInfo' | 'isIrisProfileActive' | 'getIrisCourseChatSettings'>,
    resolveCourseId: () => Promise<number | undefined>,
): Promise<{ availability: IrisAvailability; settings?: IrisSettingsResponse }> {
    // Step 1: profile probe (a throw = infra/auth issue = unavailable; profile inactive = disabled).
    let profileInfo;
    try {
        profileInfo = await api.getProfileInfo();
    } catch (error: unknown) {
        return { availability: { kind: 'unavailable', reason: `Profile probe failed: ${describeError(error)}` } };
    }
    if (!api.isIrisProfileActive(profileInfo)) {
        return { availability: { kind: 'disabled' } };
    }
    // Step 2: resolve the course (transient failures only).
    let courseId: number | undefined;
    try {
        courseId = await resolveCourseId();
    } catch (error: unknown) {
        return { availability: { kind: 'unavailable', reason: `Could not resolve course: ${describeError(error)}` } };
    }
    if (courseId === undefined) {
        return { availability: { kind: 'unavailable', reason: 'Could not resolve course for this context' } };
    }
    // Step 3: settings call — the ONLY place a 403 means "disabled" (course-forbidden = Iris off for this user).
    let settings: IrisSettingsResponse;
    try {
        settings = await api.getIrisCourseChatSettings(courseId);
    } catch (error: unknown) {
        return { availability: classifyAvailabilityFromError(error) };
    }
    const chatSettings = settings?.settings;
    if (!chatSettings || typeof chatSettings.enabled !== 'boolean') {
        return { availability: { kind: 'unavailable', reason: 'Malformed Iris settings response' } };
    }
    if (chatSettings.enabled === false) {
        return { availability: { kind: 'disabled' }, settings };
    }
    return { availability: { kind: 'enabled' }, settings };
}
```
Then rewrite `checkAndLoadIrisSettings` (lines 113-195) to delegate — keep its early guards + logging, build the `resolveCourseId` thunk from the context type, and return only `.availability`:
```ts
public async checkAndLoadIrisSettings(context: ActiveContext): Promise<IrisAvailability> {
    if (!this.deps.artemisApiService) {
        logger.warn('Artemis API service not available', LogCategory.IRIS_CHAT);
        return { kind: 'unavailable', reason: 'Artemis API service not initialized' };
    }
    logger.info(`Checking Iris settings for ${context.type}: ${context.title}`, LogCategory.IRIS_CHAT);

    // Unsupported context types are a hard "disabled" before any network call (unchanged behaviour).
    if (context.type !== 'course' && context.type !== 'exercise') {
        logger.warn(`Unsupported context type for Iris: ${context.type}`, LogCategory.IRIS_CHAT);
        return { kind: 'disabled' };
    }

    const resolveCourseId = async (): Promise<number | undefined> =>
        context.type === 'course' ? context.id : this.resolveCourseIdForExercise(context);

    const { availability } = await classifyIrisCourseAvailability(this.deps.artemisApiService, resolveCourseId);
    if (availability.kind === 'enabled') {
        logger.info('Iris chat is enabled, settings loaded', LogCategory.IRIS_CHAT);
    } else if (availability.kind === 'disabled') {
        logger.info('Iris chat is disabled (profile/settings)', LogCategory.IRIS_CHAT);
    } else {
        logger.error(`Iris availability check failed: ${availability.reason}`, LogCategory.IRIS_CHAT);
    }
    return availability;
}
```
(Remove the now-inlined steps 1-3 from the old body. `resolveCourseIdForExercise` stays a private method — the thunk calls it. The detailed per-branch logging that's dropped is replaced by the single classification log above; the helper still surfaces every reason via `availability.reason`.)

- [ ] **Step 5: Run green (incl. the existing chat-session tests) + type-check + commit**

```bash
( cd /Users/liamberger/Documents/private/MA/artemis-extension/extension \
  && npx vitest run test/logic/iris/chat/classifyIrisCourseAvailability.test.ts \
  && npx vitest run test/logic/iris && npm run check-types ) 2>&1 | tail -25
```
Expected: the new helper test + every pre-existing `checkAndLoadIrisSettings` test pass (behaviour preserved). If a pre-existing test asserts an exact `reason` string that changed, update that assertion to the helper's wording (the `kind` must not change).
```bash
git -C /Users/liamberger/Documents/private/MA/artemis-extension add \
    extension/src/extension/services/iris/chat/chatSessionService.ts \
    extension/src/shared/types/apiResponses.ts \
    extension/test/logic/iris/chat/classifyIrisCourseAvailability.test.ts
git -C /Users/liamberger/Documents/private/MA/artemis-extension commit -m "refactor(iris-chat): extract shared §14 availability classifier (reused by proactive card)"
```

---

### Task 3: Seam — the `isProactiveDegraded` signal (consent-off OR 404)

**Files:**
- Modify: `extension/src/extension/services/struggleIntervention/struggleInterventionService.ts`
- Modify: `extension/src/extension/telemetry/contract.ts`, `telemetry/noop.ts`, `telemetry/index.ts`
- Modify: `extension/src/extension.ts`, `extension/src/extension/controller/commands/types.ts`
- Test: `extension/test/logic/struggleIntervention/struggleInterventionService.test.ts` (extend)

**Interfaces:**
- Produces: `StruggleInterventionService.isProactiveDegraded(): boolean` = `!isEgressEnabled() || !_serverAvailable`; `StruggleEngineHandle.isProactiveDegraded(): boolean` + `StruggleEngineHandle.enginePresent: boolean` (true only in the full build); and `CommandContext.proactiveControl.{ isProactiveDegraded(): boolean; enginePresent: boolean }` (added to the 5b capability shape).
- Consumes: the existing orchestrator dep `isEgressEnabled()` (line 97) + private `_serverAvailable` (line 51, false-latched on a 404 at line 135).

- [ ] **Step 1: Failing logic test**

In `struggleInterventionService.test.ts` (the `fakeDeps` builder already provides `isEgressEnabled`):
```ts
it('isProactiveDegraded: true when egress consent is off', () => {
    const svc = new StruggleInterventionService(fakeDeps({ isEgressEnabled: () => false }));
    expect(svc.isProactiveDegraded()).toBe(true);
});

it('isProactiveDegraded: true after a 404 latches the server unavailable', async () => {
    const svc = new StruggleInterventionService(fakeDeps({
        isEgressEnabled: () => true,
        postIntervention: async () => 'unavailable' as const,
    }));
    svc.onTick(tick(530));
    svc.deliver(alert());
    await new Promise(r => setTimeout(r, 0));
    expect(svc.isProactiveDegraded()).toBe(true);   // _serverAvailable latched false by the 404
});

it('isProactiveDegraded: false when consent on and server up', () => {
    const svc = new StruggleInterventionService(fakeDeps({ isEgressEnabled: () => true }));
    expect(svc.isProactiveDegraded()).toBe(false);
});
```
(`alert()`/`tick()`/`fakeDeps` are the file's existing helpers; the 404 path mirrors the existing "unavailable → fallback" test in this file.)

- [ ] **Step 2: Run to verify failure**

```bash
( cd /Users/liamberger/Documents/private/MA/artemis-extension/extension && npx vitest run test/logic/struggleIntervention/struggleInterventionService.test.ts ) 2>&1 | tail -25
```
Expected: FAIL — `isProactiveDegraded` does not exist.

- [ ] **Step 3: Orchestrator method**

In `struggleInterventionService.ts`, add (near `isProactivePaused` from 5b):
```ts
/**
 * True iff proactive is running in a *degraded* mode (spec §14 cases 4-5): no proactive-egress consent
 * (local-template only) OR a 404-latched server (no-AI lamp fallback). Drives the AskIris "Degraded" card.
 * Distinct from "paused" (§5.2 backoff) and from the student/course "off" states.
 */
isProactiveDegraded(): boolean {
    return !this._deps.isEgressEnabled() || !this._serverAvailable;
}
```

- [ ] **Step 4: Seam — contract, noop, index, extension.ts, CommandContext**

`telemetry/contract.ts` — add to `StruggleEngineHandle` (next to the 5b `isProactivePaused`) BOTH the degraded method and a plain `enginePresent` flag. The flag is required because the clean build does NOT pass `undefined` for `proactiveControl` — `createStruggleEngine` (no-op) returns a real handle object, so `!!context.proactiveControl` is `true` in every build (codex r1 Critical). `enginePresent` is the only honest "is there a real engine" signal:
```ts
    /** True iff proactive is degraded (no egress consent / 404). Drives the AskIris "Degraded" card (§14). */
    isProactiveDegraded(): boolean;
    /** True only in the full build (real engine). False in the clean Open-VSX build → AskIris card is `hidden`. */
    enginePresent: boolean;
```
`telemetry/noop.ts` — add to the returned handle (the clean build has no engine):
```ts
        isProactiveDegraded: () => false,
        enginePresent: false,
```
`telemetry/index.ts` — add to the `createStruggleEngine` return object (next to the 5b handle methods):
```ts
        isProactiveDegraded: () => orchestrator.isProactiveDegraded(),
        enginePresent: true,
```
`extension.ts` — add `isProactiveDegraded` + `enginePresent` to the existing `createStruggleEngine(...)` destructure (which 5b already extended with `isProactivePaused`/`setStudentProactive`/`resumeProactive`) and into the `proactiveControl` capability object:
```ts
	const { /* …existing 5b… */ isProactivePaused, setStudentProactive, resumeProactive, isProactiveDegraded, enginePresent } = createStruggleEngine({ /* …deps… */ });
	const proactiveControl = { isProactivePaused, setStudentProactive, resumeProactive, isProactiveDegraded, enginePresent };
```
`controller/commands/types.ts` — add both to the optional `proactiveControl` shape (5b):
```ts
    proactiveControl?: {
        isProactivePaused(exerciseId: number): boolean;
        setStudentProactive(on: boolean): void;
        resumeProactive(): void;
        isProactiveDegraded(): boolean;
        enginePresent: boolean;
    };
```

- [ ] **Step 5: Run green + type-check + commit**

```bash
( cd /Users/liamberger/Documents/private/MA/artemis-extension/extension && npx vitest run test/logic/struggleIntervention/struggleInterventionService.test.ts && npm run check-types ) 2>&1 | tail -20
git -C /Users/liamberger/Documents/private/MA/artemis-extension add \
    extension/src/extension/services/struggleIntervention/struggleInterventionService.ts \
    extension/src/extension/telemetry/contract.ts \
    extension/src/extension/telemetry/noop.ts \
    extension/src/extension/telemetry/index.ts \
    extension/src/extension.ts \
    extension/src/extension/controller/commands/types.ts \
    extension/test/logic/struggleIntervention/struggleInterventionService.test.ts
git -C /Users/liamberger/Documents/private/MA/artemis-extension commit -m "feat(struggle): expose proactive-degraded + engine-present across the engine seam"
```

---

### Task 4: Command module — gather signals, derive, push the card state

**Files:**
- Modify: `extension/src/extension/types/IChatWebviewProvider.ts` (add `isNoAiEnabled` + `whenNoAiReady` to the interface)
- Modify: `extension/src/extension/provider/chatWebviewProvider.ts` (implement `whenNoAiReady`)
- Modify: `extension/src/shared/messageContracts/webviewCommands.ts`, `extension/src/shared/messageContracts/extensionMessages.ts`
- Modify: `extension/src/extension/controller/commands/proactiveControlCommands.ts`
- Test: `extension/test/logic/commands/proactiveControlCommands.test.ts`

**Interfaces:**
- Produces: `IChatWebviewProvider.isNoAiEnabled(): boolean` + `IChatWebviewProvider.whenNoAiReady(): Promise<void>`; all three proactive-control payloads (`requestProactiveControl`/`setProactiveEnabled`/`resumeProactive`) gain `courseId?: number`; `UpdateProactiveControl` gains `cardState: ProactiveCardState; cardReason?: ProactiveCardReason`; `ProactiveControlCommandModule._push` becomes `async` (with a `_pushSeq` stale-guard), gathering signals and sending the derived card state.
- Consumes: Task-1 `deriveProactiveCardState`; Task-2 `classifyIrisCourseAvailability`; Task-3 `proactiveControl.isProactiveDegraded` + `proactiveControl.enginePresent`; `context.artemisApi`; `context.providerRegistry.getChatWebviewProvider()`.

- [ ] **Step 1: Add `isNoAiEnabled` to the chat-provider interface**

In `extension/src/extension/types/IChatWebviewProvider.ts`, add to the interface (the `ChatWebviewProvider` already implements `public isNoAiEnabled(): boolean`; add a readiness awaiter so the *first* card derive cannot fail-open while the async `.noai` scan is still running — see the note below):
```ts
    /** True iff a `.noai` marker disables AI for the workspace (spec §14 case 3). */
    isNoAiEnabled(): boolean;
    /** Resolves once the initial `.noai` workspace scan has completed, so `isNoAiEnabled()` is authoritative. */
    whenNoAiReady(): Promise<void>;
```
In `ChatWebviewProvider`, implement `whenNoAiReady` by delegating to the detection service (which already exposes `waitForInitialization(): Promise<boolean>`):
```ts
public whenNoAiReady(): Promise<void> {
    return this._noAiDetectionService.waitForInitialization().then(() => undefined);
}
```
**Privacy note (codex r1 Medium, scope-corrected):** the `.noai` *egress* gate is already enforced **engine-side** — `decideOutcome` reads the live `hasNoaiMarker()` at alert time (`struggleInterventionService.ts:99-106`), so no proactive code is ever sent while `.noai` is set, regardless of the card. The card's `.noai → unavailable` is therefore a *display* correctness concern (don't show "available" then flip), not a privacy hole. Awaiting `whenNoAiReady()` makes the first render correct too; it resolves immediately after activation, so the cost is nil.

- [ ] **Step 2: Extend the message contracts**

In `webviewCommands.ts`, extend ALL THREE 5b proactive-control payloads with `courseId?` so every `_push` (init **and** toggle/resume) re-derives availability with the course id — eliminating the optimistic-no-courseId repaint codex r1 flagged (the webview has `exercise.course?.id` at every call site):
```ts
    requestProactiveControl: { exerciseId: number; courseId?: number };
    setProactiveEnabled: { exerciseId: number; enabled: boolean; courseId?: number };
    resumeProactive: { exerciseId: number; courseId?: number };
```
In `extensionMessages.ts`, extend the 5b `updateProactiveControl` payload (`ProactiveCardState`/`ProactiveCardReason` were added in Task 1):
```ts
    updateProactiveControl: {
        exerciseId: number;
        preference: 'on' | 'off';
        autoPaused: boolean;
        cardState: ProactiveCardState;
        cardReason?: ProactiveCardReason;
    };
```
(Ensure `ProactiveCardState`/`ProactiveCardReason` are in scope in `extensionMessages.ts` — they are declared in the same file in Task 1.)

- [ ] **Step 3: Failing module test**

`extension/test/logic/commands/proactiveControlCommands.test.ts` — drive `requestProactiveControl` through a fake context and assert the pushed `cardState`:
```ts
import { describe, expect, it, vi } from 'vitest';

import { WebviewCmd } from '@shared/messageContracts';
import { ProactiveControlCommandModule } from '@extension/controller/commands/proactiveControlCommands';

function ctx(over: {
    settings?: unknown; profileActive?: boolean; noAi?: boolean; degraded?: boolean; enginePresent?: boolean; prefOn?: boolean;
}) {
    const sent: any[] = [];
    // The clean build passes a REAL (no-op) proactiveControl with enginePresent:false — NOT undefined. Mirror that.
    const proactiveControl = {
        isProactivePaused: () => false,
        setStudentProactive: () => {},
        resumeProactive: () => {},
        isProactiveDegraded: () => over.degraded ?? false,
        enginePresent: over.enginePresent ?? true,
    };
    const context: any = {
        sendMessage: (m: unknown) => sent.push(m),
        artemisApi: {
            getProfileInfo: async () => ({}),
            isIrisProfileActive: () => over.profileActive ?? true,
            getIrisCourseChatSettings: async () => over.settings ?? { settings: { enabled: true, proactiveStruggleEnabled: true } },
        },
        providerRegistry: {
            getChatWebviewProvider: () => ({ isNoAiEnabled: () => over.noAi ?? false, whenNoAiReady: async () => {} }),
        },
        proactivePreference: { isProactiveOn: () => over.prefOn ?? true, setProactiveOn: () => {} },
        proactiveControl,
    };
    return { context, sent };
}
const req = (exerciseId: number, courseId?: number) => ({
    type: WebviewCmd.RequestProactiveControl, payload: { exerciseId, courseId },
} as never);

describe('ProactiveControlCommandModule card-state push', () => {
    it('all ok → available', async () => {
        const { context, sent } = ctx({});
        await new ProactiveControlCommandModule(context).getHandlers()[WebviewCmd.RequestProactiveControl](req(42, 7));
        expect(sent.at(-1)).toMatchObject({ exerciseId: 42, cardState: 'available' });
    });
    it('.noai → unavailable/noai', async () => {
        const { context, sent } = ctx({ noAi: true });
        await new ProactiveControlCommandModule(context).getHandlers()[WebviewCmd.RequestProactiveControl](req(42, 7));
        expect(sent.at(-1)).toMatchObject({ cardState: 'unavailable', cardReason: 'noai' });
    });
    it('course proactive off → off-course', async () => {
        const { context, sent } = ctx({ settings: { settings: { enabled: true, proactiveStruggleEnabled: false } } });
        await new ProactiveControlCommandModule(context).getHandlers()[WebviewCmd.RequestProactiveControl](req(42, 7));
        expect(sent.at(-1)).toMatchObject({ cardState: 'off-course' });
    });
    it('no engine → hidden', async () => {
        const { context, sent } = ctx({ enginePresent: false });
        await new ProactiveControlCommandModule(context).getHandlers()[WebviewCmd.RequestProactiveControl](req(42, 7));
        expect(sent.at(-1)).toMatchObject({ cardState: 'hidden' });
    });
    it('degraded seam → degraded', async () => {
        const { context, sent } = ctx({ degraded: true });
        await new ProactiveControlCommandModule(context).getHandlers()[WebviewCmd.RequestProactiveControl](req(42, 7));
        expect(sent.at(-1)).toMatchObject({ cardState: 'degraded' });
    });
});
```

- [ ] **Step 4: Run to verify failure**

```bash
( cd /Users/liamberger/Documents/private/MA/artemis-extension/extension && npx vitest run test/logic/commands/proactiveControlCommands.test.ts ) 2>&1 | tail -25
```
Expected: FAIL — `_push` does not send `cardState`.

- [ ] **Step 5: Make `_push` gather + derive + send**

In `proactiveControlCommands.ts`:
- Add imports:
```ts
import { classifyIrisCourseAvailability } from '@extension/services/iris/chat/chatSessionService';
import { deriveProactiveCardState } from '@extension/services/proactiveCardState';
```
- Thread `courseId` from EVERY command through to `_push` (init, toggle, resume all carry it now):
```ts
private handleRequest = async (message: WebviewToExtensionMessage): Promise<void> => {
    const { exerciseId, courseId } = getPayload<WebCmd<'requestProactiveControl'>>(message);
    await this._push(exerciseId, courseId);
};
private handleSetEnabled = async (message: WebviewToExtensionMessage): Promise<void> => {
    const { exerciseId, enabled, courseId } = getPayload<WebCmd<'setProactiveEnabled'>>(message);
    this.context.proactivePreference?.setProactiveOn(exerciseId, enabled);
    this.context.proactiveControl?.setStudentProactive(enabled);
    await this._push(exerciseId, courseId);
};
private handleResume = async (message: WebviewToExtensionMessage): Promise<void> => {
    const { exerciseId, courseId } = getPayload<WebCmd<'resumeProactive'>>(message);
    this.context.proactiveControl?.resumeProactive();
    await this._push(exerciseId, courseId);
};
```
- Add a stale-`_push` generation guard (a module field) so a slow `await`ing `_push` can never overwrite a newer one's state (codex r1 High — `_push` is now async and can interleave on rapid init/re-focus/toggle):
```ts
private _pushSeq = 0;
```
- Rewrite `_push` (was sync in 5b) to gather the signals + derive, guarded by the generation counter and the `.noai` readiness await:
```ts
private async _push(exerciseId: number, courseId?: number): Promise<void> {
    const seq = ++this._pushSeq;
    const on = this.context.proactivePreference?.isProactiveOn(exerciseId) ?? true;
    const autoPaused = on && (this.context.proactiveControl?.isProactivePaused(exerciseId) ?? false);

    // §14 availability — shared classifier (profile + course settings). courseId absent → optimistic enabled.
    let irisAvailability: 'enabled' | 'disabled' | 'unavailable' = 'enabled';
    let courseProactiveEnabled: boolean | undefined;
    if (courseId !== undefined) {
        try {
            const { availability, settings } = await classifyIrisCourseAvailability(
                this.context.artemisApi, async () => courseId);
            irisAvailability = availability.kind;
            courseProactiveEnabled = settings?.settings?.proactiveStruggleEnabled;
        } catch {
            irisAvailability = 'unavailable';   // never let a probe failure crash the card; self-heals next init
        }
    }

    // .noai: await the initial scan so the first render is authoritative (it resolves instantly post-activation).
    const chat = this.context.providerRegistry.getChatWebviewProvider();
    await chat?.whenNoAiReady();
    const noAi = chat?.isNoAiEnabled() ?? false;
    const degraded = this.context.proactiveControl?.isProactiveDegraded() ?? false;

    // enginePresent: the clean build passes a real (no-op) proactiveControl, so use the explicit flag, NOT !!control.
    const { state: cardState, reason: cardReason } = deriveProactiveCardState({
        enginePresent: this.context.proactiveControl?.enginePresent ?? false,
        irisAvailability,
        noAi,
        courseProactiveEnabled,
        degraded,
    });

    if (seq !== this._pushSeq) { return; }   // a newer _push superseded this one mid-await → drop the stale paint

    const msg: ExtensionToWebviewMessage = {
        type: ExtensionMsg.UpdateProactiveControl,
        exerciseId,
        preference: on ? 'on' : 'off',
        autoPaused,
        cardState,
        cardReason,
    };
    this.context.sendMessage(msg);
}
```

- [ ] **Step 6: Run green + type-check + commit**

```bash
( cd /Users/liamberger/Documents/private/MA/artemis-extension/extension && npx vitest run test/logic/commands/proactiveControlCommands.test.ts && npm run check-types ) 2>&1 | tail -20
git -C /Users/liamberger/Documents/private/MA/artemis-extension add \
    extension/src/extension/types/IChatWebviewProvider.ts \
    extension/src/extension/provider/chatWebviewProvider.ts \
    extension/src/shared/messageContracts/webviewCommands.ts \
    extension/src/shared/messageContracts/extensionMessages.ts \
    extension/src/extension/controller/commands/proactiveControlCommands.ts \
    extension/test/logic/commands/proactiveControlCommands.test.ts
git -C /Users/liamberger/Documents/private/MA/artemis-extension commit -m "feat(struggle): derive + push the AskIris card state from live availability signals"
```

---

### Task 5: Webview — render the four card states + the §14 banner

**Files:**
- Modify: `extension/src/webview/components/AskIris/AskIris.tsx`, `extension/src/webview/components/AskIris/AskIris.module.css`
- Modify: `extension/src/webview/views/ExerciseDetail/ExerciseDetailView.tsx`, `extension/src/webview/stores/useExerciseDetailStore.ts`
- Test: `extension/test/react/AskIris.cardState.test.tsx`

**Interfaces:**
- Consumes: the 5b `proactiveControl` VM prop on `AskIris`, extended with `cardState: ProactiveCardState` + `reason?: ProactiveCardReason`; the store's `proactiveControl` field extended with the same.
- Produces: the four rendered states + the Exercise-Detail banner (cases 2-3).

- [ ] **Step 1: Failing React test**

`extension/test/react/AskIris.cardState.test.tsx`:
```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AskIris } from '@webview/components/AskIris/AskIris';

const base = { description: 'd', onClick: vi.fn() };
const control = (over: object) => ({
    preference: 'on' as const, autoPaused: false, cardState: 'available' as const,
    onToggle: vi.fn(), onResume: vi.fn(), ...over,
});

describe('AskIris card states (§12.2)', () => {
    it('available → interactive On/Off switch, Ask enabled', () => {
        render(<AskIris {...base} proactiveControl={control({})} />);
        expect(screen.getByRole('switch')).not.toBeDisabled();
        expect(screen.getByRole('button', { name: /ask/i })).not.toBeDisabled();
    });

    it('off-course → switch disabled + course note, Ask still enabled', () => {
        render(<AskIris {...base} proactiveControl={control({ cardState: 'off-course', reason: 'course-off' })} />);
        expect(screen.getByRole('switch')).toBeDisabled();
        expect(screen.getByText(/course/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /ask/i })).not.toBeDisabled();
    });

    it('unavailable → no switch, Ask disabled', () => {
        render(<AskIris {...base} proactiveControl={control({ cardState: 'unavailable', reason: 'iris-off' })} />);
        expect(screen.queryByRole('switch')).toBeNull();
        expect(screen.getByRole('button', { name: /ask/i })).toBeDisabled();
    });

    it('degraded → switch present + limited note, Ask enabled', () => {
        render(<AskIris {...base} proactiveControl={control({ cardState: 'degraded', reason: 'limited' })} />);
        expect(screen.getByRole('switch')).toBeInTheDocument();
        expect(screen.getByText(/limited/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /ask/i })).not.toBeDisabled();
    });

    it('hidden / no control → plain AskIris (no switch), Ask enabled', () => {
        render(<AskIris {...base} proactiveControl={control({ cardState: 'hidden' })} />);
        expect(screen.queryByRole('switch')).toBeNull();
        expect(screen.getByRole('button', { name: /ask/i })).not.toBeDisabled();
    });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
( cd /Users/liamberger/Documents/private/MA/artemis-extension/extension && npx vitest run test/react/AskIris.cardState.test.tsx ) 2>&1 | tail -25
```
Expected: FAIL.

- [ ] **Step 3: Render the card states in AskIris**

In `AskIris.tsx`, extend the 5b VM and branch on `cardState` (the switch only renders for `available`/`off-course`/`degraded`; `off-course` disables it; `unavailable` disables the Ask button + shows no switch; `hidden` is the plain card):
```tsx
import type { ProactiveCardReason, ProactiveCardState } from '@shared/messageContracts';

interface ProactiveControlVM {
    preference: 'on' | 'off';
    autoPaused: boolean;
    cardState: ProactiveCardState;
    reason?: ProactiveCardReason;
    onToggle: (enabled: boolean) => void;
    onResume: () => void;
}

interface AskIrisProps {
    description: string;
    onClick: () => void;
    proactiveControl?: ProactiveControlVM;
}

const NOTE: Partial<Record<ProactiveCardState, string>> = {
    'off-course': 'Proactive help is disabled for this course.',
    degraded: 'Proactive help is limited right now.',
};

export function AskIris({ description, onClick, proactiveControl }: AskIrisProps) {
    const state = proactiveControl?.cardState;
    const askDisabled = state === 'unavailable';
    const showSwitch = state === 'available' || state === 'off-course' || state === 'degraded';
    const switchDisabled = state === 'off-course';
    // …existing Container/layout, with the Ask button now:
    // <Button variant="primary" onClick={onClick} disabled={askDisabled}>Ask</Button>
    // and, inside textCol after the description, when proactiveControl is present:
    {proactiveControl && state !== 'hidden' && (
        <div className={styles.proactiveControl}>
            {showSwitch && (
                <button
                    type="button"
                    role="switch"
                    aria-checked={proactiveControl.preference === 'on'}
                    aria-label="Proactive struggle help"
                    className={styles.proactiveSwitch}
                    data-state={proactiveControl.preference}
                    disabled={switchDisabled}
                    onClick={() => proactiveControl.onToggle(proactiveControl.preference !== 'on')}
                >
                    {proactiveControl.preference === 'on' ? 'On' : 'Off'}
                </button>
            )}
            {showSwitch && proactiveControl.autoPaused && state === 'available' && (
                <span className={styles.autoPaused}>
                    Auto-paused
                    <button type="button" className={styles.resume} onClick={proactiveControl.onResume}>Resume</button>
                </span>
            )}
            {state && NOTE[state] && <span className={styles.cardNote}>{NOTE[state]}</span>}
        </div>
    )}
}
```
Add `.cardNote` to `AskIris.module.css` (static camelCase; `color: var(--vscode-descriptionForeground); font-size: 0.85em;`). Keep the 5b `.proactiveControl`/`.proactiveSwitch`/`.autoPaused`/`.resume` keys.

- [ ] **Step 4: Store + view wiring + the §14 banner**

In `useExerciseDetailStore.ts`, extend the 5b `proactiveControl` state field to:
```ts
proactiveControl: { preference: 'on' | 'off'; autoPaused: boolean; cardState: ProactiveCardState; reason?: ProactiveCardReason } | null;
```
(import the unions from `@shared/messageContracts`; the `setProactiveControl` action signature widens accordingly).

In `ExerciseDetailView.tsx`:
- In the `ExtensionMsg.ExerciseDetailInit` handler (~line 104), request with the courseId (5b sent only `exerciseId`):
```ts
if (msg.exerciseData?.exercise?.id !== undefined) {
    postCommand(vscodeApi, 'requestProactiveControl', {
        exerciseId: msg.exerciseData.exercise.id,
        courseId: msg.exerciseData.exercise.course?.id,
    });
}
```
- In the `ExtensionMsg.UpdateProactiveControl` handler (5b), **keep the 5b stale-exercise guard** (`msg.exerciseId === exerciseData?.exercise?.id`) — it is the cross-exercise complement to the host-side `_pushSeq` guard (Task 4); without it a late push for a previous exercise can paint the current view:
```ts
if (msg.type === ExtensionMsg.UpdateProactiveControl) {
    if (msg.exerciseId !== exerciseData?.exercise?.id) { return; }   // drop a stale cross-exercise push
    setProactiveControl({ preference: msg.preference, autoPaused: msg.autoPaused, cardState: msg.cardState, reason: msg.cardReason });
}
```
- Pass `cardState`/`reason` into `<AskIris>` (~line 610, extending the 5b VM):
```tsx
proactiveControl={proactiveControl ? {
    preference: proactiveControl.preference,
    autoPaused: proactiveControl.autoPaused,
    cardState: proactiveControl.cardState,
    reason: proactiveControl.reason,
    onToggle: (enabled) => postCommand(vscodeApi, 'setProactiveEnabled', { exerciseId: exercise.id!, enabled, courseId: exercise.course?.id }),
    onResume: () => postCommand(vscodeApi, 'resumeProactive', { exerciseId: exercise.id!, courseId: exercise.course?.id }),
} : undefined}
```
- Render the §14 banner (cases 2-3) just above the Ask Iris section (~line 609), reusing the existing `styles.banner` pattern (line 403 uses `data-variant`):
```tsx
{proactiveControl?.cardState === 'unavailable' && (
    <div className={styles.banner} data-variant="warning">
        {proactiveControl.reason === 'noai'
            ? 'A .noai file disables Iris for this repository, including the chat.'
            : 'Iris is not available for this exercise right now.'}
    </div>
)}
```

- [ ] **Step 5: Run green + type-check + commit**

```bash
( cd /Users/liamberger/Documents/private/MA/artemis-extension/extension && npx vitest run test/react/AskIris.cardState.test.tsx && npm run check-types ) 2>&1 | tail -20
git -C /Users/liamberger/Documents/private/MA/artemis-extension add \
    extension/src/webview/components/AskIris/AskIris.tsx \
    extension/src/webview/components/AskIris/AskIris.module.css \
    extension/src/webview/views/ExerciseDetail/ExerciseDetailView.tsx \
    extension/src/webview/stores/useExerciseDetailStore.ts \
    extension/test/react/AskIris.cardState.test.tsx
git -C /Users/liamberger/Documents/private/MA/artemis-extension commit -m "feat(iris-chat): AskIris four-state availability card + §14 exercise-view banner"
```

---

## Self-review checklist

- **Spec coverage (§12.2 card states):** Available (5b switch, Task 5), Off-course (disabled switch + note, Tasks 4-5), Unavailable (no switch + Ask disabled + banner, Tasks 4-5), Degraded (switch + "limited" note, Tasks 4-5), plus `hidden` for the clean build. The `deriveProactiveCardState` precedence (Task 1) encodes "more-total shut-off wins", tested per §14 row.
- **Spec coverage (§14 matrix):** row 1 → `off-course` (Ask on); rows 2-3 → `unavailable` (Ask off + banner, `.noai` vs iris-off distinguished); rows 4-5 → `degraded` (Ask on, no-AI fallback); row 6 (transient) → `available` self-heal (no false "off"), explicitly tested. The banner appears only for cases 2-3 (the full shut-off), matching "Where the whole feature incl. manual chat is off … explains why".
- **"Thorough" reuse (user decision):** the card uses the **same** §14 classification as the manual chat via the extracted `classifyIrisCourseAvailability` (Task 2); the chat path *delegates* to it, so there is one source of truth and zero drift. The `kind` semantics (Iris-off / 403 / no-opt-in → `disabled`; transient → `unavailable`) are preserved exactly; behaviour-preservation is asserted by re-running the existing chat tests.
- **Seam-safe + clean-build correct (codex r1 Critical fixed):** the `@telemetry` touch is `isProactiveDegraded()` **and an explicit `enginePresent: boolean`** on the handle (real engine `true`, no-op `false`). The clean build passes a *real* no-op `proactiveControl` (not `undefined`), so the card uses `proactiveControl?.enginePresent ?? false` — **not** `!!proactiveControl` — to reach `hidden`. `deriveProactiveCardState` (always-bundled `services/proactiveCardState.ts`) and the command-module changes import nothing from `services/struggle|struggleIntervention`; `classifyIrisCourseAvailability` is in `services/iris/chat` (core). So `verify-clean-bundle.js` stays green and Open-VSX renders plain AskIris.
- **noAi, fail-closed-on-unknown (codex r1 Medium fixed):** read through `providerRegistry.getChatWebviewProvider()?.isNoAiEnabled()` (interface method added in Task 4), but `_push` first `await`s `whenNoAiReady()` so the initial async `.noai` scan can't fail-open on the first render. The actual `.noai` *egress* gate is engine-side (`decideOutcome` reads the live marker), so even the pre-fix window was a display glitch, not a privacy leak.
- **Degraded folds two §14 rows into one boolean:** consent-off (case 4) and 404-latch (case 5) both → `degraded`; the card copy is generic ("limited right now") because §12.2 gives Degraded one term and no full banner — the distinction lives only in the (separately-specced) consent prompt, untouched here.
- **courseId on every command (codex r1 High fixed):** the webview has `exercise.course?.id` (ExerciseDetailView lines 160/550) at every call site, so `requestProactiveControl`/`setProactiveEnabled`/`resumeProactive` all carry it; every `_push` re-derives availability with the course id (no optimistic repaint after a toggle). The host needs no exercise→course resolution.
- **No stale paint (codex r1 High/Low fixed):** `_push` is async, so two guards cooperate — a host-side `_pushSeq` generation counter drops a superseded `_push` before it sends, and the webview keeps the 5b `msg.exerciseId === current` guard for cross-exercise staleness.
- **No crash on a probe failure:** `_push` wraps `classifyIrisCourseAvailability` so any throw → `irisAvailability='unavailable'` → `available` (self-heal), never an exception across the message boundary.
- **Cost:** `_push` adds a profile + settings fetch per `ExerciseDetailInit` / control action — the same pair the manual chat already issues on context load; frequency is low (view open / re-focus / explicit toggle). Flagged, not hidden; caching is deliberately omitted (YAGNI) since the state must stay fresh.
- **Backward-compat:** `requestProactiveControl.courseId` and `UpdateProactiveControl.cardState`/`cardReason` are additive; AskIris renders unchanged when `proactiveControl` is absent (CourseDetailView) or `cardState==='hidden'`. The Ask button gains a `disabled` prop the `Button` component already supports.
- **Placeholder scan:** every step shows the real code or names the exact 5b/existing member it extends (`_push`, `requestProactiveControl`, `checkAndLoadIrisSettings` lines 113-195, `styles.banner` line 403, `isNoAiEnabled` line ~397); tests use canned fakes, no TODOs.
