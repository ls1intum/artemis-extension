import './styles/base.css';
import 'katex/dist/katex.min.css';

import { createRoot } from 'react-dom/client';

import type { VsCodeApi } from '@shared/messageContracts';

import { App } from './App';
import { ErrorBoundary } from './ErrorBoundary';

declare global {
	interface Window {
		acquireVsCodeApi(): VsCodeApi;
	}
}

// acquireVsCodeApi() may only be called once, hence module scope.
const vscode = window.acquireVsCodeApi();

const container = document.getElementById('root');
if (!container) {
	throw new Error('Root container not found');
}

const root = createRoot(container);
root.render(
	<ErrorBoundary vscodeApi={vscode}>
		<App vscodeApi={vscode} />
	</ErrorBoundary>
);
