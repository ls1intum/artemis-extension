import { useState, useEffect, type FormEvent } from 'react';
import { Container } from '../../components/Container';
import { TextInput } from '../../components/TextInput';
import { Button } from '../../components/Button';
import { ServiceHealth, type ServiceInfo } from '../../components/ServiceHealth';
import type { LoginViewProps, LoginPersistedState, LoginViewState, UserInfo } from './types';
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

	// Logged-in state
	const [userInfo, setUserInfo] = useState<UserInfo | null>(null);

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

	// Message handler for extension-to-webview messages
	useEffect(() => {
		const messageHandler = (event: MessageEvent<unknown>) => {
			const message = event.data;

			if (typeof message !== 'object' || message === null || !('type' in message)) {
				return;
			}

			const typedMessage = message as Record<string, unknown> & { type: string };

			switch (typedMessage.type) {
				case 'showLoading': {
					setViewState('loading');
					setLoadingHiding(false);
					setLoadingVisible(true);
					const payload = typedMessage.payload as { message?: string } | undefined;
					const showMsg = payload?.message ?? 'Checking authentication...';
					setLoadingMessage(showMsg);
					setLoadingSubtext(loadingSubtexts[showMsg] ?? 'Please wait while we process your request');
					break;
				}

				case 'hideLoading':
					if (viewState === 'loading') {
						setLoadingHiding(true);
						setTimeout(() => {
							setLoadingVisible(false);
							setLoadingHiding(false);
							setViewState('form');
							setLoadingMessage('');
							setLoadingSubtext('');
						}, 300);
					}
					break;

				case 'updateLoading': {
					const payload = typedMessage.payload as { message?: string } | undefined;
					const updateMsg = payload?.message ?? 'Processing...';
					setLoadingMessage(updateMsg);
					setLoadingSubtext(loadingSubtexts[updateMsg] ?? 'Please wait while we process your request');
					break;
				}

				case 'loginSuccess':
					setViewState('form'); // Dashboard transition handled by extension
					setStatusMessage('');
					setIsSubmitting(false);
					setShowHealthChecks(false);
					break;

				case 'loginError': {
					setViewState('form');
					const payload = typedMessage.payload as { error?: string } | undefined;
					setStatusMessage(payload?.error ?? 'Login failed');
					setStatusType('error');
					setIsSubmitting(false);
					setShowHealthChecks(true);
					// Trigger health checks on error
					if (serverUrl) {
						performHealthChecks();
					}
					break;
				}

				case 'logoutSuccess':
					setViewState('form');
					setUserInfo(null);
					setStatusMessage('You have been logged out.');
					setStatusType('info');
					setShowHealthChecks(false);
					break;

				case 'showLoggedIn': {
					setViewState('loggedIn');
					const payload = typedMessage.payload as { userInfo?: UserInfo } | undefined;
					setUserInfo(payload?.userInfo ?? null);
					setShowHealthChecks(false);
					break;
				}

				case 'setServerUrl': {
					const payload = typedMessage.payload as { serverUrl?: string } | undefined;
					setServerUrl(payload?.serverUrl ?? '');
					break;
				}

				case 'healthCheckResults': {
					// Convert health check results to ServiceInfo format
					const payload = typedMessage.payload as {
						results?: Record<string, {
							status: string;
							message: string;
							endpoint: string;
							httpStatus: number | null;
							response: string | null;
						}>;
					} | undefined;

					const results = payload?.results ?? {};
					const services: ServiceInfo[] = Object.entries(results).map(([serviceName, data]) => ({
						name: formatServiceName(serviceName),
						status: data.status as 'online' | 'offline' | 'checking' | 'unknown',
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
		};

		window.addEventListener('message', messageHandler);
		return () => window.removeEventListener('message', messageHandler);
	}, [viewState, serverUrl]);

	// Format service name from camelCase to Title Case
	const formatServiceName = (name: string): string => {
		return name
			.replace(/([A-Z])/g, ' $1')
			.replace(/^./, (str) => str.toUpperCase())
			.trim();
	};

	// Perform health checks
	const performHealthChecks = () => {
		if (!serverUrl) return;
		setIsHealthChecking(true);
		vscodeApi.postMessage({
			type: 'command',
			command: 'performHealthChecks',
			payload: { serverUrl },
		});
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

		vscodeApi.postMessage({
			type: 'command',
			command: 'login',
			payload: {
				username: trimmedUsername,
				password,
				rememberMe,
			},
		});
	};

	// Handle quick links
	const handleOpenWebsite = () => {
		vscodeApi.postMessage({
			type: 'command',
			command: 'openWebsite',
		});
	};

	const handleOpenSettings = () => {
		vscodeApi.postMessage({
			type: 'command',
			command: 'openSettings',
		});
	};

	const handleLogout = () => {
		vscodeApi.postMessage({
			type: 'command',
			command: 'logout',
		});
	};

	const handleBrowseCourses = () => {
		vscodeApi.postMessage({
			type: 'command',
			command: 'browseCourses',
		});
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

			{/* Logged-in state */}
			{viewState === 'loggedIn' && userInfo && (
				<Container
					header={
						<div>
							<div style={{ fontSize: '18px', fontWeight: 600, marginBottom: '4px' }}>
								You're already logged in!
							</div>
							<div style={{ fontSize: '13px', opacity: 0.8 }}>
								We found an active Artemis session
							</div>
						</div>
					}
					variant="highlight"
				>
					<div style={{ marginBottom: '20px' }}>
						<div style={{ marginBottom: '16px' }}>
							<div style={{ color: 'var(--vscode-descriptionForeground)', fontSize: '12px', marginBottom: '4px' }}>
								Username
							</div>
							<div style={{ color: 'var(--vscode-foreground)', fontSize: '14px', fontWeight: 500 }}>
								{userInfo.username}
							</div>
						</div>
						<div>
							<div style={{ color: 'var(--vscode-descriptionForeground)', fontSize: '12px', marginBottom: '4px' }}>
								Server URL
							</div>
							<div style={{ color: 'var(--vscode-foreground)', fontSize: '14px', fontWeight: 500 }}>
								{userInfo.serverUrl}
							</div>
						</div>
					</div>

					<div style={{ marginBottom: '12px' }}>
						<Button
							variant="primary"
							fullWidth
							onClick={handleBrowseCourses}
						>
							Go to Dashboard
						</Button>
					</div>

					<Button
						variant="secondary"
						fullWidth
						onClick={handleLogout}
					>
						Logout from Artemis
					</Button>
				</Container>
			)}
		</div>
	);
}
