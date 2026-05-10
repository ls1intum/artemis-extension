import { useState, useEffect, useCallback } from 'react';

export interface AuthStatus { authenticated: boolean; authRequired: boolean; allowWrite: boolean }

export interface UseAuthResult {
    status: AuthStatus | null;
    login: (token: string) => Promise<{ ok: true } | { ok: false; error: string }>;
    logout: () => Promise<void>;
    refresh: () => Promise<void>;
}

export function useAuth(): UseAuthResult {
    const [status, setStatus] = useState<AuthStatus | null>(null);

    const refresh = useCallback((): Promise<void> => {
        return fetch('/api/auth/status', { credentials: 'include' })
            .then(res => {
                if (!res.ok) { setStatus({ authenticated: false, authRequired: true, allowWrite: false }); return; }
                return res.json().then(json => {
                    setStatus({
                        authenticated: !!json.authenticated,
                        authRequired: !!json.authRequired,
                        allowWrite: !!json.allowWrite,
                    });
                });
            })
            .catch(() => {
                setStatus({ authenticated: false, authRequired: true, allowWrite: false });
            });
    }, []);

    useEffect(() => { void refresh(); }, [refresh]);

    const login = useCallback(async (token: string) => {
        try {
            const res = await fetch('/api/auth/login', {
                method: 'POST', credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token }),
            });
            if (res.ok) { await refresh(); return { ok: true } as const; }
            return { ok: false, error: res.status === 401 ? 'Invalid token' : `HTTP ${res.status}` } as const;
        } catch (err) {
            return { ok: false, error: String(err) } as const;
        }
    }, [refresh]);

    const logout = useCallback(async () => {
        await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }).catch(() => {});
        await refresh();
    }, [refresh]);

    return { status, login, logout, refresh };
}
