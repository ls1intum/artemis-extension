export interface ExerciseRegistryEntry {
    id: number;
    title: string;
    repositoryUri: string;
    shortName?: string;
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
