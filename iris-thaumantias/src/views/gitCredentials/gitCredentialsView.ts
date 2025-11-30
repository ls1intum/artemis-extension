import * as vscode from 'vscode';
import { IconDefinitions } from '../../utils/iconDefinitions';
import type { UserInfo } from '../app/appStateManager';
import { readCssFiles } from '../utils';
import { BackLinkComponent } from '../components/backLink/backLinkComponent';
import { ButtonComponent } from '../components/button/buttonComponent';
import { ContainerComponent } from '../components/container/containerComponent';
import { TextInputComponent } from '../components/input/textInputComponent';

export class GitCredentialsView {
    private readonly _extensionContext: vscode.ExtensionContext;

    constructor(extensionContext: vscode.ExtensionContext) {
        this._extensionContext = extensionContext;
    }

    public generateHtml(userInfo?: UserInfo): string {
        const styles = readCssFiles(
            'components/container/container.css',
            'components/backLink/back-link.css',
            'components/button/button.css',
            'components/input/input.css',
            'gitCredentials/git-credentials.css'
        );

        const gitIcon = IconDefinitions.getIcon('git');
        const shieldIcon = IconDefinitions.getIcon('shield');

        const headerCard = ContainerComponent.generate({
            id: 'gitCredentialsHeader',
            className: 'git-card git-card__header',
            header: {
                title: 'Git Credentials Helper',
                subtitle: 'Connect Git with your Artemis account to push and pull without repeated prompts',
                icon: gitIcon
            }
        });

        const infoCard = ContainerComponent.generate({
            id: 'gitWhyCard',
            className: 'git-card git-card__info',
            header: {
                title: 'Why this matters',
                icon: shieldIcon
            },
            bodyHtml: `
                <p>
                    Git needs a name and email address for every commit. Without them, Artemis submissions fail with
                    “Please tell me who you are.” Use this helper to configure the Git identity that should be attached
                    to your submissions.
                </p>
            `
        });

        const formCard = ContainerComponent.generate({
            id: 'gitFormCard',
            className: 'git-card git-card__form',
            header: {
                title: 'Configure Git author information',
                subtitle: 'Set the name and email Git will place on commits coming from this machine'
            },
            bodyHtml: `
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
            `
        });

        const tipsCard = ContainerComponent.generate({
            id: 'gitTipsCard',
            className: 'git-card git-card__tips',
            variant: 'default',
            header: {
                title: 'Tips & Useful Commands'
            },
            bodyHtml: `
                <ul class="tips-list">
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
            `
        });

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
        ${headerCard}
        ${infoCard}
        ${formCard}
        ${tipsCard}
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

        ${ContainerComponent.generateScript()}
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
