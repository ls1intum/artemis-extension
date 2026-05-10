import { useState, type FormEvent } from 'react';

interface Props {
    onLogin: (token: string) => Promise<{ ok: true } | { ok: false; error: string }>;
}

export function LoginScreen({ onLogin }: Props) {
    const [token, setToken] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        if (!token.trim()) return;
        setSubmitting(true);
        setError(null);
        const result = await onLogin(token.trim());
        setSubmitting(false);
        if (!result.ok) setError(result.error);
    };

    return (
        <div className="login-screen">
            <form onSubmit={handleSubmit} className="login-form">
                <h1>Iris Live Viewer</h1>
                <p>Enter the access token configured on the recording laptop.</p>
                <input
                    type="password"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    placeholder="Access token"
                    autoFocus
                    autoComplete="off"
                    disabled={submitting}
                />
                <button type="submit" disabled={submitting || !token.trim()}>
                    {submitting ? 'Authenticating...' : 'Connect'}
                </button>
                {error && <div className="login-error" role="alert">{error}</div>}
            </form>
        </div>
    );
}
