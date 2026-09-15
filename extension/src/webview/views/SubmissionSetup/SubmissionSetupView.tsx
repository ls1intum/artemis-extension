import Check from 'lucide-react/dist/esm/icons/check';
import Circle from 'lucide-react/dist/esm/icons/circle';
import X from 'lucide-react/dist/esm/icons/x';
import { useEffect, useRef, useState } from 'react';

import { ExtensionMsg, postCommand } from '@shared/messageContracts';
import type { SubmissionSetupSnapshot } from '@shared/types/submissionSetup';

import { BackLink, Button, Container, PageHeader, SkeletonList, StatusMessage, TextInput } from '@webview/components';
import { useExtensionMessage } from '@webview/hooks/useExtensionMessage';

import { buildBanner, buildRows, type Row } from './rows';
import styles from './SubmissionSetupView.module.css';
import type { SubmissionSetupViewProps } from './types';

/** How long a success line stays before it clears. Warnings and errors stay until the next action. */
const SUCCESS_CLEAR_MS = 5000;

export function SubmissionSetupView({ vscodeApi }: SubmissionSetupViewProps) {
    const [snapshot, setSnapshot] = useState<SubmissionSetupSnapshot | null>(null);
    const [busy, setBusy] = useState<'renew' | 'recheck' | 'save' | null>(null);
    const [editingIdentity, setEditingIdentity] = useState(false);
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');

    const [statusMessage, setStatusMessage] = useState('');
    const [statusType, setStatusType] = useState<'success' | 'error' | 'warning' | 'info'>('info');
    const statusTimerRef = useRef<ReturnType<typeof setTimeout>>();

    useEffect(() => () => {
        if (statusTimerRef.current) { clearTimeout(statusTimerRef.current); }
    }, []);

    useExtensionMessage((msg) => {
        switch (msg.type) {
            case ExtensionMsg.SubmissionSetupInfo: {
                setSnapshot(msg.snapshot);
                // A snapshot is the answer to whatever was in flight, so it is
                // also what ends the busy state: no action has to remember to.
                setBusy(null);
                setName(msg.snapshot.identity.name);
                setEmail(msg.snapshot.identity.email);
                setEditingIdentity(msg.snapshot.identity.state === 'problem');
                break;
            }
            case ExtensionMsg.SubmissionSetupResult: {
                setStatusMessage(msg.message);
                setStatusType(msg.status);
                if (msg.status !== 'success') { setBusy(null); }
                if (statusTimerRef.current) { clearTimeout(statusTimerRef.current); }
                if (msg.status === 'success') {
                    statusTimerRef.current = setTimeout(() => setStatusMessage(''), SUCCESS_CLEAR_MS);
                }
                break;
            }
        }
    }, [setSnapshot, setBusy, setName, setEmail, setStatusMessage, setStatusType]);

    const handleBackClick = () => postCommand(vscodeApi, 'backToDashboard');
    const handleRecheck = () => {
        setBusy('recheck');
        postCommand(vscodeApi, 'refreshSubmissionSetup');
    };
    const handleRenew = () => {
        setBusy('renew');
        postCommand(vscodeApi, 'renewArtemisAccess');
    };
    const handleCopyCommand = (command: string) => postCommand(vscodeApi, 'copyToClipboard', { text: command });

    const handleSaveIdentity = (e: React.FormEvent) => {
        e.preventDefault();
        const trimmedName = name.trim();
        const trimmedEmail = email.trim();
        if (!trimmedName || !trimmedEmail) {
            setStatusMessage('Enter both a name and an email address.');
            setStatusType('warning');
            return;
        }
        setBusy('save');
        postCommand(vscodeApi, 'saveGitIdentity', { name: trimmedName, email: trimmedEmail });
    };

    if (!snapshot) {
        return (
            <div className={styles.submissionSetupView}>
                <BackLink onClick={handleBackClick}>Back to Dashboard</BackLink>
                <SkeletonList count={3} />
            </div>
        );
    }

    const banner = buildBanner(snapshot);
    const canRenew = snapshot.repository.participationId !== undefined;

    const renderIcon = (state: Row['state']) => {
        if (state === 'ok') { return <Check size={14} className={styles.iconOk} aria-hidden="true" />; }
        if (state === 'problem') { return <X size={14} className={styles.iconProblem} aria-hidden="true" />; }
        return <Circle size={14} className={styles.iconUnknown} aria-hidden="true" />;
    };

    const stateLabel = (state: Row['state']) =>
        state === 'ok' ? 'in order' : state === 'problem' ? 'needs fixing' : 'not known';

    const renderIdentityForm = () => (
        <form className={styles.identityForm} onSubmit={handleSaveIdentity}>
            <TextInput
                label="Name" placeholder="e.g. Alex Example" type="text"
                value={name} onChange={setName} required fullWidth testId="setup-identity-name"
            />
            <TextInput
                label="Email" placeholder="tum-login@tum.de" type="email"
                value={email} onChange={setEmail} required fullWidth testId="setup-identity-email"
            />
            <Button type="submit" variant="primary" disabled={busy === 'save'} testId="setup-identity-save">
                {busy === 'save' ? 'Saving...' : 'Save'}
            </Button>
            <p className={styles.hint}>Saved for every repository on this computer.</p>
        </form>
    );

    const renderAction = (row: Row) => {
        if (row.id === 'identity' && row.state === 'ok' && !editingIdentity) {
            return (
                <Button variant="secondary" onClick={() => setEditingIdentity(true)} testId="setup-identity-change">
                    Change
                </Button>
            );
        }
        if (row.id === 'access' && row.state === 'problem' && canRenew) {
            return (
                <Button variant="primary" onClick={handleRenew} disabled={busy === 'renew'} testId="setup-access-renew">
                    {busy === 'renew' ? 'Renewing...' : 'Renew'}
                </Button>
            );
        }
        // A recheck is only meaningful once there is a repository to ask about;
        // without one the row is reporting "not checked", not a stale answer.
        if (row.id === 'access' && row.state !== 'problem' && canRenew) {
            return (
                <Button variant="secondary" onClick={handleRecheck} disabled={busy === 'recheck'} testId="setup-access-recheck">
                    {busy === 'recheck' ? 'Checking...' : 'Recheck'}
                </Button>
            );
        }
        return null;
    };

    return (
        <div className={styles.submissionSetupView}>
            <BackLink onClick={handleBackClick}>Back to Dashboard</BackLink>

            <PageHeader
                title="Submission Setup"
                subtitle="Everything Git needs before you can submit."
            />

            <div className={`${styles.banner} ${styles[`banner${banner.tone}`]}`} data-testid="setup-banner">
                {banner.text}
            </div>

            <Container padding="none">
                <ul className={styles.rows}>
                    {buildRows(snapshot).map((row) => (
                        <li key={row.id} className={styles.row} data-testid={`setup-row-${row.id}`}>
                            <span className={styles.rowIcon}>
                                {renderIcon(row.state)}
                                <span className={styles.srOnly}>{stateLabel(row.state)}</span>
                            </span>
                            <div className={styles.rowText}>
                                <span className={styles.rowTitle}>{row.title}</span>
                                <span className={styles.rowDetail}>{row.detail}</span>
                                {row.id === 'identity' && (editingIdentity || row.state === 'problem') && renderIdentityForm()}
                            </div>
                            {renderAction(row)}
                        </li>
                    ))}
                </ul>
            </Container>

            {statusMessage && <StatusMessage message={statusMessage} type={statusType} data-testid="setup-status" />}

            <Container header={<div className={styles.sectionTitle}>Prefer the terminal?</div>}>
                <div className={styles.commands}>
                    <Button variant="secondary" alignText="left" onClick={() => handleCopyCommand('git config user.name')}>
                        git config user.name
                    </Button>
                    <Button variant="secondary" alignText="left" onClick={() => handleCopyCommand('git config user.email')}>
                        git config user.email
                    </Button>
                </div>
                <p className={styles.hint}>
                    Artemis never asks for your TUM password in Git. Access runs through a token the extension
                    puts into your repository for you.
                </p>
            </Container>
        </div>
    );
}
