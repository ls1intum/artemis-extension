import { getRecommendedExtensionsByCategory, type RecommendedExtensionCategory } from '../utils/recommendedExtensions';
import type { CourseDashboardResponse, CourseDashboardEntry, ExerciseDetailsResponse, StudentExam, ExerciseDetail } from '../types';
import type { ArchivedCourse, CourseDetailData } from '../../shared/messageContracts';
import type { ArtemisUser } from '../types';
import type { CourseDataCache } from '../services/courseDataCache';

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
 * Discriminated union for the navigation payload. Each view owns exactly one
 * variant, and "back" transitions restore the parent payload explicitly.
 * Entering a view without its required parent in scope is a programmer error
 * — we throw so the bug surfaces instead of silently rendering a broken screen.
 */
type NavigationPayload =
    | { kind: 'none' }
    | { kind: 'course'; data: CourseDetailData }
    | { kind: 'exercise'; data: ExerciseDetailsResponse; parentCourse: CourseDetailData }
    | { kind: 'exam'; data: ExamData }
    | { kind: 'exam-exercise'; exercise: ExamExerciseData; exam: ExamData };

/**
 * Manages the application state for the Artemis webview
 */
export class AppStateManager {
    private _currentState: AppState = 'login';
    private _userInfo?: UserInfo;
    private _courseDataCache?: CourseDataCache;
    private _archivedCoursesData?: ArchivedCourse[];
    private _archiveCheckComplete = true;
    private _payload: NavigationPayload = { kind: 'none' };
    private _aiExtensions?: AiExtension[];
    private _recommendedExtensions?: RecommendedExtensionCategory[];
    private _serverRenderedPS: { html: string; interactiveScript?: string } | null = null;

    private _onStateChange?: (from: AppState, to: AppState) => void;

    constructor() { }

    /** Inject the shared course data cache. Must be called before any course operations. */
    public setCourseDataCache(cache: CourseDataCache): void {
        this._courseDataCache = cache;
    }

    public set onStateChange(handler: (from: AppState, to: AppState) => void) {
        this._onStateChange = handler;
    }

    private _setCurrentState(newState: AppState): void {
        const prev = this._currentState;
        if (prev === newState) { return; }
        this._currentState = newState;
        this._onStateChange?.(prev, newState);
    }

    // ── Getters ──────────────────────────────────────────────────────

    get currentState(): AppState {
        return this._currentState;
    }

    get userInfo(): UserInfo | undefined {
        return this._userInfo;
    }

    get coursesData(): CourseDashboardResponse | undefined {
        return this._courseDataCache?.get();
    }

    get archivedCoursesData(): ArchivedCourse[] | undefined {
        return this._archivedCoursesData;
    }

    /** Returns course detail data when the active view is a course detail. */
    get currentCourseData(): CourseDetailData | undefined {
        return this._payload.kind === 'course' ? this._payload.data : undefined;
    }

    /** Returns exercise/exam-exercise data when the active view shows an exercise. */
    get currentExerciseData(): ExerciseDetailsResponse | ExamExerciseData | undefined {
        if (this._payload.kind === 'exercise') { return this._payload.data; }
        if (this._payload.kind === 'exam-exercise') { return this._payload.exercise; }
        return undefined;
    }

    /** Returns exam data when the active view is an exam or exam-exercise. */
    get currentExamData(): ExamData | undefined {
        if (this._payload.kind === 'exam') { return this._payload.data; }
        if (this._payload.kind === 'exam-exercise') { return this._payload.exam; }
        return undefined;
    }

    get serverRenderedProblemStatement(): { html: string; interactiveScript?: string } | null {
        return this._serverRenderedPS;
    }

    set serverRenderedProblemStatement(value: { html: string; interactiveScript?: string } | null) {
        this._serverRenderedPS = value;
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

    // ── State transitions ────────────────────────────────────────────

    /**
     * Seeds authenticated session state without triggering a 'dashboard' state change.
     * Used by the workspace start-page flow to keep the loading screen visible
     * while detecting the workspace exercise.
     */
    public seedAuthenticatedSession(userInfo: UserInfo): void {
        this._userInfo = userInfo;
    }

    public showDashboard(userInfo: UserInfo): void {
        this._userInfo = userInfo;
        this._setCurrentState('dashboard');
    }

    public showLogin(): void {
        this._setCurrentState('login');
        this._userInfo = undefined;
        this._courseDataCache?.clear();
        this._archivedCoursesData = undefined;
        this._payload = { kind: 'none' };
        this._recommendedExtensions = undefined;
    }

    public showCourseList(): void {
        this._setCurrentState('course-list');
    }

    public showCourseDetail(courseData: CourseDetailData): void {
        this._payload = { kind: 'course', data: courseData };
        this._setCurrentState('course-detail');
    }

    public showExerciseDetail(exerciseData: ExerciseDetailsResponse): void {
        const parentCourse =
            this._payload.kind === 'course' ? this._payload.data :
            this._payload.kind === 'exercise' ? this._payload.parentCourse :
            undefined;
        if (!parentCourse) {
            throw new Error('showExerciseDetail requires a course in scope; call showCourseDetail first');
        }
        this._payload = { kind: 'exercise', data: exerciseData, parentCourse };
        this._serverRenderedPS = null; // Clear stale render from previous exercise
        this._setCurrentState('exercise-detail');
    }

    public backToCourseDetails(): void {
        if (this._payload.kind !== 'exercise') { return; }
        this._payload = { kind: 'course', data: this._payload.parentCourse };
        this._setCurrentState('course-detail');
    }

    public injectCourseEntry(entry: CourseDashboardEntry): void {
        this._courseDataCache?.injectEntry(entry);
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
        this._payload = { kind: 'exam', data: examData };
        this._setCurrentState('exam-start');
    }

    public showExamConduction(examData: ExamData): void {
        this._payload = { kind: 'exam', data: examData };
        this._setCurrentState('exam-conduction');
    }

    public showExamExerciseDetail(
        exercise: ExerciseDetail,
        exerciseIndex: number,
        courseId: number,
        examId: number
    ): void {
        // Bundle both exercise and exam data in a single payload variant
        const examData = this.currentExamData;
        this._payload = {
            kind: 'exam-exercise',
            exercise: {
                exercise,
                exerciseIndex,
                courseId,
                examId,
                isExamExercise: true,
                studentExam: examData?.studentExam,
            },
            exam: examData ?? { studentExam: {} as StudentExam, courseId, examId },
        };
        this._setCurrentState('exam-exercise-detail');
    }

    public backToExam(): void {
        // Extract exam data from the exam-exercise variant before transitioning
        if (this._payload.kind === 'exam-exercise') {
            this._payload = { kind: 'exam', data: this._payload.exam };
        }
        this._setCurrentState('exam-conduction');
    }

}
