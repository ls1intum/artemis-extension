import { useState, type FormEvent } from 'react';
import type { LoginInput } from '../hooks/useAuth';

interface Props {
    onLogin: (input: LoginInput) => Promise<{ ok: true } | { ok: false; error: string }>;
}

type Mode = 'rater' | 'researcher';

export function LoginScreen({ onLogin }: Props) {
    const [mode, setMode] = useState<Mode>('rater');
    const [token, setToken] = useState('');
    const [raterName, setRaterName] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        const trimmedToken = token.trim();
        if (!trimmedToken) return;
        if (mode === 'rater' && !raterName.trim()) {
            setError('Rater name is required');
            return;
        }
        setSubmitting(true);
        setError(null);
        const input: LoginInput = mode === 'rater'
            ? { mode, token: trimmedToken, raterName: raterName.trim() }
            : { mode, token: trimmedToken };
        const result = await onLogin(input);
        setSubmitting(false);
        if (!result.ok) setError(result.error);
    };

    return (
        <div className="login-screen">
            <form onSubmit={handleSubmit} className="login-form">
                <h1>Iris Live Viewer</h1>
                <div className="login-mode-toggle" role="tablist">
                    <button
                        type="button" role="tab" aria-selected={mode === 'rater'}
                        className={mode === 'rater' ? 'active' : ''}
                        onClick={() => setMode('rater')} disabled={submitting}
                    >Rater</button>
                    <button
                        type="button" role="tab" aria-selected={mode === 'researcher'}
                        className={mode === 'researcher' ? 'active' : ''}
                        onClick={() => setMode('researcher')} disabled={submitting}
                    >Researcher</button>
                </div>
                <p>
                    {mode === 'rater'
                        ? 'Enter your rater name and the access token configured on the recording laptop.'
                        : 'Enter the researcher token configured on the recording laptop.'}
                </p>
                {mode === 'rater' && (
                    <input
                        type="text" value={raterName}
                        onChange={(e) => setRaterName(e.target.value)}
                        placeholder="Your name"
                        autoComplete="off" disabled={submitting}
                        aria-label="Rater name"
                    />
                )}
                <input
                    type="password" value={token}
                    onChange={(e) => setToken(e.target.value)}
                    placeholder="Access token"
                    autoFocus={mode === 'researcher'}
                    autoComplete="off" disabled={submitting}
                    aria-label="Access token"
                />
                <button type="submit" disabled={submitting || !token.trim() || (mode === 'rater' && !raterName.trim())}>
                    {submitting ? 'Authenticating...' : 'Connect'}
                </button>
                {error && <div className="login-error" role="alert">{error}</div>}
            </form>
        </div>
    );
}
