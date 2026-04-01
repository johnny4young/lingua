/**
 * Web entry point — imports the browser adapter BEFORE React renders
 * so that window.runlang is available when App and its stores initialise.
 */

import './adapter';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import { App } from '../renderer/App';
import '../renderer/index.css';

// Use locally bundled Monaco (avoids CDN dependency in the web build)
loader.config({ monaco });

// Register the Service Worker for offline / PWA support
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('Service Worker registration failed:', err);
    });
  });
}

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
);
