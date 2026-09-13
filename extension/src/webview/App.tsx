import { useEffect } from 'react';

import type { VsCodeApi } from '@shared/messageContracts';
import { WebviewMsgType } from '@shared/messageContracts';

import { StruggleDetectionView } from '@struggleView';

import styles from './App.module.css';
import { AiConfigView } from './views/AiConfig';
import { CourseDetailView } from './views/CourseDetail';
import { CourseListView } from './views/CourseList';
import { DashboardView } from './views/Dashboard';
import { ExerciseDetailView } from './views/ExerciseDetail';
import { GitCredentialsView } from './views/GitCredentials';
import { IrisChatView } from './views/IrisChat';
import { LoginView } from './views/Login';
import { RecommendedExtensionsView } from './views/RecommendedExtensions';
import { ServiceStatusView } from './views/ServiceStatus';

interface AppProps {
	vscodeApi: VsCodeApi;
}

export function App({ vscodeApi }: AppProps) {
	const viewName = document.getElementById('root')?.getAttribute('data-view');

	// Signal readiness to extension host after mount.
	// This is the single source of the ready signal: individual views register
	// their message listeners in useEffect (child effects fire before parent),
	// so listeners are in place before this signal triggers sendInitData().
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
			case 'irisChat':
				return <IrisChatView vscodeApi={vscodeApi} />;
			case 'aiConfig':
				return <AiConfigView vscodeApi={vscodeApi} />;
			case 'struggleDetection':
				return __IRIS_TELEMETRY__
					? <StruggleDetectionView vscodeApi={vscodeApi} />
					: <div>Unknown view: {viewName}</div>;
			default:
				return <div>Unknown view: {viewName}</div>;
		}
	})();

	// IrisChat is fullscreen (100vh), so it gets no wrapper padding.
	if (viewName === 'irisChat') {return view;}

	return <div className={styles.viewWrapper}>{view}</div>;
}
