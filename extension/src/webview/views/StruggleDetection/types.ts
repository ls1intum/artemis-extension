import type { VsCodeApi } from '@shared/messageContracts';

export interface StruggleData {
    isStruggling: boolean;
    v: number;
    s: number;
    primaryBoundary: 'FM' | 'FM_PLUS' | 'E4' | 'N1' | 'STATE' | null;
    lastAlertT: number | null;
    isEnabled: boolean;
    developerMode: boolean;
}

export interface StruggleDetectionViewProps {
    vscodeApi: VsCodeApi;
}
