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
                subtitle: 'How Artemis decides when to offer help',
                titleSize: 'xlarge',
                icon: targetIcon
            },
            bodyHtml: `
                <p class="struggle-intro">
                    We combine local VS Code signals with Artemis build results into a 0–100 score,
                    then map it to subtle hints, notifications, or proactive help.
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
                    <li>Track signals from diagnostics, activity gaps, edit thrashing, and build results.</li>
                    <li>Score each signal (0–100), apply weights, clamp the combined score to 0–100.</li>
                    <li>Map score → action (subtle, notification, proactive), then apply guardrails.</li>
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
                            Errors/warnings persisting &ge; <strong>2 min</strong>. Score: 0 none; 1=30, 2=50, 3=70,
                            4=90, 5+=100.
                        </p>
                    </article>
                    <article class="signal-card">
                        <h3>Inactivity pattern</h3>
                        <div class="signal-meta">
                            <span>Local</span>
                            <span>Weight 25%</span>
                        </div>
                        <p class="signal-details">
                            Time since last edit: <strong>active</strong> &lt;30s (0), <strong>thinking</strong> 30s–2m (20),
                            <strong>confusion</strong> 2–5m (60), <strong>giving-up</strong> &gt;5m (100).
                        </p>
                    </article>
                    <article class="signal-card">
                        <h3>Edit thrashing</h3>
                        <div class="signal-meta">
                            <span>Local</span>
                            <span>Weight 20%</span>
                        </div>
                        <p class="signal-details">
                            Repeated edits in last <strong>2 min</strong> (history 20, min 3 repeats). Score 0–100
                            from repetition/cycles. Thrashing &gt; 60 triggers a check.
                        </p>
                    </article>
                    <article class="signal-card">
                        <h3>Build failures</h3>
                        <div class="signal-meta">
                            <span>Server</span>
                            <span>Weight 20%</span>
                        </div>
                        <p class="signal-details">
                            Consecutive Artemis build failures. Score: 0 none; 1=25, 2=50, 3=75, 4+=100.
                            Success resets failures.
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
                        <p class="score-note">Scores update on timers and trigger events.</p>
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
                            <li>Every 30s while enabled.</li>
                            <li>On inactivity entering <strong>confusion</strong> or <strong>giving-up</strong>.</li>
                            <li>When thrashing &gt; 60.</li>
                            <li>~5s after a build failure arrives.</li>
                        </ul>
                    </div>
                    <div class="guardrail-card">
                        <h3>Intervention guardrails</h3>
                        <ul class="guardrail-list">
                            <li>&ge; 5 min into an exercise.</li>
                            <li>2 min grace after progress (e.g., errors fixed).</li>
                            <li>5 min cooldown between interventions.</li>
                            <li>Max 3 per session (unless score ≥ 85 and proactive).</li>
                            <li>If last prompt was dismissed, only proactive can appear.</li>
                            <li>Subtle hints can still show even if prompts are blocked.</li>
                        </ul>
                    </div>
                </div>
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
