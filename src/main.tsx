import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import './styles/index.css';

// Ask the browser not to evict our IndexedDB under storage pressure (best effort; ignored where unsupported).
void navigator.storage?.persist?.().catch(() => false);

// Older versions stored a third-party AI key in this browser. AI keys now live only on the
// server (Vercel env var GEMINI_API_KEY), so remove any leftover copy.
try {
  localStorage.removeItem('lf-ai-key');
} catch {
  // storage unavailable
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
