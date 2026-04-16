import * as vscode from 'vscode';
import { AppStateManager } from '../../controller/appStateManager';
import type { TelemetryManager } from '../telemetry/telemetryManager';
import type { WebViewMessageHandler } from '../../controller/webViewMessageHandler';
import { ExtensionMsg } from '../../../shared/messageContracts';
import type { ExtensionToWebviewMessage, CourseDetailData as CourseDetailPayload } from '../../../shared/messageContracts';
import type { CourseDashboardEntry, ExerciseDetail, ExerciseDetailsResponse } from '../../types';
import { detectWorkspaceExercise, detectWorkspaceForRepoUris, type ExerciseSource } from '../workspace/workspaceDetectionService';
import { GitService } from '../workspace/gitService';
import { logger, LogCategory } from '../loggingService';
import { VSCODE_CONFIG, CONFIG, resolveServerUrl } from '../../utils';
import { COURSE_ACCESS_DISPLAY_LIMIT, type CourseAccessStorageService } from '../courseAccessStorageService';
import { selectRecentCourses } from './recentCourseSelector';

export class ViewInitDataService {
    private _initGeneration = 0;
    private readonly _gitService = new GitService();

    constructor(
        private readonly _appStateManager: AppStateManager,
        private readonly _telemetryManager: TelemetryManager | undefined,
        private readonly _messageHandler: WebViewMessageHandler,
        private readonly _postMessage: (msg: ExtensionToWebviewMessage) => void,
        private readonly _courseAccessStorage?: CourseAccessStorageService,
    ) {}

    public sendInitData(): void {
        ++this._initGeneration;
        const state = this._appStateManager.currentState;
        if (state !== 'exercise-detail') {
            this._messageHandler.clearRepositoryContext();
        }
        switch (state) {
            case 'dashboard':              return this.sendDashboardInit();
            case 'course-list':            return this.sendCourseListInit();
            case 'course-detail':          return this.sendCourseDetailInit();
            case 'exercise-detail':        return this.sendExerciseDetailInit();
            case 'exam-conduction':        return this.sendExamConductionInit();
            case 'exam-start':             return this.sendExamStartInit();
            case 'exam-exercise-detail':   return this.sendExamExerciseDetailInit();
            case 'ai-config':              return this.sendAiConfigInit();
            case 'struggle-detection':     return this.sendStruggleDetectionInit();
            case 'service-status':         return this.sendServiceStatusInit();
            case 'recommended-extensions': return this.sendRecommendedExtensionsInit();
            case 'git-credentials':        return this.sendGitCredentialsInit();
            case 'login':                  return this.sendLoginInit();
        }
    }

