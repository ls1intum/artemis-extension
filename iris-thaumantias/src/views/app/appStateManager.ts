import { ArtemisApiService } from '../../api';
import { logger, LogCategory } from '../../services/loggingService';
import { getRecommendedExtensionsByCategory, type RecommendedExtensionCategory } from '../../utils/recommendedExtensions';
import type { CourseDashboardResponse, CourseDashboardEntry, ArchivedCourse, CourseDetailData, CourseDashboardCourse, ExamSummary, ExerciseDetailsResponse, StudentExam, ExerciseDetail } from '../../types/apiResponses';
import type { ArtemisUser } from '../../types';

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

    constructor(private readonly _artemisApi: ArtemisApiService) { }

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
    public async showDashboard(userInfo: UserInfo): Promise<void> {
        this._userInfo = userInfo;
        this._currentState = 'dashboard';

        // Clear stale courses before fetching so callers can trust
        // that non-undefined coursesData reflects a successful load
        this._coursesData = undefined;

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
        this._recommendedExtensions = undefined;
    }

    public async showCourseList(options?: { skipFetch?: boolean }): Promise<void> {
        try {
            if (!options?.skipFetch) {
                this._coursesData = await this._artemisApi.getCoursesForDashboard();
            }
            this._currentState = 'course-list';
        } catch (error) {
            logger.error('Error loading courses:', LogCategory.VIEW, error);
            throw error;
        }
    }

    public showCourseDetail(courseData: CourseDetailData): void {
        this._currentCourseData = courseData;
        this._currentState = 'course-detail';
    }

    public async showArchivedCourseDetail(courseId: number): Promise<void> {
        try {
            const dashboardDTO = await this._artemisApi.getCourseForDashboard(courseId);
            const courseData: CourseDetailData = {
                course: {
                    ...(dashboardDTO.course as CourseDashboardCourse),
                    isArchived: true
                }
            };

            // Fetch exams separately (same pattern as handleReloadCourseDetail)
            try {
                const exams = await this._artemisApi.getExamsForCourse(courseId);
                courseData.course.exams = exams as ExamSummary[];
            } catch { /* continue without exams */ }

            this._currentCourseData = courseData;
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
            logger.info(`🔄 Fetching fresh exercise data for exercise ${exerciseId}`, LogCategory.VIEW);
            const exerciseDetails = await this._artemisApi.getExerciseDetails(exerciseId);
            this._currentExerciseData = exerciseDetails;

            // Enrich ALL participations with pending submissions and feedbacks
            // The React view selects participation by testRun/isPractice, not always [0]
            const participations = exerciseDetails.exercise?.studentParticipations ?? [];
            for (const participation of participations) {
                if (!participation.id) { continue; }

                // Check for pending submissions (builds in progress)
                try {
                    const pendingSubmission = await this._artemisApi.getLatestPendingSubmission(participation.id);
                    if (pendingSubmission) {
                        logger.info(`⏳ Found pending submission for participation ${participation.id}`, LogCategory.VIEW);
                        this._currentExerciseData.pendingSubmission = pendingSubmission;
                    }
                } catch { /* ignore */ }

                // Enrich the latest result with detailed feedbacks (test cases)
                // The exercise details endpoint doesn't include feedbacks — we need the result details API
                const latestSubmission = [...(participation.submissions ?? [])]
                    .sort((a, b) => ((b as { id?: number }).id ?? 0) - ((a as { id?: number }).id ?? 0))[0] as { id?: number; results?: Array<{ id?: number; feedbacks?: unknown[] }> } | undefined;
                const latestResult = [...(latestSubmission?.results ?? [])]
                    .sort((a, b) => (a.id ?? 0) > (b.id ?? 0) ? -1 : 1)[0];
                if (latestResult?.id) {
                    try {
                        const feedbacks = await this._artemisApi.getResultFeedbacks(participation.id, latestResult.id);
                        if (feedbacks.length > 0) {
                            latestResult.feedbacks = feedbacks;
                            logger.info(`📋 Enriched result ${latestResult.id} with ${feedbacks.length} feedbacks`, LogCategory.VIEW);
                        }
                    } catch {
                        logger.warn(`Could not fetch result details for result ${latestResult.id}`, LogCategory.VIEW);
                    }
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

    public injectCourseEntry(entry: CourseDashboardEntry): void {
        if (!this._coursesData) {
            this._coursesData = { courses: [] };
        }
        this._coursesData.courses ??= [];
        this._coursesData.courses.push(entry);
    }

    public async loadArchivedCourses(): Promise<void> {
        try {
            const courses = await this._artemisApi.getArchivedCourses();
            // Map CourseDashboardCourse to ArchivedCourse (subset of fields)
            this._archivedCoursesData = courses.map(course => ({
                id: course.id!,
                title: course.title || '',
                semester: course.semester,
                color: course.color
            }));
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

    public showExamStart(examData: ExamData): void {
        this._currentExamData = examData;
        this._currentState = 'exam-start';
    }

    public showExamConduction(examData: ExamData): void {
        this._currentExamData = examData;
        this._currentState = 'exam-conduction';
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
