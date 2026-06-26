import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

import { InterventionService } from '@extension/services/intervention';
import { showStruggleScoreDialog } from '@extension/services/intervention/debug/struggleDebug';
import { LogCategory, logger } from '@extension/services/loggingService';
import { ThrottledAlertSink } from '@extension/services/struggle/alerting/throttledAlertSink';
import { TUNING } from '@extension/services/struggle/config';
import { LiveEngineFeed } from '@extension/services/struggle/live/liveEngineFeed';
import { StruggleCoordinator } from '@extension/services/struggle/struggleCoordinator';
import type { TickRecord } from '@extension/services/struggle/types';
import { showActiveNotification } from '@extension/services/struggleIntervention/activeNotification';
import { collectExerciseScopedFiles } from '@extension/services/struggleIntervention/exerciseScopedCollector';
import { InterventionEventLog } from '@extension/services/struggleIntervention/interventionEventLog';
import { ProactiveEgressConsent } from '@extension/services/struggleIntervention/proactiveEgressConsent';
import { subscribeStruggleEvents } from '@extension/services/struggleIntervention/struggleEventSubscription';
import { StruggleInterventionService } from '@extension/services/struggleIntervention/struggleInterventionService';

import type { ILiveEngineFeed, IStruggleCoordinator, StruggleEngineDeps, StruggleEngineHandle } from './contract';

/** One-line developer-mode summary of a single engine tick (urgency vs θ + the gates that suppressed it). */
function formatTick(t: TickRecord): string {
    const d = t.decisionTrace;
    const gatesOn = Object.entries(d.gates).filter(([, on]) => on).map(([name]) => name);
    const why = d.outcome === 'suppressed' && gatesOn.length > 0 ? ` (gates: ${gatesOn.join(', ')})` : '';
    const boundaries = d.boundariesPresent.length > 0 ? d.boundariesPresent.join('+') : '–';
    const typing = d.typingRate === null ? '–' : `${Math.round(d.typingRate)}`;
    return `tick t=${t.t}s urgency=${d.urgency.toFixed(2)}/θ${d.theta.toFixed(2)} `
        + `typing=${typing}/min boundaries=[${boundaries}] → ${d.outcome}${why}`;
}

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
        clearLamp: () => lamp.reset(),
        setBadge: on => deps.setProactiveBadge(on),
        showActiveNotification: () => showActiveNotification(() => orchestrator.recordOutcome('clicked')),
        log,
        devLog,
    });

    // Tier-2 delivery throttle wraps the orchestrator (downstream of the recorded
    // alert path, so goldens/research are unaffected). Reads TUNING defaults.
    const throttledSink = new ThrottledAlertSink(orchestrator, TUNING);
    coordinator = new StruggleCoordinator({
        hub: deps.hub,
        alertSink: throttledSink,
        exerciseRegistry: deps.exerciseRegistry,
    });

    // Every engine tick -> orchestrator trajectory buffer (ungated; gating lives on deliver()).
    // In developer mode, also surface the per-tick decision so it's visible why an alert (does not) fire.
    deps.context.subscriptions.push(coordinator.onDidTick(t => {
        orchestrator.onTick(t);
        if (isDevMode()) { devLog(formatTick(t)); }
    }));
    // A lamp click on a surfaced hint is an engagement signal for the local eval log.
    deps.context.subscriptions.push(lamp.onDidClick(() => orchestrator.recordOutcome('clicked')));
    // Inbound per-user struggle events (ambient/active) from the server -> orchestrator.
    // Wired here (behind the seam) so extension.ts never imports struggleIntervention/.
    // The per-user topic is NOT exercise-filtered server-side, so drop any frame whose
    // exerciseId is not the one currently active: a late frame for a previous exercise
    // must never surface in (or consume the per-session budget of) the new session.
    deps.context.subscriptions.push(subscribeStruggleEvents(deps.subscribeStruggleTopic, {
        onServerAmbient: (exerciseId, hint, c) => {
            const active = exerciseId === coordinator.activeExerciseId;
            devLog(`◀ Iris AMBIENT exercise=${exerciseId} conf=${c ?? '–'}`
                + `${active ? '' : ` DROPPED (active exercise=${coordinator.activeExerciseId})`}: "${hint}"`);
            if (active) { orchestrator.onServerAmbient(hint, c); }
        },
        onServerActive: (exerciseId, sid, c) => {
            const active = exerciseId === coordinator.activeExerciseId;
            devLog(`◀ Iris ACTIVE exercise=${exerciseId} session=${sid} conf=${c ?? '–'}`
                + `${active ? '' : ` DROPPED (active exercise=${coordinator.activeExerciseId})`}`);
            if (active) { orchestrator.onServerActive(sid, c); }
        },
    }));

    return { coordinator, promptConsentIfAsk: () => consent.promptIfAsk() };
}

/**
 * Builds the live engine-decision feed for the developer-mode struggle view.
 * Kept behind the seam so the clean build never imports {@link LiveEngineFeed}
 * (it lives under the build-excluded `services/struggle/` subtree).
 */
export function createLiveEngineFeed(
    coordinator: IStruggleCoordinator,
    post: (msg: unknown) => void,
    isDeveloperMode: () => boolean,
): ILiveEngineFeed {
    return new LiveEngineFeed(coordinator, post, isDeveloperMode);
}

/** Registers the struggle-score debug command (full build only). */
export function registerDebugCommands(coordinator: IStruggleCoordinator): vscode.Disposable {
    return vscode.commands.registerCommand('artemis.showStruggleScore', async () => {
        await showStruggleScoreDialog(coordinator.getSnapshot());
    });
}
