import * as vscode from 'vscode';

import type { BuildResultTracker } from './buildResultTracker';
import type { InactivityService } from './inactivityService';
import type { AdaptiveCadence } from './intervention/adaptiveCadence';
import type { ErrorQuotientEngine } from './metrics/errorQuotientEngine';
import { EQConfidence, RecommendedAction } from './types';

interface DebugDashboardDeps {
    eqEngine: ErrorQuotientEngine;
    inactivityService: InactivityService;
    buildTracker: BuildResultTracker;
    adaptiveCadence: AdaptiveCadence;
    outputChannel: vscode.OutputChannel;
    getRecommendedAction: (eq: number, confidence: EQConfidence) => RecommendedAction;
}

/**
 * Developer-mode debug UI for the EQ-based struggle detection system.
 *
 * Shows a live status bar item with the current EQ score, provides a QuickPick
 * detail dialog, and logs telemetry state to a dedicated output channel.
 */
export class DebugDashboard implements vscode.Disposable {
    private static readonly DEBUG_UPDATE_INTERVAL_MS = 5 * 1000;

    private readonly _statusBarItem: vscode.StatusBarItem;
    private _updateTimer: NodeJS.Timeout | undefined;
    private readonly _deps: DebugDashboardDeps;

    constructor(deps: DebugDashboardDeps) {
        this._deps = deps;
        this._statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Left,
            1000,
        );
        this._statusBarItem.command = 'artemis.showStruggleScore';
    }

    public dispose(): void {
        this.stop();
        this._statusBarItem.dispose();
    }

    public start(): void {
        this._update();
        this._statusBarItem.show();

        this._updateTimer = setInterval(() => {
            this._update();
        }, DebugDashboard.DEBUG_UPDATE_INTERVAL_MS);
    }

    public stop(): void {
        if (this._updateTimer) {
            clearInterval(this._updateTimer);
            this._updateTimer = undefined;
        }
        this._statusBarItem.hide();
    }

    public async showStruggleScoreDialog(): Promise<void> {
        const { eq, confidence } = this._deps.eqEngine.getCurrentEQ();
        const state = this._deps.eqEngine.getState();
        const action = this._deps.getRecommendedAction(eq, confidence);

        this.logCurrentState();
        this._deps.outputChannel.show(true);

        const items: vscode.QuickPickItem[] = [
            {
                label: `$(graph) EQ: ${(eq * 100).toFixed(1)}%`,
                description: `Action: ${action}`,
                detail: `Confidence: ${confidence}, ${state.pairCount} pairs`,
            },
            { label: '', kind: vscode.QuickPickItemKind.Separator },
            {
                label: `$(beaker) Snapshots: ${state.snapshots.length}`,
                description: `${state.pairCount} scored pairs`,
            },
            {
                label: `$(watch) Activity: ${this._deps.inactivityService.getCurrentPattern()}`,
                description: `Time since edit: ${Math.round(this._deps.inactivityService.getTimeSinceLastEdit() / 1000)}s`,
            },
            {
                label: `$(cloud) Build Failures: ${this._deps.buildTracker.getConsecutiveFailures()}`,
                description: 'Consecutive server build failures',
            },
            { label: '', kind: vscode.QuickPickItemKind.Separator },
            {
                label: '$(output) Show Output Channel',
                description: 'View detailed telemetry logs',
            },
            {
                label: '$(refresh) Refresh',
                description: 'Recalculate EQ',
            },
        ];

        const selection = await vscode.window.showQuickPick(items, {
            title: 'Artemis Telemetry — Error Quotient',
            placeHolder: 'Current EQ-based struggle detection metrics',
        });

        if (selection?.label === '$(output) Show Output Channel') {
            this._deps.outputChannel.show();
        } else if (selection?.label === '$(refresh) Refresh') {
            await this.showStruggleScoreDialog();
        }
    }

    public logCurrentState(): void {
        const { eq, confidence } = this._deps.eqEngine.getCurrentEQ();
        const state = this._deps.eqEngine.getState();
        const pattern = this._deps.inactivityService.getCurrentPattern();

        this._deps.outputChannel.appendLine('');
        this._deps.outputChannel.appendLine('═══════════════════════════════════════');
        this._deps.outputChannel.appendLine('       TELEMETRY STATE (EQ SYSTEM)');
        this._deps.outputChannel.appendLine('═══════════════════════════════════════');
        this._deps.outputChannel.appendLine(`Time: ${new Date().toLocaleString()}`);
        this._deps.outputChannel.appendLine('');
        this._deps.outputChannel.appendLine('EQ METRICS');
        this._deps.outputChannel.appendLine(`   EQ: ${(eq * 100).toFixed(1)}%`);
        this._deps.outputChannel.appendLine(`   Confidence: ${confidence}`);
        this._deps.outputChannel.appendLine(`   Snapshots: ${state.snapshots.length}`);
        this._deps.outputChannel.appendLine(`   Pairs: ${state.pairCount}`);
        this._deps.outputChannel.appendLine(`   Action: ${this._deps.getRecommendedAction(eq, confidence)}`);
        this._deps.outputChannel.appendLine('');
        this._deps.outputChannel.appendLine('ACTIVITY');
        this._deps.outputChannel.appendLine(`   Pattern: ${pattern}`);
        this._deps.outputChannel.appendLine(`   Time since edit: ${Math.round(this._deps.inactivityService.getTimeSinceLastEdit() / 1000)}s`);
        this._deps.outputChannel.appendLine('');
        this._deps.outputChannel.appendLine('SERVER');
        this._deps.outputChannel.appendLine(`   Consecutive build failures: ${this._deps.buildTracker.getConsecutiveFailures()}`);
        this._deps.outputChannel.appendLine('═══════════════════════════════════════');
        this._deps.outputChannel.appendLine('');
    }

    private _update(): void {
        const { eq, confidence } = this._deps.eqEngine.getCurrentEQ();
        const eqPercent = Math.round(eq * 100);
        const emoji = this._getEQEmoji(eq, confidence);
        const action = this._deps.getRecommendedAction(eq, confidence);
        const actionIcon = this._getActionIcon(action);

        this._statusBarItem.text = `${emoji} EQ: ${eqPercent}% ${actionIcon}`;
        this._statusBarItem.tooltip = this._buildDebugTooltip(eq, confidence);
        this._statusBarItem.backgroundColor = this._getEQBackground(eq, confidence);
    }

    private _getEQEmoji(eq: number, confidence: EQConfidence): string {
        if (confidence === 'insufficient') {
            return '$(circle-outline)';
        }
        if (eq < 0.15) {
            return '$(pass-filled)';
        }
        if (eq < 0.35) {
            return '$(circle-filled)';
        }
        if (eq < 0.60) {
            return '$(warning)';
        }
        if (eq < 0.80) {
            return '$(flame)';
        }
        return '$(alert)';
    }

    private _getActionIcon(action: string): string {
        switch (action) {
            case 'subtle': return '$(lightbulb)';
            case 'notification': return '$(bell)';
            case 'proactive': return '$(megaphone)';
            default: return '';
        }
    }

    private _getEQBackground(eq: number, confidence: EQConfidence): vscode.ThemeColor | undefined {
        if (confidence === 'insufficient') {
            return undefined;
        }
        if (eq < 0.35) {
            return undefined;
        }
        if (eq < 0.60) {
            return new vscode.ThemeColor('statusBarItem.warningBackground');
        }
        return new vscode.ThemeColor('statusBarItem.errorBackground');
    }

    private _buildDebugTooltip(eq: number, confidence: EQConfidence): string {
        const state = this._deps.eqEngine.getState();
        const action = this._deps.getRecommendedAction(eq, confidence);
        const adaptive = this._deps.adaptiveCadence.getState();

        const lines: string[] = [
            'Artemis Telemetry Debug (EQ)',
            '━━━━━━━━━━━━━━━━━━━━━━━━',
            '',
            `EQ: ${(eq * 100).toFixed(1)}%`,
            `Confidence: ${confidence}`,
            `Recommended Action: ${action}`,
            `Snapshots: ${state.snapshots.length}`,
            `Pairs: ${state.pairCount}`,
            '',
            '── Adaptive Cadence ──',
            `   Idle ignores: ${adaptive.ignoreCounts['idle']}`,
            `   Selection ignores: ${adaptive.ignoreCounts['selection-maintained']}`,
            `   Idle threshold: ${this._deps.adaptiveCadence.getIdleThreshold() / 1000}s`,
            `   Selection threshold: ${this._deps.adaptiveCadence.getSelectionThreshold() / 1000}s`,
            '',
            '── Activity ──',
            `   Pattern: ${this._deps.inactivityService.getCurrentPattern()}`,
            `   Time since edit: ${Math.round(this._deps.inactivityService.getTimeSinceLastEdit() / 1000)}s`,
            '',
            '━━━━━━━━━━━━━━━━━━━━━━━━',
            '$(info) Click for detailed view',
        ];
        return lines.join('\n');
    }
}
