import * as vscode from 'vscode';
import { IconDefinitions } from '../../utils/iconDefinitions';
import type { UserInfo } from '../app/appStateManager';
import { readCssFiles } from '../utils';
import { BackLinkComponent } from '../components/backLink/backLinkComponent';
import { ButtonComponent } from '../components/button/buttonComponent';
import { TextInputComponent } from '../components/input/textInputComponent';

export class GitCredentialsView {
    private readonly _extensionContext: vscode.ExtensionContext;

    constructor(extensionContext: vscode.ExtensionContext) {
        this._extensionContext = extensionContext;
    }

    public generateHtml(userInfo?: UserInfo): string {
        const styles = readCssFiles(
            'components/backLink/back-link.css',
            'components/button/button.css',
            'components/input/input.css',
            'gitCredentials/git-credentials.css'
        );

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
    </style>
</head>
<body>
    ${BackLinkComponent.generateHtml()}

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
                ${TextInputComponent.generate({
                    id: 'nameInput',
                    label: 'Git User Name',
                    placeholder: 'e.g. Alex Example',
                    type: 'text',
                    required: true
                })}
                ${TextInputComponent.generate({
                    id: 'emailInput',
                    label: 'Git Email Address',
                    placeholder: 'tum-login@tum.de',
                    type: 'email',
                    required: true,
                    helperText: 'Tip: students usually use their TUM address.'
                })}
                <div class="form-actions">
                    ${ButtonComponent.generate({
                        label: 'Save identity (global)',
                        variant: 'primary',
                        type: 'submit',
                        id: 'submitButton'
                    })}
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
                        ${ButtonComponent.generate({
                            label: 'git config user.name',
                            variant: 'secondary',
                            command: "copyCommand('git config user.name')",
                            className: 'copyable-command',
                            alignText: 'left'
                        })}
                        ${ButtonComponent.generate({
                            label: 'git config user.email',
                            variant: 'secondary',
                            command: "copyCommand('git config user.email')",
                            className: 'copyable-command',
                            alignText: 'left'
                        })}
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

        ${BackLinkComponent.generateScript()}

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
