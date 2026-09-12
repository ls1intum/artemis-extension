import * as vscode from 'vscode';

import { VSCODE_CONFIG } from '@extension/utils';

export type ProactiveEgressLevel = 'ask' | 'enabled' | 'disabled';

/** Pure gate: only an explicit "enabled" permits proactive code egress. */
export function isProactiveEgressEnabled(level: ProactiveEgressLevel): boolean {
    return level === 'enabled';
}

/**
 * Whether Artemis can act on proactive help yet.
 *
 * The server side lives in Artemis #13023, which is not released. Against a server without it the
 * first intervention gets a 404, the orchestrator latches `serverAvailable = false`, and every
 * alert after that takes the silent path. Nothing breaks, but a student who accepted a prompt
 * would be waiting for help that can never arrive, with nothing to tell them why.
 *
 * Flip this to `true` in the release that follows the Artemis one, and replace it with a read of
 * `proactiveStruggleEnabled` from the course's Iris settings once that field is dependable. It is
 * not yet: `IrisCourseSettings` is serialized NON_EMPTY with the field nullable, so its absence
 * means "no instructor has set it" just as much as "this server is too old".
 */
const SERVER_FEATURE_RELEASED = false;

/**
 * Whether to ask the student about proactive help at all.
 *
 * Separate from {@link isProactiveEgressEnabled}: that one decides whether code may leave, this
 * one decides whether the question is worth asking. Undecided is a precondition, not the only one.
 */
export function shouldAskForProactiveEgress(level: ProactiveEgressLevel): boolean {
    return SERVER_FEATURE_RELEASED && level === 'ask';
}

export class ProactiveEgressConsent {
    get level(): ProactiveEgressLevel {
        return vscode.workspace
            .getConfiguration(VSCODE_CONFIG.IRIS.SECTION)
            .get<ProactiveEgressLevel>(VSCODE_CONFIG.IRIS.PROACTIVE_EGRESS_KEY, 'ask');
    }

    get isEnabled(): boolean {
        return isProactiveEgressEnabled(this.level);
    }

    private async set(level: ProactiveEgressLevel): Promise<void> {
        await vscode.workspace
            .getConfiguration(VSCODE_CONFIG.IRIS.SECTION)
            .update(VSCODE_CONFIG.IRIS.PROACTIVE_EGRESS_KEY, level, vscode.ConfigurationTarget.Global);
    }

    /**
     * Prompt once, only while undecided AND only while the question is worth asking
     * (see {@link shouldAskForProactiveEgress}). Mirrors ConsentService.promptIfPending.
     */
    async promptIfAsk(): Promise<void> {
        if (!shouldAskForProactiveEgress(this.level)) {
            return;
        }
        const choice = await vscode.window.showInformationMessage(
            'Allow Iris to detect when you might be stuck and proactively offer help? This enables local typing/pause analysis during programming exercises; your code is only sent to Iris when the detector triggers.',
            'Enable', 'Not now', 'Settings',
        );
        if (choice === 'Enable') {
            await this.set('enabled');
        } else if (choice === 'Not now') {
            await this.set('disabled');
        } else if (choice === 'Settings') {
            await vscode.commands.executeCommand(
                'workbench.action.openSettings',
                `${VSCODE_CONFIG.IRIS.SECTION}.${VSCODE_CONFIG.IRIS.PROACTIVE_EGRESS_KEY}`,
            );
        }
        // dismissed → stays 'ask', may prompt again later
    }
}