    public sendDashboardInit(): void {
        const coursesData = this._appStateManager.coursesData;
        const courses = coursesData?.courses || [];

        const accessedIds = this._courseAccessStorage?.getLastAccessedCourses() ?? [];
        const selectedCourses = selectRecentCourses(courses, accessedIds, COURSE_ACCESS_DISPLAY_LIMIT);

        const recentCourseNodes = selectedCourses.map((courseItem: CourseDashboardEntry) => {
            const course = courseItem.course || courseItem;
            const exercises = course.exercises || [];

            const recentExercises = [...exercises]
                .sort((a: ExerciseDetail, b: ExerciseDetail) => {
                    const aDate = a.releaseDate || a.startDate || a.dueDate || '';
                    const bDate = b.releaseDate || b.startDate || b.dueDate || '';
                    if (aDate && bDate) { return bDate.localeCompare(aDate); }
                    if (aDate && !bDate) { return -1; }
                    if (!aDate && bDate) { return 1; }
                    return (b.id ?? 0) - (a.id ?? 0);
                });

            return {
                courseData: {
                    course: {
                        id: (course.id ?? 0) as number,
                        title: (course.title ?? 'Untitled Course') as string,
                        exercises: course.exercises,
                        startDate: course.startDate as string | undefined,
                    }
                },
                exercises: recentExercises,
            };
        });

        // Collect all exercises across courses to detect the workspace exercise
        const allExercises = courses.flatMap((courseItem: CourseDashboardEntry) => {
            const course = courseItem.course || courseItem;
            return course.exercises || [];
        });

        // null = "no match" (shown to user), undefined = "still loading" (keeps skeleton).
        // We only publish null once the archived-course check has finished,
        // so the UI doesn't flash "no exercise" before a late-arriving archived match.
        const noMatch = this._appStateManager.archiveCheckComplete ? null : undefined;

        if (allExercises.length === 0) {
            this._postMessage({
                type: ExtensionMsg.DashboardInit,
                courses: recentCourseNodes,
                workspaceExercise: noMatch,
            });
            return;
        }

        const gen = this._initGeneration;
        detectWorkspaceExercise(allExercises as ExerciseSource[]).then((detectedExercise) => {
            if (gen !== this._initGeneration) { return; }
            this._postMessage({
                type: ExtensionMsg.DashboardInit,
                courses: recentCourseNodes,
                workspaceExercise: detectedExercise
                    ? { id: detectedExercise.id, title: detectedExercise.title }
                    : noMatch,
            });
        }).catch((error) => {
            if (gen !== this._initGeneration) { return; }
            logger.error('Failed to detect workspace exercise for dashboard', LogCategory.VIEW, error);
            this._postMessage({
                type: ExtensionMsg.DashboardInit,
                courses: recentCourseNodes,
                workspaceExercise: noMatch,
            });
        });
    }

    public sendCourseListInit(): void {
        const appState = this._appStateManager;
        const coursesData = appState.coursesData;
        const courses = coursesData?.courses || [];
        const archivedCourses = appState.archivedCoursesData || undefined;

        const mappedCourses = courses.map((entry: CourseDashboardEntry) => ({
            course: {
                id: entry.course?.id || 0,
                title: entry.course?.title || 'Untitled Course',
                description: entry.course?.description,
                semester: entry.course?.semester,
                color: entry.course?.color,
                exercises: entry.course?.exercises,
                numberOfStudents: entry.course?.numberOfStudents,
                instructorGroupName: entry.course?.instructorGroupName,
            }
        }));

        this._postMessage({
            type: ExtensionMsg.CourseListInit,
            courses: mappedCourses, archivedCourses,
        });
    }

    public sendCourseDetailInit(): void {
        const courseData = this._appStateManager.currentCourseData;
        if (!courseData) {
            logger.error('Course detail state missing course data', LogCategory.VIEW);
            this._postMessage({ type: ExtensionMsg.ViewInitError, error: 'Course data is not available. Please go back and try again.' });
            return;
        }

        const exercises = courseData.course?.exercises || [];

        const gen = this._initGeneration;
        detectWorkspaceExercise(exercises as ExerciseSource[]).then((detectedExercise: { id?: number } | null) => {
            if (gen !== this._initGeneration) { return; }
            this._postMessage({
                type: ExtensionMsg.CourseDetailInit,
                courseData: courseData as CourseDetailPayload,
                workspaceExerciseId: detectedExercise?.id ?? null,
                hideDeveloperTools: !this._isDeveloperMode(),
            });
        }).catch((error) => {
            if (gen !== this._initGeneration) { return; }
            logger.error('Failed to detect workspace exercise for course detail', LogCategory.VIEW, error);
            this._postMessage({
                type: ExtensionMsg.CourseDetailInit,
                courseData: courseData as CourseDetailPayload,
                workspaceExerciseId: null,
                hideDeveloperTools: !this._isDeveloperMode(),
            });
        });
    }

