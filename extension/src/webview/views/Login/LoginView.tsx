import { type FormEvent, useEffect, useRef, useState } from 'react';

import { ExtensionMsg, postCommand } from '@shared/messageContracts';

import { Button } from '@webview/components/Button';
import { Container } from '@webview/components/Container';
import { ServiceHealth, type ServiceInfo } from '@webview/components/ServiceHealth';
import { StatusMessage } from '@webview/components/StatusMessage';
import { TextInput } from '@webview/components/TextInput';
import { useExtensionMessage } from '@webview/hooks/useExtensionMessage';
import { formatServiceName } from '@webview/utils/formatServiceName';

import styles from './LoginView.module.css';
import type { LoginPersistedState, LoginViewProps, LoginViewState } from './types';

// Used wherever the server named no provider, so the UI never claims one it was not told about.
const GENERIC_IDP_NAME = 'your identity provider';

export function LoginView({ vscodeApi }: LoginViewProps) {
    const persistedState = vscodeApi.getState<LoginPersistedState>();

    const [viewState, setViewState] = useState<LoginViewState>('form');

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

    const [statusMessage, setStatusMessage] = useState('');
    const [statusType, setStatusType] = useState<'success' | 'error' | 'info'>('info');

    const [loadingMessage, setLoadingMessage] = useState('Checking authentication...');
    const [loadingSubtext, setLoadingSubtext] = useState('Please wait while we verify your credentials');
    const [loadingVisible, setLoadingVisible] = useState(false);
    const [loadingHiding, setLoadingHiding] = useState(false);

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

    useExtensionMessage((msg) => {
        switch (msg.type) {
            case ExtensionMsg.ShowLoading: {
                setViewState('loading');
                setLoadingHiding(false);
                setLoadingVisible(true);
                const showMsg = msg.message ?? 'Checking authentication...';
                setLoadingMessage(showMsg);
                setLoadingSubtext(loadingSubtexts[showMsg] ?? 'Please wait while we process your request');
                break;
            }

            case ExtensionMsg.HideLoading:
                if (viewState === 'loading') {
                    setLoadingHiding(true);
                    hideTimerRef.current = setTimeout(() => {
                        setLoadingVisible(false);
                        setLoadingHiding(false);
                        setViewState('form');
                        setLoadingMessage('');
                        setLoadingSubtext('');
                    }, 300);
                }
                break;

            case ExtensionMsg.UpdateLoading: {
                const updateMsg = msg.message ?? 'Processing...';
                setLoadingMessage(updateMsg);
                setLoadingSubtext(loadingSubtexts[updateMsg] ?? 'Please wait while we process your request');
                break;
            }

            case ExtensionMsg.LoginOptionsResult: {
                setIsCheckingOptions(false);
                setLoginMethod(msg.loginMethod);
                // Replaced rather than kept: a password account answers with null, and carrying over the
                // last identity provider's name would attribute the wrong one.
                setIdpName(msg.idpName ?? null);
                setStage(1);
                break;
            }

            case ExtensionMsg.LoginOptionsError: {
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

            case ExtensionMsg.LoginSuccess:
                setViewState('form');
                setStatusMessage('');
                setIsSubmitting(false);
                setIsOidcPending(false);
                setShowHealthChecks(false);
                break;

            case ExtensionMsg.LoginError: {
                setViewState('form');
                setStatusMessage(msg.error ?? 'Login failed');
                setStatusType('error');
                setIsSubmitting(false);
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
    }, [viewState, serverUrl]);

    const performHealthChecks = () => {
        if (!serverUrl) {
            return;
        }
        setIsHealthChecking(true);
        postCommand(vscodeApi, 'performHealthChecks', { serverUrl });
    };

    const handleCheckLogin = () => {
        const trimmedUsername = username.trim();
        if (!trimmedUsername) {
            setStatusMessage('Please enter your username.');
            setStatusType('error');
            return;
        }

        setStatusMessage('');
        setIsCheckingOptions(true);
        postCommand(vscodeApi, 'checkLoginOptions', { username: trimmedUsername });
    };

    const handleOidcLogin = () => {
        // Guarded here as well as on the button: every start replaces the pending attempt on the extension
        // side, so a second one would quietly strand the browser tab the user is already looking at.
        if (isOidcPending) {
            return;
        }
        setIsOidcPending(true);
        postCommand(vscodeApi, 'startOidcLogin', { rememberMe });
        setStatusMessage(`Redirecting to ${idpName ?? GENERIC_IDP_NAME}. Please complete the sign-in process in your browser.`);
        setStatusType('info');
    };

    const handleBack = () => {
        setPassword('');
        setStatusMessage('');
        setIsOidcPending(false);
        setLoginMethod('PASSWORD');
        setIdpName(null);
        setStage(0);
        // Retract the attempt, otherwise a callback from the abandoned browser tab could still sign the
        // user in, possibly under the name they just backed away from.
        postCommand(vscodeApi, 'cancelOidcLogin');
    };

    const handleSubmit = (e: FormEvent) => {
        e.preventDefault();

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

        const trimmedUsername = username.trim();
        if (!trimmedUsername || !password) {
            setStatusMessage('Please enter both username and password.');
            setStatusType('error');
            return;
        }

        setStatusMessage('');
        setIsSubmitting(true);

        postCommand(vscodeApi, 'login', {
            username: trimmedUsername,
            password,
            rememberMe,
        });
    };

    const handleOpenWebsite = () => {
        postCommand(vscodeApi, 'openWebsite');
    };

    const handleOpenSettings = () => {
        postCommand(vscodeApi, 'openSettings', { setting: 'Artemis' });
    };

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

            {loadingVisible && (
                <div className={`${styles.loadingIndicator} ${loadingHiding ? styles.loadingIndicatorHiding : ''}`}>
                    <div className={styles.loadingSpinner} />
                    <div className={styles.loadingContent}>
                        <div className={styles.loadingText}>
                            {loadingMessage.replace(/\.\.\.$/, '')}
                            <span className={styles.loadingDots} />
                        </div>
                        <div className={styles.loadingSubtext}>
                            {loadingSubtext}
                        </div>
                    </div>
                </div>
            )}

            {(viewState === 'form' || viewState === 'loading') && (
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
                            ) : (
                                <>
                                    {loginMethod === 'PASSWORD' && (
                                        <Button
                                            type="submit"
                                            variant="primary"
                                            fullWidth
                                            disabled={isSubmitting}
                                            testId="login-submit"
                                        >
                                            {isSubmitting ? 'Logging in...' : 'Login to Artemis'}
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

                                    <Button
                                        type="button"
                                        variant="secondary"
                                        fullWidth
                                        // Blocked while a password login is in flight, as before, but
                                        // deliberately NOT while waiting on the browser: that wait is the
                                        // one the user needs a way out of.
                                        disabled={isSubmitting}
                                        onClick={handleBack}
                                    >
                                        ← Back
                                    </Button>
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
            )}

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
