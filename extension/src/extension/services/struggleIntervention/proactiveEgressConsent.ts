import * as vscode from 'vscode';

import { VSCODE_CONFIG } from '@extension/utils';

export type ProactiveEgressLevel = 'ask' | 'enabled' | 'disabled';

/** Pure gate: only an explicit "enabled" permits proactive code egress. */
export function isProactiveEgressEnabled(level: ProactiveEgressLevel): boolean {
    return level === 'enabled';
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

    /** Prompt once, only while undecided (mirrors ConsentService.promptIfPending). */
    async promptIfAsk(): Promise<void> {
        if (this.level !== 'ask') {
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
