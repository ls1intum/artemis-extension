import * as vscode from 'vscode';
import { ExerciseRegistry } from '../../../services';
import { ProviderRegistry } from '../../../services/ProviderRegistry';
import { ExamErrorHandler } from '../../../services/examErrorHandler';
import type { CommandContext, CommandMap } from './types';
import { logger } from '../../../services/loggingService';
import type {
    WebviewToExtensionMessage,
    OpenExamCommand,
    OpenExamInBrowserCommand,
    ViewCourseDetailsCommand,
    OpenExerciseDetailsCommand,
    OpenExamExerciseDetailsCommand,
    ReloadCourseDetailCommand,
    ReloadExerciseDetailCommand,
    ViewArchivedCourseCommand,
    OpenExerciseCommand,
    RefreshExamCommand,
    ReloadExamConductionCommand,
    ExerciseDetail,
} from '../../../shared/messageContracts';
import type {
    CourseDashboardCourse,
    CourseDashboardEntry,
    CourseDetailData,
    ExamSummary,
    ExerciseDetailsResponse,
} from '../../../types/apiResponses';

interface CourseQuickPickItem extends vscode.QuickPickItem {
    courseData: CourseDashboardEntry;
}

// Helper to extract typed payload from command messages
function getPayload<T extends WebviewToExtensionMessage & { payload: unknown }>(message: WebviewToExtensionMessage): T['payload'] {
    return (message as T).payload;
}

// Internal message types for commands without typed contracts
interface StartExamPayload {
    courseId: number;
    examId: number;
    studentExamId: number;
}

export class NavigationCommandModule {
    constructor(private readonly context: CommandContext) { }

    public getHandlers(): CommandMap {
        return {
            browseCourses: this.handleBrowseCourses,
            viewExercises: this.handleViewExercises,
            checkGrades: this.handleCheckGrades,
            showAllCourses: this.handleShowAllCourses,
            viewCourseDetails: this.handleViewCourseDetails,
            backToDashboard: this.handleBackToDashboard,
            openExerciseDetails: this.handleOpenExerciseDetails,
            openExamExerciseDetails: this.handleOpenExamExerciseDetails,
            backToCourseDetails: this.handleBackToCourseDetails,
            backToExam: this.handleBackToExam,
            showAiConfig: this.handleShowAiConfig,
            showServiceStatus: this.handleShowServiceStatus,
            showStruggleDetection: this.handleShowStruggleDetection,
            showRecommendedExtensions: this.handleShowRecommendedExtensions,
            showGitCredentials: this.handleShowGitCredentials,
            loadArchivedCourses: this.handleLoadArchivedCourses,
            reloadCourses: this.handleReloadCourses,
            reloadDashboard: this.handleReloadDashboard,
            reloadCourseDetail: this.handleReloadCourseDetail,
            reloadExerciseDetail: this.handleReloadExerciseDetail,
            viewArchivedCourse: this.handleViewArchivedCourse,
            openExercise: this.handleOpenExercise,
            toggleFullscreen: this.handleToggleFullscreen,
            toggleCourseFullscreen: this.handleToggleCourseFullscreen,
            openExam: this.handleOpenExam,
            startExam: this.handleStartExam,
            refreshExam: this.handleRefreshExam,
            reloadExamConduction: this.handleReloadExamConduction,
            openExamInBrowser: this.handleOpenExamInBrowser,
            openRulesInEditor: this.handleOpenRulesInEditor,
        };
    }

    private handleOpenRulesInEditor = async (message: WebviewToExtensionMessage): Promise<void> => {
        try {
            // Note: openRulesInEditor doesn't have a typed command interface yet
            // Extract text field with runtime type check
            const text = 'text' in message && typeof message.text === 'string' ? message.text : '';
            const document = await vscode.workspace.openTextDocument({
                content: text,
                language: 'markdown'
            });
            await vscode.window.showTextDocument(document);
        } catch (error) {
            logger.viewError('Error opening rules in editor:', error);
            vscode.window.showErrorMessage('Failed to open rules in editor.');
        }
    };

