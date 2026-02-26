import { logger } from './loggingService';

export interface ExerciseRegistryEntry {
    id: number;
    title: string;
    repositoryUri: string;
    shortName?: string;
    courseId?: number;
}

export class ExerciseRegistry {
    private static instance: ExerciseRegistry;
    private exercises: Map<number, ExerciseRegistryEntry> = new Map();

    static getInstance(): ExerciseRegistry {
        if (!ExerciseRegistry.instance) {
            ExerciseRegistry.instance = new ExerciseRegistry();
        }
        return ExerciseRegistry.instance;
    }

    public registerExercise(id: number, title: string, repositoryUri: string, shortName?: string, courseId?: number): void {
        this.exercises.set(id, { id, title, repositoryUri, shortName, courseId });
    }

    /**
     * Clears all exercises belonging to a specific course.
     * This should be called before re-registering exercises from fresh course data
     * to ensure deleted exercises are removed from the registry.
     */
    public clearCourse(courseId: number): void {
        const toDelete: number[] = [];
        for (const [exerciseId, entry] of this.exercises) {
            if (entry.courseId === courseId) {
                toDelete.push(exerciseId);
            }
        }
        for (const id of toDelete) {
            this.exercises.delete(id);
        }
        if (toDelete.length > 0) {
            logger.exercise(`Cleared ${toDelete.length} exercises for course ${courseId}`);
        }
    }

    public registerFromCourseData(courseData: unknown): void {
        const data = courseData as { course?: { id?: number; exercises?: unknown[] }; exercises?: unknown[]; id?: number };
        const exercises = data?.course?.exercises || data?.exercises || [];
        const courseId = data?.course?.id ?? data?.id;

        // Clear existing exercises for this course before registering fresh data
        // This ensures deleted exercises are properly removed from the registry
        if (courseId !== undefined && courseId !== null) {
            this.clearCourse(courseId);
        }

        let registeredCount = 0;
        const registered: string[] = [];
        const skipped: string[] = [];

        for (const exercise of exercises) {
            const ex = exercise as {
                id?: number;
                title?: string;
                shortName?: string;
                studentParticipations?: Array<{ repositoryUri?: string }>
            };
            const participations = ex.studentParticipations || [];

            if (participations.length > 0 && participations[0].repositoryUri && ex.id && ex.title) {
                this.registerExercise(
                    ex.id,
                    ex.title,
                    participations[0].repositoryUri,
                    ex.shortName,
                    courseId
                );
                registeredCount++;
                registered.push(`${ex.id}: ${ex.title}`);
            } else {
                skipped.push(`${ex.id ?? 'unknown'}: ${ex.title ?? 'unknown'} (no repo URI)`);
            }
        }

        logger.exercise(`Processed ${exercises.length} exercises: ${registeredCount} registered, ${skipped.length} skipped. Total in registry: ${this.exercises.size}`);
        if (registered.length > 0) {
            logger.exercise(`✅ Registered: ${registered.join(', ')}`);
        }
        if (skipped.length > 0 && skipped.length <= 3) {
            logger.exercise(`⏭️  Skipped: ${skipped.join(', ')}`);
        } else if (skipped.length > 3) {
            logger.exercise(`⏭️  Skipped ${skipped.length} exercises (no repository URIs)`);
        }
    }

    public getAllExercises(): ExerciseRegistryEntry[] {
        return Array.from(this.exercises.values());
    }

    public clear(): void {
        this.exercises.clear();
    }

    /**
     * Reset the singleton instance for testing purposes.
     * This should only be used in test files to ensure clean state between tests.
     */
    public static resetForTesting(): void {
        ExerciseRegistry.instance = undefined as unknown as ExerciseRegistry;
    }
}
