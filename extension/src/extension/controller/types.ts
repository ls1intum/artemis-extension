import type { CourseDetailData } from '@shared/messageContracts';

import type { ExerciseDetailsResponse } from '@extension/types';

import type { UserInfo } from './appStateManager';

/**
 * Interface implemented by classes that can perform actions requested from the webview.
 */
export interface WebViewActionHandler {
    showCourseList(): Promise<void>;
    showDashboard(userInfo: UserInfo): Promise<void>;
    navigateToStartPage(userInfo: UserInfo): Promise<void>;
    showAiConfig(): void;
    showServiceStatus(): void;
    showStruggleDetection(): void;
    showRecommendedExtensions(): void;
    showGitCredentials(): void;
    openJsonInEditor(data: unknown): Promise<void>;
    openExerciseDetails(exerciseId: number): Promise<void>;
    openExerciseFullscreen(exerciseData: ExerciseDetailsResponse): Promise<void>;
    openCourseFullscreen(courseData: CourseDetailData): Promise<void>;
    openCourseListFullscreen(): Promise<void>;
    openStruggleFullscreen(): Promise<void>;
    render(): void;
    sendInitData(): void;
    backgroundRenderProblemStatement(): void;
}