    private handleOpenExamInBrowser = async (message: WebviewToExtensionMessage): Promise<void> => {
        try {
            const { courseId, examId } = getPayload<OpenExamInBrowserCommand>(message);
            const serverUrl = this.context.appStateManager.userInfo?.serverUrl;
            if (serverUrl) {
                const url = `${serverUrl}/courses/${courseId}/exams/${examId}`;
                await vscode.env.openExternal(vscode.Uri.parse(url));
            } else {
                vscode.window.showErrorMessage('Could not determine Artemis server URL.');
            }
        } catch (error) {
            logger.viewError('[EXAMMODE] Error opening exam in browser:', error);
            vscode.window.showErrorMessage('Failed to open exam in browser.');
        }
    };

    private handleOpenExam = async (message: WebviewToExtensionMessage): Promise<void> => {
        try {
            const { courseId, examId } = getPayload<OpenExamCommand>(message);
            logger.view(`[EXAMMODE] Handling openExam for course ${courseId}, exam ${examId}`);
            const studentExam = await this.context.artemisApi.getOwnStudentExam(courseId, examId);
            logger.view(`[EXAMMODE] Fetched student exam:`, studentExam);

            if (studentExam.started) {
                logger.view(`[EXAMMODE] Exam already started, proceeding to conduction`);
                // If already started, go directly to conduction (to be implemented)
                // For now, we can reuse the start exam logic which will fetch conduction details
                const studentExamId = studentExam.id ?? 0;
                await this.handleStartExam({ courseId, examId, studentExamId });
            } else {
                logger.view(`[EXAMMODE] Exam not started, showing start view`);
                // Show start exam view
                this.context.appStateManager.showExamStart({ studentExam, courseId, examId });
                this.context.actionHandler.render();
            }
        } catch (error: unknown) {
            logger.viewError('[EXAMMODE] Error opening exam:', error);
            const userMessage = ExamErrorHandler.getExamErrorMessage(error);
            vscode.window.showErrorMessage(userMessage);
        }
    };


    private handleStartExam = async (message: WebviewToExtensionMessage | StartExamPayload): Promise<void> => {
        try {
            // Handle both typed message and internal payload format
            const payload = 'type' in message && message.type === 'command'
                ? getPayload<{ type: 'command'; command: 'startExam'; payload: StartExamPayload }>(message)
                : message as StartExamPayload;

            const { courseId, examId, studentExamId } = payload;
            logger.view(`[EXAMMODE] Starting exam ${examId} for student exam ${studentExamId}`);
            const conductionDetails = await this.context.artemisApi.startStudentExam(courseId, examId, studentExamId);

            logger.view('[EXAMMODE] Exam started, conduction details:', conductionDetails);

            // Show conduction view
            this.context.appStateManager.showExamConduction({ studentExam: conductionDetails, courseId, examId });
            this.context.actionHandler.render();

        } catch (error: unknown) {
            logger.viewError('[EXAMMODE] Error starting exam:', error);
            vscode.window.showErrorMessage('Failed to start exam.');
        }
    };

    private handleBrowseCourses = async (): Promise<void> => {
        try {
            vscode.window.showInformationMessage('Loading courses...');

            const dashboardData = await this.context.artemisApi.getCoursesForDashboard();

            if (dashboardData?.courses && dashboardData.courses.length > 0) {
                const quickPickItems: CourseQuickPickItem[] = dashboardData.courses.map((courseData: CourseDashboardEntry) => {
                    const course = courseData.course;
                    const exerciseCount = course?.exercises ? course.exercises.length : 0;
                    const semester = course?.semester || 'No semester';

                    return {
                        label: course?.title ?? 'Untitled Course',
                        description: `${semester} • ${exerciseCount} exercises`,
                        detail: course?.description || 'No description available',
                        courseData
                    };
                });

                const selectedItem = await vscode.window.showQuickPick<CourseQuickPickItem>(quickPickItems, {
                    placeHolder: 'Select a course to view details',
                    matchOnDescription: true,
                    matchOnDetail: true
                });

                if (selectedItem) {
                    await this.processCourseDetails(selectedItem.courseData);
                }
            } else {
                vscode.window.showWarningMessage('No courses found or you don\'t have access to any courses.');
            }
        } catch (error: unknown) {
            logger.viewError('Browse courses error:', error);
            vscode.window.showErrorMessage('Error loading courses');
        }
    };

