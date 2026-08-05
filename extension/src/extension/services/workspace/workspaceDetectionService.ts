import * as vscode from 'vscode';
import { execFile } from 'child_process';
import { promisify } from 'util';

import type { ArtemisApiService } from '@extension/api';
import type { CourseCatalog } from '@extension/services/courseCatalog';
import { ExerciseRegistry, type ExerciseRegistryEntry } from '@extension/services/exerciseRegistry';
import { logger } from '@extension/services/loggingService';
import type { CourseDashboardCourse, CourseDashboardEntry, ExerciseDetail } from '@extension/types';

import type { DetectionOutcome } from './detectionOutcome';
import { checkWorkspaceFiles } from './workspaceFileChecker';

const execFileAsync = promisify(execFile);

/** A workspace-detected exercise. Structurally identical to ExerciseRegistryEntry. */
export type DetectedExercise = ExerciseRegistryEntry;

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
 * Return the exercises for a CourseDashboardEntry, preferring the nested
 * `course.exercises` array and falling back to the flat `entry.exercises`.
 *
 * The length check is deliberate: in JavaScript `[] || fallback` evaluates
 * to `[]` (empty arrays are truthy), so a previous mix of `??` and `||`
 * across the codebase was effectively identical. The new behavior treats
 * a nested empty array as "look at flat next", which is what consumers
 * appear to assume in practice.
 */
export function getEntryExercises(entry: CourseDashboardEntry): ExerciseDetail[] {
    const nested = entry.course?.exercises;
    return nested?.length ? nested : (entry.exercises ?? []);
}

/**
 * Map a raw `ExerciseDetail` (server response) to the narrow `ExerciseSource`
 * shape used by workspace detection. Returns null when the exercise is missing
 * a numeric id or a string title — those are the only fields the workspace
 * matching logic cannot tolerate.
 *
 * `courseId` is taken from the argument, not from any nested `course.id`,
 * because the surrounding traversal knows which course the exercise belongs to.
 */
export function toExerciseSource(
    exercise: ExerciseDetail,
    courseId?: number,
): ExerciseSource | null {
    if (typeof exercise.id !== 'number' || typeof exercise.title !== 'string') {
        return null;
    }
    const rawParticipations = exercise.studentParticipations;
    const studentParticipations = Array.isArray(rawParticipations)
        ? rawParticipations.map(p => ({
            repositoryUri: p.repositoryUri,
            testRun: p.testRun,
        }))
        : undefined;
    return {
        id: exercise.id,
        title: exercise.title,
        shortName: exercise.shortName,
        courseId,
        repositoryUri: exercise.repositoryUri,
        studentParticipations,
    };
}

/**
 * Extracts ExerciseSource objects from course dashboard entries.
 * Handles both nested (entry.course.exercises) and flat (entry.exercises) shapes.
 */
