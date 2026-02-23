/**
 * ExerciseDetail view exports.
 * Includes main view, types, and extracted components for Phase 5 reuse.
 */

export { ExerciseDetailView } from './ExerciseDetailView';
export type { ExerciseDetailViewProps } from './types';

// Re-export extracted components for external use
export { ProblemStatement, ScoreInfo, TestResults } from './components';
export type {
    ProblemStatementProps,
    ScoreInfoProps,
    TestResultsProps,
    TestCase,
} from './types';