    private handleViewExercises = async (): Promise<void> => {
        try {
            vscode.window.showInformationMessage('This feature will show exercises in a future update.');
        } catch (error: unknown) {
            logger.viewError('View exercises error:', error);
            vscode.window.showErrorMessage('Error accessing exercises');
        }
    };

    private handleCheckGrades = async (): Promise<void> => {
        try {
            vscode.window.showInformationMessage('This feature will show grades in a future update.');
        } catch (error: unknown) {
            logger.viewError('Check grades error:', error);
            vscode.window.showErrorMessage('Error accessing grades');
        }
    };

    private handleShowAllCourses = async (): Promise<void> => {
        await this.context.actionHandler.showCourseList();
    };

    private handleViewCourseDetails = async (message: WebviewToExtensionMessage): Promise<void> => {
        const { courseData } = getPayload<ViewCourseDetailsCommand>(message);
        await this.processCourseDetails(courseData);
    };

    private async processCourseDetails(courseData: CourseDashboardEntry | CourseDashboardCourse): Promise<void> {
        try {
            const course: CourseDashboardCourse | undefined = 'course' in courseData
                ? (courseData.course as CourseDashboardCourse | undefined)
                : courseData;

            // Fetch exams for the course
            if (course?.id) {
                try {
                    const exams = await this.context.artemisApi.getExamsForCourse(course.id);
                    course.exams = exams;
                } catch (error: unknown) {
                    logger.apiError('Error fetching exams:', error);
                    // Continue without exams if fetch fails
                }
            }

            // Convert to CourseDetailData format expected by state manager
            const courseDetailData: CourseDetailData = {
                course: ('course' in courseData ? courseData.course! : courseData) as CourseDashboardCourse & {
                    exercises?: ExerciseDetail[];
                    exams?: ExamSummary[];
                    isArchived?: boolean;
                }
            };

            this.context.appStateManager.showCourseDetail(courseDetailData);

            const registry = ExerciseRegistry.getInstance();
            // Pass the entry format for registration (expects CourseDashboardEntry)
            const entryFormat: CourseDashboardEntry = 'course' in courseData ? courseData : { course: courseData };
            registry.registerFromCourseData(entryFormat);

            const chatProvider = ProviderRegistry.getInstance().getChatWebviewProvider();
            if (course) {
                const courseTitle = course.title || 'Untitled Course';
                const courseId = course.id || 0;
                const shortName = course.shortName;

                if (chatProvider && typeof chatProvider.updateDetectedCourse === 'function') {
                    chatProvider.updateDetectedCourse(courseTitle, courseId, shortName);
                    logger.view('📚 [Course Detection] Notified chat about course:', courseTitle);
                }

                if (course.exercises && Array.isArray(course.exercises) && chatProvider && typeof chatProvider.updateDetectedExercise === 'function') {
                    course.exercises.forEach((exercise) => {
                        // Type guard: exercise is from CourseDashboardCourse which uses optional fields
                        if (exercise && typeof exercise === 'object' && 'studentParticipations' in exercise &&
                            Array.isArray(exercise.studentParticipations) && exercise.studentParticipations.length > 0) {
                            const exerciseTitle = exercise.title ?? 'Untitled Exercise';
                            const exerciseId = exercise.id ?? 0;
                            const releaseDate = exercise.releaseDate ?? exercise.startDate;
                            const dueDate = exercise.dueDate;
                            const shortName = exercise.shortName;

                            chatProvider.updateDetectedExercise(exerciseTitle, exerciseId, releaseDate, dueDate, shortName, courseId);
                            logger.view(`📚 [Course Exercises] Updated exercise from course: ${exerciseTitle} (ID: ${exerciseId})`);
                        }
                    });
                }
            }

            this.context.actionHandler.render();
        } catch (error: unknown) {
            logger.viewError('View course details error:', error);
            vscode.window.showErrorMessage('Error viewing course details');
        }
    }

