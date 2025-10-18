import * as vscode from 'vscode';
import { ThemeManager } from '../../themes';
import { IconDefinitions } from '../../utils/iconDefinitions';
import type { UserInfo } from '../app/appStateManager';
import { StyleManager } from '../styles';

export class GitCredentialsView {
    private readonly _themeManager: ThemeManager;
    private readonly _extensionContext: vscode.ExtensionContext;
    private readonly _styleManager: StyleManager;

    constructor(extensionContext: vscode.ExtensionContext, styleManager: StyleManager) {
        this._themeManager = new ThemeManager();
        this._extensionContext = extensionContext;
        this._styleManager = styleManager;
    }

    public generateHtml(userInfo?: UserInfo): string {
        const themeCSS = this._themeManager.getThemeCSS();
        const currentTheme = this._themeManager.getCurrentTheme();
        const styles = this._styleManager.getStyles(currentTheme, [
            'views/git-credentials.css'
        ]);

        const gitIcon = IconDefinitions.getIcon('git');
        const shieldIcon = IconDefinitions.getIcon('shield');

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Git Credentials Helper</title>
    <style>
        ${styles}
        ${themeCSS}
    </style>
</head>
<body class="theme-${currentTheme}">
    <div class="back-link-container">
        <div class="back-link" onclick="backToDashboard()">← Back to Dashboard</div>
    </div>

    <div class="git-credentials-container">
        <header class="view-header">
            <h1 class="view-title">
                <span class="view-icon">${gitIcon}</span>
                Git Credentials Helper
            </h1>
            <p class="view-subtitle">
                Connect Git with your Artemis account to push and pull exercise repositories without repeated prompts.
            </p>
        </header>

        <section class="info-card">
            <div class="info-icon">${shieldIcon}</div>
            <div class="info-content">
                <h2>Why this matters</h2>
                <p>
                    Git needs a name and email address for every commit. Without them, Artemis submissions fail with
                    “Please tell me who you are.” Use this helper to configure the Git identity that should be attached
                    to your submissions.
                </p>
            </div>
        </section>

        <section class="credentials-section">
            <h2>Configure Git author information</h2>
            <p class="section-description">
                Set the name and email Git will place on commits coming from this machine. These values are stored globally so
                future Artemis submissions work without additional prompts.
            </p>
            <form id="identityForm" class="credentials-form">
                <div class="field-row">
                    <label class="field-label" for="nameInput">Git User Name</label>
                    <input id="nameInput" class="field-input" type="text" autocomplete="off" placeholder="e.g. Alex Example" required />
                </div>
                <div class="field-row">
                    <label class="field-label" for="emailInput">Git Email Address</label>
                    <input id="emailInput" class="field-input" type="email" autocomplete="off" placeholder="tum-login@tum.de" required />
                    <span class="field-help-text">Tip: students usually use their TUM address.</span>
                </div>
                <div class="form-actions">
                    <button class="primary-button" type="submit">Save identity (global)</button>
                </div>
            </form>
            <div id="statusMessage" class="status-message" role="status" aria-live="polite"></div>
        </section>

        <section class="tips-section">
            <h2>Tips & Useful Commands</h2>
            <ul>
                <li>
                    View or change your Git identity manually:
                    <div class="command-group">
                        <code class="copyable-command" onclick="copyCommand('git config user.name')" title="Click to copy">git config user.name</code>
                        <code class="copyable-command" onclick="copyCommand('git config user.email')" title="Click to copy">git config user.email</code>
                    </div>
                </li>
                <li>The form above saves your identity globally for all repositories on this computer.</li>
                <li>Git credentials (username/password or token) are managed separately via Git's credential helper.</li>
                <li>You can rerun this helper anytime if you change your preferred name or email.</li>
            </ul>
        </section>
    </div>

    <script>
        const vscode = acquireVsCodeApi();

        const $ = (id) => document.getElementById(id);
        const nameInput = $('nameInput');
        const emailInput = $('emailInput');
        const identityForm = $('identityForm');
        const statusMessage = $('statusMessage');

        const setStatus = (type, message) => {
            if (!statusMessage) {
                return;
            }

            statusMessage.textContent = message || '';
            statusMessage.dataset.type = type || '';
            statusMessage.classList.toggle('visible', Boolean(message));
        };

        window.backToDashboard = function() {
            vscode.postMessage({ command: 'backToDashboard' });
        };

        window.copyCommand = function(command) {
            vscode.postMessage({ 
                command: 'copyToClipboard',
                text: command
            });
            
            // Visual feedback
            const allCommands = document.querySelectorAll('.copyable-command');
            allCommands.forEach(cmd => {
                if (cmd.textContent.trim() === command.replace(/\\"/g, '"')) {
                    const originalText = cmd.innerHTML;
                    cmd.innerHTML = '✓ Copied!';
                    cmd.style.background = 'var(--theme-success-background)';
                    cmd.style.color = 'var(--theme-success-foreground)';
                    setTimeout(() => {
                        cmd.innerHTML = originalText;
                        cmd.style.background = '';
                        cmd.style.color = '';
                    }, 1500);
                }
            });
        };

        if (identityForm) {
            identityForm.addEventListener('submit', (event) => {
                event.preventDefault();
                const name = nameInput ? nameInput.value.trim() : '';
                const email = emailInput ? emailInput.value.trim() : '';

                if (!name) {
                    setStatus('warning', 'Please provide a name.');
                    nameInput?.focus();
                    return;
                }

                if (!email) {
                    setStatus('warning', 'Please provide an email address.');
                    emailInput?.focus();
                    return;
                }

                setStatus('info', 'Saving identity...');

                vscode.postMessage({
                    command: 'saveGitIdentity',
                    name,
                    email
                });
            });
        }

        vscode.postMessage({ command: 'requestGitIdentity' });

        window.addEventListener('message', event => {
            const message = event.data;
            if (!message) {
                return;
            }

            switch (message.command) {
                case 'gitCredentialsResult': {
                    const { status, message: text } = message;
                    setStatus(status, text || '');
                    break;
                }
                case 'gitIdentityInfo': {
                    const { name, email } = message;
                    if (nameInput && typeof name === 'string') {
                        nameInput.value = name;
                    }
                    if (emailInput && typeof email === 'string') {
                        emailInput.value = email;
                    }
                    break;
                }
            }
        });
    </script>
</body>
</html>`;
    }

    private _escapeHtml(value: string): string {
        return value
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }
}
