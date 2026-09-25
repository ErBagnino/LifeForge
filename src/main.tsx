import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import './styles/index.css';

// Ask the browser not to evict our IndexedDB under storage pressure (best effort; ignored where unsupported).
void navigator.storage?.persist?.().catch(() => false);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
