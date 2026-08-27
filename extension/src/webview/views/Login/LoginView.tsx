import { type FormEvent, useEffect, useRef, useState } from 'react';

import type { AttemptId } from '@shared/messageContracts';
import { ExtensionMsg, postCommand } from '@shared/messageContracts';

import { Button } from '@webview/components/Button';
import { Container } from '@webview/components/Container';
import { ServiceHealth, type ServiceInfo } from '@webview/components/ServiceHealth';
import { StatusMessage } from '@webview/components/StatusMessage';
import { TextInput } from '@webview/components/TextInput';
import { useExtensionMessage } from '@webview/hooks/useExtensionMessage';
import { formatServiceName } from '@webview/utils/formatServiceName';

import styles from './LoginView.module.css';
import type { LoginPersistedState, LoginViewProps } from './types';

// Used wherever the server named no provider, so the UI never claims one it was not told about.
const GENERIC_IDP_NAME = 'your identity provider';

export function LoginView({ vscodeApi }: LoginViewProps) {
    const persistedState = vscodeApi.getState<LoginPersistedState>();

    // Stage 0: Enter username, Stage 1: Enter password / OIDC
    const [stage, setStage] = useState<0 | 1>(0);

    // Form state, persisted. The password is deliberately not stored.
    const [username, setUsername] = useState(persistedState?.username || '');
    const [password, setPassword] = useState('');
    const [rememberMe, setRememberMe] = useState(persistedState?.rememberMe ?? true);

    const [loginMethod, setLoginMethod] = useState<'PASSWORD' | 'OIDC' | 'SAML2'>('PASSWORD');
    // Null whenever the server named no provider, so the UI can decline to attribute one.
    const [idpName, setIdpName] = useState<string | null>(null);
    const [isCheckingOptions, setIsCheckingOptions] = useState<boolean>(false);
    // Kept apart from isSubmitting on purpose: that flag also disables Back, which is the only way out of
    // a browser sign-in the user has changed their mind about.
    const [isOidcPending, setIsOidcPending] = useState<boolean>(false);

    /**
     * The phase between "the credential is committed" and "the authenticated UI
     * is on screen". The host wires that up after announcing success, and it
     * takes seconds; without a phase of its own the view fell back to an idle
     * form that claimed nothing was happening.
     *
     * It carries its own owner because `activeAttemptId` is released on entry
     * and because `progress.attemptId === null` already means the startup
     * credential check, so reusing either would let unrelated messages steer it.
     */
    interface Handover {
        source: 'password' | 'oidc';
        attemptId: AttemptId | null;
    }
    const [handover, setHandover] = useState<Handover | null>(null);

    /**
     * The sign-in worked and the host could not open Artemis behind it. Held
     * separately from `statusMessage`, which belongs to the form the user is no
     * longer in.
     */
    const [handoverFailure, setHandoverFailure] = useState<{ error: string; generation: number } | null>(null);

    // Whether this MOUNT has started a sign-in. An init replay describes something that happened before
    // this view existed, so it must not overwrite an attempt the user has since begun here.
    const startedAttempt = useRef(false);

    const [statusMessage, setStatusMessage] = useState('');
    const [statusType, setStatusType] = useState<'success' | 'error' | 'info'>('info');

    interface LoginProgress {
        message: string;
        subtext: string;
        /** The interactive attempt this belongs to, or null for the startup credential check. */
        attemptId: AttemptId | null;
        hiding: boolean;
    }

    const [progress, setProgress] = useState<LoginProgress | null>(null);

    // Monotone within this mount, and prefixed so it is unique ACROSS mounts.
    // `postMessage` gives no delivery guarantee, so a result for a retracted attempt can still be in
    // flight; the id is how the view knows the answer is not to its question. A bare counter was not
    // enough for that: `render()` replaces the document, and a counter restarting at 1 in the new view
    // would match an answer meant for the old one. Generated once, in a ref, never during a render.
    const mountId = useRef<string>();
    if (mountId.current === undefined) {
        mountId.current = typeof crypto?.randomUUID === 'function'
            ? crypto.randomUUID()
            : Math.random().toString(36).slice(2);
    }
    const attemptCounter = useRef(0);
    const nextAttemptId = (): AttemptId => {
        startedAttempt.current = true;
        return `${mountId.current}-${++attemptCounter.current}`;
    };
    const [activeAttemptId, setActiveAttemptId] = useState<AttemptId | null>(null);

    const loadingSubtexts: Record<string, string> = {
        'Checking stored credentials...': 'Looking for saved authentication data',
        'Validating authentication...': 'Verifying your login credentials',
        'Loading user information...': 'Fetching your profile and preferences',
        'Connecting to Artemis...': 'Establishing secure connection',
        'Checking authentication...': 'Please wait while we verify your credentials',
    };

    const [serverUrl, setServerUrl] = useState('');

    const [showHealthChecks, setShowHealthChecks] = useState(false);
    const [healthServices, setHealthServices] = useState<ServiceInfo[]>([]);
    const [isHealthChecking, setIsHealthChecking] = useState(false);
    const [lastHealthCheck, setLastHealthCheck] = useState<Date | undefined>(undefined);

    const [isSubmitting, setIsSubmitting] = useState(false);

    useEffect(() => {
        vscodeApi.setState<LoginPersistedState>({
            username,
            rememberMe,
        });
    }, [username, rememberMe, vscodeApi]);

    const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => () => {
        if (hideTimerRef.current) {
            clearTimeout(hideTimerRef.current);
        }
    }, []);

    // A handover gets no deadline. Start-page resolution composes several requests, each with its own
    // 30s timeout, so a legitimate slow load can outrun any number picked here and reporting failure
    // would be a lie. This changes only what the view admits to: never the phase, never the form.
    useEffect(() => {
        if (!handover) {
            return;
        }
        const timer = setTimeout(() => {
            showProgress('Still opening Artemis', 'This is taking longer than usual', handover.attemptId);
        }, 20_000);
        return () => clearTimeout(timer);
    }, [handover]);

    const clearHideTimer = () => {
        if (hideTimerRef.current) {
            clearTimeout(hideTimerRef.current);
            hideTimerRef.current = null;
        }
    };

    const showProgress = (message: string, subtext: string, attemptId: AttemptId | null) => {
        // A hide already scheduled would otherwise fire against this new indicator and take it away.
        clearHideTimer();
        setProgress({ message, subtext, attemptId, hiding: false });
    };

    const hideProgress = () => {
        clearHideTimer();
        setProgress(current => (current ? { ...current, hiding: true } : null));
        // Ownership is released here, in the callback, rather than when the hide is scheduled: for these
        // 300ms the indicator is still on screen, and an unowned message arriving in that window would
        // otherwise be free to change it.
        hideTimerRef.current = setTimeout(() => {
            hideTimerRef.current = null;
            setProgress(null);
        }, 300);
    };

    const enterHandover = (source: 'password' | 'oidc', attemptId: AttemptId | null) => {
        setActiveAttemptId(null);
        setHandover({ source, attemptId });
        setStatusMessage('');
        setIsSubmitting(false);
        setIsCheckingOptions(false);
        setIsOidcPending(false);
        setShowHealthChecks(false);
        // Nothing below re-reads it, and it has no business outliving the sign-in it belonged to.
        setPassword('');
        showProgress('Signed in, opening Artemis', 'Loading your courses', attemptId);
    };

    const failHandover = (error: string, generation: number | null) => {
        setHandover(null);
        setActiveAttemptId(null);
        hideProgress();
        setHandoverFailure({ error, generation: generation ?? -1 });
    };

    /**
     * Whether an authentication outcome is this view's to act on.
     *
     * An id names a password attempt and has to match the one still being waited
     * on. No id is the OIDC signature: that flow outlives the webview, so there
     * is no counter to check it against and it is accepted. The exception is a
     * password attempt or its handover being in flight, where an id-less message
     * can only be a stale callback from an older attempt.
     */
    const acceptsAuthOutcome = (attemptId: AttemptId | undefined): boolean => {
        if (attemptId !== undefined) {
            return attemptId === activeAttemptId;
        }
        return activeAttemptId === null && handover?.source !== 'password';
    };

    /** Whether a message may touch the indicator: its own attempt's, or anyone's while nobody owns it. */
    const ownsProgress = (attemptId: AttemptId | undefined): boolean => {
        if (!progress) {
            return true;
        }
        if (progress.attemptId === null) {
            // The startup check owns it, and only unowned startup messages may touch it.
            return attemptId === undefined;
        }
        // Matching the indicator is not enough: after a Cancel it is still fading out under its old
        // owner, and a late message naming that owner must not be able to revive it.
        return attemptId === progress.attemptId && attemptId === activeAttemptId;
    };

    useExtensionMessage((msg) => {
        switch (msg.type) {
            case ExtensionMsg.ShowLoading: {
                // showLoading never carries an attemptId: it is exclusively the startup credential check.
                if (!ownsProgress(undefined)) {
                    break;
                }
                const showMsg = msg.message ?? 'Checking authentication...';
                showProgress(showMsg, loadingSubtexts[showMsg] ?? 'Please wait while we process your request', null);
                break;
            }

            case ExtensionMsg.HideLoading:
                if (!ownsProgress(undefined)) {
                    break;
                }
                hideProgress();
                break;

            case ExtensionMsg.UpdateLoading: {
                if (!ownsProgress(msg.attemptId)) {
                    break;
                }
                const message = msg.message ?? 'Processing...';
                setProgress(current => {
                    // Re-checked against the state the updater actually sees. `ownsProgress` reads the
                    // render's `progress`, which can be one step behind a hide that has just started.
                    if (!current || current.attemptId !== (msg.attemptId ?? null)) {
                        return current;
                    }
                    return {
                        ...current,
                        message,
                        subtext: msg.subtext ?? loadingSubtexts[message] ?? 'Please wait while we process your request',
                    };
                });
                break;
            }

            case ExtensionMsg.LoginOptionsResult: {
                // Gated on the whole case, not just the indicator: a stale answer for a retracted attempt
                // must not move the form to stage 1 either, while a different attempt is now active. An
                // undefined attemptId cannot happen for this message in practice, but is let through rather
                // than rejected, matching the other three result handlers below.
                if (msg.attemptId !== undefined && msg.attemptId !== activeAttemptId) {
                    break;
                }
                setActiveAttemptId(null);
                hideProgress();
                setIsCheckingOptions(false);
                setLoginMethod(msg.loginMethod);
                // Replaced rather than kept: a password account answers with null, and carrying over the
                // last identity provider's name would attribute the wrong one.
                setIdpName(msg.idpName ?? null);
                setStage(1);
                break;
            }

            case ExtensionMsg.LoginOptionsError: {
                // Gated for the same reason as LoginOptionsResult above.
                if (msg.attemptId !== undefined && msg.attemptId !== activeAttemptId) {
                    break;
                }
                setActiveAttemptId(null);
                hideProgress();
                setIsCheckingOptions(false);
                setIsSubmitting(false);
                setStatusMessage(msg.error ?? 'Failed to reach Artemis server. Please check your connection or server URL.');
                setStatusType('error');
                setShowHealthChecks(true);
                if (serverUrl) {
                    performHealthChecks();
                }
                break;
            }

            case ExtensionMsg.LoginSuccess: {
                if (!acceptsAuthOutcome(msg.attemptId)) {
                    break;
                }
                // Not the end of the flow, the middle of it. The credential is committed, but the host
                // still has to wire up the authenticated UI, and that used to happen behind a form that
                // had just reset itself and claimed nothing was going on.
                enterHandover(msg.attemptId === undefined ? 'oidc' : 'password', msg.attemptId ?? null);
                break;
            }

            case ExtensionMsg.LoginHandoverFailed: {
                // Live, so it must belong to the handover this view is actually in. An id names the
                // password attempt; no id is the OIDC signature and is only this view's business while
                // the handover it holds is an OIDC one.
                const mine = msg.attemptId !== undefined
                    ? handover?.attemptId === msg.attemptId
                    : handover?.source === 'oidc';
                if (!handover || !mine) {
                    break;
                }
                failHandover(msg.error, null);
                break;
            }

            case ExtensionMsg.LoginHandoverFailedInit: {
                // A replay for a view that did not exist when the failure happened, so there is no owner
                // to match and the absence of one is the point. It must not speak over a sign-in this
                // mount has since started, and repeating the same generation changes nothing: init is
                // resent on every ready, request-init and visibility change.
                if (startedAttempt.current || handoverFailure?.generation === msg.generation) {
                    break;
                }
                failHandover(msg.error, msg.generation);
                break;
            }

            case ExtensionMsg.LoginError: {
                // Gated for the same reason as LoginSuccess above.
                if (msg.attemptId !== undefined && msg.attemptId !== activeAttemptId) {
                    break;
                }
                setActiveAttemptId(null);
                hideProgress();
                setStatusMessage(msg.error ?? 'Login failed');
                setStatusType('error');
                setIsSubmitting(false);
                setIsCheckingOptions(false);
                setIsOidcPending(false);
                setShowHealthChecks(true);
                if (serverUrl) {
                    performHealthChecks();
                }
                break;
            }

            case ExtensionMsg.SetServerUrl: {
                setServerUrl(msg.serverUrl ?? '');
                break;
            }

            case ExtensionMsg.HealthCheckResults: {
                const services: ServiceInfo[] = Object.entries(msg.results).map(([serviceName, data]) => ({
                    name: formatServiceName(serviceName),
                    status: data.status,
                    message: data.message ?? '',
                    endpoint: data.endpoint ?? '',
                    httpStatus: data.httpStatus !== null ? String(data.httpStatus) : undefined,
                    response: data.response ?? undefined,
                }));
                setHealthServices(services);
                setIsHealthChecking(false);
                setLastHealthCheck(new Date());
                break;
            }
        }
        // `activeAttemptId` and `progress` are read from the closure by `ownsProgress`, not through refs,
        // so a stale render here would let the handler decide ownership off an outdated indicator.
    }, [serverUrl, activeAttemptId, progress]);

    const performHealthChecks = () => {
        if (!serverUrl) {
            return;
        }
        setIsHealthChecking(true);
        postCommand(vscodeApi, 'performHealthChecks', { serverUrl });
    };

    const handleCheckLogin = () => {
        if (isCheckingOptions) {
            return;
        }
        const trimmedUsername = username.trim();
        if (!trimmedUsername) {
            setStatusMessage('Please enter your username.');
            setStatusType('error');
            return;
        }

        const attemptId = nextAttemptId();
        setActiveAttemptId(attemptId);
        setStatusMessage('');
        setIsCheckingOptions(true);
        showProgress('Checking how you sign in', 'Asking Artemis which login this account uses', attemptId);
        postCommand(vscodeApi, 'checkLoginOptions', { username: trimmedUsername, attemptId });
    };

    const handleOidcLogin = () => {
        // Guarded here as well as on the button: every start replaces the pending attempt on the extension
        // side, so a second one would quietly strand the browser tab the user is already looking at.
        // The handover guard is on the handler rather than only the button because a disabled control
        // still leaves keyboard submits and programmatic calls open.
        if (isOidcPending || handover) {
            return;
        }
        setIsOidcPending(true);
        postCommand(vscodeApi, 'startOidcLogin', { rememberMe });
        setStatusMessage(`Redirecting to ${idpName ?? GENERIC_IDP_NAME}. Please complete the sign-in process in your browser.`);
        setStatusType('info');
    };

    /** Retracts whatever attempt is in flight and unlocks the form, without moving off the current step. */
    const cancelAttempt = () => {
        setActiveAttemptId(null);
        setIsSubmitting(false);
        setIsCheckingOptions(false);
        setIsOidcPending(false);
        hideProgress();
        postCommand(vscodeApi, 'cancelLogin');
    };

    const handleBack = () => {
        // Past the commit there is nothing left to retract, and dropping the user back onto the form
        // while they are signed in would be a lie about the state they are in.
        if (handover) {
            return;
        }
        // Retract the attempt too, otherwise a callback from the abandoned browser tab or a late server
        // answer could still sign the user in, possibly under the name they just backed away from.
        cancelAttempt();
        setPassword('');
        setStatusMessage('');
        setLoginMethod('PASSWORD');
        setIdpName(null);
        setStage(0);
    };

    const handleSubmit = (e: FormEvent) => {
        e.preventDefault();

        // The credential is already committed; a second sign-in from here would race the one being
        // wired up. A disabled submit button does not cover a keyboard submit, so the guard is here.
        if (handover) {
            return;
        }

        if (stage === 0) {
            handleCheckLogin();
            return;
        }

        if (loginMethod === 'OIDC') {
            handleOidcLogin();
            return;
        }

        if (loginMethod === 'SAML2') {
            // Nothing to submit: SAML2 has no flow in the extension, and sending it down the OIDC path
            // would open an endpoint this server does not serve.
            return;
        }

        if (isSubmitting) {
            return;
        }
        const trimmedUsername = username.trim();
        if (!trimmedUsername || !password) {
            setStatusMessage('Please enter both username and password.');
            setStatusType('error');
            return;
        }

        const attemptId = nextAttemptId();
        setActiveAttemptId(attemptId);
        setStatusMessage('');
        setIsSubmitting(true);
        showProgress('Verifying your credentials', 'Checking your username and password', attemptId);

        postCommand(vscodeApi, 'login', {
            username: trimmedUsername,
            password,
            rememberMe,
            attemptId,
        });
    };

    const handleOpenWebsite = () => {
        postCommand(vscodeApi, 'openWebsite');
    };

    const handleOpenSettings = () => {
        postCommand(vscodeApi, 'openSettings', { setting: 'Artemis' });
    };

    if (handoverFailure) {
        // Deliberately not the login form. The credential is committed and valid, so any affordance
        // that reads as "authenticate again" would be false. A reload rebuilds the host state that
        // failed, from a credential that is still there.
        return (
            <div className={styles.loginView}>
                <div style={{ marginBottom: '32px', textAlign: 'center' }}>
                    <h1 style={{ color: 'var(--vscode-foreground)', fontSize: '24px', marginBottom: '8px' }}>
                        Artemis Login
                    </h1>
                </div>
                <Container>
                    <StatusMessage message={handoverFailure.error} type="error" data-testid="login-status" />
                    <div style={{ marginTop: '16px' }}>
                        <Button
                            type="button"
                            variant="primary"
                            fullWidth
                            testId="login-reload"
                            onClick={() => postCommand(vscodeApi, 'reloadWindow')}
                        >
                            Reload Window
                        </Button>
                    </div>
                </Container>
            </div>
        );
    }

    return (
        <div className={styles.loginView}>
            <div style={{ marginBottom: '32px', textAlign: 'center' }}>
                <h1 style={{ color: 'var(--vscode-foreground)', fontSize: '24px', marginBottom: '8px' }}>
                    Artemis Login
                </h1>
                <p style={{ color: 'var(--vscode-descriptionForeground)', fontSize: '14px', margin: 0 }}>
                    VS Code Extension for the Artemis Learning Platform
                </p>
            </div>

            {progress && (
                <div
                    className={`${styles.loadingIndicator} ${progress.hiding ? styles.loadingIndicatorHiding : ''}`}
                    role="status"
                    aria-live="polite"
                    aria-atomic="true"
                    data-testid="login-progress"
                >
                    <div className={styles.loadingSpinner} aria-hidden="true" />
                    <div className={styles.loadingContent}>
                        <div className={styles.loadingText}>
                            {progress.message.replace(/\.\.\.$/, '')}
                            <span className={styles.loadingDots} />
                        </div>
                        <div className={styles.loadingSubtext}>{progress.subtext}</div>
                    </div>
                </div>
            )}

            <Container
                header={
                    <div>
                        <div style={{ fontSize: '18px', fontWeight: 600, marginBottom: '4px' }}>
                            Login to Artemis
                        </div>
                        <div style={{ fontSize: '13px', opacity: 0.8 }}>
                            {stage === 0
                                ? 'Enter your TUM username to continue'
                                : `Logging in as ${username}`}
                        </div>
                    </div>
                }
            >
                <form onSubmit={handleSubmit} data-testid="login-form">
                    {stage === 0 ? (
                        <TextInput
                            id="username"
                            label="Username"
                            type="text"
                            placeholder="Enter your TUM username"
                            value={username}
                            onChange={setUsername}
                            disabled={isSubmitting || isCheckingOptions}
                            required
                            autocomplete="username"
                            fullWidth
                            testId="login-username"
                        />
                    ) : (
                        <>
                            {loginMethod === 'PASSWORD' ? (
                                <TextInput
                                    id="password"
                                    label="Password"
                                    type="password"
                                    placeholder="Enter your password"
                                    value={password}
                                    onChange={setPassword}
                                    disabled={isSubmitting}
                                    required
                                    autocomplete="current-password"
                                    fullWidth
                                    testId="login-password"
                                />
                            ) : loginMethod === 'SAML2' ? (
                                <div style={{ marginTop: '8px', marginBottom: '16px', textAlign: 'center' }}>
                                    <p style={{ color: 'var(--vscode-descriptionForeground)', fontSize: '13px', margin: 0 }}>
                                        {idpName
                                            ? `This account signs in through ${idpName}, which the extension cannot complete yet.`
                                            : `This account signs in through ${GENERIC_IDP_NAME}, which the extension cannot complete yet.`}
                                        {' '}Please log in on the Artemis website instead.
                                    </p>
                                </div>
                            ) : (
                                <div style={{ marginTop: '8px', marginBottom: '16px', textAlign: 'center' }}>
                                    <p style={{ color: 'var(--vscode-descriptionForeground)', fontSize: '13px', margin: 0 }}>
                                        You will be redirected to complete authentication via {idpName ?? GENERIC_IDP_NAME}.
                                    </p>
                                </div>
                            )}

                            <div style={{ marginTop: '16px', marginBottom: '16px' }}>
                                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                                    <input
                                        type="checkbox"
                                        checked={rememberMe}
                                        onChange={(e) => setRememberMe(e.target.checked)}
                                        disabled={isSubmitting}
                                        style={{ cursor: 'pointer' }}
                                    />
                                    <span style={{ color: 'var(--vscode-foreground)', fontSize: '13px' }}>
                                        Remember me on this device
                                    </span>
                                </label>
                            </div>
                        </>
                    )}

                    {statusMessage && (
                        <div style={{ marginTop: '16px', marginBottom: '16px' }}>
                            <StatusMessage
                                message={statusMessage}
                                type={statusType}
                                data-testid="login-status"
                            />
                        </div>
                    )}

                    <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {stage === 0 ? (
                            <>
                                <Button
                                    type="button"
                                    variant="primary"
                                    fullWidth
                                    disabled={isSubmitting || isCheckingOptions}
                                    testId="login-next"
                                    onClick={handleCheckLogin}
                                >
                                    {isCheckingOptions ? 'Checking options...' : 'Continue'}
                                </Button>
                                {isCheckingOptions && (
                                    <Button
                                        type="button"
                                        variant="secondary"
                                        fullWidth
                                        testId="login-secondary"
                                        onClick={cancelAttempt}
                                    >
                                        Cancel
                                    </Button>
                                )}
                            </>
                        ) : (
                            <>
                                {loginMethod === 'PASSWORD' && (
                                    <Button
                                        type="submit"
                                        variant="primary"
                                        fullWidth
                                        disabled={isSubmitting || handover !== null}
                                        testId="login-submit"
                                    >
                                        {isSubmitting || handover ? 'Logging in...' : 'Login to Artemis'}
                                    </Button>
                                )}
                                {loginMethod === 'OIDC' && (
                                    <Button
                                        type="button"
                                        variant="primary"
                                        fullWidth
                                        disabled={isSubmitting || isOidcPending}
                                        onClick={handleOidcLogin}
                                        testId="login-oidc-submit"
                                    >
                                        {isOidcPending ? 'Waiting for your browser...' : `Sign in with ${idpName ?? GENERIC_IDP_NAME}`}
                                    </Button>
                                )}

                                {/*
                                  * Gone entirely during the handover, not disabled. Both meanings this
                                  * button can carry are false once the credential is committed: there is
                                  * nothing left to Cancel, and Back would offer a way out of a state the
                                  * user is already past. Driven by the phase rather than `isSubmitting`,
                                  * which is false throughout an OIDC browser wait.
                                  */}
                                {!handover && (
                                    <Button
                                        type="button"
                                        variant="secondary"
                                        fullWidth
                                        // Not disabled while a password login is in flight: that wait is
                                        // exactly the one the user needs a way out of, so the button stays
                                        // live and switches meaning to Cancel instead.
                                        testId="login-secondary"
                                        onClick={isSubmitting ? cancelAttempt : handleBack}
                                    >
                                        {isSubmitting ? 'Cancel' : '← Back'}
                                    </Button>
                                )}
                            </>
                        )}
                    </div>

                    <div style={{ marginTop: '20px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <Button variant="link" onClick={handleOpenWebsite}>
                            Open Artemis in Browser →
                        </Button>
                        <Button variant="link" onClick={handleOpenSettings}>
                            Open Artemis Settings →
                        </Button>
                    </div>
                </form>
            </Container>

            {showHealthChecks && healthServices.length > 0 && (
                <div style={{ marginTop: '24px' }}>
                    <ServiceHealth
                        services={healthServices}
                        onRefresh={performHealthChecks}
                        isRefreshing={isHealthChecking}
                        lastCheckTime={lastHealthCheck}
                        compact
                        showTitle
                    />
                </div>
            )}
        </div>
    );
}
