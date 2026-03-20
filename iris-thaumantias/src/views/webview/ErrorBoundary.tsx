import React from 'react';
import type { VsCodeApi } from '../../shared/messageContracts';
import { WebviewMsgType } from '../../shared/messageContracts';

interface ErrorBoundaryProps {
	children: React.ReactNode;
	vscodeApi: VsCodeApi;
}

interface ErrorBoundaryState {
	hasError: boolean;
	error: Error | null;
	errorInfo: React.ErrorInfo | null;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
	constructor(props: ErrorBoundaryProps) {
		super(props);
		this.state = { hasError: false, error: null, errorInfo: null };
	}

	static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
		return { hasError: true, error };
	}

	componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
		// Store errorInfo for display
		this.setState({ errorInfo });

		// Report error to extension host via postMessage
		this.props.vscodeApi.postMessage({
			type: WebviewMsgType.Error,
			payload: {
				message: error.message,
				stack: error.stack,
				componentStack: errorInfo.componentStack ?? undefined,
			},
		});
	}

	handleRetry = (): void => {
		this.setState({ hasError: false, error: null, errorInfo: null });
	};

	render(): React.ReactNode {
		if (this.state.hasError) {
			const { error, errorInfo } = this.state;

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
					<h2 style={{ marginBottom: '16px', fontSize: '1.2em', fontWeight: '600' }}>
						Something went wrong
					</h2>

					<p style={{ marginBottom: '16px', textAlign: 'center', maxWidth: '600px' }}>
						{error?.message || 'An unexpected error occurred in the React view.'}
					</p>

					<details
						style={{
							width: '100%',
							maxWidth: '800px',
							marginBottom: '20px',
							padding: '12px',
							backgroundColor: 'var(--vscode-editor-background)',
							border: '1px solid var(--vscode-inputValidation-errorBorder)',
							borderRadius: '4px',
							fontSize: '0.9em',
							cursor: 'pointer',
						}}
					>
						<summary
							style={{
								fontWeight: '600',
								marginBottom: '8px',
								outline: 'none',
								userSelect: 'none',
							}}
						>
							Error details
						</summary>

						<div style={{ marginTop: '12px', fontFamily: 'var(--vscode-editor-font-family, monospace)' }}>
							{error?.stack && (
								<div style={{ marginBottom: '16px' }}>
									<strong>Stack trace:</strong>
									<pre
										style={{
											marginTop: '8px',
											padding: '8px',
											backgroundColor: 'var(--vscode-textCodeBlock-background)',
											borderRadius: '2px',
											overflow: 'auto',
											maxHeight: '200px',
											fontSize: '0.85em',
											whiteSpace: 'pre-wrap',
											wordBreak: 'break-word',
										}}
									>
										{error.stack}
									</pre>
								</div>
							)}

							{errorInfo?.componentStack && (
								<div>
									<strong>Component stack:</strong>
									<pre
										style={{
											marginTop: '8px',
											padding: '8px',
											backgroundColor: 'var(--vscode-textCodeBlock-background)',
											borderRadius: '2px',
											overflow: 'auto',
											maxHeight: '200px',
											fontSize: '0.85em',
											whiteSpace: 'pre-wrap',
											wordBreak: 'break-word',
										}}
									>
										{errorInfo.componentStack}
									</pre>
								</div>
							)}
						</div>
					</details>

					<button
						onClick={this.handleRetry}
						style={{
							padding: '10px 20px',
							fontSize: '14px',
							fontWeight: '600',
							backgroundColor: 'var(--vscode-button-background)',
							color: 'var(--vscode-button-foreground)',
							border: 'none',
							borderRadius: '2px',
							cursor: 'pointer',
							transition: 'opacity 0.2s',
						}}
						onMouseEnter={(e) => {
							e.currentTarget.style.opacity = '0.9';
						}}
						onMouseLeave={(e) => {
							e.currentTarget.style.opacity = '1';
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
