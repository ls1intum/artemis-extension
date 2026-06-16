import { STRUGGLE_LABELS, CONTEXT_LABELS } from '../types';
import { CONTEXT_KEYS } from '../hooks/useLiveHotkeys';

const CONTEXT_KEY_BY_VALUE: Record<string, string> = Object.fromEntries(
    Object.entries(CONTEXT_KEYS).map(([key, value]) => [value, key]),
);

/** Keyboard-shortcut legend for annotation hotkeys. Shared between the live
 *  control bar and archive (normal) mode, since the same hotkeys (1–5 struggle,
 *  letters for context) are active in both. */
export function HotkeyLegend() {
    return (
        <div className="live-legend">
            <strong>Struggle:</strong>
            {STRUGGLE_LABELS.map((s, i) => (
                <span key={s.value} style={{ color: s.color }}>{i + 1}={s.label}</span>
            ))}
            <strong>Context:</strong>
            {CONTEXT_LABELS.map(s => (
                <span key={s.value} style={{ color: s.color }}>{CONTEXT_KEY_BY_VALUE[s.value] ?? '?'}={s.label}</span>
            ))}
        </div>
    );
}