    public sendExerciseDetailInit(): void {
        const exerciseData = this._appStateManager.currentExerciseData;
        if (!exerciseData) {
            logger.error('Exercise detail state missing exercise data', LogCategory.VIEW);
            this._postMessage({ type: ExtensionMsg.ViewInitError, error: 'Exercise data is not available. Please go back and try again.' });
            return;
        }

        const participations = exerciseData.exercise?.studentParticipations ?? [];
        const repoUris = participations
            .map(p => p.repositoryUri)
            .filter((uri): uri is string => !!uri);

        if (repoUris.length > 0) {
            const exerciseId = exerciseData.exercise?.id;
            const gen = this._initGeneration;
            detectWorkspaceForRepoUris(repoUris).then((repoStatus) => {
                if (gen !== this._initGeneration) { return; }
                // Set repo context so workspace listeners can auto-detect changes on file save
                if (repoStatus.matchedUri && exerciseId !== undefined) {
                    const handler = this._messageHandler;
                    handler.setRepositoryContext(repoStatus.matchedUri, exerciseId);
                }
                this._postMessage({
                    type: ExtensionMsg.ExerciseDetailInit,
                    exerciseData: exerciseData as ExerciseDetailsResponse,
                    hideDeveloperTools: !this._isDeveloperMode(),
                    repoStatus,
                });
            }).catch((error) => {
                if (gen !== this._initGeneration) { return; }
                logger.error('Failed to detect workspace status for exercise detail', LogCategory.VIEW, error);
                this._messageHandler.clearRepositoryContext();
                this._postMessage({
                    type: ExtensionMsg.ExerciseDetailInit,
                    exerciseData: exerciseData as ExerciseDetailsResponse,
                    hideDeveloperTools: !this._isDeveloperMode(),
                });
            });
        } else {
            this._messageHandler.clearRepositoryContext();
            this._postMessage({
                type: ExtensionMsg.ExerciseDetailInit,
                exerciseData: exerciseData as ExerciseDetailsResponse,
                hideDeveloperTools: !this._isDeveloperMode(),
            });
        }
    }

    public sendExamConductionInit(): void {
        const examData = this._appStateManager.currentExamData;
        if (!examData) {
            logger.error('Exam conduction state missing exam data', LogCategory.VIEW);
            this._postMessage({ type: ExtensionMsg.ViewInitError, error: 'Exam data is not available. Please go back and try again.' });
            return;
        }

        const studentExam = examData.studentExam;
        const exam = studentExam.exam;

        let startTime: number;
        let endTime: number;
        if (exam?.testExam && studentExam.startedDate) {
            startTime = new Date(studentExam.startedDate).getTime();
        } else if (exam?.startDate) {
            startTime = new Date(exam.startDate).getTime();
        } else {
            startTime = Date.now();
        }
        endTime = startTime + ((studentExam.workingTime || 0) * 1000);
        const totalDuration = (studentExam.workingTime || 0) * 1000;

        const exercises = studentExam.exercises || [];
        const gen = this._initGeneration;
        detectWorkspaceExercise(exercises as ExerciseSource[]).then((detectedExercise: { id?: number } | null) => {
            if (gen !== this._initGeneration) { return; }
            this._postMessage({
                type: ExtensionMsg.ExamConductionInit,
                studentExam,
                courseId: examData.courseId,
                examId: examData.examId,
                endTime,
                startTime,
                totalDuration,
                workspaceExerciseId: detectedExercise?.id ?? null,
            });
        }).catch((error) => {
            if (gen !== this._initGeneration) { return; }
            logger.error('Failed to detect workspace exercise for exam conduction', LogCategory.VIEW, error);
            this._postMessage({
                type: ExtensionMsg.ExamConductionInit,
                studentExam,
                courseId: examData.courseId,
                examId: examData.examId,
                endTime,
                startTime,
                totalDuration,
                workspaceExerciseId: null,
            });
        });
    }

    public sendExamStartInit(): void {
        const examData = this._appStateManager.currentExamData;
        if (!examData) {
            logger.error('Exam start state missing exam data', LogCategory.VIEW);
            this._postMessage({ type: ExtensionMsg.ViewInitError, error: 'Exam data is not available. Please go back and try again.' });
            return;
        }

        this._postMessage({
            type: ExtensionMsg.ExamStartInit,
            studentExam: examData.studentExam,
            courseId: examData.courseId,
            examId: examData.examId,
        });
    }