    private handleBackToDashboard = async (): Promise<void> => {
        const userInfo = this.context.appStateManager.userInfo;
        if (userInfo) {
            await this.context.actionHandler.showDashboard(userInfo);
        }
    };

    private handleOpenExerciseDetails = async (message: WebviewToExtensionMessage): Promise<void> => {
        const { exerciseId } = getPayload<OpenExerciseDetailsCommand>(message);
        await this.context.actionHandler.openExerciseDetails(exerciseId);
    };

    private handleOpenExamExerciseDetails = async (message: WebviewToExtensionMessage): Promise<void> => {
        const { exercise, exerciseIndex, courseId, examId } = getPayload<OpenExamExerciseDetailsCommand>(message);
        await this.context.actionHandler.openExamExerciseDetails(exercise, exerciseIndex, courseId, examId);
    };

    private handleBackToCourseDetails = async (): Promise<void> => {
        this.context.appStateManager.backToCourseDetails();
        this.context.actionHandler.render();
    };

    private handleBackToExam = async (): Promise<void> => {
        this.context.appStateManager.backToExam();
        this.context.actionHandler.render();
    };

    private handleShowAiConfig = async (): Promise<void> => {
        this.context.actionHandler.showAiConfig();
    };

    private handleShowServiceStatus = async (): Promise<void> => {
        this.context.actionHandler.showServiceStatus();
    };

    private handleShowStruggleDetection = async (): Promise<void> => {
        this.context.actionHandler.showStruggleDetection();
    };

    private handleShowRecommendedExtensions = async (): Promise<void> => {
        this.context.actionHandler.showRecommendedExtensions();
    };

    private handleShowGitCredentials = async (): Promise<void> => {
        this.context.actionHandler.showGitCredentials();
    };

    private handleLoadArchivedCourses = async (): Promise<void> => {
        try {
            vscode.window.showInformationMessage('Loading archived courses...');

            await this.context.appStateManager.loadArchivedCourses();

            // Send typed message for React views
            const archivedCourses = this.context.appStateManager.archivedCoursesData || [];
            this.context.sendMessage({
                type: 'archivedCoursesLoaded',
                payload: { archivedCourses }
            });

            const archivedCount = archivedCourses.length;
            if (archivedCount > 0) {
                vscode.window.showInformationMessage(`Loaded ${archivedCount} archived course${archivedCount === 1 ? '' : 's'}`);
            } else {
                vscode.window.showInformationMessage('No archived courses found');
            }
        } catch (error: unknown) {
            logger.viewError('Load archived courses error:', error);
            vscode.window.showErrorMessage('Error loading archived courses');
        }
    };

    private handleReloadCourses = async (): Promise<void> => {
        try {
            this.context.appStateManager.clearCoursesData();
            await this.context.appStateManager.showCourseList();
            // Send updated data to React without re-rendering
            this.context.actionHandler.resendViewData();
        } catch (error: unknown) {
            logger.viewError('Reload courses error:', error);
            vscode.window.showErrorMessage('Error reloading courses');
        }
    };

    private handleReloadDashboard = async (): Promise<void> => {
        try {
            this.context.appStateManager.clearDashboardData();
            const userInfo = this.context.appStateManager.userInfo;
            if (userInfo) {
                await this.context.appStateManager.showDashboard(userInfo);
                // Send updated data to React without re-rendering
                this.context.actionHandler.resendViewData();
            }
        } catch (error: unknown) {
            logger.viewError('Reload dashboard error:', error);
            vscode.window.showErrorMessage('Error reloading dashboard');
        }
    };

