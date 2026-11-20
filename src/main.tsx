import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { applyThemePref, loadThemePref } from './lib/theme.ts';
import '@fontsource-variable/newsreader/opsz.css';
import '@fontsource-variable/instrument-sans';
import './styles.css';

// Apply a stored day/night choice before the first render to avoid a flash of the other theme.
applyThemePref(loadThemePref());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
