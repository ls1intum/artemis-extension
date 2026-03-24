import { ListItem } from '../../../components/ListItem/ListItem';
import { Badge } from '../../../components/Badge/Badge';
import { getIcon } from '../../../utils/iconMap';
import type { ExerciseDetail } from '../../../../shared/messageContracts';
import styles from './ExerciseList.module.css';

interface ExerciseListProps {
    exercises: ExerciseDetail[];
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
                const ExerciseIcon = getIcon(exercise.type);

                return (
                    <ListItem
                        key={exercise.id}
                        onClick={() => onExerciseClick(index)}
                        selected={isWorkspace}
                    >
                        <div className={styles.exerciseHeader}>
                            <span className={styles.exerciseNumber}>Exercise {index + 1}</span>
                            <span className={styles.exerciseTitle}>{exercise.title || 'Untitled'}</span>
                            <span className={styles.exerciseTypeIcon}>
                                <ExerciseIcon size={16} />
                            </span>
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
