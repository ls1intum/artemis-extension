import * as vscode from 'vscode';
import { IconDefinitions } from '../../utils/iconDefinitions';
import { readCssFiles } from '../utils';
import { BackLinkComponent } from '../components/backLink/backLinkComponent';
import { ContainerComponent } from '../components/container/containerComponent';

export class StruggleDetectionView {
    private readonly _extensionContext: vscode.ExtensionContext;

    constructor(extensionContext: vscode.ExtensionContext) {
        this._extensionContext = extensionContext;
    }

    public generateHtml(webview?: vscode.Webview): string {
        const styles = readCssFiles(
            'components/backLink/back-link.css',
            'components/container/container.css',
            'struggleDetection/struggle-detection.css'
        );

        return this._getStruggleDetectionHtml(styles, webview);
    }

    private _getStruggleDetectionHtml(styles: string, webview?: vscode.Webview): string {
        const targetIcon = IconDefinitions.getIcon('target');
        const infoIcon = IconDefinitions.getIcon('question-mark');
        const eyeIcon = IconDefinitions.getIcon('eye-open');

        const headerContainer = ContainerComponent.generate({
            className: 'struggle-header',
            header: {
                title: 'Struggle Detection',
                subtitle: 'Understand how Artemis decides when to offer help',
                titleSize: 'xlarge',
                icon: targetIcon
            },
            bodyHtml: `
                <p class="struggle-intro">
                    Struggle detection combines local VS Code signals with Artemis build results to estimate when you
                    might be stuck. It calculates a score from 0 to 100, then decides whether to show a subtle hint,
                    a notification, or proactive help.
                </p>
            `
        });

        const flowContainer = ContainerComponent.generate({
            className: 'struggle-card',
            header: {
                title: 'How it works',
                icon: infoIcon,
                divider: true
            },
            bodyHtml: `
                <ol class="steps-list">
                    <li>Track local signals (diagnostics, activity gaps, edit thrashing) and server build outcomes.</li>
                    <li>Convert each signal into a 0–100 score, apply weights, and clamp the combined score to 100.</li>
                    <li>Map the combined score to a recommended action: subtle, notification, or proactive.</li>
                    <li>Apply guardrails (cooldowns, progress grace period, session limits) before intervening.</li>
                </ol>
            `
        });

        const signalsContainer = ContainerComponent.generate({
            className: 'struggle-card',
            header: {
                title: 'Signals & scoring',
                subtitle: 'Each signal is scored independently before being weighted into the combined score.',
                icon: eyeIcon,
                divider: true
            },
            bodyHtml: `
                <div class="signal-grid">
                    <article class="signal-card">
                        <h3>Persistent errors</h3>
                        <div class="signal-meta">
                            <span>Local</span>
                            <span>Weight 35%</span>
                        </div>
                        <p class="signal-details">
                            Tracks VS Code errors and warnings that persist for at least <strong>2 minutes</strong>.
                            Score: 0 if none; 1 error = 30; 2 = 50; 3 = 70; 4 = 90; 5+ caps at 100.
                        </p>
                    </article>
                    <article class="signal-card">
                        <h3>Inactivity pattern</h3>
                        <div class="signal-meta">
                            <span>Local</span>
                            <span>Weight 25%</span>
                        </div>
                        <p class="signal-details">
                            Time since last edit determines the pattern: <strong>active</strong> &lt; 30s (score 0),
                            <strong>thinking</strong> 30s–2m (20), <strong>confusion</strong> 2–5m (60),
                            <strong>giving-up</strong> &gt; 5m (100).
                        </p>
                    </article>
                    <article class="signal-card">
                        <h3>Edit thrashing</h3>
                        <div class="signal-meta">
                            <span>Local</span>
                            <span>Weight 20%</span>
                        </div>
                        <p class="signal-details">
                            Detects repeated, similar edits within the last <strong>2 minutes</strong>
                            (history size 20, minimum 3 repetitions). Produces a 0–100 score based on repetition/cycle
                            patterns. A thrashing score &gt; 60 triggers an immediate score check.
                        </p>
                    </article>
                    <article class="signal-card">
                        <h3>Build failures</h3>
                        <div class="signal-meta">
                            <span>Server</span>
                            <span>Weight 20%</span>
                        </div>
                        <p class="signal-details">
                            Uses consecutive Artemis build failures. Score: 0 if none; 1 failure = 25; 2 = 50;
                            3 = 75; 4+ caps at 100. Success resets the failure count.
                        </p>
                    </article>
                </div>
            `
        });

        const scoringContainer = ContainerComponent.generate({
            className: 'struggle-card',
            header: {
                title: 'Combined score & actions',
                subtitle: 'How the system converts signals into interventions.',
                divider: true
            },
            bodyHtml: `
                <div class="score-grid">
                    <div class="score-card">
                        <div class="score-title">Weighted formula</div>
                        <pre class="score-code">combined = clamp(0..100,
  0.35 * persistentErrors +
  0.25 * inactivity +
  0.20 * thrashing +
  0.20 * buildFailures
)</pre>
                        <p class="score-note">Scores are recalculated periodically and on trigger events.</p>
                    </div>
                    <div class="score-card">
                        <div class="score-title">Confidence</div>
                        <ul class="score-list">
                            <li>Base confidence starts at 0.5.</li>
                            <li>+0.2 if diagnostics exist or active errors are present.</li>
                            <li>+0.2 if build data is available.</li>
                            <li>+0.1 if the user is not in “giving-up”.</li>
                            <li>Capped at 1.0.</li>
                        </ul>
                    </div>
                </div>
                <div class="threshold-list">
                    <div class="threshold-row" data-level="subtle">
                        <span>Subtle hint</span>
                        <div>Score ≥ 35 (shows a status bar lightbulb)</div>
                    </div>
                    <div class="threshold-row" data-level="notification">
                        <span>Notification</span>
                        <div>Score ≥ 55 (info message + highlighted status bar)</div>
                    </div>
                    <div class="threshold-row" data-level="proactive">
                        <span>Proactive help</span>
                        <div>Score ≥ 75 (warning prompt to open Iris)</div>
                    </div>
                </div>
            `
        });

        const triggersContainer = ContainerComponent.generate({
            className: 'struggle-card',
            header: {
                title: 'When checks happen & guardrails',
                subtitle: 'The system only intervenes when timing rules allow it.',
                divider: true
            },
            bodyHtml: `
                <div class="guardrail-grid">
                    <div class="guardrail-card">
                        <h3>Score check triggers</h3>
                        <ul class="guardrail-list">
                            <li>Every 30 seconds while struggle detection is enabled.</li>
                            <li>When inactivity enters <strong>confusion</strong> or <strong>giving-up</strong>.</li>
                            <li>When thrashing score rises above 60.</li>
                            <li>About 5 seconds after a build failure arrives.</li>
                        </ul>
                    </div>
                    <div class="guardrail-card">
                        <h3>Intervention guardrails</h3>
                        <ul class="guardrail-list">
                            <li>At least 5 minutes into an exercise before intervening.</li>
                            <li>2-minute grace period after detected progress (e.g., errors fixed).</li>
                            <li>5-minute cooldown between interventions.</li>
                            <li>Max 3 interventions per session (unless score ≥ 85 and proactive).</li>
                            <li>If the last prompt was dismissed, only proactive helps can appear.</li>
                            <li>Subtle hints can still show even when other guardrails block prompts.</li>
                        </ul>
                    </div>
                </div>
            `
        });

        const settingsContainer = ContainerComponent.generate({
            className: 'struggle-card',
            header: {
                title: 'Settings & visibility',
                divider: true
            },
            bodyHtml: `
                <ul class="settings-list">
                    <li><strong>artemis.struggleDetection.enabled</strong> toggles the system on/off.</li>
                    <li><strong>artemis.developerMode</strong> shows a live score in the status bar when struggle detection is enabled (click for details).</li>
                    <li>Struggle hints open Iris chat so you can ask for help when you want it.</li>
                </ul>
            `
        });

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Struggle Detection</title>
    <style>
        ${styles}
    </style>
</head>
<body>
    ${BackLinkComponent.generateHtml()}

    <div class="struggle-detection-container">
        ${headerContainer}
        ${flowContainer}
        ${signalsContainer}
        ${scoringContainer}
        ${triggersContainer}
        ${settingsContainer}
    </div>

    <script>
        const vscode = acquireVsCodeApi();

        ${BackLinkComponent.generateScript()}
        ${ContainerComponent.generateScript()}
    </script>
</body>
</html>`;
    }
}
