import { getRecommendedExtensionsByCategory, type RecommendedExtensionCategory } from '../utils/recommendedExtensions';
import type { CourseDashboardResponse, CourseDashboardEntry, ExerciseDetailsResponse, StudentExam, ExerciseDetail } from '../types';
import type { ArchivedCourse, CourseDetailData } from '../../shared/messageContracts';
import type { ArtemisUser } from '../types';

export type AppState = 'login' | 'dashboard' | 'course-list' | 'course-detail' | 'exercise-detail' | 'exam-exercise-detail' | 'ai-config' | 'service-status' | 'struggle-detection' | 'recommended-extensions' | 'git-credentials' | 'exam-start' | 'exam-conduction';

export interface UserInfo {
    username: string;
    serverUrl: string;
    user?: ArtemisUser;
}

export interface ExamData {
    studentExam: StudentExam;
    courseId: number;
    examId: number;
}

export interface ExamExerciseData {
    exercise: ExerciseDetail;
    exerciseIndex: number;
    courseId: number;
    examId: number;
    isExamExercise: true;
    studentExam?: StudentExam;
}

export interface AiExtension {
    id: string;
    name: string;
    publisher: string;
    version: string;
    description: string;
    isInstalled: boolean;
    provider: string;
    providerColor: string;
}

/**
 * Manages the application state for the Artemis webview
 */
export class AppStateManager {
    private _currentState: AppState = 'login';
    private _userInfo?: UserInfo;
    private _coursesData?: CourseDashboardResponse;
    private _archivedCoursesData?: ArchivedCourse[];
    private _archiveCheckComplete = true;
    private _currentCourseData?: CourseDetailData;
    private _currentExerciseData?: ExerciseDetailsResponse | ExamExerciseData;
    private _currentExamData?: ExamData;
    private _aiExtensions?: AiExtension[];
    private _recommendedExtensions?: RecommendedExtensionCategory[];

    private _onStateChange?: (from: AppState, to: AppState) => void;

    constructor() { }

    public set onStateChange(handler: (from: AppState, to: AppState) => void) {
        this._onStateChange = handler;
    }

    private _setCurrentState(newState: AppState): void {
        const prev = this._currentState;
        if (prev === newState) { return; }
        this._currentState = newState;
        this._onStateChange?.(prev, newState);
    }

    // State getters
    get currentState(): AppState {
        return this._currentState;
    }

    get userInfo(): UserInfo | undefined {
        return this._userInfo;
    }

    get coursesData(): CourseDashboardResponse | undefined {
        return this._coursesData;
    }

    get archivedCoursesData(): ArchivedCourse[] | undefined {
        return this._archivedCoursesData;
    }

    get currentCourseData(): CourseDetailData | undefined {
        return this._currentCourseData;
    }

    get currentExerciseData(): ExerciseDetailsResponse | ExamExerciseData | undefined {
        return this._currentExerciseData;
    }

    get currentExamData(): ExamData | undefined {
        return this._currentExamData;
    }

    get aiExtensions(): AiExtension[] | undefined {
        return this._aiExtensions;
    }

    get recommendedExtensions(): RecommendedExtensionCategory[] | undefined {
        return this._recommendedExtensions;
    }

    get archiveCheckComplete(): boolean {
        return this._archiveCheckComplete;
    }

    set archiveCheckComplete(value: boolean) {
        this._archiveCheckComplete = value;
    }

    /**
     * Seeds authenticated session state without triggering a 'dashboard' state change.
     * Used by the workspace start-page flow to keep the loading screen visible
     * while detecting the workspace exercise.
     */
    public seedAuthenticatedSession(userInfo: UserInfo, coursesData?: CourseDashboardResponse): void {
        this._userInfo = userInfo;
        if (coursesData) { this._coursesData = coursesData; }
    }

    // State transitions
    public showDashboard(userInfo: UserInfo, coursesData?: CourseDashboardResponse): void {
        this._userInfo = userInfo;
        this._coursesData = coursesData;
        this._setCurrentState('dashboard');
    }

    public setCoursesData(coursesData: CourseDashboardResponse): void {
        this._coursesData = coursesData;
    }

    public showLogin(): void {
        this._setCurrentState('login');
        this._userInfo = undefined;
        this._coursesData = undefined;
        this._archivedCoursesData = undefined;
        this._currentCourseData = undefined;
        this._currentExerciseData = undefined;
        this._recommendedExtensions = undefined;
    }

    public showCourseList(coursesData?: CourseDashboardResponse): void {
        if (coursesData) { this._coursesData = coursesData; }
        this._setCurrentState('course-list');
    }

    public showCourseDetail(courseData: CourseDetailData): void {
        this._currentCourseData = courseData;
        this._setCurrentState('course-detail');
    }

    public showExerciseDetail(exerciseData: ExerciseDetailsResponse): void {
        this._currentExerciseData = exerciseData;
        this._setCurrentState('exercise-detail');
    }

    public backToCourseDetails(): void {
        this._setCurrentState('course-detail');
    }

    public injectCourseEntry(entry: CourseDashboardEntry): void {
        if (!this._coursesData) {
            this._coursesData = { courses: [] };
        }
        this._coursesData.courses ??= [];
        this._coursesData.courses.push(entry);
    }

    public setArchivedCourses(courses: ArchivedCourse[]): void {
        this._archivedCoursesData = courses;
    }

    public showAiConfig(aiExtensions: AiExtension[]): void {
        this._aiExtensions = aiExtensions;
        this._setCurrentState('ai-config');
    }

    public showServiceStatus(): void {
        this._setCurrentState('service-status');
    }

    public showStruggleDetection(): void {
        this._setCurrentState('struggle-detection');
    }

    public showRecommendedExtensions(recommendedExtensions?: RecommendedExtensionCategory[]): void {
        if (recommendedExtensions) {
            this._recommendedExtensions = recommendedExtensions.map(category => ({
                ...category,
                extensions: category.extensions.map(extension => ({ ...extension }))
            }));
        } else {
            this._recommendedExtensions = getRecommendedExtensionsByCategory();
        }
        this._setCurrentState('recommended-extensions');
    }

    public showGitCredentials(): void {
        this._setCurrentState('git-credentials');
    }

    public showExamStart(examData: ExamData): void {
        this._currentExamData = examData;
        this._setCurrentState('exam-start');
    }

    public showExamConduction(examData: ExamData): void {
        this._currentExamData = examData;
        this._setCurrentState('exam-conduction');
    }

    public showExamExerciseDetail(
        exercise: ExerciseDetail,
        exerciseIndex: number,
        courseId: number,
        examId: number
    ): void {
        // Store the exam exercise with additional context
        this._currentExerciseData = {
            exercise,
            exerciseIndex,
            courseId,
            examId,
            isExamExercise: true,
            studentExam: this._currentExamData?.studentExam
        };
        this._setCurrentState('exam-exercise-detail');
    }

    public backToExam(): void {
        this._setCurrentState('exam-conduction');
    }

    public isLoggedIn(): boolean {
        return this._userInfo !== undefined;
    }

    public requiresAuth(): boolean {
        return this._currentState !== 'login' && !this.isLoggedIn();
    }

    // State validation
    public canShowDashboard(): boolean {
        return this.isLoggedIn();
    }

    public canShowCourseList(): boolean {
        return this.isLoggedIn();
    }

    public canShowCourseDetail(): boolean {
        return this.isLoggedIn() && this._currentCourseData !== undefined;
    }

    public canShowExerciseDetail(): boolean {
        return this.isLoggedIn() && this._currentExerciseData !== undefined;
    }
}
