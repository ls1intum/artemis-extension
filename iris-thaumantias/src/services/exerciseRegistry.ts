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

    public registerFromCourseData(courseData: any): void {
        const exercises = courseData?.course?.exercises || courseData?.exercises || [];
        const courseId = courseData?.course?.id ?? courseData?.id;

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
                    exercise.shortName,
                    courseId
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

    public getAllExercises(): ExerciseRegistryEntry[] {
        return Array.from(this.exercises.values());
    }

    public clear(): void {
        this.exercises.clear();
    }
}
