interface VsCodeApi {
	postMessage(message: unknown): void;
	getState(): unknown;
	setState(state: unknown): void;
}

interface AppProps {
	vscodeApi: VsCodeApi;
}

export function App({ vscodeApi }: AppProps) {
	return (
		<div style={{ color: 'var(--vscode-foreground)', padding: '20px' }}>
			Artemis React Webview
		</div>
	);
}