    private handleReloadCourseDetail = async (message: WebviewToExtensionMessage): Promise<void> => {
        try {
            const payload = getPayload<ReloadCourseDetailCommand>(message);
            const courseId = payload.courseId || this.context.appStateManager.currentCourseData?.course?.id;
            if (courseId) {
                this.context.appStateManager.clearCurrentCourseData();

                // Fetch fresh course data from the single-course dashboard endpoint
                const dashboardDTO = await this.context.artemisApi.getCourseForDashboard(courseId);

                // Build CourseDetailData structure expected by showCourseDetail
                const courseData: CourseDetailData = {
                    course: dashboardDTO.course as CourseDashboardCourse
                };

                // Fetch exams separately (not included in dashboard endpoint)
                try {
                    const exams = await this.context.artemisApi.getExamsForCourse(courseId);
                    if (courseData.course) {
                        courseData.course.exams = exams as ExamSummary[];
                    }
                } catch (error: unknown) {
                    logger.apiError('Error fetching exams during reload:', error);
                    // Continue without exams if fetch fails
                }

                this.context.appStateManager.showCourseDetail(courseData);
                // Send updated data to React without re-rendering
                this.context.actionHandler.resendViewData();
            }
        } catch (error: unknown) {
            logger.viewError('Reload course detail error:', error);
            vscode.window.showErrorMessage('Error reloading course details');
        }
    };

    private handleReloadExerciseDetail = async (message: WebviewToExtensionMessage): Promise<void> => {
        try {
            const payload = getPayload<ReloadExerciseDetailCommand>(message);
            const currentData = this.context.appStateManager.currentExerciseData;

            // Extract exercise ID from various possible structures
            let exerciseId: number | undefined = payload.exerciseId;
            if (!exerciseId && currentData) {
                // Check if it's ExerciseDetailsResponse format
                if ('exercise' in currentData && currentData.exercise?.id) {
                    exerciseId = currentData.exercise.id;
                }
                // Check if it's direct format (ExamExerciseData)
                else if ('id' in currentData && typeof currentData.id === 'number') {
                    exerciseId = currentData.id;
                }
            }

            if (exerciseId) {
                this.context.appStateManager.clearCurrentExerciseData();
                await this.context.appStateManager.showExerciseDetail(exerciseId);
                // Send updated data to React without re-rendering
                this.context.actionHandler.resendViewData();
            }
        } catch (error: unknown) {
            logger.viewError('Reload exercise detail error:', error);
            vscode.window.showErrorMessage('Error reloading exercise details');
        }
    };

    private handleViewArchivedCourse = async (message: WebviewToExtensionMessage): Promise<void> => {
        const { courseId } = getPayload<ViewArchivedCourseCommand>(message);
        try {
            vscode.window.showInformationMessage('Loading archived course details...');

            await this.context.appStateManager.showArchivedCourseDetail(courseId);
            this.context.actionHandler.render();
        } catch (error: unknown) {
            logger.viewError('View archived course error:', error);
            vscode.window.showErrorMessage('Error viewing archived course details');
        }
    };

    private handleOpenExercise = async (message: WebviewToExtensionMessage): Promise<void> => {
        const { exerciseId } = getPayload<OpenExerciseCommand>(message);

        try {
            const coursesData = this.context.appStateManager.coursesData;
            let parentCourseDetailData: CourseDetailData | null = null;

            if (coursesData?.courses) {
                for (const courseEntry of coursesData.courses) {
                    const exercises = courseEntry?.course?.exercises || [];
                    const foundExercise = exercises.find((ex) => ex?.id === exerciseId);

                    if (foundExercise && courseEntry.course) {
                        // Convert to CourseDetailData format
                        parentCourseDetailData = { course: courseEntry.course };
                        logger.view(`[Navigation] 📚 Found parent course for exercise ${exerciseId}: ${courseEntry.course.title}`);
                        break;
                    }
                }
            }

            if (parentCourseDetailData) {
                this.context.appStateManager.showCourseDetail(parentCourseDetailData);
            } else {
                logger.viewWarn(`⚠️  Could not find parent course for exercise ${exerciseId}`);
            }

            await this.context.actionHandler.openExerciseDetails(exerciseId);
        } catch (error: unknown) {
            logger.viewError('Open exercise error:', error);
            vscode.window.showErrorMessage('Failed to open exercise details.');
        }
    };

