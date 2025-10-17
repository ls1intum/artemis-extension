import type { UserInfo } from './appStateManager';

/**
 * Interface implemented by classes that can perform actions requested from the webview.
 */
export interface WebViewActionHandler {
    showCourseList(): Promise<void>;
    showDashboard(userInfo: UserInfo): Promise<void>;
    showAiConfig(): void;
    showServiceStatus(): void;
    showRecommendedExtensions(): void;
    showGitCredentials(): void;
    openJsonInEditor(data: any): Promise<void>;
    openExerciseDetails(exerciseId: number): Promise<void>;
    openExerciseFullscreen(exerciseData: any): Promise<void>;
    openCourseFullscreen(courseData: any): Promise<void>;
    render(): void;
}
