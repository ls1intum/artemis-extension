import type { VsCodeApi } from '../../../shared/messageContracts';
import { GitCredentialsView } from './views/GitCredentials';

interface AppProps {
	vscodeApi: VsCodeApi;
}

export function App({ vscodeApi }: AppProps) {
	// Read the view name from the root element's data-view attribute
	const viewName = document.getElementById('root')?.getAttribute('data-view');

	// Route to the appropriate view component
	switch (viewName) {
		case 'gitCredentials':
			return <GitCredentialsView vscodeApi={vscodeApi} />;
		default:
			return (
				<div style={{ color: 'var(--vscode-foreground)', padding: '20px' }}>
					Unknown view: {viewName}
				</div>
			);
	}
}
