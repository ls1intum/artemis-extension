import type { UserInfo } from './appStateManager';
import type { ExerciseDetailsResponse, CourseDetailData } from '../../types/apiResponses';

/**
 * Interface implemented by classes that can perform actions requested from the webview.
 */
export interface WebViewActionHandler {
    showCourseList(): Promise<void>;
    showDashboard(userInfo: UserInfo): Promise<void>;
    showAiConfig(): void;
    showServiceStatus(): void;
    showStruggleDetection(): void;
    showRecommendedExtensions(): void;
    showGitCredentials(): void;
    openJsonInEditor(data: unknown): Promise<void>;
    openExerciseDetails(exerciseId: number): Promise<void>;
    openExamExerciseDetails(exercise: ExerciseDetailsResponse, exerciseIndex: number, courseId: number, examId: number): Promise<void>;
    openExerciseFullscreen(exerciseData: ExerciseDetailsResponse): Promise<void>;
    openCourseFullscreen(courseData: CourseDetailData): Promise<void>;
    openCourseListFullscreen(): Promise<void>;
    render(): void;
    sendInitData(): void;
}
