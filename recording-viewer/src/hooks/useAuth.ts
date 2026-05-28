import { useState, useEffect, useCallback } from 'react';

export type ViewerRole = 'rater' | 'researcher';

export interface AuthStatus {
    authenticated: boolean;
    authRequired: boolean;
    allowWrite: boolean;
    role: ViewerRole | undefined;
    raterName: string | undefined;
}

export type LoginInput =
    | { mode: 'rater'; token: string; raterName: string }
    | { mode: 'researcher'; token: string };

export interface UseAuthResult {
    status: AuthStatus | null;
    login: (input: LoginInput) => Promise<{ ok: true } | { ok: false; error: string }>;
    logout: () => Promise<void>;
    refresh: () => Promise<void>;
}

export function useAuth(): UseAuthResult {
    const [status, setStatus] = useState<AuthStatus | null>(null);

    const refresh = useCallback((): Promise<void> => {
        return fetch('/api/auth/status', { credentials: 'include' })
            .then(res => {
                if (!res.ok) {
                    setStatus({ authenticated: false, authRequired: true, allowWrite: false, role: undefined, raterName: undefined });
                    return;
                }
                return res.json().then((json: Partial<AuthStatus>) => {
                    setStatus({
                        authenticated: !!json.authenticated,
                        authRequired: !!json.authRequired,
                        allowWrite: !!json.allowWrite,
                        role: json.role,
                        raterName: json.raterName,
                    });
                });
            })
            .catch(() => {
                setStatus({ authenticated: false, authRequired: true, allowWrite: false, role: undefined, raterName: undefined });
            });
    }, []);

    useEffect(() => { void refresh(); }, [refresh]);

    const login = useCallback(async (input: LoginInput) => {
        try {
            const body = input.mode === 'rater'
                ? { token: input.token, raterName: input.raterName }
                : { token: input.token };
            const res = await fetch('/api/auth/login', {
                method: 'POST', credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            if (res.ok) { await refresh(); return { ok: true } as const; }
            const json = await res.json().catch(() => ({}));
            const errMsg = typeof json?.error === 'string' ? json.error : `HTTP ${res.status}`;
            return { ok: false, error: errMsg } as const;
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
