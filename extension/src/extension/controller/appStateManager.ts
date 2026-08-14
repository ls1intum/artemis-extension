import type { ArchivedCourse, CourseDetailData } from '@shared/messageContracts';

import type { CourseCatalog } from '@extension/services/courseCatalog';
import type {
    CourseDashboardEntry,
    CourseDashboardResponse,
    ExerciseDetailsResponse,
} from '@extension/types';
import type { ArtemisUser } from '@extension/types';
import { getRecommendedExtensionsByCategory, type RecommendedExtensionCategory } from '@extension/utils/recommendedExtensions';

export type AppState = 'login' | 'dashboard' | 'course-list' | 'course-detail' | 'exercise-detail' | 'ai-config' | 'service-status' | 'struggle-detection' | 'recommended-extensions' | 'git-credentials';

export interface UserInfo {
    username: string;
    serverUrl: string;
    user?: ArtemisUser;
}

interface AiExtension {
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
 * Entering a view without its required parent in scope is a programmer error,
 * so it throws instead of silently rendering a broken screen.
 */
type NavigationPayload =
    | { kind: 'none' }
    | { kind: 'course'; data: CourseDetailData }
    | { kind: 'exercise'; data: ExerciseDetailsResponse; parentCourse: CourseDetailData };

/** Manages the application state for the Artemis webview. */
export class AppStateManager {
    private _currentState: AppState = 'login';
    private _userInfo?: UserInfo;
    private _courseCatalog?: CourseCatalog;
    private _archivedCoursesData?: ArchivedCourse[];
    private _archiveCheckComplete = true;
    private _payload: NavigationPayload = { kind: 'none' };
    private _aiExtensions?: AiExtension[];
    private _recommendedExtensions?: RecommendedExtensionCategory[];
    private _serverRenderedPS: { html: string } | null = null;

    private _onStateChange?: (from: AppState, to: AppState) => void;

    constructor() { }

    /** Inject the shared course data cache. Must be called before any course operations. */
    public setCourseCatalog(cache: CourseCatalog): void {
        this._courseCatalog = cache;
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

    get currentState(): AppState {
        return this._currentState;
    }

    get userInfo(): UserInfo | undefined {
        return this._userInfo;
    }

    get coursesData(): CourseDashboardResponse | undefined {
        return this._courseCatalog?.get();
    }

    get archivedCoursesData(): ArchivedCourse[] | undefined {
        return this._archivedCoursesData;
    }

    /** Returns course detail data when the active view is a course detail. */
    get currentCourseData(): CourseDetailData | undefined {
        return this._payload.kind === 'course' ? this._payload.data : undefined;
    }

    /** Returns exercise data when the active view shows an exercise. */
    get currentExerciseData(): ExerciseDetailsResponse | undefined {
        return this._payload.kind === 'exercise' ? this._payload.data : undefined;
    }

    get serverRenderedProblemStatement(): { html: string } | null {
        return this._serverRenderedPS;
    }

    set serverRenderedProblemStatement(value: { html: string } | null) {
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
        this._courseCatalog?.clear();
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

    /** `epoch` is the caller's, captured before the search that found `entry`. */
    public injectCourseEntry(entry: CourseDashboardEntry, epoch: number): void {
        this._courseCatalog?.injectEntry(entry, epoch);
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

}
