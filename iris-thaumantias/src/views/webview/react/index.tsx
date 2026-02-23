import './styles/base.css';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ErrorBoundary } from './ErrorBoundary';

interface VsCodeApi {
	postMessage(message: unknown): void;
	getState(): unknown;
	setState(state: unknown): void;
}

declare global {
	interface Window {
		acquireVsCodeApi(): VsCodeApi;
	}
}

// Acquire VS Code API once at module scope
const vscode = window.acquireVsCodeApi();

// Get root container
const container = document.getElementById('root');
if (!container) {
	throw new Error('Root container not found');
}

// Render React app with error boundary
const root = createRoot(container);
root.render(
	<ErrorBoundary vscodeApi={vscode}>
		<App vscodeApi={vscode} />
	</ErrorBoundary>
);

// Signal readiness to extension host
vscode.postMessage({ type: 'ready' });