export function collectExerciseSources(entries: CourseDashboardEntry[]): ExerciseSource[] {
    return entries.flatMap(entry => {
        const exercises = getEntryExercises(entry);
        return exercises
            .map(ex => toExerciseSource(ex, entry.course?.id))
            .filter((s): s is ExerciseSource => s !== null);
    });
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
interface WorkspaceStatus {
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
 * Result of searching the archived courses for a repository match.
 *
 * `reachable` is false when any per-course detail request threw, which means
 * an absent `entry` is not proof of "no match" - the course that would have
 * matched may be the one that could not be read.
 */
export interface ArchiveSearchResult {
    entry?: CourseDashboardEntry;
    reachable: boolean;
}

/**
 * Searches the given archived courses for one whose exercises match `repositoryUrl`.
 * Fetches archived course details one at a time (sequential) to avoid loading all at once.
 * A per-course failure does not abort the search - the remaining courses are still tried -
 * but it does mark the result unreachable, since the failed course could have been the match.
 */
export async function searchArchivedCoursesForRepository(
    artemisApi: ArtemisApiService,
    repositoryUrl: string,
    archivedCourses: CourseDashboardCourse[]
): Promise<ArchiveSearchResult> {
    let reachable = true;

    for (const course of archivedCourses) {
        if (course.id === undefined) {
            continue;
        }
        try {
            const entry = await artemisApi.getCourseForDashboard(course.id);
            const exercises: ExerciseSource[] = getEntryExercises(entry)
                .map(ex => toExerciseSource(ex, entry.course?.id))
                .filter((s): s is ExerciseSource => s !== null);

            if (findExerciseByRepositoryUrl(repositoryUrl, exercises)) {
                logger.irisChat(`Found workspace match in archived course: ${entry.course?.title}`);
                return { entry, reachable };
            }
        } catch (error) {
            reachable = false;
            logger.irisChatWarn(`Failed to load archived course ${course.id}`, error);
        }
    }

    return { reachable };
}

/**
 * Searches archived courses for one whose exercises match the current workspace git remote.
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
    const allActiveExercises: ExerciseSource[] = activeCourseEntries.flatMap(entry =>
        getEntryExercises(entry)
            .map(ex => toExerciseSource(ex, entry.course?.id))
            .filter((s): s is ExerciseSource => s !== null)
    );

    if (findExerciseByRepositoryUrl(repositoryUrl, allActiveExercises)) {
        return null; // Already matched in active courses
    }

    const result = await searchArchivedCoursesForRepository(
        artemisApi, repositoryUrl, await artemisApi.getArchivedCourses(),
    );
    return result.entry ?? null;
}

/**
 * Detect workspace exercise with registry population fallback, then register it in a ContextStore.
 * Used by ChatWebviewProvider to auto-detect the workspace exercise on load.
 */
interface WorkspaceRegistrationCallbacks {
    registerExercise: (input: {
        id: number;
        title: string;
        shortName?: string;
        courseId: number;
        repositoryUri?: string;
    }) => void;
    clearStaleWorkspaceContext: () => void;
}

/**
 * Detects and registers the workspace exercise for a known repository URL.
 * The URL is a parameter (not re-read from git) so every branch below is
 * reachable from a test without a real repository on disk.
 */
export async function detectWorkspaceExerciseForRepository(
    repositoryUrl: string,
    artemisApiService: ArtemisApiService | undefined,
    callbacks: WorkspaceRegistrationCallbacks,
    registry: ExerciseRegistry,
    courseCatalog?: CourseCatalog,
): Promise<DetectionOutcome> {
    // Captured once, at the top: a write built from a later read could cross
    // a session boundary that opened while this function was awaiting the
    // server.
    const epoch = courseCatalog?.currentEpoch ?? 0;
    let exercises = registry.getAllExercises();
    let reachable = true;

    // If registry is empty, populate it from the shared course cache (or API as fallback).
    // The cache deduplicates concurrent fetches so this is cheap if data is already loaded.
    if (exercises.length === 0) {
        logger.irisChat('Registry empty, fetching courses to populate exercises...');
        try {
            const dashboardData = await courseCatalog?.fetch();
            if (!dashboardData) {
                // _doFetch swallows its error and returns undefined, so this
                // is the only signal the cache gives us. An empty `courses`
                // array is a truthy response and stays reachable.
                reachable = false;
            } else {
                for (const courseData of dashboardData.courses ?? []) {
                    registry.registerFromCourseData(courseData);
                }
            }
            exercises = registry.getAllExercises();
            logger.irisChat(`Registry populated with ${exercises.length} exercises`);
        } catch (error) {
            reachable = false;
            logger.irisChatWarn('Failed to fetch courses for registry population', error);
        }
    }

    // findExerciseByRepositoryUrl, not detectWorkspaceExercise: the latter
    // re-reads the git remote and would undo the whole point of the split.
    let detected = findExerciseByRepositoryUrl(repositoryUrl, exercises);

    // Fallback: search archived courses if no match in active courses
    if (!detected && artemisApiService) {
        logger.irisChat('No match in active courses, checking archived courses...');
        let archivedCourses: CourseDashboardCourse[] = [];
        try {
            archivedCourses = await artemisApiService.getArchivedCourses();
        } catch (error) {
            reachable = false;
            logger.irisChatWarn('Failed to list archived courses', error);
        }
        const archive = await searchArchivedCoursesForRepository(
            artemisApiService, repositoryUrl, archivedCourses,
        );
        if (!archive.reachable) {
            reachable = false;
        }
        if (archive.entry) {
            // The dashboard will never carry an archived course, and a forced
            // refresh replaces the dashboard layer wholesale. Without this the
            // exercise the student is actually working in disappears from the
            // picker on the next refresh, and the archive probe never runs
            // again because the registry still matches the folder.
            courseCatalog?.upsertSupplemental({ kind: 'course', entry: archive.entry }, epoch);
            registry.registerFromCourseData(archive.entry);
            detected = findExerciseByRepositoryUrl(repositoryUrl, registry.getAllExercises());
        }
    }

    if (!detected) {
        if (!reachable) {
            logger.irisChat('Workspace detection could not reach the server');
            return { kind: 'unavailable' };
        }
        logger.irisChat('No exercise matches the workspace remote');
        callbacks.clearStaleWorkspaceContext();
        return { kind: 'no-match' };
    }

    if (detected.courseId === undefined) {
        // Not registered at all. Flagging it as the workspace exercise would
        // set `workspaceExerciseId`, and `isColdStart` requires that to be
        // null: the student would get the ordinary chat shell with an empty
        // "Choose a course" header instead of the cold-start chooser, for an
        // exercise that can never be opened anyway.
        logger.irisChat(`Workspace exercise ${detected.id} has no course; not usable`);
        callbacks.clearStaleWorkspaceContext();
        return { kind: 'no-match' };
    }

    logger.irisChat(`Detected workspace exercise: ${detected.title} (ID: ${detected.id})`);

    callbacks.registerExercise({
        id: detected.id,
        title: detected.title,
        shortName: detected.shortName,
        courseId: detected.courseId,
        repositoryUri: detected.repositoryUri,
    });
    return { kind: 'matched', exerciseId: detected.id, courseId: detected.courseId };
}

export async function detectAndRegisterWorkspaceExercise(
    artemisApiService: ArtemisApiService | undefined,
    callbacks: WorkspaceRegistrationCallbacks,
    exerciseRegistry: ExerciseRegistry,
    courseCatalog?: CourseCatalog,
    // Injected so the no-remote branch is testable. `getWorkspaceRepositoryUrl`
    // is called module-locally, so sinon cannot intercept it through the module
    // object; a default parameter is the smallest honest seam.
    resolveRepositoryUrl: () => Promise<string | null> = getWorkspaceRepositoryUrl,
): Promise<DetectionOutcome> {
    try {
        const repositoryUrl = await resolveRepositoryUrl();
        if (!repositoryUrl) {
            // Conclusive and server-independent: this folder is not an Artemis
            // exercise checkout. It must stay `no-match` even when the dashboard
            // is also unreachable, or every non-exercise window would offer a
            // Retry for a server that has nothing to do with the answer.
            logger.irisChat('No git remote in the workspace; not an exercise folder');
            callbacks.clearStaleWorkspaceContext();
            return { kind: 'no-match' };
        }
        return await detectWorkspaceExerciseForRepository(
            repositoryUrl, artemisApiService, callbacks, exerciseRegistry, courseCatalog,
        );
    } catch (error) {
        // `noImplicitReturns` makes this mandatory, and the conservative answer
        // is the right one: an unexpected failure is not evidence of absence.
        logger.irisChatWarn('Workspace detection failed unexpectedly', error);
        return { kind: 'unavailable' };
    }
}
