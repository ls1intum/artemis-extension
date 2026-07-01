import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

import { InterventionService } from '@extension/services/intervention';
import { showStruggleScoreDialog } from '@extension/services/intervention/debug/struggleDebug';
import { isAnchorLive } from '@extension/services/intervention/inlineHint';
import { InlineHintDecoration } from '@extension/services/intervention/inlineHintDecoration';
import { LogCategory, logger } from '@extension/services/loggingService';
import { BackoffGate } from '@extension/services/struggle/alerting/backoffGate';
import { ThrottledAlertSink } from '@extension/services/struggle/alerting/throttledAlertSink';
import { TUNING } from '@extension/services/struggle/config';
import { LiveEngineFeed } from '@extension/services/struggle/live/liveEngineFeed';
import { StruggleCoordinator } from '@extension/services/struggle/struggleCoordinator';
import type { AlertRecord } from '@extension/services/struggle/types';
import { showActiveNotification } from '@extension/services/struggleIntervention/activeNotification';
import { collectExerciseScopedFiles } from '@extension/services/struggleIntervention/exerciseScopedCollector';
import { InterventionEventLog } from '@extension/services/struggleIntervention/interventionEventLog';
import { ProactiveEgressConsent } from '@extension/services/struggleIntervention/proactiveEgressConsent';
import { subscribeStruggleEvents } from '@extension/services/struggleIntervention/struggleEventSubscription';
import { StruggleInterventionService } from '@extension/services/struggleIntervention/struggleInterventionService';

