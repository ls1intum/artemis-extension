import { ListItem } from '../../../components/ListItem/ListItem';
import { Badge } from '../../../components/Badge/Badge';
import { IconDefinitions } from '../../../../../../utils/iconDefinitions';
import styles from './ExerciseList.module.css';

interface Exercise {
    id: number;
    title?: string;
    type?: string;
    maxPoints?: number;
}

interface ExerciseListProps {
    exercises: Exercise[];
    workspaceExerciseId: number | null;
    onExerciseClick: (index: number) => void;
}

/**
 * List of exercises in an exam with workspace highlighting.
 */
export function ExerciseList({
    exercises,
    workspaceExerciseId,
    onExerciseClick
}: ExerciseListProps) {
    return (
        <div className={styles.exerciseList}>
            {exercises.map((exercise, index) => {
                const isWorkspace = exercise.id === workspaceExerciseId;
                const icon = IconDefinitions.getIcon(exercise.type || 'default');

                return (
                    <ListItem
                        key={exercise.id}
                        onClick={() => onExerciseClick(index)}
                        selected={isWorkspace}
                    >
                        <div className={styles.exerciseHeader}>
                            <span className={styles.exerciseNumber}>Exercise {index + 1}</span>
                            <span className={styles.exerciseTitle}>{exercise.title || 'Untitled'}</span>
                            <span
                                className={styles.exerciseTypeIcon}
                                dangerouslySetInnerHTML={{ __html: icon }}
                            />
                        </div>
                        <div className={styles.exerciseInfo}>
                            <span>{exercise.maxPoints || 0} Points</span>
                            {exercise.type && <Badge variant="muted">{exercise.type}</Badge>}
                            {isWorkspace && (
                                <Badge variant="info">Open</Badge>
                            )}
                        </div>
                    </ListItem>
                );
            })}
        </div>
    );
}
