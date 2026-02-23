/**
 * Barrel export for React view components.
 * Each view is a standalone component that implements a specific application screen.
 */

export { GitCredentialsView } from './GitCredentials';
export type { GitCredentialsViewProps, GitCredentialsPersistedState } from './GitCredentials';

export { ServiceStatusView } from './ServiceStatus';
export type { ServiceStatusViewProps } from './ServiceStatus';

export { RecommendedExtensionsView } from './RecommendedExtensions';
export type { RecommendedExtensionsViewProps, RecommendedExtensionsPersistedState } from './RecommendedExtensions';

export { LoginView } from './Login';
export type { LoginViewProps, LoginPersistedState } from './Login';

export { DashboardView } from './Dashboard';
export type { DashboardViewProps, DashboardPersistedState } from './Dashboard';

export { CourseListView } from './CourseList';
export type { CourseListViewProps, CourseListPersistedState, CourseData, ArchivedCourse } from './CourseList';

export { CourseDetailView } from './CourseDetail';
export type { CourseDetailViewProps, CourseDetailPersistedState } from './CourseDetail';

export { ExerciseDetailView } from './ExerciseDetail';
export type { ExerciseDetailViewProps } from './ExerciseDetail';
