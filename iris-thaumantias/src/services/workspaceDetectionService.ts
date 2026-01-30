import * as vscode from 'vscode';
import { promisify } from 'util';
import { execFile } from 'child_process';

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
