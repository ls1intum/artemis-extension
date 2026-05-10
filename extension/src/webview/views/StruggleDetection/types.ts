import type { VsCodeApi } from '../../../shared/messageContracts';

export interface StruggleData {
    isStruggling: boolean;
    eq: number;
    eqConfidence: 'insufficient' | 'sufficient';
    triggerType?: string;
    recommendedAction: 'none' | 'subtle' | 'notification' | 'proactive';
    isEnabled: boolean;
    developerMode: boolean;
}

export interface StruggleDetectionViewProps {
    vscodeApi: VsCodeApi;
}
