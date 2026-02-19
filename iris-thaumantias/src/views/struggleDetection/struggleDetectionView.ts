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
                    We use the Error Quotient (EQ) from compile-equivalent events to measure struggle severity,
                    then subtask-boundary triggers decide <em>when</em> to intervene.
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
                    <li>Track compile-equivalent events (file saves and Artemis build results).</li>
                    <li>Score consecutive event pairs using the Jadud EQ formula (0.0–1.0).</li>
                    <li>Subtask-boundary triggers (error, paste, idle, selection) decide <em>when</em> to evaluate.</li>
                    <li>Map EQ → action level (subtle, notification, proactive), then apply guardrails.</li>
                </ol>
            `
        });

        const signalsContainer = ContainerComponent.generate({
            className: 'struggle-card',
            header: {
                title: 'Error Quotient (EQ)',
                subtitle: 'Based on Jadud 2006 — pairs of consecutive compile events are scored and averaged.',
                icon: eyeIcon,
                divider: true
            },
            bodyHtml: `
                <div class="signal-grid">
                    <article class="signal-card">
                        <h3>Pair scoring</h3>
                        <div class="signal-meta">
                            <span>Jadud 2006</span>
                            <span>Max 11 per pair</span>
                        </div>
                        <p class="signal-details">
                            Both events have errors: <strong>+8</strong>.
                            Same error family: <strong>+3</strong>.
                            Otherwise: <strong>0</strong>.
                            EQ = mean of (pair scores / 11).
                        </p>
                    </article>
                    <article class="signal-card">
                        <h3>Compile-equivalent events</h3>
                        <div class="signal-meta">
                            <span>Local + Server</span>
                        </div>
                        <p class="signal-details">
                            File saves (with 500ms delay for language server) and Artemis build results.
                            Compiler errors count as errors; test failures do not.
                        </p>
                    </article>
                    <article class="signal-card">
                        <h3>Confidence levels</h3>
                        <div class="signal-meta">
                            <span>Pair count</span>
                        </div>
                        <p class="signal-details">
                            <strong>None</strong>: &lt;3 pairs.
                            <strong>Low</strong>: 3–5 pairs.
                            <strong>Medium</strong>: 6–14 pairs.
                            <strong>High</strong>: &ge;15 pairs.
                            Interventions require medium+ confidence.
                        </p>
                    </article>
                    <article class="signal-card">
                        <h3>Session management</h3>
                        <div class="signal-meta">
                            <span>Lifecycle</span>
                        </div>
                        <p class="signal-details">
                            Exercise switch resets all state. 30-minute inactivity splits a sub-session
                            (clears snapshots). 5-second dedup window prevents duplicate events.
                        </p>
                    </article>
                </div>
            `
        });

        const scoringContainer = ContainerComponent.generate({
            className: 'struggle-card',
            header: {
                title: 'EQ thresholds & actions',
                subtitle: 'How the system converts EQ into interventions.',
                divider: true
            },
            bodyHtml: `
                <div class="score-grid">
                    <div class="score-card">
                        <div class="score-title">EQ formula</div>
                        <pre class="score-code">pair_score =
  both_error ? 8 : 0
  + same_family ? 3 : 0

EQ = mean(pair_scores) / 11</pre>
                        <p class="score-note">EQ ranges from 0.0 (no struggle) to 1.0 (maximum struggle).</p>
                    </div>
                    <div class="score-card">
                        <div class="score-title">Subtask-boundary triggers</div>
                        <ul class="score-list">
                            <li><strong>Execution error</strong>: Build failure from Artemis (0% disruption).</li>
                            <li><strong>Multiline paste</strong>: Student pastes &gt;1 line of code.</li>
                            <li><strong>Idle</strong>: No edits for 30s (adaptive, +30s per ignore, cap 3min).</li>
                            <li><strong>Selection maintained</strong>: Selection held for 15s (adaptive, +15s per ignore, cap 2min).</li>
                        </ul>
                    </div>
                </div>
                <div class="threshold-list">
                    <div class="threshold-row" data-level="subtle">
                        <span>Subtle hint</span>
                        <div>EQ &ge; 0.15 (shows a status bar lightbulb)</div>
                    </div>
                    <div class="threshold-row" data-level="notification">
                        <span>Notification</span>
                        <div>EQ &ge; 0.35 (info message + highlighted status bar)</div>
                    </div>
                    <div class="threshold-row" data-level="proactive">
                        <span>Proactive help</span>
                        <div>EQ &ge; 0.60 (warning prompt to open Iris)</div>
                    </div>
                </div>
            `
        });

        const triggersContainer = ContainerComponent.generate({
            className: 'struggle-card',
            header: {
                title: 'When checks happen & guardrails',
                subtitle: 'The system only intervenes when timing and cadence rules allow it.',
                divider: true
            },
            bodyHtml: `
                <div class="guardrail-grid">
                    <div class="guardrail-card">
                        <h3>Trigger evaluation</h3>
                        <ul class="guardrail-list">
                            <li>On build failure (execution-error trigger).</li>
                            <li>On multiline paste detection.</li>
                            <li>When idle threshold exceeded (adaptive: 30s + 30s per ignore).</li>
                            <li>When selection maintained past threshold (adaptive: 15s + 15s per ignore).</li>
                            <li>60-second cooldown between trigger evaluations.</li>
                        </ul>
                    </div>
                    <div class="guardrail-card">
                        <h3>Intervention guardrails</h3>
                        <ul class="guardrail-list">
                            <li>&ge; 5 min into an exercise.</li>
                            <li>2 min grace after progress (e.g., errors fixed).</li>
                            <li>5 min cooldown between interventions.</li>
                            <li>Max 3 per session (unless EQ &ge; 0.85 and proactive).</li>
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
