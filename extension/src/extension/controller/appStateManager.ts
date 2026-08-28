import type { ArchivedCourse, CourseDetailData, RenderedProblemStatementPayload } from '@shared/messageContracts';

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
    private _serverRenderedPS: RenderedProblemStatementPayload | null = null;
    private _workspaceMode: { exerciseId: number; isPractice: boolean; ticket: number } | undefined;
    private _workspaceModeProbe = 0;
    private _workspaceModeFloor = 0;
    private _onWorkspaceModeChange?: () => void;

    private _onStateChange?: (from: AppState, to: AppState) => void;

    constructor() { }

    /** Inject the shared course data cache. Must be called before any course operations. */
    public setCourseCatalog(cache: CourseCatalog): void {
        this._courseCatalog = cache;
    }

    public set onStateChange(handler: (from: AppState, to: AppState) => void) {
        this._onStateChange = handler;
    }

    /** Fired only when the mode {@link workspaceIsPractice} answers with actually changes. */
    public set onWorkspaceModeChange(handler: () => void) {
        this._onWorkspaceModeChange = handler;
    }

    /**
     * Whether the student's workspace is the practice repository of the exercise
     * on screen, as far as anyone has managed to find out.
     *
     * A record naming a different exercise is not evidence about this one, so it
     * reads as `false`. That is also what makes the record self-invalidating:
     * `refreshFromServer` re-enters `showExerciseDetail` for the same exercise,
     * and a value cleared there would fall back to graded on every result.
     */
    get workspaceIsPractice(): boolean {
        const current = this.currentExerciseData?.exercise?.id;
        return this._workspaceMode !== undefined
            && this._workspaceMode.exerciseId === current
            && this._workspaceMode.isPractice;
    }

    /**
     * Claim a ticket before starting a workspace detection. Never reused.
     *
     * Taken at the START of the probe, so a higher ticket always means a
     * detection that began later, which is the one worth believing.
     */
    public beginWorkspaceModeProbe(): number {
        return ++this._workspaceModeProbe;
    }

    /**
     * Report what a detection found.
     *
     * `accepted` is false when the result no longer describes where the user is:
     * it names an exercise that is not the active one, or a newer detection has
     * already been recorded. The caller must then apply NOTHING it derived from
     * that result, not merely skip the mode.
     *
     * Acceptance compares against the ticket ALREADY RECORDED, not the newest
     * one handed out, so the freshest SUCCESSFUL detection wins rather than the
     * freshest attempt. A probe that fails simply does not call this, and cannot
     * silence an older one that succeeded: with probes 1 and 2 in flight, 1
     * lands whenever it lands, and 2 overwrites it only by succeeding.
     */
    public recordWorkspaceMode(ticket: number, exerciseId: number, isPractice: boolean): { accepted: boolean } {
        if (!this.isCurrentWorkspaceModeProbe(ticket, exerciseId)) {
            return { accepted: false };
        }

        const before = this.workspaceIsPractice;
        this._workspaceMode = { exerciseId, isPractice, ticket };
        if (before !== isPractice) { this._onWorkspaceModeChange?.(); }
        return { accepted: true };
    }

    /**
     * Whether a probe's answer would still be worth acting on, without recording anything.
     *
     * For the conclusions a probe draws besides the mode, such as an error to show the user: a
     * message about an exercise nobody is looking at is noise at best and a lie about the exercise
     * that IS on screen at worst.
     */
    public isCurrentWorkspaceModeProbe(ticket: number, exerciseId: number): boolean {
        // The state as well as the payload: `showCourseList` leaves the exercise payload in place,
        // so `currentExerciseData` alone would let a probe report about an exercise the student has
        // navigated away from and leave a stale mode behind for the next time they open it.
        if (this._currentState !== 'exercise-detail') { return false; }
        if (exerciseId !== this.currentExerciseData?.exercise?.id) { return false; }
        // Clearing the record on sign-out is not enough on its own: it leaves nothing to compare
        // against, so a probe that started in the previous session would be accepted on its way back.
        if (ticket <= this._workspaceModeFloor) { return false; }
        return !this._workspaceMode || this._workspaceMode.ticket <= ticket;
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

    get serverRenderedProblemStatement(): RenderedProblemStatementPayload | null {
        return this._serverRenderedPS;
    }

    set serverRenderedProblemStatement(value: RenderedProblemStatementPayload | null) {
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
        // Otherwise the next session's exercise with the same id would inherit a mode nobody
        // detected for it, and a probe still running from before the sign-out would be free to
        // report into the session after it.
        this._workspaceMode = undefined;
        this._workspaceModeFloor = this._workspaceModeProbe;
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
