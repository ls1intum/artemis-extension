import * as vscode from 'vscode';
import { IrisChatView } from '../templates/irisChatView';
import { StyleManager } from '../styles';

// Global exercise registry for repository URL matching
interface ExerciseRegistryEntry {
    id: number;
    title: string;
    repositoryUri: string;
    shortName?: string;
}

// Chat context types
type ChatContextType = 'exercise' | 'course' | 'lecture' | 'general';

type ChatContextReason = 
    | 'user-selected'           // User manually selected this context
    | 'auto-workspace'          // Auto-selected because it matches workspace
    | 'auto-first'              // Auto-selected as first available
    | 'auto-recent'             // Auto-selected as most recently opened
    | 'default';                // Default context

interface ChatContext {
    type: ChatContextType;
    id: number;
    title: string;
    reason: ChatContextReason;
    timestamp: number;          // When this context was selected
}

class ExerciseRegistry {
    private static instance: ExerciseRegistry;
    private exercises: Map<number, ExerciseRegistryEntry> = new Map();

    static getInstance(): ExerciseRegistry {
        if (!ExerciseRegistry.instance) {
            ExerciseRegistry.instance = new ExerciseRegistry();
        }
        return ExerciseRegistry.instance;
    }

    public registerExercise(id: number, title: string, repositoryUri: string, shortName?: string): void {
        this.exercises.set(id, { id, title, repositoryUri, shortName });
    }

    public registerFromCourseData(courseData: any): void {
        const exercises = courseData?.course?.exercises || courseData?.exercises || [];
        
        let registeredCount = 0;
        const registered: string[] = [];
        const skipped: string[] = [];
        
        for (const exercise of exercises) {
            const participations = exercise.studentParticipations || [];
            
            if (participations.length > 0 && participations[0].repositoryUri) {
                this.registerExercise(
                    exercise.id,
                    exercise.title,
                    participations[0].repositoryUri,
                    exercise.shortName
                );
                registeredCount++;
                registered.push(`${exercise.id}: ${exercise.title}`);
            } else {
                skipped.push(`${exercise.id}: ${exercise.title} (no repo URI)`);
            }
        }
        
        console.log(`📚 [Exercise Registry] Processed ${exercises.length} exercises: ${registeredCount} registered, ${skipped.length} skipped. Total in registry: ${this.exercises.size}`);
        if (registered.length > 0) {
            console.log(`   ✅ Registered: ${registered.join(', ')}`);
        }
        if (skipped.length > 0 && skipped.length <= 3) {
            console.log(`   ⏭️  Skipped: ${skipped.join(', ')}`);
        } else if (skipped.length > 3) {
            console.log(`   ⏭️  Skipped ${skipped.length} exercises (no repository URIs)`);
        }
    }

    public findByRepositoryUrl(repoUrl: string): ExerciseRegistryEntry | null {
        const normalizeUrl = (url: string) => {
            return url
                .replace(/^git@([^:]+):/, 'https://$1/')
                .replace(/^https?:\/\/[^@]*@/, 'https://')
                .replace(/\.git$/, '')
                .replace(/\/$/, '')
                .toLowerCase();
        };

        const normalizedSearchUrl = normalizeUrl(repoUrl);
        
        for (const exercise of this.exercises.values()) {
            if (normalizeUrl(exercise.repositoryUri) === normalizedSearchUrl) {
                return exercise;
            }
        }
        
        return null;
    }

    public getAllExercises(): ExerciseRegistryEntry[] {
        return Array.from(this.exercises.values());
    }

    public clear(): void {
        this.exercises.clear();
    }
}

// Export for use in other providers
export { ExerciseRegistry };

