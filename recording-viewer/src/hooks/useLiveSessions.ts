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
                        setIds(prev => {
                            const ids = json.sessions.map(s => s.id);
                            if (prev.size === ids.length && ids.every(id => prev.has(id))) return prev;
                            return new Set(ids);
                        });
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
