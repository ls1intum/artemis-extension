import * as vscode from 'vscode';

import { InterventionService } from '@extension/services/intervention';
import { showStruggleScoreDialog } from '@extension/services/intervention/debug/struggleDebug';
import { ThrottledAlertSink } from '@extension/services/struggle/alerting/throttledAlertSink';
import { TUNING } from '@extension/services/struggle/config';
import { StruggleCoordinator } from '@extension/services/struggle/struggleCoordinator';

import type { IStruggleCoordinator, StruggleEngineDeps } from './contract';

/**
 * Real struggle-detection engine (full / Marketplace / Desktop build).
 *
 * This module is the SINGLE value entry-point into the struggle/intervention
 * engine: it owns the whole live value graph (InterventionService + Tier-2
 * ThrottledAlertSink + StruggleCoordinator). The Open VSX build aliases
 * `@telemetry` to ./noop instead, so none of those subtrees are bundled there
 * (proved fail-closed by scripts/verify-clean-bundle.js).
 */
export function createStruggleEngine(deps: StruggleEngineDeps): IStruggleCoordinator {
    const interventionService = new InterventionService();
    deps.context.subscriptions.push(interventionService);
    // Tier-2 delivery throttle wraps the UI sink (downstream of the recorded
    // alert path, so goldens/research are unaffected). Reads TUNING defaults.
    const throttledSink = new ThrottledAlertSink(interventionService, TUNING);
    return new StruggleCoordinator({
        hub: deps.hub,
        alertSink: throttledSink,
        exerciseRegistry: deps.exerciseRegistry,
    });
}

/** Registers the struggle-score debug command (full build only). */
export function registerDebugCommands(coordinator: IStruggleCoordinator): vscode.Disposable {
    return vscode.commands.registerCommand('artemis.showStruggleScore', async () => {
        await showStruggleScoreDialog(coordinator.getSnapshot());
    });
}
