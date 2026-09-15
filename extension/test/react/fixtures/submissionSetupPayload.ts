import type { ExtMsg } from '@shared/messageContracts';
import type { SubmissionSetupSnapshot } from '@shared/types/submissionSetup';

/** A snapshot where every check passes, as the default for tests that care about one row. */
export function createSubmissionSetupSnapshot(
    overrides?: Partial<SubmissionSetupSnapshot>,
): SubmissionSetupSnapshot {
    return {
        git: { state: 'ok', version: '2.45.1' },
        identity: { state: 'ok', name: 'Test User', email: 'test@example.com' },
        repository: { state: 'ok', exerciseTitle: 'Sorting Algorithms', folderName: 'sorting', participationId: 42 },
        access: { state: 'ok', checkedAt: 1_700_000_000_000 },
        ...overrides,
    };
}

export function createSubmissionSetupPayload(
    overrides?: Partial<SubmissionSetupSnapshot>,
): ExtMsg<'submissionSetupInfo'> {
    return {
        type: 'submissionSetupInfo',
        snapshot: createSubmissionSetupSnapshot(overrides),
    };
}
