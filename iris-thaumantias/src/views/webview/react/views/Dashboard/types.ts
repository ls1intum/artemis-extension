import type { VsCodeApi } from '../../../../../shared/messageContracts';

export type { RecentCourseNode, Exercise } from '../../../../../shared/messageContracts';

export interface DashboardViewProps {
    vscodeApi: VsCodeApi;
}

export interface DashboardPersistedState {
    // Dashboard data is always re-fetched, so no persisted state needed
}