    public sendExamExerciseDetailInit(): void {
        const appState = this._appStateManager;
        const exerciseData = appState.currentExerciseData;
        const examData = appState.currentExamData;

        if (!examData) {
            logger.error('Exam exercise detail state missing exam data', LogCategory.VIEW);
            this._postMessage({ type: ExtensionMsg.ViewInitError, error: 'Exam data is not available. Please go back and try again.' });
            return;
        }
        if (!exerciseData) {
            logger.error('Exam exercise detail state missing exercise data', LogCategory.VIEW);
            this._postMessage({ type: ExtensionMsg.ViewInitError, error: 'Exam data is not available. Please go back and try again.' });
            return;
        }

        const studentExam = examData.studentExam;
        const exam = studentExam.exam;

        let startTime: number;
        if (exam?.testExam && studentExam.startedDate) {
            startTime = new Date(studentExam.startedDate).getTime();
        } else if (exam?.startDate) {
            startTime = new Date(exam.startDate).getTime();
        } else {
            startTime = Date.now();
        }
        const endTime = startTime + ((studentExam.workingTime || 0) * 1000);
        const totalDuration = (studentExam.workingTime || 0) * 1000;

        this._postMessage({
            type: ExtensionMsg.ExamExerciseDetailInit,
            exerciseData: { exercise: exerciseData.exercise },
            examContext: {
                courseId: examData.courseId,
                examId: examData.examId,
                studentExam,
                endTime,
                startTime,
                totalDuration,
            },
            hideDeveloperTools: !this._isDeveloperMode(),
        });
    }

    public sendAiConfigInit(): void {
        const aiExtensions = this._appStateManager.aiExtensions || [];
        this._postMessage({ type: ExtensionMsg.AiConfigInit, aiExtensions });
    }

    public sendStruggleDetectionInit(): void {
        const telemetry = this._telemetryManager;
        const ctx = telemetry?.getStruggleContext();
        this._postMessage({
            type: ExtensionMsg.StruggleDetectionInit,
            isStruggling: ctx?.isStruggling ?? false,
            eq: ctx?.eq ?? 0,
            eqConfidence: ctx?.eqConfidence ?? 'insufficient',
            triggerType: ctx?.triggerType,
            recommendedAction: ctx?.recommendedAction ?? 'none',
            isEnabled: telemetry?.isEnabled() ?? false,
            developerMode: this._isDeveloperMode(),
        });
    }

    public sendServiceStatusInit(): void {
        const serverUrl = this._appStateManager.userInfo?.serverUrl;
        this._postMessage({ type: ExtensionMsg.ServiceStatusInit, serverUrl });
    }

    public sendRecommendedExtensionsInit(): void {
        const categories = this._appStateManager.recommendedExtensions || [];
        const mappedCategories = categories.map(category => ({
            ...category,
            extensions: category.extensions.map(ext => ({
                ...ext,
                isInstalled: ext.isInstalled ?? false
            }))
        }));
        this._postMessage({ type: ExtensionMsg.RecommendedExtensionsInit, categories: mappedCategories });
    }

    public sendGitCredentialsInit(): void {
        const gen = this._initGeneration;
        const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
        this._gitService.readIdentity(cwd).then(({ name, email }) => {
            if (gen !== this._initGeneration) { return; }
            this._postMessage({ type: ExtensionMsg.GitIdentityInfo, name, email });
        }).catch((error) => {
            if (gen !== this._initGeneration) { return; }
            logger.error('Failed to read git identity', LogCategory.VIEW, error);
            this._postMessage({ type: ExtensionMsg.GitIdentityInfo, name: '', email: '' });
        });
    }

    public sendLoginInit(): void {
        this._postMessage({ type: ExtensionMsg.SetServerUrl, serverUrl: resolveServerUrl() });
    }

    private _isDeveloperMode(): boolean {
        const config = vscode.workspace.getConfiguration('artemis');
        return config.get<boolean>('developerMode', false);
    }
}
