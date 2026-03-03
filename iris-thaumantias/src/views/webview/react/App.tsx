import { useEffect } from 'react';
import type { VsCodeApi } from '../../../shared/messageContracts';
import { WebviewMsgType } from '../../../shared/messageContracts';
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
import { IrisChatView } from './views/IrisChat';
import { AiConfigView } from './views/AiConfig';
import { StruggleDetectionView } from './views/StruggleDetection';
import styles from './App.module.css';

interface AppProps {
	vscodeApi: VsCodeApi;
}

export function App({ vscodeApi }: AppProps) {
	// Read the view name from the root element's data-view attribute
	const viewName = document.getElementById('root')?.getAttribute('data-view');

	// Signal readiness to extension host after mount.
	// This is the single source of the ready signal — individual views register
	// their message listeners in useEffect (child effects fire before parent),
	// so listeners are in place before this signal triggers resendViewData().
	useEffect(() => {
		vscodeApi.postMessage({ type: WebviewMsgType.Ready });
	}, [vscodeApi]);

	const view = (() => {
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
			case 'irisChat':
				return <IrisChatView vscodeApi={vscodeApi} />;
			case 'aiConfig':
				return <AiConfigView vscodeApi={vscodeApi} />;
			case 'struggleDetection':
				return <StruggleDetectionView vscodeApi={vscodeApi} />;
			default:
				return <div>Unknown view: {viewName}</div>;
		}
	})();

	// IrisChat is fullscreen (100vh) — no wrapper padding
	if (viewName === 'irisChat') return view;

	return <div className={styles.viewWrapper}>{view}</div>;
}
