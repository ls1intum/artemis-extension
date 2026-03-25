import { ArtemisApiService } from '../../api';
import { logger, LogLevel, LogCategory } from '../../services/loggingService';
import { getRecommendedExtensionsByCategory, type RecommendedExtensionCategory } from '../../utils/recommendedExtensions';
import { RenderResult } from '../../services/problemStatementRenderService';

export type AppState = 'login' | 'dashboard' | 'course-list' | 'course-detail' | 'exercise-detail' | 'exam-exercise-detail' | 'ai-config' | 'service-status' | 'struggle-detection' | 'recommended-extensions' | 'git-credentials' | 'exam-start' | 'exam-conduction';

export interface UserInfo {
    username: string;
    serverUrl: string;
    user?: any;
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
    private _coursesData?: any;
    private _archivedCoursesData?: any[];
    private _currentCourseData?: any;
    private _currentExerciseData?: any;
    private _currentExamData?: any;
    private _aiExtensions?: AiExtension[];
    private _recommendedExtensions?: RecommendedExtensionCategory[];
    private _currentRenderResult?: RenderResult;

    constructor(private readonly _artemisApi: ArtemisApiService) { }

    // State getters
    get currentState(): AppState {
        return this._currentState;
    }

    get userInfo(): UserInfo | undefined {
        return this._userInfo;
    }

    get coursesData(): any {
        return this._coursesData;
    }

    get archivedCoursesData(): any[] | undefined {
        return this._archivedCoursesData;
    }

    get currentCourseData(): any {
        return this._currentCourseData;
    }

    get currentExerciseData(): any {
        return this._currentExerciseData;
    }

    get currentExamData(): any {
        return this._currentExamData;
    }

    get currentRenderResult(): RenderResult | undefined {
        return this._currentRenderResult;
    }

    set currentRenderResult(result: RenderResult | undefined) {
        this._currentRenderResult = result;
    }

    get aiExtensions(): AiExtension[] | undefined {
        return this._aiExtensions;
    }

    get recommendedExtensions(): RecommendedExtensionCategory[] | undefined {
        return this._recommendedExtensions;
    }

    // State transitions
    public async showDashboard(userInfo: UserInfo): Promise<void> {
        this._userInfo = userInfo;
        this._currentState = 'dashboard';

        // Always fetch fresh courses data for the dashboard
        try {
            this._coursesData = await this._artemisApi.getCoursesForDashboard();

            // The registry is populated lazily when needed (e.g., when viewing course details, for Iris chat)
            // For workspace detection, we search coursesData directly (see _handleDetectWorkspaceExercise)
        } catch (error) {
            logger.error('Error loading courses for dashboard:', LogCategory.VIEW, error);
            // Continue anyway, dashboard will show "Loading courses..."
        }
    }

    public showLogin(): void {
        this._currentState = 'login';
        this._userInfo = undefined;
        this._coursesData = undefined;
        this._archivedCoursesData = undefined;
        this._currentCourseData = undefined;
        this._currentExerciseData = undefined;
        this._currentRenderResult = undefined;
        this._recommendedExtensions = undefined;
    }

    public async showCourseList(): Promise<void> {
        try {
            // Always fetch fresh courses data
            this._coursesData = await this._artemisApi.getCoursesForDashboard();

            this._currentState = 'course-list';
        } catch (error) {
            logger.error('Error loading courses:', LogCategory.VIEW, error);
            throw error;
        }
    }

    public showCourseDetail(courseData: any): void {
        this._currentCourseData = courseData;
        this._currentState = 'course-detail';
    }

    public async showArchivedCourseDetail(courseId: number): Promise<void> {
        try {
            // Fetch course details
            const courseDetails = await this._artemisApi.getCourseDetails(courseId);

            // Create courseData structure for archived courses
            // We don't include exercises since archived courses typically don't have active exercises
            const archivedCourseData = {
                course: {
                    ...courseDetails,
                    exercises: [], // Empty exercises array for archived courses
                    isArchived: true // Mark this as archived for potential UI differences
                }
            };

            this._currentCourseData = archivedCourseData;
            this._currentState = 'course-detail';
        } catch (error) {
            logger.error('Error loading archived course details:', LogCategory.VIEW, error);
            throw error;
        }
    }

