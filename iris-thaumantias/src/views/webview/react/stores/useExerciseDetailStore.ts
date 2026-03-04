import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { postCommand, type VsCodeApi } from '../../../../shared/messageContracts';
import type {
    ExerciseDetailsResponse,
    ParticipationSummary,
    ResultSummary,
    SubmissionSummary,
} from '../../../../types/apiResponses';

interface RepoStatus {
    isConnected: boolean;
    hasChanges: boolean;
    isGradedRepo: boolean;
}

interface SubmissionResult {
    success: boolean;
    error?: string;
}

interface DirtyPagesStatus {
    hasDirtyPages: boolean;
    dirtyFileCount: number;
    autoSaveEnabled: boolean;
}

interface ExerciseDetailState {
    exerciseData: ExerciseDetailsResponse | null;
    hideDeveloperTools: boolean;
    isLoading: boolean;

    // Submission processing
    pendingSubmission: { state: string; participationId: number; buildTimingInfo?: unknown } | null;

    // Extension→Webview response state
    repoStatus: RepoStatus | null;
    submissionResult: SubmissionResult | null;
    clonedNotice: string | null;
    dirtyPagesStatus: DirtyPagesStatus | null;

    // Actions
    setExerciseData: (data: ExerciseDetailsResponse, hideDeveloperTools: boolean) => void;
    setLoading: (loading: boolean) => void;
    loadExerciseDetail: (vscodeApi: VsCodeApi, exerciseId: number) => void;
    updateBuildStatus: (payload: ResultSummary) => void;
    updateSubmission: (payload: SubmissionSummary) => void;
    updateSubmissionProcessing: (payload: { state: string; participationId: number; buildTimingInfo?: unknown }) => void;
    setRepoStatus: (status: RepoStatus) => void;
    setSubmissionResult: (result: SubmissionResult) => void;
    setClonedNotice: (exerciseTitle: string) => void;
    setDirtyPagesStatus: (status: DirtyPagesStatus) => void;
    clearSubmissionResult: () => void;
    clearClonedNotice: () => void;
    clearPendingSubmission: () => void;
}

/**
 * Helper to find participation by result or submission ID.
 * Mimics the legacy resolveParticipationForResult logic.
 */
function findParticipationForResult(
    exerciseData: ExerciseDetailsResponse,
    result: ResultSummary
): ParticipationSummary | null {
    if (!exerciseData?.exercise?.studentParticipations) {
        return null;
    }

    for (const participation of exerciseData.exercise.studentParticipations) {
        if (participation.results) {
            const foundResult = participation.results.find((r) => r.id === result.id);
            if (foundResult) {
                return participation;
            }
        }
    }

    return null;
}

export const useExerciseDetailStore = create<ExerciseDetailState>()(
    devtools(
        (set, get) => ({
            exerciseData: null,
            hideDeveloperTools: false,
            isLoading: false,
            pendingSubmission: null,
            repoStatus: null,
            submissionResult: null,
            clonedNotice: null,
            dirtyPagesStatus: null,

            setExerciseData: (data, hideDeveloperTools) => {
                set({
                    exerciseData: data,
                    hideDeveloperTools,
                    isLoading: false,
                    pendingSubmission: (data.pendingSubmission as { state: string; participationId: number; buildTimingInfo?: unknown }) ?? null,
                }, false, 'setExerciseData');
            },

            setLoading: (loading) => {
                set({ isLoading: loading }, false, 'setLoading');
            },

            loadExerciseDetail: (vscodeApi, exerciseId) => {
                set({ isLoading: true }, false, 'loadExerciseDetail');
                postCommand(vscodeApi, 'reloadExerciseDetail', { exerciseId });
            },

            updateBuildStatus: (payload) => {
                const state = get();
                if (!state.exerciseData) {
                    return;
                }

                // payload is the newResult data
                const result = payload;

                const updatedData = structuredClone(state.exerciseData);

                // Find participation: match by participationId first, then by result ID, then fallback
                let participation: ParticipationSummary | null = null;
                if (result.participationId && updatedData.exercise?.studentParticipations) {
                    participation = updatedData.exercise.studentParticipations.find(
                        p => p.id === result.participationId
                    ) ?? null;
                }
                if (!participation) {
                    participation = findParticipationForResult(updatedData, result);
                }
                if (!participation && updatedData.exercise?.studentParticipations?.length) {
                    participation = updatedData.exercise.studentParticipations[0];
                }

                if (participation) {
                    // Update or add result
                    if (!participation.results) {
                        participation.results = [];
                    }

                    const existingIndex = participation.results.findIndex((r) => r.id === result.id);
                    if (existingIndex >= 0) {
                        participation.results[existingIndex] = result;
                    } else {
                        participation.results.push(result);
                    }
                }

                set({ exerciseData: updatedData }, false, 'updateBuildStatus');
            },

            updateSubmission: (payload) => {
                const state = get();
                if (!state.exerciseData) {
                    return;
                }

                // payload is the newSubmission data
                const submission = payload;

                const updatedData = structuredClone(state.exerciseData);

                // Find participation by participationId first, then fallback to first
                let participation: ParticipationSummary | undefined;
                if (submission.participationId && updatedData.exercise?.studentParticipations) {
                    participation = updatedData.exercise.studentParticipations.find(
                        (p: ParticipationSummary) => p.id === submission.participationId
                    );
                }
                if (!participation && updatedData.exercise?.studentParticipations?.length) {
                    participation = updatedData.exercise.studentParticipations[0];
                }

                if (participation) {
                    // Update or add submission
                    if (!participation.submissions) {
                        participation.submissions = [];
                    }

                    const existingIndex = participation.submissions.findIndex((s: SubmissionSummary) => s.id === submission.id);
                    if (existingIndex >= 0) {
                        participation.submissions[existingIndex] = submission;
                    } else {
                        participation.submissions.push(submission);
                    }
                }

                set({ exerciseData: updatedData }, false, 'updateSubmission');
            },

            updateSubmissionProcessing: (payload) => {
                const state = get();
                if (!state.exerciseData) {
                    return;
                }

                // Guard: only accept events for participations belonging to this exercise
                const match = state.exerciseData.exercise?.studentParticipations?.find(
                    (p) => p.id === payload.participationId
                );
                if (!match) {
                    return;
                }

                set({ pendingSubmission: payload }, false, 'updateSubmissionProcessing');
            },

            setRepoStatus: (status) => {
                set({ repoStatus: status }, false, 'setRepoStatus');
            },

            setSubmissionResult: (result) => {
                set({ submissionResult: result }, false, 'setSubmissionResult');
            },

            setClonedNotice: (exerciseTitle) => {
                set({ clonedNotice: exerciseTitle }, false, 'setClonedNotice');
            },

            setDirtyPagesStatus: (status) => {
                set({ dirtyPagesStatus: status }, false, 'setDirtyPagesStatus');
            },

            clearSubmissionResult: () => {
                set({ submissionResult: null }, false, 'clearSubmissionResult');
            },

            clearClonedNotice: () => {
                set({ clonedNotice: null }, false, 'clearClonedNotice');
            },

            clearPendingSubmission: () => {
                set({ pendingSubmission: null }, false, 'clearPendingSubmission');
            },
        }),
        {
            name: 'ExerciseDetailStore',
            enabled: process.env.NODE_ENV === 'development',
        }
    )
);
