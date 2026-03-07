import * as vscode from 'vscode';
import { promisify } from 'util';
import { execFile } from 'child_process';
import type { ArtemisApiService } from '../../api';
import type { CourseDashboardEntry } from '../../types/apiResponses';
import type { ContextStore } from '../contextStore';
import { ExerciseRegistry } from '../exerciseRegistry';
import { logger } from '../loggingService';
import { checkWorkspaceFiles } from '../../utils';

const execFileAsync = promisify(execFile);

/**
 * Information about a detected exercise in the workspace
 */
export interface DetectedExercise {
    id: number;
    title: string;
    shortName?: string;
    repositoryUri: string;
    courseId?: number;
}

/**
 * Source of exercises to search against
 */
export interface ExerciseSource {
    id: number;
    title: string;
    shortName?: string;
    courseId?: number;
    repositoryUri?: string;
    studentParticipations?: Array<{
        repositoryUri?: string;
        testRun?: boolean;
    }>;
}

/**
 * Normalizes a git repository URL for comparison.
 * Handles various URL formats:
 * - SSH: git@github.com:user/repo.git
 * - HTTPS with credentials: https://user@github.com/user/repo.git
 * - HTTPS/HTTP: https://github.com/user/repo.git or http://github.com/user/repo.git
 */
export function normalizeRepositoryUrl(url: string): string {
    const normalized = url
        .replace(/^git@([^:]+):/, 'https://$1/')
        .replace(/^https?:\/\/[^@]*@/, 'https://')
        .replace(/^http:\/\//, 'https://')
        .replace(/\.git$/, '')
        .replace(/\/$/, '')
        .toLowerCase();

    return normalized;
}

/**
 * Gets the git remote origin URL from a workspace folder.
 * @param workspaceFolder Optional workspace folder, defaults to first workspace folder
 * @returns The remote origin URL or null if not a git repository
 */
export async function getWorkspaceRepositoryUrl(
    workspaceFolder?: vscode.WorkspaceFolder
): Promise<string | null> {
    const folder = workspaceFolder || vscode.workspace.workspaceFolders?.[0];

    if (!folder) {
        return null;
    }

    try {
        const { stdout } = await execFileAsync('git', ['remote', 'get-url', 'origin'], {
            cwd: folder.uri.fsPath
        });

        const url = stdout.trim();
        return url || null;
    } catch {
        // Not a git repository or git command failed
        return null;
    }
}

/**
 * Status of the current workspace relative to an expected exercise repository.
 */
export interface WorkspaceStatus {
    isConnected: boolean;
    hasChanges: boolean;
    isPracticeRepo: boolean;
}

/**
 * Checks whether the current workspace matches an expected exercise repository URL.
 * Combines URL comparison, practice-repo fallback, and file-change detection.
 * @param expectedRepoUri The exercise's expected repository URL
 * @param workspaceFolder Optional workspace folder, defaults to first workspace folder
 * @returns WorkspaceStatus with connection, changes, and practice-repo info
 */
export async function getWorkspaceStatus(
    expectedRepoUri: string,
    workspaceFolder?: vscode.WorkspaceFolder
): Promise<WorkspaceStatus> {
    const folder = workspaceFolder || vscode.workspace.workspaceFolders?.[0];

    const disconnected: WorkspaceStatus = { isConnected: false, hasChanges: false, isPracticeRepo: false };

    if (!folder) {
        return disconnected;
    }

    const workspaceUrl = await getWorkspaceRepositoryUrl(folder);
    if (!workspaceUrl) {
        return disconnected;
    }

    const normalizedWorkspace = normalizeRepositoryUrl(workspaceUrl);
    const normalizedExpected = normalizeRepositoryUrl(expectedRepoUri);

    async function getFileChanges(): Promise<boolean> {
        try {
            const result = await checkWorkspaceFiles(folder!, { includeContent: false, applyFilters: false });
            return result.hasChanges;
        } catch {
            return false;
        }
    }

    // Direct match
    if (normalizedWorkspace === normalizedExpected) {
        const hasChanges = await getFileChanges();
        return { isConnected: true, hasChanges, isPracticeRepo: normalizedWorkspace.includes('-practice-') };
    }

    // Practice-repo fallback: workspace URL contains '-practice-', try matching without it
    if (normalizedWorkspace.includes('-practice-')) {
        const potentialGradedUrl = normalizedWorkspace.replace('-practice-', '-');
        if (potentialGradedUrl === normalizedExpected) {
            const hasChanges = await getFileChanges();
            return { isConnected: true, hasChanges, isPracticeRepo: true };
        }
    }

    return disconnected;
}

/**
 * Finds an exercise that matches the given repository URL.
 * @param repositoryUrl The repository URL to match
 * @param exercises Array of exercises to search
 * @returns The matching exercise or null
 */
export function findExerciseByRepositoryUrl(
    repositoryUrl: string,
    exercises: ExerciseSource[]
): DetectedExercise | null {
    const normalizedSearchUrl = normalizeRepositoryUrl(repositoryUrl);

    // First pass: exact match
    for (const exercise of exercises) {
        // Check direct repositoryUri on exercise
        if (exercise.repositoryUri) {
            if (normalizeRepositoryUrl(exercise.repositoryUri) === normalizedSearchUrl) {
                const result: DetectedExercise = {
                    id: exercise.id,
                    title: exercise.title,
                    shortName: exercise.shortName,
                    repositoryUri: exercise.repositoryUri
                };
                if (exercise.courseId !== undefined) {
                    result.courseId = exercise.courseId;
                }
                return result;
            }
        }

        // Check participations
        const participations = exercise.studentParticipations || [];
        for (const participation of participations) {
            if (participation.repositoryUri) {
                if (normalizeRepositoryUrl(participation.repositoryUri) === normalizedSearchUrl) {
                    const result: DetectedExercise = {
                        id: exercise.id,
                        title: exercise.title,
                        shortName: exercise.shortName,
                        repositoryUri: participation.repositoryUri
                    };
                    if (exercise.courseId !== undefined) {
                        result.courseId = exercise.courseId;
                    }
                    return result;
                }
            }
        }
    }

    // Second pass: practice repo fallback
    // If the workspace is a practice repo (contains '-practice-'), try matching against graded repos
    if (normalizedSearchUrl.includes('-practice-')) {
        const potentialGradedUrl = normalizedSearchUrl.replace('-practice-', '-');

        for (const exercise of exercises) {
            if (exercise.repositoryUri) {
                if (normalizeRepositoryUrl(exercise.repositoryUri) === potentialGradedUrl) {
                    const result: DetectedExercise = {
                        id: exercise.id,
                        title: exercise.title,
                        shortName: exercise.shortName,
                        repositoryUri: exercise.repositoryUri
                    };
                    if (exercise.courseId !== undefined) {
                        result.courseId = exercise.courseId;
                    }
                    return result;
                }
            }

            const participations = exercise.studentParticipations || [];
            for (const participation of participations) {
                if (participation.repositoryUri) {
                    if (normalizeRepositoryUrl(participation.repositoryUri) === potentialGradedUrl) {
                        const result: DetectedExercise = {
                            id: exercise.id,
                            title: exercise.title,
                            shortName: exercise.shortName,
                            repositoryUri: participation.repositoryUri
                        };
                        if (exercise.courseId !== undefined) {
                            result.courseId = exercise.courseId;
                        }
                        return result;
                    }
                }
            }
        }
    }

    return null;
}

/**
 * Detects the exercise that corresponds to the current workspace.
 * @param exercises Array of exercises to search
 * @param workspaceFolder Optional workspace folder, defaults to first workspace folder
 * @returns The detected exercise or null
 */
export async function detectWorkspaceExercise(
    exercises: ExerciseSource[],
    workspaceFolder?: vscode.WorkspaceFolder
): Promise<DetectedExercise | null> {
    const repositoryUrl = await getWorkspaceRepositoryUrl(workspaceFolder);

    if (!repositoryUrl) {
        return null;
    }

    return findExerciseByRepositoryUrl(repositoryUrl, exercises);
}

/**
 * Checks if a specific exercise matches the current workspace.
 * @param exerciseId The exercise ID to check
 * @param exercises Array of exercises containing the exercise to check
 * @param workspaceFolder Optional workspace folder
 * @returns True if the exercise matches the current workspace
 */
export async function isExerciseInCurrentWorkspace(
    exerciseId: number,
    exercises: ExerciseSource[],
    workspaceFolder?: vscode.WorkspaceFolder
): Promise<boolean> {
    const detected = await detectWorkspaceExercise(exercises, workspaceFolder);
    return detected?.id === exerciseId;
}

/**
 * Check workspace status against a list of repository URIs.
 * Returns the first connected match with its URI, or disconnected status if none match.
 */
export async function detectWorkspaceForRepoUris(
    repoUris: string[],
    workspaceFolder?: vscode.WorkspaceFolder
): Promise<WorkspaceStatus & { matchedUri?: string }> {
    for (const uri of repoUris) {
        const status = await getWorkspaceStatus(uri, workspaceFolder);
        if (status.isConnected) {
            return { ...status, matchedUri: uri };
        }
    }
    return { isConnected: false, hasChanges: false, isPracticeRepo: false };
}

/**
 * Searches archived courses for one whose exercises match the current workspace git remote.
 * Fetches archived course details one at a time (sequential) to avoid loading all at once.
 * @returns The matching CourseDashboardEntry, or null if not found / already in active courses.
 */
export async function findWorkspaceCourseInArchive(
    artemisApi: ArtemisApiService,
    activeCourseEntries: CourseDashboardEntry[]
): Promise<CourseDashboardEntry | null> {
    const repositoryUrl = await getWorkspaceRepositoryUrl();
    if (!repositoryUrl) {
        return null;
    }

    // Check if the exercise is already in active courses
    const allActiveExercises: ExerciseSource[] = activeCourseEntries.flatMap(entry => {
        const exercises = entry.course?.exercises || entry.exercises || [];
        return exercises
            .filter((ex): ex is typeof ex & { id: number; title: string } => ex.id !== undefined && ex.title !== undefined)
            .map(ex => ({ ...ex, courseId: entry.course?.id }));
    });

    if (findExerciseByRepositoryUrl(repositoryUrl, allActiveExercises)) {
        return null; // Already matched in active courses
    }

    // Fetch lightweight archived course list
    const archivedCourses = await artemisApi.getArchivedCourses();

    // Check each archived course sequentially until we find a match
    for (const course of archivedCourses) {
        if (course.id === undefined) {
            continue;
        }
        try {
            const entry = await artemisApi.getCourseForDashboard(course.id);
            const exercises: ExerciseSource[] = (entry.course?.exercises || entry.exercises || [])
                .filter((ex): ex is typeof ex & { id: number; title: string } => ex.id !== undefined && ex.title !== undefined)
                .map(ex => ({ ...ex, courseId: entry.course?.id }));

            if (findExerciseByRepositoryUrl(repositoryUrl, exercises)) {
                logger.irisChat(`Found workspace match in archived course: ${entry.course?.title}`);
                return entry;
            }
        } catch {
            // Skip courses that fail to load
        }
    }

    return null;
}

/**
 * Detect workspace exercise with registry population fallback, then register it in a ContextStore.
 * Used by ChatWebviewProvider to auto-detect the workspace exercise on load.
 */
export async function detectAndRegisterWorkspaceExercise(
    artemisApiService: ArtemisApiService | undefined,
    contextStore: ContextStore,
    postSnapshot: () => void,
    exerciseRegistry: ExerciseRegistry,
): Promise<void> {

    try {
        const registry = exerciseRegistry;
        let exercises = registry.getAllExercises();

        if (exercises.length === 0 && artemisApiService) {
            logger.irisChat('Registry empty, fetching courses to populate exercises...');
            try {
                const dashboardData = await artemisApiService.getCoursesForDashboard();
                const courses = dashboardData?.courses;

                if (courses && Array.isArray(courses) && courses.length > 0) {
                    for (const courseData of courses) {
                        const courseExercises = courseData?.course?.exercises || courseData?.exercises || [];
                        if (courseExercises.length > 0) {
                            registry.registerFromCourseData({
                                course: courseData.course || courseData,
                                exercises: courseExercises
                            });
                        }
                    }
                }
                exercises = registry.getAllExercises();
                logger.irisChat(`Registry populated with ${exercises.length} exercises`);
            } catch (error) {
                logger.irisChatWarn('Failed to fetch courses for registry population', error);
            }
        }

        let detected = await detectWorkspaceExercise(exercises);

        // Fallback: search archived courses if no match in active courses
        if (!detected && artemisApiService) {
            logger.irisChat('No match in active courses, checking archived courses...');
            try {
                const archivedEntry = await findWorkspaceCourseInArchive(artemisApiService, []);
                if (archivedEntry) {
                    const courseExercises = archivedEntry.course?.exercises || archivedEntry.exercises || [];
                    if (courseExercises.length > 0) {
                        registry.registerFromCourseData({
                            course: archivedEntry.course || {},
                            exercises: courseExercises
                        });
                    }
                    exercises = registry.getAllExercises();
                    detected = await detectWorkspaceExercise(exercises);
                }
            } catch (error) {
                logger.irisChatWarn('Failed to fetch archived courses for workspace detection', error);
            }
        }

        if (detected) {
            logger.irisChat(`Detected workspace exercise: ${detected.title} (ID: ${detected.id})`);
        } else {
            logger.irisChat('No workspace exercise detected matching current git remote');
        }

        if (!detected) {
            const current = contextStore.getActiveContext();
            if (current && current.source === 'workspace-detected') {
                logger.irisChat(`Clearing stale workspace context: ${current.title}`);
                contextStore.clearActiveContext();
                postSnapshot();
            }
            return;
        }

        const baseTitle = detected.title.replace(/ \(Workspace\)$/i, '');
        const displayTitle = `${baseTitle} (Workspace)`;

        contextStore.registerExercise({
            id: detected.id,
            title: displayTitle,
            shortName: detected.shortName,
            courseId: detected.courseId,
            repositoryUri: detected.repositoryUri,
            source: 'workspace-detected',
            isWorkspace: true,
        });

        postSnapshot();
    } catch {
        // Not a git repository or command failed - ignore silently
    }
}
