import { useState, useEffect, useRef, type FormEvent } from 'react';
import { Container } from '../../components/Container';
import { TextInput } from '../../components/TextInput';
import { Button } from '../../components/Button';
import { ServiceHealth, type ServiceInfo } from '../../components/ServiceHealth';
import { useExtensionMessage } from '../../hooks/useExtensionMessage';
import type { LoginViewProps, LoginPersistedState, LoginViewState } from './types';
import { ExtensionMsg, postCommand } from '../../../../../shared/messageContracts';
import { formatServiceName } from '../../utils/formatServiceName';
import styles from './LoginView.module.css';

export function LoginView({ vscodeApi }: LoginViewProps) {
	// Load persisted state
	const persistedState = vscodeApi.getState<LoginPersistedState>();

	// View state (discriminated)
	const [viewState, setViewState] = useState<LoginViewState>('form');

	// Form state (persisted)
	const [username, setUsername] = useState(persistedState?.username || '');
	const [password, setPassword] = useState(persistedState?.password || '');
	const [rememberMe, setRememberMe] = useState(persistedState?.rememberMe ?? true);

	// Transient status messages
	const [statusMessage, setStatusMessage] = useState('');
	const [statusType, setStatusType] = useState<'success' | 'error' | 'info'>('info');

	// Loading state
	const [loadingMessage, setLoadingMessage] = useState('Checking authentication...');
	const [loadingSubtext, setLoadingSubtext] = useState('Please wait while we verify your credentials');
	const [loadingVisible, setLoadingVisible] = useState(false);
	const [loadingHiding, setLoadingHiding] = useState(false);

	// Map loading messages to subtexts
	const loadingSubtexts: Record<string, string> = {
		'Checking stored credentials...': 'Looking for saved authentication data',
		'Validating authentication...': 'Verifying your login credentials',
		'Loading user information...': 'Fetching your profile and preferences',
		'Connecting to Artemis...': 'Establishing secure connection',
		'Checking authentication...': 'Please wait while we verify your credentials',
	};

	// Server URL for health checks
	const [serverUrl, setServerUrl] = useState('');

	// Health check state
	const [showHealthChecks, setShowHealthChecks] = useState(false);
	const [healthServices, setHealthServices] = useState<ServiceInfo[]>([]);
	const [isHealthChecking, setIsHealthChecking] = useState(false);
	const [lastHealthCheck, setLastHealthCheck] = useState<Date | undefined>(undefined);

	// Form submission state
	const [isSubmitting, setIsSubmitting] = useState(false);

	// Persist form state changes
	useEffect(() => {
		vscodeApi.setState<LoginPersistedState>({
			username,
			password,
			rememberMe,
		});
	}, [username, password, rememberMe, vscodeApi]);

	// Timer ref for hide-loading animation
	const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	// Cleanup timer on unmount
	useEffect(() => () => {
		if (hideTimerRef.current) {clearTimeout(hideTimerRef.current);}
	}, []);

	// Message handler for extension-to-webview messages
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

			case ExtensionMsg.LoginSuccess:
				setViewState('form');
				setStatusMessage('');
				setIsSubmitting(false);
				setShowHealthChecks(false);
				break;

			case ExtensionMsg.LoginError: {
				setViewState('form');
				setStatusMessage(msg.error ?? 'Login failed');
				setStatusType('error');
				setIsSubmitting(false);
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

	// Perform health checks
	const performHealthChecks = () => {
		if (!serverUrl) {return;}
		setIsHealthChecking(true);
		postCommand(vscodeApi, 'performHealthChecks', { serverUrl });
	};

	// Handle form submission
	const handleSubmit = (e: FormEvent) => {
		e.preventDefault();

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

	// Handle quick links
	const handleOpenWebsite = () => {
		postCommand(vscodeApi, 'openWebsite');
	};

	const handleOpenSettings = () => {
		postCommand(vscodeApi, 'openSettings', { setting: 'Artemis' });
	};

	return (
		<div className={styles.loginView}>
			{/* Header */}
			<div style={{ marginBottom: '32px', textAlign: 'center' }}>
				<h1 style={{ color: 'var(--vscode-foreground)', fontSize: '24px', marginBottom: '8px' }}>
					Artemis Login
				</h1>
				<p style={{ color: 'var(--vscode-descriptionForeground)', fontSize: '14px', margin: 0 }}>
					VS Code Extension for the Artemis Learning Platform
				</p>
			</div>

			{/* Loading indicator */}
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

			{/* Login form */}
			{(viewState === 'form' || viewState === 'loading') && (
				<Container
					header={
						<div>
							<div style={{ fontSize: '18px', fontWeight: 600, marginBottom: '4px' }}>
								Login to Artemis
							</div>
							<div style={{ fontSize: '13px', opacity: 0.8 }}>
								Use your TUM credentials to continue
							</div>
						</div>
					}
				>
					<form onSubmit={handleSubmit} data-testid="login-form">
						<TextInput
							id="username"
							label="Username"
							type="text"
							placeholder="Enter your TUM username"
							value={username}
							onChange={setUsername}
							disabled={isSubmitting}
							required
							autocomplete="username"
							fullWidth
							testId="login-username"
						/>

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

						<div style={{ marginBottom: '16px' }}>
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

						{statusMessage && (
							<div
								data-testid="login-status"
								style={{
									marginBottom: '16px',
									padding: '12px',
									borderRadius: '4px',
									fontSize: '13px',
									backgroundColor:
										statusType === 'success'
											? 'var(--vscode-testing-iconPassed)'
											: statusType === 'error'
											? 'var(--vscode-inputValidation-errorBackground)'
											: 'var(--vscode-inputValidation-infoBackground)',
									color: 'var(--vscode-foreground)',
									border: `1px solid ${
										statusType === 'success'
											? 'var(--vscode-testing-iconPassed)'
											: statusType === 'error'
											? 'var(--vscode-inputValidation-errorBorder)'
											: 'var(--vscode-inputValidation-infoBorder)'
									}`,
								}}
							>
								{statusMessage}
							</div>
						)}

						<Button
							type="submit"
							variant="primary"
							fullWidth
							disabled={isSubmitting}
							testId="login-submit"
						>
							{isSubmitting ? 'Logging in...' : 'Login to Artemis'}
						</Button>

						{/* Quick links */}
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

			{/* Health checks section (shown on error) */}
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
