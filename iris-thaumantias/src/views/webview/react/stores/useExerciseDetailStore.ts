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
    isPracticeRepo: boolean;
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
    error: string | null;

    // Submission processing
    pendingSubmission: { state: string; participationId: number; buildTimingInfo?: unknown } | null;

    // Extension→Webview response state
    repoStatus: RepoStatus | null;
    clonedNotice: string | null;
    dirtyPagesStatus: DirtyPagesStatus | null;

    // Actions
    setExerciseData: (data: ExerciseDetailsResponse, hideDeveloperTools: boolean, repoStatus?: RepoStatus) => void;
    setError: (error: string | null) => void;
    setLoading: (loading: boolean) => void;
    loadExerciseDetail: (vscodeApi: VsCodeApi, exerciseId: number) => void;
    updateBuildStatus: (payload: ResultSummary) => void;
    updateSubmission: (payload: SubmissionSummary) => void;
    updateSubmissionProcessing: (payload: { state: string; participationId: number; buildTimingInfo?: unknown }) => void;
    setRepoStatus: (status: RepoStatus) => void;
    setClonedNotice: (exerciseTitle: string) => void;
    setDirtyPagesStatus: (status: DirtyPagesStatus) => void;
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
        // Results live on submission.results in Artemis
        for (const submission of participation.submissions ?? []) {
            if (submission.results?.some((r) => r.id === result.id)) {
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
            isLoading: true,
            error: null,
            pendingSubmission: null,
            repoStatus: null,
            clonedNotice: null,
            dirtyPagesStatus: null,

            setExerciseData: (data, hideDeveloperTools, repoStatus) => {
                set({
                    exerciseData: data,
                    hideDeveloperTools,
                    isLoading: false,
                    error: null,
                    pendingSubmission: (data.pendingSubmission as { state: string; participationId: number; buildTimingInfo?: unknown }) ?? null,
                    repoStatus: repoStatus ?? null,
                    clonedNotice: null,
                    dirtyPagesStatus: null,
                }, false, 'setExerciseData');
            },

            setError: (error) => {
                set({ error, isLoading: false }, false, 'setError');
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
                if (!participation) {
                    set({ pendingSubmission: null }, false, 'updateBuildStatus');
                    return;
                }

                if (participation) {
                    // Results live on submission.results in Artemis
                    // Find the latest submission (highest ID) and update its results
                    const submissions = participation.submissions ?? [];
                    const latestSubmission = [...submissions]
                        .sort((a, b) => (b.id ?? 0) - (a.id ?? 0))[0];

                    if (latestSubmission) {
                        if (!latestSubmission.results) {
                            latestSubmission.results = [];
                        }
                        const existingIndex = latestSubmission.results.findIndex((r) => r.id === result.id);
                        if (existingIndex >= 0) {
                            latestSubmission.results[existingIndex] = result;
                        } else {
                            latestSubmission.results.push(result);
                        }
                    }
                }

                set({ exerciseData: updatedData, pendingSubmission: null }, false, 'updateBuildStatus');
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
                if (!participation) {
                    return;
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

            setClonedNotice: (exerciseTitle) => {
                set({ clonedNotice: exerciseTitle }, false, 'setClonedNotice');
            },

            setDirtyPagesStatus: (status) => {
                set({ dirtyPagesStatus: status }, false, 'setDirtyPagesStatus');
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