import type { ILiveEngineFeed, IStruggleCoordinator, StruggleEngineDeps, StruggleEngineHandle } from './contract';
import { formatTick } from './formatTick';

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

    // Forward ref: the orchestrator's deps read the coordinator lazily (only when
    // an alert fires, well after construction), so the cycle resolves by order.
    let coordinator: StruggleCoordinator;
    // Forward ref: the slot-change sink is registered after the orchestrator is built
    // (via handle.setSlotChangeSink), so we close over a mutable binding.
    let slotChangeSink: () => void = () => {};
    // Inline in-editor cue surface (spec §4.1). The getExerciseRoot thunk reads the coordinator lazily (it is
    // assigned below; the thunk only fires on later editor events), so constructing this before it is safe.
    const inline = new InlineHintDecoration(deps.context.extensionUri, () => coordinator.activeExerciseRoot);
    deps.context.subscriptions.push(inline);
    const orchestrator = new StruggleInterventionService({
        isEgressEnabled: () => consent.isEnabled,
        hasNoaiMarker: () => {
            const root = coordinator.activeExerciseRoot ?? vscode.workspace.workspaceFolders?.[0]?.uri;
            return root ? fs.existsSync(path.join(root.fsPath, '.noai')) : false;
        },
        getExerciseId: () => coordinator.activeExerciseId,
        getExerciseRoot: () => coordinator.activeExerciseRoot,
        collectFiles: root => collectExerciseScopedFiles(root),
        postIntervention: (exId, body) => deps.postIntervention(exId, body),
        openSession: async id => { await deps.openProactiveSession(id); },
        showAmbient: (hint, opensChat) => lamp.showAmbient(hint, opensChat),
        showLamp: () => lamp.showLamp(),
        clearLamp: () => lamp.reset(),
        showInline: (f, l, h, m) => inline.show(f, l, h, m),
        showGutterOnly: (f, l) => inline.showGutterOnly(f, l),
        clearInline: () => inline.clear(),
        postBubble: (text, id) => deps.postOptimisticBubble(text, id),
        isAnchorLive: (f, l) => isAnchorLive(f, l, vscode.window.visibleTextEditors, coordinator.activeExerciseRoot),
        isStudentProactiveOn: exerciseId => deps.isStudentProactiveOn(exerciseId),
        softThreshold: TUNING.softThreshold,
        pauseStrikes: TUNING.pauseStrikes,
        setBadge: on => deps.setProactiveBadge(on),
        showActiveNotification: () => showActiveNotification(
            () => orchestrator.recordOutcome('clicked'),
            () => {
                // C8: keep the existing backoff bump, and also perform the episode-scoped
                // resolution (free the slot, write DISMISSED outcome, fold the episode).
                // recordOutcome is NOT inside dismissEpisode to avoid double-counting
                // with the card path (which bumps the backoff via _onDidDismissProactive).
                orchestrator.recordOutcome('dismissed');
                orchestrator.dismissEpisode();
            },
        ),
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
        postStaleAsk: (e, a, m, q) => deps.postStaleAsk(e, a, m, q),
        log,
        devLog,
        onSlotChange: () => slotChangeSink(),
    });

    // Inline-hover action links (spec §4.1, §5.2): Open chat engages (clears backoff) and KEEPS the cue as a
    // standing reference; Hide inline removes the cue with NO backoff (pure visual); Dismiss (→ backoff)
    // removes it. The cue also retires on its other lifecycle events (student edit, new episode, terminal
    // episode exit). Registered behind the seam so extension.ts never imports the intervention surface.
    deps.context.subscriptions.push(
        vscode.commands.registerCommand('iris.intervention.inlineOpen', () => {
            orchestrator.recordOutcome('clicked');
            // C2 spec §5.2 pull reveal: reveal the parked ambient hint if the slot is PARKED.
            // Safe unconditional call -- revealParkedHint is a no-op when the slot is not PARKED.
            void orchestrator.revealParkedHint();
            void vscode.commands.executeCommand('iris.chatView.focus');
        }),
        vscode.commands.registerCommand('iris.intervention.inlineHide', () => {
            // Pure visual hide: remove the in-editor cue only. Unlike Dismiss it records NO outcome
            // (no reject-backoff) and does not touch the episode -- the hint stays in the chat.
            inline.clear();
        }),
        vscode.commands.registerCommand('iris.intervention.inlineDismiss', () => {
            orchestrator.recordOutcome('dismissed');
            inline.clear();
        }),
    );

    // Tier-2 delivery throttle wraps the orchestrator (downstream of the recorded
    // alert path, so goldens/research are unaffected). Reads TUNING defaults.
    const throttledSink = new ThrottledAlertSink(orchestrator, TUNING);
    // Reject backoff sits ABOVE the throttle so a paused/soft-skipped alert is dropped before the throttle counts
    // it (the orchestrator owns the counters and satisfies BackoffSource via isPaused/tryConsumeSoftSkip).
    const backoffGate = new BackoffGate(throttledSink, orchestrator);
    coordinator = new StruggleCoordinator({
        hub: deps.hub,
        alertSink: backoffGate,
        exerciseRegistry: deps.exerciseRegistry,
    });

    // Every engine tick -> orchestrator trajectory buffer (ungated; gating lives on deliver()).
    // In developer mode, also surface the per-tick decision so it's visible why an alert (does not) fire.
    deps.context.subscriptions.push(coordinator.onDidTick(t => {
        orchestrator.onTick(t);
        // Phase B: pass the live debug snapshot so the one-line tick log also carries the
        // throttle/grace/fN2 timers (same data source the dev dashboard renders from).
        if (isDevMode()) { devLog(formatTick(t, coordinator.getDebugSnapshot())); }
    }));
    // A lamp click on a surfaced hint is an engagement signal for the local eval log.
    // C2 spec §5.2 pull reveal: also reveal the parked ambient hint. Safe unconditional call --
    // revealParkedHint is a no-op when the slot is not PARKED.
    deps.context.subscriptions.push(lamp.onDidClick(() => {
        orchestrator.recordOutcome('clicked');
        void orchestrator.revealParkedHint();
    }));
    // Inbound per-user struggle events (ambient/active) from the server -> orchestrator.
    // Wired here (behind the seam) so extension.ts never imports struggleIntervention/.
    // The per-user topic is NOT exercise-filtered server-side, so drop any frame whose
    // exerciseId is not the one currently active: a late frame for a previous exercise
    // must never surface in (or consume the per-session budget of) the new session.
    deps.context.subscriptions.push(subscribeStruggleEvents(deps.subscribeStruggleTopic, {
        onServerAmbient: (exerciseId, hint, anchorFile, anchorLine, inlineHint, c, messageId) => {
            const active = exerciseId === coordinator.activeExerciseId;
            devLog(`◀ Iris AMBIENT exercise=${exerciseId} conf=${c ?? '–'}`
                + `${active ? '' : ` DROPPED (active exercise=${coordinator.activeExerciseId})`}: "${hint}"`);
            if (active) { orchestrator.onServerAmbient(hint, anchorFile, anchorLine, inlineHint, c, messageId); }
        },
        onServerActive: (exerciseId, sid, anchorFile, anchorLine, inlineHint, c, message, messageId) => {
            const active = exerciseId === coordinator.activeExerciseId;
            devLog(`◀ Iris ACTIVE exercise=${exerciseId} session=${sid} conf=${c ?? '–'}`
                + `${active ? '' : ` DROPPED (active exercise=${coordinator.activeExerciseId})`}`);
            if (active) { orchestrator.onServerActive(sid, anchorFile, anchorLine, inlineHint, c, message, messageId); }
        },
        onServerSilent: (episodeId, messageId) => {
            devLog(`◀ Iris SILENT episodeId=${episodeId ?? '–'}`);
            orchestrator.onServerSilent(episodeId, messageId);
        },
        onServerClose: (episodeId, resolved, messageId, closingSentence, episodeLabel) => {
            devLog(`◀ Iris CLOSE episodeId=${episodeId ?? '–'} resolved=${resolved}`);
            orchestrator.onServerClose(episodeId, resolved, messageId, closingSentence, episodeLabel);
        },
        onServerStale: (episodeId, ask, messageId, question) => {
            devLog(`◀ Iris STALE episodeId=${episodeId ?? '–'} ask=${ask}`);
            orchestrator.onServerStale(episodeId, ask, messageId, question);
        },
    }));

    // Developer-only: force a synthetic edit-path alert straight into the orchestrator,
    // bypassing the engine gates (warmup / θ / B2 / B4) and the Tier-2 throttle that make
    // a real alert slow + flaky to provoke. decideOutcome still runs, so egress consent /
    // exercise presence stay realistic: with egress on you get the full POST → Pyris →
    // bubble round-trip, otherwise the local fallback lamp. Palette entry is dev-gated.
    deps.context.subscriptions.push(vscode.commands.registerCommand('artemis.forceStruggleIntervention', () => {
        if (!isDevMode()) {
            void vscode.window.showWarningMessage('Artemis: "Force Struggle Intervention" is developer-mode only.');
            return;
        }
        const snap = coordinator.getSnapshot();
        const forced: AlertRecord = {
            kind: 'edit',
            t: Math.round(snap.sessionSeconds),
            ts: Date.now(),
            urgency: 1,
            v: snap.v,
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
    }));

    return {
        coordinator,
        promptConsentIfAsk: () => consent.promptIfAsk(),
        recordProactiveDismiss: () => orchestrator.recordChatDismiss(),
        isProactivePaused: exerciseId => orchestrator.isProactivePaused(exerciseId),
        setStudentProactive: (exerciseId, on) => orchestrator.setStudentProactive(exerciseId, on),
        resumeProactive: exerciseId => orchestrator.resumeProactive(exerciseId),
        isProactiveDegraded: () => orchestrator.isProactiveDegraded(),
        setInSession: (open: boolean) => orchestrator.setInSession(open),
        // C5: stale-ask button + free-text grace hook
        onStaleAskButton: (askId, button) => orchestrator.onStaleAskButton(askId, button),
        onFreeTextReply: () => orchestrator.onFreeTextReply(),
        // C8: episode-scoped dismiss (seam callback threaded to setStruggleCallbacks.onEpisodeDismiss)
        dismissEpisode: (episodeId?: string) => orchestrator.dismissEpisode(episodeId),
        // Slot debug (Task 4): expose orchestrator snapshot/history + register the change sink.
        getSlotDebugSnapshot: () => orchestrator.getSlotDebugSnapshot(),
        getEpisodeHistory: () => orchestrator.getEpisodeHistory(),
        setSlotChangeSink: (fn: () => void) => { slotChangeSink = fn; },
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
    return vscode.commands.registerCommand('artemis.showStruggleScore', async () => {
        await showStruggleScoreDialog(coordinator.getSnapshot());
    });
}
