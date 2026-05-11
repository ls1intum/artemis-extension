import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppAuthGate } from './components/AppAuthGate';
import './index.css';
import './App.css';

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <AppAuthGate />
    </StrictMode>,
);