    private handleToggleFullscreen = async (): Promise<void> => {
        try {
            const exerciseData = this.context.appStateManager.currentExerciseData;
            if (!exerciseData) {
                vscode.window.showErrorMessage('No exercise data available to open in fullscreen');
                return;
            }

            await this.context.actionHandler.openExerciseFullscreen(exerciseData as ExerciseDetailsResponse);
        } catch (error: unknown) {
            logger.viewError('Error opening exercise in fullscreen:', error);
            vscode.window.showErrorMessage('Failed to open exercise in fullscreen mode');
        }
    };

    private handleToggleCourseFullscreen = async (): Promise<void> => {
        try {
            const courseData = this.context.appStateManager.currentCourseData;
            if (!courseData) {
                vscode.window.showErrorMessage('No course data available to open in fullscreen');
                return;
            }

            await this.context.actionHandler.openCourseFullscreen(courseData);
        } catch (error: unknown) {
            logger.viewError('Error opening course in fullscreen:', error);
            vscode.window.showErrorMessage('Failed to open course in fullscreen mode');
        }
    };

    private handleRefreshExam = async (message: WebviewToExtensionMessage): Promise<void> => {
        try {
            const { courseId, examId, studentExamId } = getPayload<RefreshExamCommand>(message);
            logger.view(`[EXAMMODE] Refreshing exam status for course ${courseId}, exam ${examId}`);

            const studentExam = await this.context.artemisApi.getOwnStudentExam(courseId, examId);

            if (studentExam.started) {
                logger.view(`[EXAMMODE] Exam started in browser, proceeding to conduction`);
                // Proceed to conduction by fetching details
                const effectiveStudentExamId = studentExamId || studentExam.id || 0;
                await this.handleStartExam({ courseId, examId, studentExamId: effectiveStudentExamId });
            } else {
                vscode.window.showInformationMessage('Exam has not been started yet. Please start it in the browser.');
            }
        } catch (error: unknown) {
            logger.viewError('[EXAMMODE] Error refreshing exam:', error);
            vscode.window.showErrorMessage('Failed to refresh exam status.');
        }
    };

    private handleReloadExamConduction = async (_message: WebviewToExtensionMessage): Promise<void> => {
        try {
            const examData = this.context.appStateManager.currentExamData;
            if (!examData) {
                logger.viewError('[EXAMMODE] No exam data available for reload');
                return;
            }

            // Extract courseId and examId from exam data (added as context fields)
            // Type assertion needed as ExamData interface may extend with these fields
            const examDataWithContext = examData as { courseId?: unknown; examId?: unknown };
            const courseId = examDataWithContext.courseId;
            const examId = examDataWithContext.examId;

            if (typeof courseId !== 'number' || typeof examId !== 'number') {
                logger.viewError('[EXAMMODE] Invalid exam context - missing courseId or examId');
                return;
            }

            logger.view(`[EXAMMODE] Reloading exam conduction for course ${courseId}, exam ${examId}`);

            const studentExam = await this.context.artemisApi.getOwnStudentExam(courseId, examId);

            if (studentExam.started && studentExam.id) {
                const conductionDetails = await this.context.artemisApi.startStudentExam(courseId, examId, studentExam.id);
                this.context.appStateManager.showExamConduction({ studentExam: conductionDetails, courseId, examId });
                this.context.actionHandler.resendViewData();
            } else {
                vscode.window.showWarningMessage('Exam has not been started yet.');
            }
        } catch (error: unknown) {
            logger.viewError('[EXAMMODE] Error reloading exam conduction:', error);
            vscode.window.showErrorMessage('Failed to reload exam conduction.');
        }
    };
}
