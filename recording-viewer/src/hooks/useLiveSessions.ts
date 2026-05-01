import { useEffect, useState } from 'react';

interface LiveSession { id: string; metadata: unknown }

export function useLiveSessions(enabled: boolean, intervalMs = 5_000): Set<string> {
    const [ids, setIds] = useState<Set<string>>(new Set());
    useEffect(() => {
        if (!enabled) {
            queueMicrotask(() => setIds(new Set()));
            return;
        }
        let cancelled = false;
        const tick = (): void => {
            fetch('/api/live/sessions', { credentials: 'include' })
                .then(res => {
                    if (!res.ok || cancelled) return;
                    return res.json().then((json: { sessions: LiveSession[] }) => {
                        if (cancelled) return;
                        setIds(new Set(json.sessions.map(s => s.id)));
                    });
                })
                .catch(() => { /* ignore */ });
        };
        tick();
        const t = setInterval(tick, intervalMs);
        return () => { cancelled = true; clearInterval(t); };
    }, [enabled, intervalMs]);
    return ids;
}
