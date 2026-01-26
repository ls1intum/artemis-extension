export { AppStateManager, type AppState, type UserInfo, type AiExtension } from './app/appStateManager';
export { ViewRouter } from './app/viewRouter';
export { ViewActionService } from './app/viewActionService';
export { WebViewMessageHandler } from './app/webViewMessageHandler';
export type { WebViewActionHandler } from './app/types';

export { ServiceHealthComponent } from './components/serviceHealth/serviceHealthComponent';
export { BackLinkComponent } from './components/backLink/backLinkComponent';
export { ButtonComponent, type ButtonOptions } from './components/button/buttonComponent';
export { AskIrisComponent, type AskIrisOptions } from './components/askIris/askIrisComponent';

export { AiCheckerView } from './aiChecker/aiCheckerView';
export { CourseDetailView } from './courseDetail/courseDetailView';
export { CourseListView } from './courseList/courseListView';
export { DashboardView } from './dashboard/dashboardView';
export { ExerciseDetailView } from './exerciseDetail/exerciseDetailView';
export { ExamExerciseDetailView, type ExamContext } from './examExerciseDetail/examExerciseDetailView';
export { RecommendedExtensionsView } from './recommendedExtensions/recommendedExtensionsView';
export { IrisChatView } from './irisChat/irisChatView';
export { LoginView } from './login/loginView';
export { ServiceStatusView } from './serviceStatus/serviceStatusView';
export { StruggleDetectionView } from './struggleDetection/struggleDetectionView';
export { GitCredentialsView } from './gitCredentials/gitCredentialsView';
