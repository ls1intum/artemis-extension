import { useEffect } from 'react';
import type { AnnotationLabel, StruggleLevel, ContextMarker } from '../types';

const STRUGGLE_KEYS: Record<string, StruggleLevel> = {
    '1': 'confident', '2': 'light-struggle', '3': 'medium-struggle', '4': 'high-struggle', '5': 'blocked',
};
const CONTEXT_KEYS: Record<string, ContextMarker> = {
    'q': 'idle', 'w': 'trial-error', 'e': 'reading', 'r': 'off-task', 't': 'using-ai',
};

export function useLiveHotkeys(enabled: boolean, onLabel: (label: AnnotationLabel) => void): void {
    useEffect(() => {
        if (!enabled) return;
        const handler = (e: KeyboardEvent) => {
            if (e.repeat) return;
            const target = e.target as HTMLElement | null;
            if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
            if (e.metaKey || e.ctrlKey || e.altKey) return;
            const key = e.key.toLowerCase();
            const struggle = STRUGGLE_KEYS[key];
            if (struggle) { e.preventDefault(); onLabel(struggle); return; }
            const ctx = CONTEXT_KEYS[key];
            if (ctx) { e.preventDefault(); onLabel(ctx); }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [enabled, onLabel]);
}
