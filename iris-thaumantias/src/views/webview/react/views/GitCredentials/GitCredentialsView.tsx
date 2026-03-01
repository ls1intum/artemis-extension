/**
 * GitCredentials view component.
 * Allows users to configure their Git identity (name and email) for commits.
 */

import { useState, useEffect } from 'react';
import { BackLink, Container, TextInput, Button } from '../../components';
import type { GitCredentialsViewProps, GitCredentialsPersistedState } from './types';
import type { GitCredentialsInitMessage, GitCredentialsResultMessage } from '../../../../../shared/messageContracts';

export function GitCredentialsView({ vscodeApi }: GitCredentialsViewProps) {
    // Restore persisted state (form values only)
    const previousState = vscodeApi.getState<GitCredentialsPersistedState>();
    const [name, setName] = useState(previousState?.name || '');
    const [email, setEmail] = useState(previousState?.email || '');

    // Transient state (NOT persisted)
    const [statusMessage, setStatusMessage] = useState('');
    const [statusType, setStatusType] = useState<'success' | 'error' | 'warning' | 'info'>('info');

    // Persist durable state only (form values)
    useEffect(() => {
        vscodeApi.setState({ name, email });
    }, [name, email, vscodeApi]);

    // Message handler
    useEffect(() => {
        const handleMessage = (event: MessageEvent<unknown>) => {
            const message = event.data;

            if (typeof message !== 'object' || message === null || !('type' in message)) {
                return;
            }

            const typedMessage = message as { type: string };

            switch (typedMessage.type) {
                case 'gitCredentialsInit': {
                    const initMsg = typedMessage as GitCredentialsInitMessage;
                    if (initMsg.payload.currentName) {
                        setName(initMsg.payload.currentName);
                    }
                    if (initMsg.payload.currentEmail) {
                        setEmail(initMsg.payload.currentEmail);
                    }
                    break;
                }
                case 'gitCredentialsResult': {
                    const resultMsg = typedMessage as GitCredentialsResultMessage;
                    setStatusMessage(resultMsg.message);
                    setStatusType(resultMsg.status);
                    // Clear status after 5 seconds
                    const timer = setTimeout(() => setStatusMessage(''), 5000);
                    return () => clearTimeout(timer);
                }
            }
        };

        window.addEventListener('message', handleMessage);
        return () => window.removeEventListener('message', handleMessage);
    }, []);

    // Request current git identity on mount
    useEffect(() => {
        vscodeApi.postMessage({ type: 'command', command: 'requestGitIdentity' });
    }, [vscodeApi]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();

        const trimmedName = name.trim();
        const trimmedEmail = email.trim();

        if (!trimmedName) {
            setStatusMessage('Please provide a name.');
            setStatusType('warning');
            return;
        }

        if (!trimmedEmail) {
            setStatusMessage('Please provide an email address.');
            setStatusType('warning');
            return;
        }

        setStatusMessage('Saving...');
        setStatusType('info');

        vscodeApi.postMessage({
            type: 'command',
            command: 'saveGitIdentity',
            payload: { name: trimmedName, email: trimmedEmail }
        });
    };

    const handleCopyCommand = (command: string) => {
        vscodeApi.postMessage({
            type: 'command',
            command: 'copyToClipboard',
            payload: { text: command }
        });
    };

    const handleBackClick = () => {
        vscodeApi.postMessage({
            type: 'command',
            command: 'backToDashboard'
        });
    };

    // Status message styles
    const statusStyles: React.CSSProperties = statusMessage ? {
        marginTop: '12px',
        padding: '8px 12px',
        borderRadius: '4px',
        fontSize: '13px',
        backgroundColor: statusType === 'success' ? 'var(--vscode-testing-iconPassed, #4caf50)' :
                         statusType === 'error' ? 'var(--vscode-errorBackground, #f44336)' :
                         statusType === 'warning' ? 'var(--vscode-inputValidation-warningBackground, #ff9800)' :
                         'var(--vscode-inputValidation-infoBackground, #2196f3)',
        color: statusType === 'success' ? 'var(--vscode-testing-iconPassed, #fff)' :
               statusType === 'error' ? 'var(--vscode-errorForeground, #fff)' :
               statusType === 'warning' ? 'var(--vscode-inputValidation-warningForeground, #fff)' :
               'var(--vscode-inputValidation-infoForeground, #fff)',
        border: `1px solid ${statusType === 'success' ? 'var(--vscode-testing-iconPassed, #4caf50)' :
                              statusType === 'error' ? 'var(--vscode-errorBorder, #f44336)' :
                              statusType === 'warning' ? 'var(--vscode-inputValidation-warningBorder, #ff9800)' :
                              'var(--vscode-inputValidation-infoBorder, #2196f3)'}`,
    } : {};

    return (
        <>
            <BackLink onClick={handleBackClick}>Back to Dashboard</BackLink>

            <div>
                {/* Header Card */}
                <Container
                    header={
                        <div>
                            <div style={{ fontSize: '18px', fontWeight: 600, marginBottom: '4px' }}>
                                Git Credentials Helper
                            </div>
                            <div style={{ fontSize: '13px', opacity: 0.8 }}>
                                Connect Git with your Artemis account to push and pull without repeated prompts
                            </div>
                        </div>
                    }
                    variant="default"
                    padding="default"
                    className="git-card-header"
                >
                    {/* Empty content - header only card */}
                    <div />
                </Container>

                {/* Info Card */}
                <div style={{ marginTop: '16px' }}>
                    <Container
                        header={
                            <div style={{ fontSize: '15px', fontWeight: 600 }}>
                                Why this matters
                            </div>
                        }
                        variant="muted"
                        padding="default"
                        className="git-card-info"
                    >
                        <p style={{ margin: 0, fontSize: '13px', lineHeight: '1.5' }}>
                            Git needs a name and email address for every commit. Without them, Artemis submissions fail with
                            "Please tell me who you are." Use this helper to configure the Git identity that should be attached
                            to your submissions.
                        </p>
                    </Container>
                </div>

                {/* Form Card */}
                <div style={{ marginTop: '16px' }}>
                    <Container
                        header={
                            <div>
                                <div style={{ fontSize: '15px', fontWeight: 600, marginBottom: '4px' }}>
                                    Configure Git author information
                                </div>
                                <div style={{ fontSize: '12px', opacity: 0.8 }}>
                                    Set the name and email Git will place on commits coming from this machine
                                </div>
                            </div>
                        }
                        variant="default"
                        padding="default"
                        className="git-card-form"
                    >
                        <form onSubmit={handleSubmit}>
                            <TextInput
                                label="Git User Name"
                                placeholder="e.g. Alex Example"
                                type="text"
                                value={name}
                                onChange={setName}
                                required
                                fullWidth
                            />
                            <div style={{ marginTop: '12px' }}>
                                <TextInput
                                    label="Git Email Address"
                                    placeholder="tum-login@tum.de"
                                    type="email"
                                    value={email}
                                    onChange={setEmail}
                                    required
                                    fullWidth
                                    hint="Tip: students usually use their TUM address."
                                />
                            </div>
                            <div style={{ marginTop: '16px' }}>
                                <Button type="submit" variant="primary">
                                    Save identity (global)
                                </Button>
                            </div>

                            {statusMessage && (
                                <div role="status" aria-live="polite" style={statusStyles}>
                                    {statusMessage}
                                </div>
                            )}
                        </form>
                    </Container>
                </div>

                {/* Tips Card */}
                <div style={{ marginTop: '16px', marginBottom: '20px' }}>
                    <Container
                        header={
                            <div style={{ fontSize: '15px', fontWeight: 600 }}>
                                Tips & Useful Commands
                            </div>
                        }
                        variant="default"
                        padding="default"
                        className="git-card-tips"
                    >
                        <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '13px', lineHeight: '1.7' }}>
                            <li>
                                View or change your Git identity manually:
                                <div style={{ marginTop: '8px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                    <Button
                                        variant="secondary"
                                        alignText="left"
                                        onClick={() => handleCopyCommand('git config user.name')}
                                    >
                                        git config user.name
                                    </Button>
                                    <Button
                                        variant="secondary"
                                        alignText="left"
                                        onClick={() => handleCopyCommand('git config user.email')}
                                    >
                                        git config user.email
                                    </Button>
                                </div>
                            </li>
                            <li>The form above saves your identity globally for all repositories on this computer.</li>
                            <li>Git credentials (username/password or token) are managed separately via Git's credential helper.</li>
                            <li>You can rerun this helper anytime if you change your preferred name or email.</li>
                        </ul>
                    </Container>
                </div>
            </div>
        </>
    );
}
