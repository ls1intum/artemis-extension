import * as vscode from 'vscode';
import { AppStateManager, type AppState } from './appStateManager';
import { AiCheckerView } from '../aiChecker/aiCheckerView';
import { CourseDetailView } from '../courseDetail/courseDetailView';
import { CourseListView } from '../courseList/courseListView';
import { DashboardView } from '../dashboard/dashboardView';
import { ExerciseDetailView } from '../exerciseDetail/exerciseDetailView';
import { ExamExerciseDetailView } from '../examExerciseDetail/examExerciseDetailView';
import { LoginView } from '../login/loginView';
import { ServiceStatusView } from '../serviceStatus/serviceStatusView';
import { StruggleDetectionView } from '../struggleDetection/struggleDetectionView';
import { RecommendedExtensionsView } from '../recommendedExtensions/recommendedExtensionsView';
import { GitCredentialsView } from '../gitCredentials/gitCredentialsView';
import { ExamStartView } from '../examStart/examStartView';
import { ExamConductionView } from '../examConduction/examConductionView';
import { getReactWebviewHtml } from '../../utils/webviewHelpers';

/**
 * Maps application state to the appropriate webview HTML.
 */
export class ViewRouter {
    private readonly _loginView: LoginView;
    private readonly _dashboardView: DashboardView;
    private readonly _courseListView: CourseListView;
    private readonly _courseDetailView: CourseDetailView;
    private readonly _exerciseDetailView: ExerciseDetailView;
    private readonly _examExerciseDetailView: ExamExerciseDetailView;
    private readonly _aiCheckerView: AiCheckerView;
    private readonly _serviceStatusView: ServiceStatusView;
    private readonly _struggleDetectionView: StruggleDetectionView;
    private readonly _recommendedExtensionsView: RecommendedExtensionsView;
    private readonly _gitCredentialsView: GitCredentialsView;
    private readonly _examStartView: ExamStartView;
    private readonly _examConductionView: ExamConductionView;

    /**
     * Map of app states to React view availability.
     * If true, the view has been migrated to React; if false/undefined, fall back to legacy HTML.
     */
    private readonly _reactViews = new Map<string, boolean>([
        ['git-credentials', true],  // Phase 3: migrated
        ['service-status', true],   // Phase 3: migrated
        ['recommended-extensions', true],  // Phase 3: migrated
        ['login', true],  // Phase 3: migrated
        // Other views will be added as they're migrated
    ]);

    constructor(
        private readonly _appStateManager: AppStateManager,
        private readonly _extensionContext: vscode.ExtensionContext,
        private readonly _webview?: vscode.Webview
    ) {
        // Initialize view templates with extension context
        this._loginView = new LoginView();
        this._dashboardView = new DashboardView(this._extensionContext);
        this._courseListView = new CourseListView();
        this._courseDetailView = new CourseDetailView(this._extensionContext);
        this._exerciseDetailView = new ExerciseDetailView(this._extensionContext);
        this._examExerciseDetailView = new ExamExerciseDetailView(this._extensionContext);
        this._aiCheckerView = new AiCheckerView(this._extensionContext);
        this._serviceStatusView = new ServiceStatusView(this._extensionContext);
        this._struggleDetectionView = new StruggleDetectionView(this._extensionContext);
        this._recommendedExtensionsView = new RecommendedExtensionsView();
        this._gitCredentialsView = new GitCredentialsView(this._extensionContext);
        this._examStartView = new ExamStartView(this._extensionContext);
        this._examConductionView = new ExamConductionView(this._extensionContext);
    }

    public async getHtml(): Promise<string> {
        const webview = this._webview;
        if (!webview) {
            throw new Error('Webview is not initialized');
        }

        const state = this._appStateManager.currentState;

        // Check if React component exists for this view (coexistence pattern)
        if (this._reactViews.get(state)) {
            const viewName = this._stateToViewName(state);
            return getReactWebviewHtml(webview, this._extensionContext.extensionUri, viewName);
        }

        // Fall back to legacy HTML generation for non-React views

        // Read developer tools setting (inverted: developerMode=true means hideDeveloperTools=false)
        const config = vscode.workspace.getConfiguration('artemis');
        const hideDeveloperTools = !config.get<boolean>('developerMode', false);

        switch (state) {
            case 'dashboard': {
                const userInfo = this._appStateManager.userInfo;
                if (userInfo) {
                    return this._dashboardView.generateHtml(userInfo, this._appStateManager.coursesData, webview);
                }
                break;
            }
            case 'course-list':
                return this._courseListView.generateHtml(
                    this._appStateManager.coursesData,
                    this._appStateManager.archivedCoursesData
                );
            case 'course-detail':
                return await this._courseDetailView.generateHtml(this._appStateManager.currentCourseData, hideDeveloperTools, webview);
            case 'exercise-detail':
                return this._exerciseDetailView.generateHtml(this._appStateManager.currentExerciseData, hideDeveloperTools, webview);
            case 'exam-exercise-detail': {
                // Use the dedicated ExamExerciseDetailView
                const exerciseData = this._appStateManager.currentExerciseData;
                return this._examExerciseDetailView.generateHtml(
                    exerciseData.exercise,
                    hideDeveloperTools,
                    webview,
                    {
                        isExamExercise: true,
                        courseId: exerciseData.courseId,
                        examId: exerciseData.examId,
                        studentExam: exerciseData.studentExam
                    }
                );
            }
            case 'ai-config':
                return this._aiCheckerView.generateHtml(this._appStateManager.aiExtensions || []);
            case 'service-status': {
                const serverUrl = this._appStateManager.userInfo?.serverUrl;
                return this._serviceStatusView.generateHtml(serverUrl, webview);
            }
            case 'struggle-detection': {
                return this._struggleDetectionView.generateHtml(webview);
            }
            case 'recommended-extensions': {
                const categories = this._appStateManager.recommendedExtensions || [];
                return this._recommendedExtensionsView.generateHtml(categories);
            }
            case 'git-credentials': {
                const userInfo = this._appStateManager.userInfo;
                return this._gitCredentialsView.generateHtml(userInfo);
            }
            case 'exam-start': {
                const examData = this._appStateManager.currentExamData;
                return this._examStartView.generateHtml(examData.studentExam, examData.courseId, examData.examId, hideDeveloperTools);
            }
            case 'exam-conduction': {
                const examData = this._appStateManager.currentExamData;
                return await this._examConductionView.generateHtml(examData.studentExam, examData.courseId, examData.examId);
            }
            case 'login':
            default:
                break;
        }

        return this._loginView.generateHtml();
    }

    /**
     * Map AppState values to React view names.
     * Used by the coexistence router to determine which React component to render.
     */
    private _stateToViewName(state: AppState): string {
        // Map kebab-case state names to camelCase view names
        switch (state) {
            case 'git-credentials':
                return 'gitCredentials';
            case 'service-status':
                return 'serviceStatus';
            case 'recommended-extensions':
                return 'recommendedExtensions';
            case 'login':
                return 'login';
            case 'dashboard':
                return 'dashboard';
            case 'course-list':
                return 'courseList';
            case 'course-detail':
                return 'courseDetail';
            case 'exercise-detail':
                return 'exerciseDetail';
            case 'exam-exercise-detail':
                return 'examExerciseDetail';
            case 'ai-config':
                return 'aiConfig';
            case 'struggle-detection':
                return 'struggleDetection';
            case 'exam-start':
                return 'examStart';
            case 'exam-conduction':
                return 'examConduction';
            default:
                return state;
        }
    }
}
