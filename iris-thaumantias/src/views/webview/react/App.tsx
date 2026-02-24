import type { VsCodeApi } from '../../../shared/messageContracts';
import { GitCredentialsView } from './views/GitCredentials';
import { ServiceStatusView } from './views/ServiceStatus';
import { RecommendedExtensionsView } from './views/RecommendedExtensions';
import { LoginView } from './views/Login';
import { DashboardView } from './views/Dashboard';
import { CourseListView } from './views/CourseList';
import { CourseDetailView } from './views/CourseDetail';
import { ExerciseDetailView } from './views/ExerciseDetail';
import { ExamStartView } from './views/ExamStart';
import { ExamConductionView } from './views/ExamConduction';
import { ExamExerciseDetailView } from './views/ExamExerciseDetail';

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
		case 'serviceStatus':
			return <ServiceStatusView vscodeApi={vscodeApi} />;
		case 'recommendedExtensions':
			return <RecommendedExtensionsView vscodeApi={vscodeApi} />;
		case 'login':
			return <LoginView vscodeApi={vscodeApi} />;
		case 'dashboard':
			return <DashboardView vscodeApi={vscodeApi} />;
		case 'courseList':
			return <CourseListView vscodeApi={vscodeApi} />;
		case 'courseDetail':
			return <CourseDetailView vscodeApi={vscodeApi} />;
		case 'exerciseDetail':
			return <ExerciseDetailView vscodeApi={vscodeApi} />;
		case 'examStart':
			return <ExamStartView vscodeApi={vscodeApi} />;
		case 'examConduction':
			return <ExamConductionView vscodeApi={vscodeApi} />;
		case 'examExerciseDetail':
			return <ExamExerciseDetailView vscodeApi={vscodeApi} />;
		default:
			return (
				<div style={{ color: 'var(--vscode-foreground)', padding: '20px' }}>
					Unknown view: {viewName}
				</div>
			);
	}
}