    public async showExerciseDetail(exerciseId: number): Promise<void> {
        try {
            // ALWAYS fetch fresh data to ensure we have the latest results
            // Exercise data changes frequently (new submissions, build results)
            // and stale data can occur when WebSocket fails or disconnects
            logger.view(`🔄 Fetching fresh exercise data for exercise ${exerciseId}`);
            const exerciseDetails = await this._artemisApi.getExerciseDetails(exerciseId);
            this._currentExerciseData = exerciseDetails;
            this._currentRenderResult = undefined; // Clear stale render from previous exercise

            // Check for pending submissions (builds in progress)
            const participation = exerciseDetails.exercise?.studentParticipations?.[0];
            if (participation?.id) {
                logger.view(`🔍 Checking for pending submission for participation ${participation.id}`);
                const pendingSubmission = await this._artemisApi.getLatestPendingSubmission(participation.id);

                if (pendingSubmission) {
                    logger.view(`⏳ Found pending submission - build in progress!`);
                    // Store pending submission info for the view to use
                    this._currentExerciseData.pendingSubmission = pendingSubmission;
                } else {
                    logger.view(`✅ No pending submission - latest result is final`);
                }
            }

            this._currentState = 'exercise-detail';
        } catch (error) {
            logger.error('Error loading exercise details:', LogCategory.VIEW, error);
            throw error;
        }
    }

    public backToCourseDetails(): void {
        this._currentState = 'course-detail';
    }

    /**
     * Refresh the current exercise detail view with fresh data
     */
    public async refreshCurrentExercise(): Promise<void> {
        if (this._currentState === 'exercise-detail' && this._currentExerciseData) {
            const exerciseId = this._currentExerciseData?.exercise?.id || this._currentExerciseData?.id;
            if (exerciseId) {
                logger.view(`🔄 Refreshing exercise ${exerciseId}`);
                await this.showExerciseDetail(exerciseId);
            }
        }
    }

    // Data management
    public clearCoursesData(): void {
        this._coursesData = undefined;
    }

    public clearCurrentCourseData(): void {
        this._currentCourseData = undefined;
    }

    public clearCurrentExerciseData(): void {
        this._currentExerciseData = undefined;
        this._currentRenderResult = undefined;
    }

    public clearDashboardData(): void {
        this._coursesData = undefined;
    }

    public setCoursesData(data: any): void {
        this._coursesData = data;
    }

    public async loadArchivedCourses(): Promise<void> {
        try {
            this._archivedCoursesData = await this._artemisApi.getArchivedCourses();
        } catch (error) {
            logger.error('Error loading archived courses:', LogCategory.VIEW, error);
            throw error;
        }
    }

    public showAiConfig(aiExtensions: AiExtension[]): void {
        this._aiExtensions = aiExtensions;
        this._currentState = 'ai-config';
    }

    public showServiceStatus(): void {
        this._currentState = 'service-status';
    }

    public showStruggleDetection(): void {
        this._currentState = 'struggle-detection';
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
        this._currentState = 'recommended-extensions';
    }

    public showGitCredentials(): void {
        this._currentState = 'git-credentials';
    }

    public showExamStart(examData: any): void {
        this._currentExamData = examData;
        this._currentState = 'exam-start';
    }

    public showExamConduction(examData: any): void {
        this._currentExamData = examData;
        this._currentState = 'exam-conduction';
    }

    public showExamExerciseDetail(
        exercise: any,
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
        this._currentState = 'exam-exercise-detail';
    }

    public backToExam(): void {
        this._currentState = 'exam-conduction';
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
