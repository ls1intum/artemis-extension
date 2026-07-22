import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

import type { ProactiveLevel } from '@shared/messageContracts';

import { InterventionService } from '@extension/services/intervention';
import { showStruggleScoreDialog } from '@extension/services/intervention/debug/struggleDebug';
import { anchorRelPath, isAnchorDocument } from '@extension/services/intervention/inlineHint';
import { InlineHintDecoration } from '@extension/services/intervention/inlineHintDecoration';
import { LogCategory, logger } from '@extension/services/loggingService';
import { BackoffGate } from '@extension/services/struggle/alerting/backoffGate';
import { ThrottledAlertSink } from '@extension/services/struggle/alerting/throttledAlertSink';
import { THROTTLE_BY_LEVEL, TUNING } from '@extension/services/struggle/config';
import { LiveEngineFeed } from '@extension/services/struggle/live/liveEngineFeed';
import { StruggleCoordinator } from '@extension/services/struggle/struggleCoordinator';
import type { AlertRecord } from '@extension/services/struggle/types';
import { collectExerciseScopedFiles } from '@extension/services/struggleIntervention/exerciseScopedCollector';
import { InterventionEventLog } from '@extension/services/struggleIntervention/interventionEventLog';
import { ProactiveEgressConsent } from '@extension/services/struggleIntervention/proactiveEgressConsent';
import { subscribeStruggleEvents } from '@extension/services/struggleIntervention/struggleEventSubscription';
import { StruggleInterventionService } from '@extension/services/struggleIntervention/struggleInterventionService';
import { MOCK_NUDGE_EPISODE_ID, pickNudgeText } from '@extension/services/ui/nudgeBannerText';
import { VSCODE_CONFIG } from '@extension/utils';

import type { ILiveEngineFeed, IStruggleCoordinator, StruggleEngineDeps, StruggleEngineHandle } from './contract';
import { formatTick } from './formatTick';

/** Fixed hint text for the dev-only mocked active surface (visual only, carries no real analysis). */
const MOCK_INLINE_HINT = 'Check your loop bounds here';
const MOCK_INLINE_MESSAGE = 'Look at the loop in `isValidSelection` and think about what happens on the very *last* index of the array, then decide whether the bound `size lessThan arrayLength` is right.';

/**
 * Real struggle-detection engine + proactive intervention (full / Marketplace /
 * Desktop build).
 *
 * This module is the SINGLE value entry-point into the struggle/intervention
 * graph: it owns the lamp, the Tier-2 throttle, the proactive orchestrator, the
 * always-on local event log, the consent gate, AND the per-user server-event
 * subscription. Delivery path: coordinator -> ThrottledAlertSink -> orchestrator.
 * The Open VSX build aliases `@telemetry` to ./noop instead, so NONE of these
 * subtrees are bundled there (proved fail-closed by scripts/verify-clean-bundle.js).
 */
