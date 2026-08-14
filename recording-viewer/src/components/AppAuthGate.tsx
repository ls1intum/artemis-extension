import { useAuth } from '../hooks/useAuth';
import { LoginScreen } from './LoginScreen';
import { RecordingViewerApp } from '../App';

/**
 * Top-level auth wrapper. Decides between LoginScreen, the main app, or a
 * loading placeholder. Crucially, it does NOT call hooks conditionally:
 * `RecordingViewerApp` is its own component, so hook order in it is independent.
 */
export function AppAuthGate() {
    const auth = useAuth();
    if (auth.status == null) {
        return <div className="loading-screen">Loading…</div>;
    }
    if (auth.status.authRequired && !auth.status.authenticated) {
        return <LoginScreen onLogin={auth.login} />;
    }
    return <RecordingViewerApp authStatus={auth.status} />;
}
