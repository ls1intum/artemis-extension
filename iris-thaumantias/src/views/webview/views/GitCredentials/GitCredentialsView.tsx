/**
 * GitCredentials view component.
 * Allows users to configure their Git identity (name and email) for commits.
 */

import { useState, useEffect, useRef } from 'react';
import { BackLink, Container, TextInput, Button, PageHeader, SkeletonList } from '../../components';
import { useExtensionMessage } from '../../hooks/useExtensionMessage';
import styles from './GitCredentialsView.module.css';
import type { GitCredentialsViewProps, GitCredentialsPersistedState } from './types';
import { ExtensionMsg, postCommand } from '../../../../shared/messageContracts';

export function GitCredentialsView({ vscodeApi }: GitCredentialsViewProps) {
    // Restore persisted state (form values only)
    const previousState = vscodeApi.getState<GitCredentialsPersistedState>();
    const [name, setName] = useState(previousState?.name || '');
    const [email, setEmail] = useState(previousState?.email || '');

    // Loading state
    const [isLoaded, setIsLoaded] = useState(false);

    // Transient state (NOT persisted)
    const [statusMessage, setStatusMessage] = useState('');
    const [statusType, setStatusType] = useState<'success' | 'error' | 'warning' | 'info'>('info');

    // Persist durable state only (form values)
    useEffect(() => {
        vscodeApi.setState({ name, email });
    }, [name, email, vscodeApi]);

    // Timer ref for status message auto-clear
    const statusTimerRef = useRef<ReturnType<typeof setTimeout>>();

    // Cleanup timer on unmount
    useEffect(() => () => {
        if (statusTimerRef.current) {clearTimeout(statusTimerRef.current);}
    }, []);

    // Message handler
    useExtensionMessage((msg) => {
        switch (msg.type) {
            case ExtensionMsg.GitIdentityInfo: {
                setName(msg.name);
                setEmail(msg.email);
                setIsLoaded(true);
                break;
            }
            case ExtensionMsg.GitCredentialsResult: {
                setStatusMessage(msg.message);
                setStatusType(msg.status);
                if (statusTimerRef.current) {
                    clearTimeout(statusTimerRef.current);
                }
                statusTimerRef.current = setTimeout(() => setStatusMessage(''), 5000);
                break;
            }
        }
    }, [setName, setEmail, setIsLoaded, setStatusMessage, setStatusType]);

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

        postCommand(vscodeApi, 'saveGitIdentity', { name: trimmedName, email: trimmedEmail });
    };

    const handleCopyCommand = (command: string) => {
        postCommand(vscodeApi, 'copyToClipboard', { text: command });
    };

    const handleBackClick = () => {
        postCommand(vscodeApi, 'backToDashboard');
    };

    if (!isLoaded) {
        return (
            <div className={styles.gitCredentialsView}>
                <BackLink onClick={handleBackClick}>Back to Dashboard</BackLink>
                <SkeletonList count={3} />
            </div>
        );
    }

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
        <div className={styles.gitCredentialsView}>
            <BackLink onClick={handleBackClick}>Back to Dashboard</BackLink>

            <PageHeader
                title="Git Credentials Helper"
                subtitle="Connect Git with your Artemis account to push and pull without repeated prompts"
            />

            <Container
                header={<div className={styles.sectionTitle}>Why this matters</div>}
                variant="muted"
            >
                <p style={{ margin: 0, fontSize: '13px', lineHeight: '1.5' }}>
                    Git needs a name and email address for every commit. Without them, Artemis submissions fail with
                    "Please tell me who you are." Use this helper to configure the Git identity that should be attached
                    to your submissions.
                </p>
            </Container>

            <Container
                header={
                    <div>
                        <div className={styles.sectionTitle}>
                            Configure Git author information
                        </div>
                        <div style={{ fontSize: '12px', opacity: 0.8, marginTop: '4px' }}>
                            Set the name and email Git will place on commits coming from this machine
                        </div>
                    </div>
                }
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

            <Container
                header={<div className={styles.sectionTitle}>Tips & Useful Commands</div>}
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
    );
}
