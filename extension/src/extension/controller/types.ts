import type { CourseDetailData } from '@shared/messageContracts';

import type { ExerciseDetailsResponse } from '@extension/types';

import type { UserInfo } from './appStateManager';

/**
 * Interface implemented by classes that can perform actions requested from the webview.
 */
export interface WebViewActionHandler {
    showCourseList(): Promise<void>;
    /**
     * `force` makes the course list come from the server rather than the catalog's memoised
     * copy. Optional, and absent on every navigation path: only an explicit reload gesture
     * spends a request.
     */
    showDashboard(userInfo: UserInfo, options?: { force?: boolean }): Promise<void>;
    navigateToStartPage(userInfo: UserInfo): Promise<void>;
    showStruggleDetection(): void;
    showSubmissionSetup(): void;
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