export function createStruggleEngine(deps: StruggleEngineDeps): StruggleEngineHandle {
    // Developer-mode diagnostic sink: surfaces engine ticks, the outgoing intervention
    // request, and Iris's inbound response into the "Artemis Extension" output channel.
    // Silent for normal students (gated on artemis.developerMode), so it stays in permanently.
    const isDevMode = (): boolean => vscode.workspace.getConfiguration('artemis').get<boolean>('developerMode', false);
    const devLog = (msg: string): void => { if (isDevMode()) { logger.info(msg, LogCategory.STRUGGLE); } };

    const lamp = new InterventionService();
    deps.context.subscriptions.push(lamp);

    // Always-on, local-only JSONL eval log (no egress).
    const logDir = deps.context.globalStorageUri.fsPath;
    const log = new InterventionEventLog(async line => {
        try {
            await fs.promises.mkdir(logDir, { recursive: true });
            await fs.promises.appendFile(path.join(logDir, 'struggle-interventions.jsonl'), line, 'utf-8');
        }
        catch { /* logging must never break the feature */ }
    }, () => Date.now());

    const consent = new ProactiveEgressConsent();

    // #349: the coordinator's detection-consent gate. Detection observes only while
    // the egress consent is explicitly 'enabled'; the emitter relays every change of
    // the underlying setting so grant/revoke reconcile mid-session.
    const consentChanged = new vscode.EventEmitter<void>();
    deps.context.subscriptions.push(consentChanged);
    deps.context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration(`${VSCODE_CONFIG.IRIS.SECTION}.${VSCODE_CONFIG.IRIS.PROACTIVE_EGRESS_KEY}`)) {
            consentChanged.fire();
        }
    }));

    // Forward ref: the orchestrator's deps read the coordinator lazily (only when
    // an alert fires, well after construction), so the cycle resolves by order.
    let coordinator: StruggleCoordinator;
    // Forward ref: the slot-change sink is registered after the orchestrator is built
    // (via handle.setSlotChangeSink), so we close over a mutable binding.
    let slotChangeSink: () => void = () => {};
    // Nudge-banner text rotation: tracks the last shown title so pickNudgeText never repeats it.
    let lastNudgeTitle: string | undefined;
    // Inline in-editor cue surface (spec §4.1). The getExerciseRoot thunk reads the coordinator lazily (it is
    // assigned below; the thunk only fires on later editor events), so constructing this before it is safe.
    const inline = new InlineHintDecoration(deps.context.extensionUri, () => coordinator.activeExerciseRoot);
    deps.context.subscriptions.push(inline);
    const orchestrator = new StruggleInterventionService({
        isIrisEnabled: () => deps.isIrisEnabled(),
        isEgressEnabled: () => consent.isEnabled,
        hasNoaiMarker: () => {
            const root = coordinator.activeExerciseRoot ?? vscode.workspace.workspaceFolders?.[0]?.uri;
            return root ? fs.existsSync(path.join(root.fsPath, '.noai')) : false;
        },
        getExerciseId: () => coordinator.activeExerciseId,
        getExerciseRoot: () => coordinator.activeExerciseRoot,
        collectFiles: root => collectExerciseScopedFiles(root),
        // Current in-memory text of the anchor file, resolved exercise-root-relative like the anchor
        // surfaces (isAnchorDocument), so the delivery-time rebase reads the same coord system the
        // decoration/jump do. Reads the open buffer (unsaved edits included), undefined if not open.
        readFileContent: anchorFile => {
            const root = coordinator.activeExerciseRoot;
            if (!root) { return undefined; }
            return vscode.workspace.textDocuments.find(d => isAnchorDocument(d, anchorFile, root))?.getText();
        },
        postIntervention: (exId, body) => deps.postIntervention(exId, body),
        openSession: async id => { await deps.openProactiveSession(id); },
        showLamp: () => lamp.showLamp(),
        // Snapshot the absolute anchor Uri at arm time (inverse of the shared relPath in inlineHint.ts),
        // so a later exercise switch cannot retarget the jump click. The orchestrator has already
        // enforced isSafeAnchorPath (one contract for all anchor surfaces), so only the root can be
        // missing here; when it is, clear any stale episode lamp rather than leave a dangling pointer.
        showActiveJump: (anchorFile, anchorLine) => {
            const root = coordinator.activeExerciseRoot;
            if (root) {
                lamp.showJump(vscode.Uri.joinPath(root, ...anchorFile.split('/')), anchorLine);
            } else {
                lamp.clearEpisodeLamp();
            }
        },
        clearLamp: () => lamp.reset(),
        clearEpisodeLamp: () => lamp.clearEpisodeLamp(),
        showInline: (f, l, h, m) => inline.show(f, l, h, m),
        showGutterOnly: (f, l) => inline.showGutterOnly(f, l),
        clearInline: () => inline.clear(),
        postBubble: (text, id, episodeId) => deps.postOptimisticBubble(text, id, episodeId),
        setChatLiveEpisode: episodeId => deps.postLiveEpisode(episodeId),
        isStudentProactiveOn: () => deps.isStudentProactiveOn(),
        getProactiveLevel: () => deps.getProactiveLevel(),
        // Slot + progress-close tuning live in config.ts (TUNING.slot). TUNING.slot is a superset that
        // satisfies both StaleConfig and ProgressCloseCfg, so it feeds both deps; the orchestrator's
        // DEFAULT_SLOT_CFG / DEFAULT_PROGRESS_CFG remain fallbacks for test stubs that omit these.
        slotCfg: TUNING.slot,
        progressCloseCfg: TUNING.slot,
        setBadge: on => deps.setProactiveBadge(on),
        showActiveBanner: (episodeId) => {
            const t = pickNudgeText(lastNudgeTitle);
            lastNudgeTitle = t.title;
            deps.showNudgeBanner(t, episodeId, 15_000);
        },
        hideActiveBanner: () => deps.hideNudgeBanner(),
        // C5: offer-bubble transport (delegated to the chat/nudge providers via extension.ts)
        postOfferBubble: (o) => deps.postOfferBubble(o),
        resolveOfferBubble: (offerId, answered) => deps.resolveOfferBubble(offerId, answered),
        showOfferBanner: (o) => deps.showOfferBanner(o),
        // C2: reveal + episode-outcome (seam-threaded; webview reconcile wired via deps)
        generateLocalId: () => crypto.randomUUID(),
        postRevealBubble: (text, localId) => deps.postRevealBubble(text, localId),
        reconcileOptimisticBubble: (localId, serverId, proactiveEpisodeId, sentAt) =>
            deps.reconcileOptimisticBubble(localId, serverId, proactiveEpisodeId, sentAt),
        revealAmbient: (exerciseId, episodeId, hintText, level, clientMessageId) =>
            deps.revealAmbient(exerciseId, episodeId, hintText, level, clientMessageId),
        setEpisodeOutcome: (exerciseId, episodeId, outcome) =>
            deps.setEpisodeOutcome(exerciseId, episodeId, outcome),
        // C3: slot-continuity seam
        cancelOutstandingStruggleJob: (exerciseId, requestToken) =>
            deps.cancelOutstandingStruggleJob(exerciseId, requestToken),
        // C7: fold episode host->webview
        foldEpisode: (episodeId, outcome, praise) => deps.foldEpisode(episodeId, outcome, praise),
        // C4: stale-row suppression
        postRemoveMessage: (id) => deps.postRemoveMessage(id),
        deleteSupersededProactiveMessage: (exerciseId, messageId) =>
            deps.deleteSupersededProactiveMessage(exerciseId, messageId),
        log,
        devLog,
        onSlotChange: () => slotChangeSink(),
    });

    // Inline-hover action links (spec §4.1, §5.2): Open chat reveals the parked hint and KEEPS the cue as a
    // standing reference; Dismiss removes the cue (pure visual, no episode outcome) -- the hint stays in the
    // chat. The cue also retires on its other lifecycle events (new episode, terminal episode exit); typing
    // does NOT retire it. Registered behind the seam so extension.ts never imports the intervention surface.
    deps.context.subscriptions.push(
        vscode.commands.registerCommand('iris.intervention.inlineOpen', () => {
            // C2 spec §5.2 pull reveal: reveal the parked ambient hint if the slot is PARKED.
            // Safe unconditional call -- revealParkedHint is a no-op when the slot is not PARKED.
            void orchestrator.revealParkedHint();
            void vscode.commands.executeCommand('iris.chatView.focus');
        }),
        vscode.commands.registerCommand('iris.intervention.inlineDismiss', () => {
            // Remove the in-editor cue and the jump lamp that points at it. It does not touch the episode --
            // the hint stays in the chat (mode-guarded: leaves the fallback lamp).
            inline.clear();
            lamp.clearEpisodeLamp();
        }),
    );

    // Single source of truth for the proactive-help level (spec §12.2, issue #341). The level is one
    // remembered setting now, so there is no active-exercise keying; getProactiveLevel() already
    // defaults to 'more' when unset. Read live so a mid-session Off/Less/More flip takes effect at once.
    const getActiveProactiveLevel = (): ProactiveLevel => deps.getProactiveLevel();

    // Tier-2 delivery throttle wraps the orchestrator (downstream of the recorded
    // alert path, so goldens/research are unaffected). Reads THROTTLE_BY_LEVEL live on
    // every deliver() call, keyed by the ACTIVE proactive-help level, so a mid-session
    // Less/More flip takes effect immediately without rebuilding the sink.
    const throttledSink = new ThrottledAlertSink(
        orchestrator,
        () => THROTTLE_BY_LEVEL[getActiveProactiveLevel() === 'less' ? 'less' : 'more'],
    );
    // The suppression gate sits ABOVE the throttle so a provably-discarded alert (course-off / student-opt-out /
    // evidence-gate / delivered-slot) is dropped before the throttle counts it (orchestrator satisfies BackoffSource).
    const backoffGate = new BackoffGate(throttledSink, orchestrator);
    coordinator = new StruggleCoordinator({
        hub: deps.hub,
        alertSink: backoffGate,
        detectionConsent: { isGranted: () => consent.isEnabled, onDidChange: consentChanged.event },
        exerciseRegistry: deps.exerciseRegistry,
    });

    // Every engine tick -> orchestrator trajectory buffer (ungated; gating lives on deliver()).
    // In developer mode, also surface the per-tick decision so it's visible why an alert (does not) fire.
    deps.context.subscriptions.push(coordinator.onDidTick(t => {
        orchestrator.onTick(t);
        // Phase B: pass the live debug snapshot so the one-line tick log also carries the
        // throttle/grace timers (same data source the dev dashboard renders from).
        if (isDevMode()) { devLog(formatTick(t, coordinator.getDebugSnapshot())); }
    }));
    // A lamp click on a surfaced hint reveals the parked ambient hint (C2 spec §5.2 pull reveal).
    // Safe unconditional call -- revealParkedHint is a no-op when the slot is not PARKED.
    deps.context.subscriptions.push(lamp.onDidClick(() => {
        void orchestrator.revealParkedHint();
    }));
    // Inbound per-user struggle events (ambient/active) from the server -> orchestrator.
    // Wired here (behind the seam) so extension.ts never imports struggleIntervention/.
    // The per-user topic is NOT exercise-filtered server-side, so drop any frame whose
    // exerciseId is not the one currently active: a late frame for a previous exercise
    // must never surface in (or consume the per-session budget of) the new session.
    // #349 wave 3: a frame dropped HERE (before the orchestrator ever sees it) still has a chat row
    // the server already persisted, so a post-revocation or wrong-exercise hint could resurface via
    // chat history. Retire that row with identifiers only (never touch hint content). Uses the FRAME's
    // exerciseId for the durable delete, NOT the coordinator's active one -- the inactive-exercise drop
    // is exactly the case where they differ. The delete is best-effort (swallow errors). Mirrors the
    // orchestrator's _dropStaleRow, kept local because these frames never reach the orchestrator.
    const retireDroppedFrameRow = (frameExerciseId: number, messageId: number | null): void => {
        if (messageId === null) { return; }
        deps.postRemoveMessage(messageId);
        void deps.deleteSupersededProactiveMessage(frameExerciseId, messageId).catch(() => { /* best-effort */ });
    };
    deps.context.subscriptions.push(subscribeStruggleEvents(deps.subscribeStruggleTopic, {
        onServerAmbient: (exerciseId, episodeId, hint, anchorFile, anchorLine, inlineHint, c, messageId) => {
            // #349 Finding 4: never surface late inbound hint content (even to the dev log) once
            // consent is revoked; log only redacted metadata and drop the frame before the
            // orchestrator (whose own consent guard stays as defence in depth).
            if (!consent.isEnabled) {
                devLog(`◀ Iris AMBIENT dropped (consent revoked) exercise=${exerciseId}`);
                retireDroppedFrameRow(exerciseId, messageId);
                return;
            }
            // #349 wave 2: metadata only - never log hint content here. The orchestrator has not
            // correlated the frame yet, so this could be a stale pre-revoke hint; content logging
            // lives in the orchestrator AFTER its correlation guard passes.
            const active = exerciseId === coordinator.activeExerciseId;
            devLog(`◀ Iris AMBIENT exercise=${exerciseId} conf=${c ?? 'n/a'}`
                + `${active ? '' : ` DROPPED (active exercise=${coordinator.activeExerciseId})`}`);
            if (active) { orchestrator.onServerAmbient(episodeId, hint, anchorFile, anchorLine, inlineHint, c, messageId); }
            else { retireDroppedFrameRow(exerciseId, messageId); }
        },
        onServerActive: (exerciseId, episodeId, sid, anchorFile, anchorLine, inlineHint, c, message, messageId) => {
            // #349 Finding 4: as onServerAmbient - drop late content once consent is revoked.
            if (!consent.isEnabled) {
                devLog(`◀ Iris ACTIVE dropped (consent revoked) exercise=${exerciseId}`);
                retireDroppedFrameRow(exerciseId, messageId);
                return;
            }
            const active = exerciseId === coordinator.activeExerciseId;
            devLog(`◀ Iris ACTIVE exercise=${exerciseId} session=${sid} conf=${c ?? '–'}`
                + `${active ? '' : ` DROPPED (active exercise=${coordinator.activeExerciseId})`}`);
            if (active) { orchestrator.onServerActive(episodeId, sid, anchorFile, anchorLine, inlineHint, c, message, messageId); }
            else { retireDroppedFrameRow(exerciseId, messageId); }
        },
        onServerSilent: (episodeId, messageId) => {
            devLog(`◀ Iris SILENT episodeId=${episodeId ?? '–'}`);
            orchestrator.onServerSilent(episodeId, messageId);
        },
        onServerClose: (episodeId, resolved, messageId, closingSentence, episodeLabel) => {
            devLog(`◀ Iris CLOSE episodeId=${episodeId ?? '–'} resolved=${resolved}`);
            orchestrator.onServerClose(episodeId, resolved, messageId, closingSentence, episodeLabel);
        },
    }));

    // Developer-only: force a synthetic edit-path alert straight into the orchestrator,
    // bypassing the engine gates (warmup / θ / B2 / B4) and the Tier-2 throttle that make
    // a real alert slow + flaky to provoke. decideOutcome still runs, so egress consent /
    // exercise presence stay realistic: with egress on you get the full POST → Pyris →
    // bubble round-trip, otherwise it ends silently (logged, no local surface).
    const forceFullPipeline = (): void => {
        const snap = coordinator.getSnapshot();
        const forced: AlertRecord = {
            kind: 'edit',
            t: Math.round(snap.sessionSeconds),
            ts: Date.now(),
            urgency: 1,
            typesPreGate: ['STATE'],
            types: ['STATE'],
            primary: 'STATE',
            path: 'armed',
            inWarmup: false,
            inGrace: false,
        };
        devLog('▶ FORCED intervention (dev command): synthetic edit alert boundary=STATE urgency=1 → orchestrator.deliver()');
        orchestrator.deliver(forced);
        void vscode.window.showInformationMessage('Artemis (Dev): forced a struggle intervention — watch the [Struggle] output channel.');
    };

    // The mock surfaces below call the visual sinks (banner / lamp / badge / inline) DIRECTLY and
    // never touch the orchestrator or its slot, so nothing is persisted and the slot stays FREE for
    // a real alert. The inline/gutter cue is best-effort: it renders only when an exercise is active
    // and an editor is open, anchored at the current cursor line (same coord system as real anchors).
    const mockActive = (): void => {
        const t = pickNudgeText(lastNudgeTitle);
        lastNudgeTitle = t.title;
        // Sentinel episodeId: the banner's action buttons are gated on it downstream, so a mock
        // banner never mutates real backoff/episode state (see MOCK_NUDGE_EPISODE_ID).
        deps.showNudgeBanner(t, MOCK_NUDGE_EPISODE_ID, 15_000);
        const root = coordinator.activeExerciseRoot;
        const editor = vscode.window.activeTextEditor;
        if (root && editor) {
            const line = editor.selection.active.line + 1;
            inline.show(anchorRelPath(root, editor.document.uri), line, MOCK_INLINE_HINT, MOCK_INLINE_MESSAGE);
            lamp.showJump(editor.document.uri, line);
        }
        devLog('▶ MOCK active proactivity (dev): banner + inline cue (visual only, no slot, no persist)');
    };
    const mockAmbient = (): void => {
        lamp.showLamp();
        deps.setProactiveBadge(true);
        const root = coordinator.activeExerciseRoot;
        const editor = vscode.window.activeTextEditor;
        if (root && editor) {
            inline.showGutterOnly(anchorRelPath(root, editor.document.uri), editor.selection.active.line + 1);
        }
        devLog('▶ MOCK ambient proactivity (dev): lamp + badge + gutter cue (visual only, no slot, no persist)');
    };
    const clearMockedSurfaces = (): void => {
        deps.hideNudgeBanner();
        lamp.reset();
        inline.clear();
        deps.setProactiveBadge(false);
        devLog('▶ Cleared mocked proactivity surfaces (dev command)');
    };

    // The command is now a submenu: the real force path plus purely-visual ambient/active mocks.
    // Palette entry is dev-gated (config.artemis.developerMode) but re-check here in case it is
    // invoked programmatically.
    deps.context.subscriptions.push(vscode.commands.registerCommand('artemis.forceStruggleIntervention', async () => {
        if (!isDevMode()) {
            void vscode.window.showWarningMessage('Artemis: the struggle-intervention dev menu is developer-mode only.');
            return;
        }
        type MenuItem = vscode.QuickPickItem & { run: () => void };
        const pick = await vscode.window.showQuickPick<MenuItem>(
            [
                { label: '$(zap) Force struggle intervention', description: 'full pipeline — real deliver, POSTs to Iris, occupies the slot', run: forceFullPipeline },
                { label: '$(comment-discussion) Mock active proactivity', description: 'banner + inline cue · visual only (no slot, no persist)', run: mockActive },
                { label: '$(lightbulb) Mock ambient proactivity', description: 'lamp + badge + gutter cue · visual only (no slot, no persist)', run: mockAmbient },
                { label: '$(clear-all) Clear mocked surfaces', description: 'hide the banner and remove the lamp / badge / inline cue', run: clearMockedSurfaces },
            ],
            { title: 'Artemis: Struggle Intervention (Developer)', placeHolder: 'Pick an action' },
        );
        pick?.run();
    }));

    return {
        coordinator,
        promptConsentIfAsk: () => consent.promptIfAsk(),
        // Same hoisted getter the delivery throttle reads (later also read by the Pull re-route).
        getActiveProactiveLevel,
        setStudentProactive: (exerciseId, on) => orchestrator.setStudentProactive(exerciseId, on),
        getProactiveGateState: () => orchestrator.getProactiveGateState(),
        setInSession: (open: boolean) => orchestrator.setInSession(open),
        // C8: episode-scoped dismiss (seam callback threaded to setStruggleCallbacks.onEpisodeDismiss)
        dismissEpisode: (episodeId?: string) => orchestrator.dismissEpisode(episodeId),
        // "Solved it" positive close (RECOVERED); seam callback to setStruggleCallbacks.onEpisodeResolve.
        resolveEpisode: (episodeId?: string) => orchestrator.resolveEpisode(episodeId),
        // Slot debug (Task 4): expose orchestrator snapshot/history + register the change sink.
        getSlotDebugSnapshot: () => orchestrator.getSlotDebugSnapshot(),
        getEpisodeHistory: () => orchestrator.getEpisodeHistory(),
        setSlotChangeSink: (fn: () => void) => { slotChangeSink = fn; },
        handleBannerAction: (payload) => {
            if ('moment' in payload) {
                const { moment, action, episodeId, offerId } = payload;
                if (episodeId === MOCK_NUDGE_EPISODE_ID || !episodeId) { return; }
                if (moment === 'stuck') {
                    if (action === 'accept') { orchestrator.acceptOffer(offerId ?? '', episodeId); }
                    else if (action === 'decline') { orchestrator.declineOffer(offerId ?? '', episodeId); }
                    else if (action === 'timeout') { orchestrator.offerTimedOut(offerId ?? '', episodeId); }
                } else {
                    if (action === 'accept') { orchestrator.needMoreHelp(offerId ?? '', episodeId); }
                    else if (action === 'decline') { orchestrator.stillOnIt(offerId ?? '', episodeId); }
                    // abandon/timeout: no action here; the watchdog force-free owns it (C7).
                }
                return;
            }
            // LEGACY active banner (unchanged behaviour):
            const { action, episodeId } = payload;
            // 'showMe' also navigates to the flagged line by reusing the already-armed jump lamp (a
            // no-op when no anchor is armed). Done before the mock guard so the dev mock jumps too and
            // stays testable; recording an outcome / opening the chat stays real-only.
            if (action === 'showMe') { lamp.revealJumpTarget(); }
            // Dev mock banner: purely visual, so its buttons must not touch real episode state.
            if (episodeId === MOCK_NUDGE_EPISODE_ID) { return; }
            // 'showMe' opens the chat (wired in extension.ts); 'dismiss' closes the episode; 'timeout' → no outcome.
            if (action === 'dismiss') { orchestrator.dismissEpisode(episodeId); }
        },
    };
}

/**
 * Builds the live engine-decision feed for the developer-mode struggle view.
 * Kept behind the seam so the clean build never imports {@link LiveEngineFeed}
 * (it lives under the build-excluded `services/struggle/` subtree).
 */
export function createLiveEngineFeed(
    coordinator: IStruggleCoordinator,
    isDeveloperMode: () => boolean,
): ILiveEngineFeed {
    return new LiveEngineFeed(coordinator, isDeveloperMode);
}

/** Registers the struggle-score debug command (full build only). */
export function registerDebugCommands(coordinator: IStruggleCoordinator): vscode.Disposable {
    const showScore = vscode.commands.registerCommand('artemis.showStruggleScore', async () => {
        await showStruggleScoreDialog(coordinator.getSnapshot());
    });
    const toggleWarmup = vscode.commands.registerCommand('artemis.toggleStruggleWarmupSkip', () => {
        const skipped = coordinator.toggleSkipWarmup();
        void vscode.window.showInformationMessage(
            skipped
                ? 'Artemis: struggle warm-up SKIPPED — D1 off, alerts can fire immediately (dev).'
                : 'Artemis: struggle warm-up restored to the default (8 min).',
        );
    });
    return vscode.Disposable.from(showScore, toggleWarmup);
}
