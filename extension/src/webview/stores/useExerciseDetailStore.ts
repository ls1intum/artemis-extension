import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

import { postCommand, type ProactiveCardReason, type ProactiveCardState, type ProactiveLevel, type VsCodeApi } from '@shared/messageContracts';
import type {
    ExerciseDetailsResponse,
    ParticipationSummary,
    PendingSubmissionStatus,
    ResultSummary,
    SubmissionSummary,
} from '@shared/types/apiResponses';

interface RepoStatus {
    isConnected: boolean;
    hasChanges: boolean;
    isPracticeRepo: boolean;
}

/** AskIris proactive control + its §14 availability card, tagged with the exercise it belongs to (spec §12.2). */
type ProactiveControlState = {
    exerciseId: number;
    level: ProactiveLevel;
    cardState: ProactiveCardState;
    reason?: ProactiveCardReason;
    proactiveControlAvailable: boolean;
};

interface DirtyPagesStatus {
    hasDirtyPages: boolean;
    dirtyFileCount: number;
    autoSaveEnabled: boolean;
}

// Alias for webview callers importing this name. Canonical source of truth:
// @shared/types/apiResponses.
export type PendingSubmissionInfo = PendingSubmissionStatus;

interface ExerciseDetailState {
    exerciseData: ExerciseDetailsResponse | null;
    hideDeveloperTools: boolean;
    isLoading: boolean;
    error: string | null;

    /**
     * Pending build statuses keyed by `participation.id`. The view picks the
     * entry that matches the participation it has selected (graded vs.
     * practice).
     */
    pendingSubmissionsByParticipationId: Record<number, PendingSubmissionStatus>;

    repoStatus: RepoStatus | null;
    clonedNotice: { exerciseTitle: string; participationId: number } | null;
    dirtyPagesStatus: DirtyPagesStatus | null;
    /** AskIris proactive Off/Less/More control + availability card (spec §12.2 / §14), tagged with its exercise so a late update can't paint the wrong card. */
    proactiveControl: ProactiveControlState | null;

    setExerciseData: (data: ExerciseDetailsResponse, hideDeveloperTools: boolean, repoStatus?: RepoStatus) => void;
    setError: (error: string | null) => void;
    setLoading: (loading: boolean) => void;
    loadExerciseDetail: (vscodeApi: VsCodeApi, exerciseId: number) => void;
    updateBuildStatus: (payload: ResultSummary) => void;
    updateSubmission: (payload: SubmissionSummary) => void;
    updateSubmissionProcessing: (payload: PendingSubmissionStatus) => void;
    setRepoStatus: (status: RepoStatus) => void;
    setClonedNotice: (exerciseTitle: string, participationId: number) => void;
    setDirtyPagesStatus: (status: DirtyPagesStatus) => void;
    setProactiveControl: (control: ProactiveControlState | null) => void;
    clearClonedNotice: () => void;
    /** Clear all pending entries (e.g. on result arrival without per-participation context). */
    clearPendingSubmission: () => void;
}

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
            pendingSubmissionsByParticipationId: {},
            repoStatus: null,
            clonedNotice: null,
            dirtyPagesStatus: null,
            proactiveControl: null,

            setExerciseData: (data, hideDeveloperTools, repoStatus) => {
                set({
                    exerciseData: data,
                    hideDeveloperTools,
                    isLoading: false,
                    error: null,
                    // Reset the proactive control on every exercise load so the next exercise never shows the
                    // previous one's badge while its fresh state is re-requested (spec §12.2).
                    proactiveControl: null,
                    // Always reset to the freshly-loaded map (or `{}` if the
                    // server didn't supply one). Keeping stale entries across
                    // a reload would let an already-finished build keep
                    // displaying "in progress" on the next exercise open.
                    pendingSubmissionsByParticipationId:
                        data.pendingSubmissionsByParticipationId ?? {},
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

                const updatedData = structuredClone(state.exerciseData);

                let participation: ParticipationSummary | null = null;
                if (payload.participationId && updatedData.exercise?.studentParticipations) {
                    participation = updatedData.exercise.studentParticipations.find(
                        p => p.id === payload.participationId
                    ) ?? null;
                }
                if (!participation) {
                    participation = findParticipationForResult(updatedData, payload);
                }
                if (!participation) {
                    return;
                }

                // Results live on submission.results in Artemis.
                const submissions = participation.submissions ?? [];
                const latestSubmission = [...submissions]
                    .sort((a, b) => (b.id ?? 0) - (a.id ?? 0))[0];

                if (latestSubmission) {
                    if (payload.buildFailed !== undefined) {
                        latestSubmission.buildFailed = payload.buildFailed;
                    }
                    if (!latestSubmission.results) {
                        latestSubmission.results = [];
                    }
                    if (payload.id !== null && payload.id !== undefined) {
                        const existingIndex = latestSubmission.results.findIndex((r) => r.id === payload.id);
                        if (existingIndex >= 0) {
                            latestSubmission.results[existingIndex] = payload;
                        } else {
                            latestSubmission.results.push(payload);
                        }
                    } else {
                        latestSubmission.results.push(payload);
                    }
                }

                // Clear the pending entry keyed on `participation.id` (the
                // resolved owner) rather than `payload.participationId`, so a
                // mismatched payload cannot delete an unrelated key. Other
                // participations' pending builds are unaffected.
                const clearedParticipationId = participation.id;
                const nextPending = { ...state.pendingSubmissionsByParticipationId };
                if (clearedParticipationId !== undefined) {
                    delete nextPending[clearedParticipationId];
                }

                set({
                    exerciseData: updatedData,
                    pendingSubmissionsByParticipationId: nextPending,
                }, false, 'updateBuildStatus');
            },

            updateSubmission: (payload) => {
                const state = get();
                if (!state.exerciseData) {
                    return;
                }

                const updatedData = structuredClone(state.exerciseData);

                let participation: ParticipationSummary | undefined;
                if (payload.participationId && updatedData.exercise?.studentParticipations) {
                    participation = updatedData.exercise.studentParticipations.find(
                        (p: ParticipationSummary) => p.id === payload.participationId
                    );
                }
                if (!participation) {
                    return;
                }

                if (!participation.submissions) {
                    participation.submissions = [];
                }

                const existingIndex = participation.submissions.findIndex((s: SubmissionSummary) => s.id === payload.id);
                if (existingIndex >= 0) {
                    participation.submissions[existingIndex] = payload;
                } else {
                    participation.submissions.push(payload);
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

                set({
                    pendingSubmissionsByParticipationId: {
                        ...state.pendingSubmissionsByParticipationId,
                        [payload.participationId]: payload,
                    },
                }, false, 'updateSubmissionProcessing');
            },

            setRepoStatus: (status) => {
                set({ repoStatus: status }, false, 'setRepoStatus');
            },

            setClonedNotice: (exerciseTitle, participationId) => {
                set({ clonedNotice: { exerciseTitle, participationId } }, false, 'setClonedNotice');
            },

            setDirtyPagesStatus: (status) => {
                set({ dirtyPagesStatus: status }, false, 'setDirtyPagesStatus');
            },

            setProactiveControl: (control) => {
                set({ proactiveControl: control }, false, 'setProactiveControl');
            },

            clearClonedNotice: () => {
                set({ clonedNotice: null }, false, 'clearClonedNotice');
            },

            clearPendingSubmission: () => {
                set({ pendingSubmissionsByParticipationId: {} }, false, 'clearPendingSubmission');
            },
        }),
        {
            name: 'ExerciseDetailStore',
            enabled: process.env.NODE_ENV === 'development',
        }
    )
);
