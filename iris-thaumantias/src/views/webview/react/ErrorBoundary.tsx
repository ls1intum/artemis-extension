import React from 'react';

interface VsCodeApi {
	postMessage(message: unknown): void;
	getState(): unknown;
	setState(state: unknown): void;
}

interface ErrorBoundaryProps {
	children: React.ReactNode;
	vscodeApi: VsCodeApi;
}

interface ErrorBoundaryState {
	hasError: boolean;
	error: Error | null;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
	constructor(props: ErrorBoundaryProps) {
		super(props);
		this.state = { hasError: false, error: null };
	}

	static getDerivedStateFromError(error: Error): ErrorBoundaryState {
		return { hasError: true, error };
	}

	componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
		// Send error to extension host via postMessage
		this.props.vscodeApi.postMessage({
			type: 'error',
			error: {
				message: error.message,
				stack: error.stack,
				componentStack: errorInfo.componentStack,
			},
		});
	}

	handleRetry = (): void => {
		this.setState({ hasError: false, error: null });
	};

	render(): React.ReactNode {
		if (this.state.hasError) {
			return (
				<div
					style={{
						display: 'flex',
						flexDirection: 'column',
						alignItems: 'center',
						justifyContent: 'center',
						height: '100vh',
						padding: '20px',
						backgroundColor: 'var(--vscode-inputValidation-errorBackground)',
						border: '1px solid var(--vscode-inputValidation-errorBorder)',
						color: 'var(--vscode-errorForeground)',
					}}
				>
					<h2 style={{ marginBottom: '16px' }}>Something went wrong</h2>
					<p style={{ marginBottom: '8px', textAlign: 'center' }}>
						{this.state.error?.message || 'An unexpected error occurred'}
					</p>
					<button
						onClick={this.handleRetry}
						style={{
							marginTop: '16px',
							padding: '8px 16px',
							backgroundColor: 'var(--vscode-button-background)',
							color: 'var(--vscode-button-foreground)',
							border: 'none',
							borderRadius: '2px',
							cursor: 'pointer',
						}}
					>
						Retry
					</button>
				</div>
			);
		}

		return this.props.children;
	}
}