export class ChatWebviewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'iris.chatView';

    private _view?: vscode.WebviewView;
    private _irisChatView?: IrisChatView;
    private _openExercises: Map<number, { 
        title: string; 
        id: number;
        shortName?: string; // Exercise short name (e.g., "S11E02")
        releaseDate?: string; 
        dueDate?: string;
        lastViewed?: number; // Timestamp when last viewed
        score?: number; // Completion score (0-100)
    }> = new Map();
    private _openCourses: Map<number, { 
        title: string; 
        id: number;
        shortName?: string; // Course short name (e.g., "ios25")
        lastViewed?: number; // Timestamp when last viewed
    }> = new Map();
    private _exerciseQueue: number[] = [];
    private _courseQueue: number[] = [];
    private readonly MAX_EXERCISES = 5;
    private readonly MAX_COURSES = 3;
    private _selectedContext?: ChatContext; // Store the currently selected chat context
    private readonly _styleManager: StyleManager;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _extensionContext: vscode.ExtensionContext,
    ) { 
        this._styleManager = new StyleManager(this._extensionUri);
        // Don't create IrisChatView here - wait until resolveWebviewView
    }
    private _getOrCreateIrisChatView(): IrisChatView {
        if (!this._irisChatView) {
            this._irisChatView = new IrisChatView(this._extensionContext, this._styleManager);
        }
        return this._irisChatView;
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            // Allow scripts in the webview
            enableScripts: true,
            localResourceRoots: [
                this._extensionUri
            ]
        };

        // Set up message handling for the chat functionality
        webviewView.webview.onDidReceiveMessage(
            message => {
                this._handleMessage(message);
            },
            undefined,
            []
        );

        // Read developer tools setting
        const config = vscode.workspace.getConfiguration('artemis');
        const showDeveloperTools = !config.get<boolean>('hideDeveloperTools', true);

        webviewView.webview.html = this._getOrCreateIrisChatView().generateHtml(webviewView.webview, showDeveloperTools);

        // Give webview time to initialize, then send exercises and courses
        setTimeout(() => {
            // Detect workspace exercise and send all exercises
            this._detectAndSendExercises();
            
            // Send all currently tracked courses
            this._sendCourses();
        }, 150);

        // Resend exercises and courses when view becomes visible again
        webviewView.onDidChangeVisibility(() => {
            if (webviewView.visible) {
                this._detectAndSendExercises();
                this._sendCourses();
            }
        });

        // Listen for workspace folder changes
        vscode.workspace.onDidChangeWorkspaceFolders(() => {
            this._detectAndSendExercises();
        });

        // Listen for configuration changes to re-render when settings change
        vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration('artemis.hideDeveloperTools') || 
                event.affectsConfiguration('artemis.theme')) {
                this.refreshTheme();
            }
        });
    }

    private async _detectAndSendExercises(): Promise<void> {
        // Detect workspace exercise
        await this._detectWorkspaceExercise();
        // Send all exercises including workspace one
        this._sendExercises();
    }

    private _addExerciseToQueue(exerciseId: number, exerciseTitle: string, releaseDate?: string, dueDate?: string, shortName?: string): void {
        // Check if already exists
        if (!this._openExercises.has(exerciseId)) {
            this._exerciseQueue.push(exerciseId);
            
            // Enforce max limit (FIFO)
            if (this._exerciseQueue.length > this.MAX_EXERCISES) {
                const oldestId = this._exerciseQueue.shift();
                if (oldestId !== undefined) {
                    this._openExercises.delete(oldestId);
                }
            }
        }
        
        this._openExercises.set(exerciseId, { 
            title: exerciseTitle, 
            id: exerciseId,
            shortName, 
            releaseDate, 
            dueDate,
            lastViewed: Date.now() // Set view timestamp
        });
        
        // Re-sort queue by priority
        this._sortExerciseQueue();
    }

    private _addCourseToQueue(courseId: number, courseTitle: string, shortName?: string): void {
        // Check if already exists
        if (!this._openCourses.has(courseId)) {
            this._courseQueue.push(courseId);
            
            // Enforce max limit (FIFO)
            if (this._courseQueue.length > this.MAX_COURSES) {
                const oldestId = this._courseQueue.shift();
                if (oldestId !== undefined) {
                    this._openCourses.delete(oldestId);
                }
            }
        }
        
        this._openCourses.set(courseId, { 
            title: courseTitle, 
            id: courseId,
            shortName,
            lastViewed: Date.now() // Set view timestamp
        });
        
        // Re-sort queue by priority
        this._sortCourseQueue();
    }

    /**
     * Calculate priority score for an exercise
     * Higher score = higher priority
     */
    private _calculateExercisePriority(exerciseId: number): number {
        const exercise = this._openExercises.get(exerciseId);
        if (!exercise) {
            return 0;
        }

        let priority = 0;
        const now = Date.now();
        const msPerDay = 24 * 60 * 60 * 1000;

        // 1. Workspace bonus: +1000
        if (exercise.title.includes('(Workspace)')) {
            priority += 1000;
        }

        // 2. Released in last 7 days: +100
        if (exercise.releaseDate) {
            const releaseTime = new Date(exercise.releaseDate).getTime();
            const daysSinceRelease = (now - releaseTime) / msPerDay;
            if (daysSinceRelease >= 0 && daysSinceRelease <= 7) {
                priority += 100;
            }
        }

        // 3. Due in next 7 days: +200 (closer deadline = more points)
        if (exercise.dueDate) {
            const dueTime = new Date(exercise.dueDate).getTime();
            const daysUntilDue = (dueTime - now) / msPerDay;
            if (daysUntilDue >= 0 && daysUntilDue <= 7) {
                // Closer deadline gets more points (200 for due today, 170 for 7 days away)
                priority += Math.max(200 - Math.floor(daysUntilDue * 30 / 7), 170);
            }
        }

        // 4. Recently viewed: +50
        if (exercise.lastViewed) {
            const hoursSinceView = (now - exercise.lastViewed) / (60 * 60 * 1000);
            if (hoursSinceView <= 24) {
                priority += 50;
            }
        }

        // 5. Base score: Release date timestamp (newer = higher)
        if (exercise.releaseDate) {
            // Normalize to small number (days since epoch / 1000)
            const releaseTime = new Date(exercise.releaseDate).getTime();
            priority += Math.floor(releaseTime / msPerDay / 1000);
        }

        // 6. Completed exercises (score = 100) get lower priority: -100
        if (exercise.score === 100) {
            priority -= 100;
        }

        return priority;
    }

    /**
     * Calculate priority score for a course
     * Higher score = higher priority
     */
    private _calculateCoursePriority(courseId: number): number {
        const course = this._openCourses.get(courseId);
        if (!course) {
            return 0;
        }

        let priority = 0;
        const now = Date.now();
        const msPerDay = 24 * 60 * 60 * 1000;

        // 1. Has workspace exercise: +800
        const hasWorkspaceExercise = Array.from(this._openExercises.values())
            .some(ex => ex.title.includes('(Workspace)'));
        if (hasWorkspaceExercise) {
            // Check if any workspace exercise belongs to this course (would need course-exercise mapping)
            // For now, just boost the most recently viewed course if workspace exists
            priority += 800;
        }

        // 2. Recently viewed: +100
        if (course.lastViewed) {
            const hoursSinceView = (now - course.lastViewed) / (60 * 60 * 1000);
            if (hoursSinceView <= 24) {
                priority += 100;
            }
        }

        // 3. Base score: Last viewed timestamp (normalized like exercises)
        if (course.lastViewed) {
            // Normalize to small number (days since epoch / 1000) - same as exercises
            priority += Math.floor(course.lastViewed / msPerDay / 1000);
        }

        return priority;
    }

    /**
     * Get detailed breakdown of exercise priority score for diagnostics
     */
    private _getExercisePriorityBreakdown(exercise: { 
        title: string; 
        id: number;
        shortName?: string;
        releaseDate?: string; 
        dueDate?: string;
        lastViewed?: number;
        score?: number;
    }): string[] {
        const breakdown: string[] = [];
        const now = Date.now();
        const msPerDay = 24 * 60 * 60 * 1000;

        // 1. Workspace bonus
        if (exercise.title.includes('(Workspace)')) {
            breakdown.push('+1000 (Workspace exercise)');
        }

        // 2. Recently released
        if (exercise.releaseDate) {
            const releaseTime = new Date(exercise.releaseDate).getTime();
            const daysSinceRelease = (now - releaseTime) / msPerDay;
            if (daysSinceRelease >= 0 && daysSinceRelease <= 7) {
                breakdown.push(`+100 (Released ${Math.floor(daysSinceRelease)} days ago)`);
            }
        }

        // 3. Due soon
        if (exercise.dueDate) {
            const dueTime = new Date(exercise.dueDate).getTime();
            const daysUntilDue = (dueTime - now) / msPerDay;
            if (daysUntilDue >= 0 && daysUntilDue <= 7) {
                const points = Math.max(200 - Math.floor(daysUntilDue * 30 / 7), 170);
                breakdown.push(`+${points} (Due in ${Math.floor(daysUntilDue)} days)`);
            }
        }

        // 4. Recently viewed
        if (exercise.lastViewed) {
            const hoursSinceView = (now - exercise.lastViewed) / (60 * 60 * 1000);
            if (hoursSinceView <= 24) {
                breakdown.push(`+50 (Viewed ${Math.floor(hoursSinceView)} hours ago)`);
            }
        }

        // 5. Base score from release date
        if (exercise.releaseDate) {
            const releaseTime = new Date(exercise.releaseDate).getTime();
            const baseScore = Math.floor(releaseTime / msPerDay / 1000);
            breakdown.push(`+${baseScore} (Base score from release date)`);
        }

        // 6. Completed penalty
        if (exercise.score === 100) {
            breakdown.push('-100 (Already completed)');
        }

        return breakdown;
    }

    /**
     * Get detailed breakdown of course priority score for diagnostics
     */
    private _getCoursePriorityBreakdown(course: {
        title: string;
        id: number;
        shortName?: string;
        lastViewed?: number;
    }): string[] {
        const breakdown: string[] = [];
        const now = Date.now();

        // 1. Workspace exercise bonus
        const hasWorkspaceExercise = Array.from(this._openExercises.values())
            .some(ex => ex.title.includes('(Workspace)'));
        if (hasWorkspaceExercise) {
            breakdown.push('+800 (Has workspace exercise)');
        }

        // 2. Recently viewed
        if (course.lastViewed) {
            const hoursSinceView = (now - course.lastViewed) / (60 * 60 * 1000);
            if (hoursSinceView <= 24) {
                breakdown.push(`+100 (Viewed ${Math.floor(hoursSinceView)} hours ago)`);
            }
        }

        // 3. Base score (normalized like exercises)
        if (course.lastViewed) {
            const msPerDay = 24 * 60 * 60 * 1000;
            const baseScore = Math.floor(course.lastViewed / msPerDay / 1000);
            breakdown.push(`+${baseScore} (Base score from last view)`);
        }

        return breakdown;
    }

    /**
     * Sort exercise queue by priority (highest first)
     */
    private _sortExerciseQueue(): void {
        this._exerciseQueue.sort((a, b) => {
            const priorityA = this._calculateExercisePriority(a);
            const priorityB = this._calculateExercisePriority(b);
            return priorityB - priorityA; // Descending order
        });
    }

    /**
     * Sort course queue by priority (highest first)
     */
    private _sortCourseQueue(): void {
        this._courseQueue.sort((a, b) => {
            const priorityA = this._calculateCoursePriority(a);
            const priorityB = this._calculateCoursePriority(b);
            return priorityB - priorityA; // Descending order
        });
    }

    private async _detectWorkspaceExercise(): Promise<void> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return;
        }

        try {
            const { exec } = require('child_process');
            const { promisify } = require('util');
            const execAsync = promisify(exec);

            // Get git remote URL
            const { stdout } = await execAsync('git remote get-url origin', {
                cwd: workspaceFolder.uri.fsPath
            });

            const repoUrl = stdout.trim();

            // Check against exercise registry using exact URL matching
            const registry = ExerciseRegistry.getInstance();
            const matchedExercise = registry.findByRepositoryUrl(repoUrl);
            
            if (matchedExercise) {
                console.log('✅ [Workspace] Matched:', matchedExercise.title);
                
                // Check if this exercise is already in open exercises
                const existingEntry = this._openExercises.get(matchedExercise.id);
                if (existingEntry) {
                    // Update existing entry with (Workspace) marker, preserve dates
                    const baseTitle = existingEntry.title.replace(' (Workspace)', '');
                    this._openExercises.set(matchedExercise.id, {
                        title: `${baseTitle} (Workspace)`,
                        id: matchedExercise.id,
                        shortName: existingEntry.shortName,
                        releaseDate: existingEntry.releaseDate,
                        dueDate: existingEntry.dueDate
                    });
                } else {
                    // Add new entry with (Workspace) marker
                    this._addExerciseToQueue(matchedExercise.id, `${matchedExercise.title} (Workspace)`, undefined, undefined, matchedExercise.shortName);
                }
            } else {
                console.log('⚠️  [Workspace] No match found. Ensure course is loaded first.');
            }
        } catch (error) {
            // Not a git repository - that's okay
        }
    }

    private _sendExercises(): void {
        if (this._view) {
            // Prepare exercises list with isWorkspace flag
            const exercises = Array.from(this._openExercises.values()).map(ex => ({
                ...ex,
                isWorkspace: ex.title.includes('(Workspace)')
            }));
            
            // Auto-select workspace exercise if it exists, otherwise select first exercise
            let contextToSend = null;
            if (!this._selectedContext && exercises.length > 0) {
                const workspaceExercise = exercises.find(ex => ex.isWorkspace);
                if (workspaceExercise) {
                    this._setContext('exercise', workspaceExercise.id, workspaceExercise.title, 'auto-workspace');
                    contextToSend = {
                        type: 'exercise',
                        id: workspaceExercise.id,
                        title: workspaceExercise.title,
                        shortName: workspaceExercise.shortName
                    };
                    console.log(`📌 [Iris Chat] Auto-selected workspace exercise: ${workspaceExercise.title}`);
                } else {
                    this._setContext('exercise', exercises[0].id, exercises[0].title, 'auto-first');
                    contextToSend = {
                        type: 'exercise',
                        id: exercises[0].id,
                        title: exercises[0].title,
                        shortName: exercises[0].shortName
                    };
                    console.log(`📌 [Iris Chat] Auto-selected first exercise: ${exercises[0].title}`);
                }
            } else if (this._selectedContext && this._selectedContext.type === 'exercise') {
                // If context already exists, send it to webview to sync
                const selectedExercise = exercises.find(ex => ex.id === this._selectedContext!.id);
                if (selectedExercise) {
                    contextToSend = {
                        type: 'exercise',
                        id: selectedExercise.id,
                        title: selectedExercise.title,
                        shortName: selectedExercise.shortName
                    };
                    console.log(`📌 [Iris Chat] Sending existing context to webview: ${selectedExercise.title}`);
                }
            }
            
            setTimeout(() => {
                if (this._view) {
                    this._view.webview.postMessage({
                        command: 'updateDetectedExercises',
                        exercises: exercises
                    });
                    
                    // Send context to webview (either auto-selected or existing)
                    if (contextToSend) {
                        this._view.webview.postMessage({
                            command: 'autoSelectContext',
                            context: contextToSend
                        });
                    }
                }
            }, 100);
        }
    }

    private _sendCourses(): void {
        if (this._view) {
            const courses = Array.from(this._openCourses.values());
            
            console.log(`📚 [Iris Chat] Sending ${courses.length} tracked courses to webview`);
            
            // Check if we need to send a course context
            let contextToSend = null;
            if (this._selectedContext && this._selectedContext.type === 'course') {
                const selectedCourse = courses.find(c => c.id === this._selectedContext!.id);
                if (selectedCourse) {
                    contextToSend = {
                        type: 'course',
                        id: selectedCourse.id,
                        title: selectedCourse.title,
                        shortName: selectedCourse.shortName
                    };
                    console.log(`📌 [Iris Chat] Sending existing course context to webview: ${selectedCourse.title}`);
                }
            }
            
            if (courses.length > 0) {
                setTimeout(() => {
                    if (this._view) {
                        this._view.webview.postMessage({
                            command: 'updateDetectedCourses',
                            courses: courses
                        });
                        
                        // Send course context to webview if it exists
                        if (contextToSend) {
                            this._view.webview.postMessage({
                                command: 'autoSelectContext',
                                context: contextToSend
                            });
                        }
                    }
                }, 100);
            }
        }
    }

    public refreshTheme(): void {
        if (this._view) {
            // Read developer tools setting
            const config = vscode.workspace.getConfiguration('artemis');
            const showDeveloperTools = !config.get<boolean>('hideDeveloperTools', true);
            
            this._view.webview.html = this._getOrCreateIrisChatView().generateHtml(this._view.webview, showDeveloperTools);
        }
    }

    public updateDetectedExercise(exerciseTitle: string, exerciseId: number, releaseDate?: string, dueDate?: string, shortName?: string): void {
        this._addExerciseToQueue(exerciseId, exerciseTitle, releaseDate, dueDate, shortName);
        
        if (this._view) {
            setTimeout(() => {
                if (this._view) {
                    this._view.webview.postMessage({
                        command: 'updateDetectedExercises',
                        exercises: Array.from(this._openExercises.values())
                    });
                }
            }, 50);
        }
    }

    public removeDetectedExercise(exerciseId: number): void {
        this._openExercises.delete(exerciseId);
        
        // Remove from queue
        const index = this._exerciseQueue.indexOf(exerciseId);
        if (index > -1) {
            this._exerciseQueue.splice(index, 1);
        }
        
        if (this._view) {
            this._view.webview.postMessage({
                command: 'updateDetectedExercises',
                exercises: Array.from(this._openExercises.values())
            });
        }
    }

    public updateDetectedCourse(courseTitle: string, courseId: number, shortName?: string): void {
        this._addCourseToQueue(courseId, courseTitle, shortName);
        
        console.log(`📚 [Iris Chat] Course detected: ${courseTitle} (ID: ${courseId})`);
        console.log(`📚 [Iris Chat] Total courses tracked: ${this._openCourses.size}`);
        console.log(`📚 [Iris Chat] View exists: ${!!this._view}`);
        
        // Auto-select if no context is set and this is the first course
        if (!this._selectedContext && this._openCourses.size === 1) {
            this._setContext('course', courseId, courseTitle, 'auto-first');
            console.log(`📌 [Iris Chat] Auto-selected first course: ${courseTitle}`);
        }
        
        if (this._view) {
            const coursesArray = Array.from(this._openCourses.values());
            console.log(`📚 [Iris Chat] Sending ${coursesArray.length} courses to webview:`, coursesArray);
            setTimeout(() => {
                if (this._view) {
                    this._view.webview.postMessage({
                        command: 'updateDetectedCourses',
                        courses: coursesArray
                    });
                }
            }, 50);
        } else {
            console.warn('📚 [Iris Chat] Cannot send courses - view not initialized yet');
        }
    }

    public removeDetectedCourse(courseId: number): void {
        this._openCourses.delete(courseId);
        
        // Remove from queue
        const index = this._courseQueue.indexOf(courseId);
        if (index > -1) {
            this._courseQueue.splice(index, 1);
        }
        
        // Clear context if the removed course was selected
        if (this._selectedContext?.type === 'course' && this._selectedContext.id === courseId) {
            this.clearContext();
        }
        
        if (this._view) {
            this._view.webview.postMessage({
                command: 'updateDetectedCourses',
                courses: Array.from(this._openCourses.values())
            });
        }
    }

    private _handleMessage(message: any): void {
        switch (message.command) {
            case 'sendMessage':
                // Handle chat message sending
                this._handleChatMessage(message);
                break;
            case 'clearHistory':
                // Handle clear history
                this._handleClearHistory();
                break;
            case 'selectChatContext':
                // Handle unified context selection (new format from irisChatView)
                this._handleContextSelection(message.context, message.itemId, message.itemName, message.itemShortName);
                break;
            case 'selectExerciseContext':
                // Handle exercise context selection (legacy)
                this._handleExerciseSelection(message.exerciseId);
                break;
            case 'selectCourseContext':
                // Handle course context selection (legacy)
                this._handleCourseSelection(message.courseId);
                break;
            case 'openDiagnostics':
                // Handle diagnostics request (async)
                this._handleOpenDiagnostics(message.selectionModeInfo).catch(err => {
                    console.error('Error opening diagnostics:', err);
                    vscode.window.showErrorMessage('Failed to open diagnostics report');
                });
                break;
            default:
                console.log('Unhandled message in chat view:', message);
                break;
        }
    }

    private _handleContextSelection(contextType: ChatContextType, itemId: number, itemName: string, itemShortName?: string): void {
        this._setContext(contextType, itemId, itemName, 'user-selected');
        
        console.log(`📌 [Iris Chat] User selected ${contextType} context: ${itemName} (ID: ${itemId}, Short: ${itemShortName || 'N/A'})`);
        
        // Optionally show a notification to the user
        const contextTypeLabel = contextType === 'exercise' ? 'Exercise' : contextType === 'course' ? 'Course' : 'Context';
        vscode.window.showInformationMessage(`${contextTypeLabel} context set to: ${itemName}`);
    }

    private _handleCourseSelection(courseId: number): void {
        const course = this._openCourses.get(courseId);
        const courseTitle = course ? course.title : `Course ${courseId}`;
        
        this._setContext('course', courseId, courseTitle, 'user-selected');
        
        console.log(`📌 [Iris Chat] User selected course context: ${courseTitle} (ID: ${courseId})`);
    }

    private _handleExerciseSelection(exerciseId: number): void {
        const exercise = this._openExercises.get(exerciseId);
        const exerciseTitle = exercise ? exercise.title : `Exercise ${exerciseId}`;
        
        this._setContext('exercise', exerciseId, exerciseTitle, 'user-selected');
        
        console.log(`📌 [Iris Chat] User selected exercise context: ${exerciseTitle} (ID: ${exerciseId})`);
        
        // Optionally show a notification to the user
        vscode.window.showInformationMessage(`Exercise context set to: ${exerciseTitle}`);
    }

    /**
     * Set the chat context with type, ID, title, and reason
     */
    private _setContext(type: ChatContextType, id: number, title: string, reason: ChatContextReason): void {
        this._selectedContext = {
            type,
            id,
            title,
            reason,
            timestamp: Date.now()
        };
    }

    /**
     * Get the currently selected chat context
     */
    public getSelectedContext(): ChatContext | undefined {
        return this._selectedContext;
    }

    /**
     * Get the currently selected exercise ID (for backward compatibility)
     */
    public getSelectedExerciseId(): number | undefined {
        return this._selectedContext?.type === 'exercise' ? this._selectedContext.id : undefined;
    }

    /**
     * Get the currently selected exercise details (for backward compatibility)
     */
    public getSelectedExercise(): { title: string; id: number } | undefined {
        if (this._selectedContext?.type === 'exercise') {
            return {
                id: this._selectedContext.id,
                title: this._selectedContext.title
            };
        }
        return undefined;
    }

    /**
     * Set context to a course
     */
    public setCourseContext(courseId: number, courseTitle: string, reason: ChatContextReason = 'user-selected', shortName?: string): void {
        this._addCourseToQueue(courseId, courseTitle, shortName);
        this._setContext('course', courseId, courseTitle, reason);
        console.log(`📌 [Iris Chat] Course context set: ${courseTitle} (ID: ${courseId}, reason: ${reason})`);

        if (this._view) {
            this._view.webview.postMessage({
                command: 'autoSelectContext',
                context: {
                    type: 'course',
                    id: courseId,
                    title: courseTitle,
                    shortName: shortName
                }
            });
        }
    }

    /**
     * Set context to an exercise (public method for external use)
     */
    public setExerciseContext(exerciseId: number, exerciseTitle: string, reason: ChatContextReason = 'user-selected', shortName?: string): void {
        this._addExerciseToQueue(exerciseId, exerciseTitle, undefined, undefined, shortName);
        this._setContext('exercise', exerciseId, exerciseTitle, reason);
        console.log(`📌 [Iris Chat] Exercise context set: ${exerciseTitle} (ID: ${exerciseId}, reason: ${reason})`);

        if (this._view) {
            this._view.webview.postMessage({
                command: 'autoSelectContext',
                context: {
                    type: 'exercise',
                    id: exerciseId,
                    title: exerciseTitle,
                    shortName: shortName
                }
            });
        }
    }

    /**
     * Clear the current context
     */
    public clearContext(): void {
        this._selectedContext = undefined;
        console.log(`📌 [Iris Chat] Context cleared`);
    }

    private async _handleOpenDiagnostics(selectionModeInfo?: any): Promise<void> {
        // Build the entire diagnostics report as a single string
        let report = '='.repeat(80) + '\n';
        report += '🐛 IRIS CHAT DIAGNOSTICS\n';
        report += 'Generated at: ' + new Date().toISOString() + '\n';
        report += '='.repeat(80) + '\n';
        
        // 1. Selected Context
        report += '\n📌 SELECTED CONTEXT:\n';
        if (this._selectedContext) {
            report += `  Type: ${this._selectedContext.type}\n`;
            report += `  ID: ${this._selectedContext.id}\n`;
            report += `  Title: ${this._selectedContext.title}\n`;
            report += `  Reason: ${this._selectedContext.reason}\n`;
            report += `  Selected at: ${new Date(this._selectedContext.timestamp).toISOString()}\n`;
        } else {
            report += '  No context selected\n';
        }
        
        // 1.5 Selection Mode State
        if (selectionModeInfo) {
            report += '\n🎛️  SELECTION MODE STATE:\n';
            report += `  Current Mode: ${selectionModeInfo.currentMode}\n`;
            report += `  Saved State Mode: ${selectionModeInfo.savedStateMode}\n`;
            report += `  UI Button Text: ${selectionModeInfo.uiButtonText}\n`;
            report += `  UI Button Class: ${selectionModeInfo.uiButtonClass}\n`;
            report += '\n  UI Element Visibility:\n';
            report += `    Search Container: ${selectionModeInfo.searchContainerDisplay}\n`;
            report += `    Quick Select: ${selectionModeInfo.quickSelectDisplay}\n`;
            report += `    Exercises Section: ${selectionModeInfo.exercisesSectionDisplay}\n`;
            report += `    Courses Section: ${selectionModeInfo.coursesSectionDisplay}\n`;
        }
        
        // 2. Tracked Exercises with Priority Scores
        report += `\n🎯 TRACKED EXERCISES (${this._openExercises.size}):\n`;
        if (this._openExercises.size > 0) {
            // Sort by priority for the report
            const exercisesWithPriority = Array.from(this._openExercises.values())
                .map(ex => ({
                    exercise: ex,
                    priority: this._calculateExercisePriority(ex.id),
                    scoreBreakdown: this._getExercisePriorityBreakdown(ex)
                }))
                .sort((a, b) => b.priority - a.priority);

            exercisesWithPriority.forEach((item, idx) => {
                const ex = item.exercise;
                const isWorkspace = ex.title.includes('(Workspace)');
                report += `  ${idx + 1}. [${ex.id}] ${ex.title}${isWorkspace ? ' ⭐' : ''}\n`;
                report += `     Priority Score: ${item.priority}\n`;
                
                // Show score breakdown
                if (item.scoreBreakdown.length > 0) {
                    report += `     Score Breakdown:\n`;
                    item.scoreBreakdown.forEach((reason: string) => {
                        report += `       ${reason}\n`;
                    });
                }
                
                if (ex.shortName) {
                    report += `     Short Name: ${ex.shortName}\n`;
                }
                if (ex.releaseDate) {
                    report += `     Release: ${ex.releaseDate}\n`;
                }
                if (ex.dueDate) {
                    report += `     Due: ${ex.dueDate}\n`;
                }
                if (ex.score !== undefined) {
                    report += `     Completion: ${ex.score}%\n`;
                }
                if (ex.lastViewed) {
                    report += `     Last Viewed: ${new Date(ex.lastViewed).toISOString()}\n`;
                }
                report += '\n';
            });
            report += `  Queue order: [${this._exerciseQueue.join(', ')}]\n`;
        } else {
            report += '  No exercises detected\n';
        }
        
        // 3. Tracked Courses with Priority Scores
        report += `\n📚 TRACKED COURSES (${this._openCourses.size}):\n`;
        if (this._openCourses.size > 0) {
            // Sort by priority for the report
            const coursesWithPriority = Array.from(this._openCourses.values())
                .map(course => ({
                    course: course,
                    priority: this._calculateCoursePriority(course.id),
                    scoreBreakdown: this._getCoursePriorityBreakdown(course)
                }))
                .sort((a, b) => b.priority - a.priority);

            coursesWithPriority.forEach((item, idx) => {
                const course = item.course;
                report += `  ${idx + 1}. [${course.id}] ${course.title}\n`;
                report += `     Priority Score: ${item.priority}\n`;
                
                // Show score breakdown
                if (item.scoreBreakdown.length > 0) {
                    report += `     Score Breakdown:\n`;
                    item.scoreBreakdown.forEach((reason: string) => {
                        report += `       ${reason}\n`;
                    });
                }
                
                if (course.shortName) {
                    report += `     Short Name: ${course.shortName}\n`;
                }
                if (course.lastViewed) {
                    report += `     Last Viewed: ${new Date(course.lastViewed).toISOString()}\n`;
                }
                report += '\n';
            });
            report += `  Queue order: [${this._courseQueue.join(', ')}]\n`;
        } else {
            report += '  No courses detected\n';
        }
        
        // 4. Exercise Registry
        const registry = ExerciseRegistry.getInstance();
        const allExercises = registry.getAllExercises();
        report += `\n📚 EXERCISE REGISTRY (${allExercises.length} total):\n`;
        if (allExercises.length > 0) {
            allExercises.forEach((ex, idx) => {
                report += `  ${idx + 1}. [${ex.id}] ${ex.title}\n`;
                report += `     Repository: ${ex.repositoryUri}\n`;
            });
        } else {
            report += '  Registry is empty\n';
        }
        
        // 5. View State
        report += '\n🖼️  VIEW STATE:\n';
        report += `  View initialized: ${!!this._view}\n`;
        report += `  View visible: ${this._view?.visible ?? 'N/A'}\n`;
        
        report += '\n' + '='.repeat(80) + '\n';
        report += '\nThis report can be shared for debugging purposes.\n';
        report += 'Please remove any sensitive information before sharing.\n';
        
        // Open a new untitled document and paste the diagnostics
        const document = await vscode.workspace.openTextDocument({
            content: report,
            language: 'plaintext'
        });
        
        await vscode.window.showTextDocument(document, {
            preview: false,
            viewColumn: vscode.ViewColumn.Active
        });
    }

    private _handleChatMessage(message: any): void {
        // For now, just acknowledge the message
        // In a real implementation, this would send to Iris API
        vscode.window.showInformationMessage(`Chat message: ${message.text}`);
    }

    private _handleClearHistory(): void {
        // Handle clearing chat history
        vscode.window.showInformationMessage('Chat history cleared');
    }
}
