import * as vscode from 'vscode';
import { ExerciseRegistry } from '../../../services';
import { ProviderRegistry } from '../../../services/ProviderRegistry';
import type { CommandContext, CommandMap } from './types';

interface CourseQuickPickItem extends vscode.QuickPickItem {
    courseData: any;
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
            openExamInBrowser: this.handleOpenExamInBrowser,
            openRulesInEditor: this.handleOpenRulesInEditor,
        };
    }

    private handleOpenRulesInEditor = async (message: any): Promise<void> => {
        try {
            const text = message.text;
            const document = await vscode.workspace.openTextDocument({
                content: text,
                language: 'markdown'
            });
            await vscode.window.showTextDocument(document);
        } catch (error) {
            console.error('Error opening rules in editor:', error);
            vscode.window.showErrorMessage('Failed to open rules in editor.');
        }
    };

    private handleOpenExamInBrowser = async (message: any): Promise<void> => {
        try {
            const { courseId, examId } = message;
            const serverUrl = this.context.appStateManager.userInfo?.serverUrl;
            if (serverUrl) {
                const url = `${serverUrl}/courses/${courseId}/exams/${examId}`;
                await vscode.env.openExternal(vscode.Uri.parse(url));
            } else {
                vscode.window.showErrorMessage('Could not determine Artemis server URL.');
            }
        } catch (error) {
            console.error('[EXAMMODE] Error opening exam in browser:', error);
            vscode.window.showErrorMessage('Failed to open exam in browser.');
        }
    };

    private handleOpenExam = async (message: any): Promise<void> => {
        try {
            const { courseId, examId } = message;
            console.log(`[EXAMMODE] Handling openExam for course ${courseId}, exam ${examId}`);
            const studentExam = await this.context.artemisApi.getOwnStudentExam(courseId, examId);
            console.log(`[EXAMMODE] Fetched student exam:`, studentExam);

            if (studentExam.started) {
                console.log(`[EXAMMODE] Exam already started, proceeding to conduction`);
                // If already started, go directly to conduction (to be implemented)
                // For now, we can reuse the start exam logic which will fetch conduction details
                await this.handleStartExam({ courseId, examId, studentExamId: studentExam.id });
            } else {
                console.log(`[EXAMMODE] Exam not started, showing start view`);
                // Show start exam view
                this.context.appStateManager.showExamStart({ studentExam, courseId, examId });
                this.context.actionHandler.render();
            }
        } catch (error: any) {
            console.error('[EXAMMODE] Error opening exam:', error);
            const userMessage = this.getExamErrorMessage(error);
            vscode.window.showErrorMessage(userMessage);
        }
    };

    /**
     * Maps Artemis exam error keys and messages to user-friendly error messages.
     * Error keys are defined in Artemis backend (ExamAccessService, ExamResource, StudentExamResource).
     */
    private getExamErrorMessage(error: any): string {
        const detail = (error.detail || error.message || '').toLowerCase();
        const errorKey = this.extractErrorKey(error.detail || error.message || '');

        // Map of Artemis error keys to user-friendly messages
        const errorKeyMessages: Record<string, string> = {
            // Exam state errors
            'examhasalreadyended': 'This exam has already ended. You can no longer participate.',
            'examended': 'This exam has already ended. You can no longer participate.',
            'examnotvisible': 'This exam is not yet visible. Please check the exam schedule.',
            'examnotover': 'This exam is not yet over.',
            
            // Participation errors  
            'cannotparticipateinexams': 'Instructors and administrators cannot participate in exams as students.',
            'cannotregisterinstructor': 'Instructors and administrators cannot be registered for exams.',
            'startexerciseonlyforrealelexams': 'This operation is only allowed for real exams.',
            
            // Registration errors
            'addstudentOnlyforrealelexams': 'Adding students is only allowed for real exams.',
            'unregisterstudentsonlyforrealelexams': 'Unregistering students is only allowed for real exams.',
            'unregisterallonlyforrealelexams': 'Unregistering all students is only allowed for real exams.',
            'generatestudentexamsonlyforrealelexams': 'Generating student exams is only allowed for real exams.',
            'evaluatequizexercisesonlyforrealelexams': 'Evaluating quiz exercises is only allowed for real exams.',
            'addcoursestudentsonlyforrealelexams': 'Adding course students is only allowed for real exams.',
            
            // Test run errors
            'testrunnoliverealvents': 'Test runs do not have live events.',
            
            // Conflict errors
            'studentexamexamconflict': 'The student exam does not belong to this exam.',
            'examcourseconflict': 'The exam does not belong to this course.',
            'usermismatch': 'You are not the owner of this exam attempt.',
        };

        // Check for exact error key match (case-insensitive)
        const normalizedKey = errorKey.toLowerCase();
        if (errorKeyMessages[normalizedKey]) {
            return errorKeyMessages[normalizedKey];
        }

        // Check for partial matches in detail string for AccessForbiddenException messages
        if (detail.includes('not registered for the exam')) {
            return 'You are not registered for this exam. Please contact your instructor.';
        }
        if (detail.includes('cannot be started yet')) {
            return 'The exam cannot be started yet. Please wait until closer to the start time.';
        }
        if (detail.includes('instructors or administrators cannot participate')) {
            return 'Instructors and administrators cannot participate in exams as students.';
        }
        if (detail.includes('not the user of the requested student exam')) {
            return 'You are not authorized to access this student exam.';
        }
        if (detail.includes('submit between start and end')) {
            return 'You can only submit during the exam period.';
        }
        if (detail.includes('not allowed to access the summary') && detail.includes('not submitted')) {
            return 'You cannot access the summary of an exam that was not submitted.';
        }
        if (detail.includes('minutes before the exam start')) {
            return 'You cannot access the exam until 5 minutes before the start time.';
        }
        if (detail.includes('not allowed to manage exams')) {
            return 'You are not allowed to manage exams in this course.';
        }
        if (detail.includes('not allowed to access exams')) {
            return 'You are not allowed to access exams in this course.';
        }
        if (detail.includes('not allowed to access this exam')) {
            return 'You are not allowed to access this exam.';
        }
        if (detail.includes('example solution') && detail.includes('not published')) {
            return 'The example solution for this exam is not published yet.';
        }

        // Fallback based on HTTP status
        if (error.status === 403) {
            return error.detail 
                ? `Access denied: ${error.detail}`
                : 'Access denied. You may not have permission to access this exam.';
        }
        if (error.status === 400) {
            return error.detail 
                ? `Invalid request: ${error.detail}`
                : 'Invalid request. Please try again.';
        }
        if (error.status === 404) {
            return 'Exam not found. Please check if the exam still exists.';
        }
        if (error.status === 409) {
            return error.detail 
                ? `Conflict: ${error.detail}`
                : 'There was a conflict with your request.';
        }

        return error.detail 
            ? `Failed to open exam: ${error.detail}`
            : 'Failed to open exam. Please try again.';
    }

    /**
     * Extracts the error key from an Artemis error message.
     * Handles formats like "error.examHasAlreadyEnded" or just "examHasAlreadyEnded"
     */
    private extractErrorKey(message: string): string {
        if (!message) return '';
        // Remove "error." prefix if present
        const cleaned = message.replace(/^error\./, '');
        // Return the first word/key (before any spaces or punctuation)
        return cleaned.split(/[\s:.,]/)[0];
    }


    private handleStartExam = async (message: any): Promise<void> => {
        try {
            const { courseId, examId, studentExamId } = message;
            console.log(`[EXAMMODE] Starting exam ${examId} for student exam ${studentExamId}`);
            const conductionDetails = await this.context.artemisApi.startStudentExam(courseId, examId, studentExamId);

            console.log('[EXAMMODE] Exam started, conduction details:', conductionDetails);

            // Show conduction view
            this.context.appStateManager.showExamConduction({ studentExam: conductionDetails, courseId, examId });
            this.context.actionHandler.render();

        } catch (error) {
            console.error('[EXAMMODE] Error starting exam:', error);
            vscode.window.showErrorMessage('Failed to start exam.');
        }
    };

    private handleBrowseCourses = async (): Promise<void> => {
        try {
            vscode.window.showInformationMessage('Loading courses...');

            const dashboardData = await this.context.artemisApi.getCoursesForDashboard();

            if (dashboardData?.courses && dashboardData.courses.length > 0) {
                const quickPickItems: CourseQuickPickItem[] = dashboardData.courses.map((courseData: any) => {
                    const course = courseData.course;
                    const exerciseCount = course.exercises ? course.exercises.length : 0;
                    const semester = course.semester || 'No semester';

                    return {
                        label: course.title,
                        description: `${semester} • ${exerciseCount} exercises`,
                        detail: course.description || 'No description available',
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
        } catch (error) {
            console.error('Browse courses error:', error);
            vscode.window.showErrorMessage('Error loading courses');
        }
    };

    private handleViewExercises = async (): Promise<void> => {
        try {
            vscode.window.showInformationMessage('This feature will show exercises in a future update.');
        } catch (error) {
            console.error('View exercises error:', error);
            vscode.window.showErrorMessage('Error accessing exercises');
        }
    };

    private handleCheckGrades = async (): Promise<void> => {
        try {
            vscode.window.showInformationMessage('This feature will show grades in a future update.');
        } catch (error) {
            console.error('Check grades error:', error);
            vscode.window.showErrorMessage('Error accessing grades');
        }
    };

    private handleShowAllCourses = async (): Promise<void> => {
        await this.context.actionHandler.showCourseList();
    };

    private handleViewCourseDetails = async (message: any): Promise<void> => {
        await this.processCourseDetails(message.courseData);
    };

    private async processCourseDetails(courseData: any): Promise<void> {
        try {
            const course = courseData?.course || courseData;

            // Fetch exams for the course
            if (course && course.id) {
                try {
                    const exams = await this.context.artemisApi.getExamsForCourse(course.id);
                    course.exams = exams;
                } catch (error) {
                    console.error('Error fetching exams:', error);
                    // Continue without exams if fetch fails
                }
            }

            this.context.appStateManager.showCourseDetail(courseData);

            const registry = ExerciseRegistry.getInstance();
            registry.registerFromCourseData(courseData);

            const chatProvider = ProviderRegistry.getInstance().getChatWebviewProvider();
            if (course) {
                const courseTitle = course.title || 'Untitled Course';
                const courseId = course.id || 0;
                const shortName = course.shortName;

                if (chatProvider && typeof chatProvider.updateDetectedCourse === 'function') {
                    chatProvider.updateDetectedCourse(courseTitle, courseId, shortName);
                    console.log('📚 [Course Detection] Notified chat about course:', courseTitle);
                }

                if (course.exercises && Array.isArray(course.exercises) && chatProvider && typeof chatProvider.updateDetectedExercise === 'function') {
                    course.exercises.forEach((exercise: any) => {
                        if (exercise.studentParticipations && exercise.studentParticipations.length > 0) {
                            const exerciseTitle = exercise.title || 'Untitled Exercise';
                            const exerciseId = exercise.id;
                            const releaseDate = exercise.releaseDate || exercise.startDate;
                            const dueDate = exercise.dueDate;
                            const shortName = exercise.shortName;

                            chatProvider.updateDetectedExercise(exerciseTitle, exerciseId, releaseDate, dueDate, shortName, courseId);
                            console.log(`📚 [Course Exercises] Updated exercise from course: ${exerciseTitle} (ID: ${exerciseId})`);
                        }
                    });
                }
            }

            this.context.actionHandler.render();
        } catch (error) {
            console.error('View course details error:', error);
            vscode.window.showErrorMessage('Error viewing course details');
        }
    }

    private handleBackToDashboard = async (): Promise<void> => {
        const userInfo = this.context.appStateManager.userInfo;
        if (userInfo) {
            await this.context.actionHandler.showDashboard(userInfo);
        }
    };

    private handleOpenExerciseDetails = async (message: any): Promise<void> => {
        await this.context.actionHandler.openExerciseDetails(message.exerciseId);
    };

    private handleOpenExamExerciseDetails = async (message: any): Promise<void> => {
        const { exercise, exerciseIndex, courseId, examId } = message;
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
            this.context.actionHandler.render();

            const archivedCount = this.context.appStateManager.archivedCoursesData?.length || 0;
            if (archivedCount > 0) {
                vscode.window.showInformationMessage(`Loaded ${archivedCount} archived course${archivedCount === 1 ? '' : 's'}`);
            } else {
                vscode.window.showInformationMessage('No archived courses found');
            }
        } catch (error) {
            console.error('Load archived courses error:', error);
            vscode.window.showErrorMessage('Error loading archived courses');
        }
    };

    private handleReloadCourses = async (): Promise<void> => {
        try {
            this.context.appStateManager.clearCoursesData();
            await this.context.actionHandler.showCourseList();
        } catch (error) {
            console.error('Reload courses error:', error);
            vscode.window.showErrorMessage('Error reloading courses');
        }
    };

    private handleReloadDashboard = async (): Promise<void> => {
        try {
            this.context.appStateManager.clearDashboardData();
            const userInfo = this.context.appStateManager.userInfo;
            if (userInfo) {
                await this.context.actionHandler.showDashboard(userInfo);
            }
        } catch (error) {
            console.error('Reload dashboard error:', error);
            vscode.window.showErrorMessage('Error reloading dashboard');
        }
    };

    private handleReloadCourseDetail = async (message: any): Promise<void> => {
        try {
            const courseId = message.courseId || this.context.appStateManager.currentCourseData?.course?.id;
            if (courseId) {
                this.context.appStateManager.clearCurrentCourseData();
                await this.context.appStateManager.showCourseDetail(courseId);
                this.context.actionHandler.render();
            }
        } catch (error) {
            console.error('Reload course detail error:', error);
            vscode.window.showErrorMessage('Error reloading course details');
        }
    };

    private handleReloadExerciseDetail = async (message: any): Promise<void> => {
        try {
            const exerciseId = message.exerciseId || this.context.appStateManager.currentExerciseData?.exercise?.id || this.context.appStateManager.currentExerciseData?.id;
            if (exerciseId) {
                this.context.appStateManager.clearCurrentExerciseData();
                await this.context.actionHandler.openExerciseDetails(exerciseId);
            }
        } catch (error) {
            console.error('Reload exercise detail error:', error);
            vscode.window.showErrorMessage('Error reloading exercise details');
        }
    };

    private handleViewArchivedCourse = async (message: any): Promise<void> => {
        const courseId: number = message.courseId;
        try {
            vscode.window.showInformationMessage('Loading archived course details...');

            await this.context.appStateManager.showArchivedCourseDetail(courseId);
            this.context.actionHandler.render();
        } catch (error) {
            console.error('View archived course error:', error);
            vscode.window.showErrorMessage('Error viewing archived course details');
        }
    };

    private handleOpenExercise = async (message: any): Promise<void> => {
        const exerciseId: number = message.exerciseId;

        try {
            const coursesData = this.context.appStateManager.coursesData;
            let parentCourseData = null;

            if (coursesData?.courses) {
                for (const courseData of coursesData.courses) {
                    const exercises = courseData?.course?.exercises || courseData?.exercises || [];
                    const foundExercise = exercises.find((ex: any) => ex.id === exerciseId);

                    if (foundExercise) {
                        parentCourseData = courseData;
                        console.log(`[Navigation] 📚 Found parent course for exercise ${exerciseId}: ${courseData.course?.title}`);
                        break;
                    }
                }
            }

            if (parentCourseData) {
                this.context.appStateManager.showCourseDetail(parentCourseData);
            } else {
                console.warn(`⚠️  Could not find parent course for exercise ${exerciseId}`);
            }

            await this.context.actionHandler.openExerciseDetails(exerciseId);
        } catch (error) {
            console.error('Open exercise error:', error);
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

            await this.context.actionHandler.openExerciseFullscreen(exerciseData);
        } catch (error) {
            console.error('Error opening exercise in fullscreen:', error);
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
        } catch (error) {
            console.error('Error opening course in fullscreen:', error);
            vscode.window.showErrorMessage('Failed to open course in fullscreen mode');
        }
    };

    private handleRefreshExam = async (message: any): Promise<void> => {
        try {
            const { courseId, examId, studentExamId } = message;
            console.log(`[EXAMMODE] Refreshing exam status for course ${courseId}, exam ${examId}`);

            const studentExam = await this.context.artemisApi.getOwnStudentExam(courseId, examId);

            if (studentExam.started) {
                console.log(`[EXAMMODE] Exam started in browser, proceeding to conduction`);
                // Proceed to conduction by fetching details
                await this.handleStartExam({ courseId, examId, studentExamId });
            } else {
                vscode.window.showInformationMessage('Exam has not been started yet. Please start it in the browser.');
            }
        } catch (error) {
            console.error('[EXAMMODE] Error refreshing exam:', error);
            vscode.window.showErrorMessage('Failed to refresh exam status.');
        }
    };
}
