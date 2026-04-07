import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { configureMonaco } from './monaco';
import { pluginRegistry } from './plugins';
import { luaPlugin } from './plugins/lua-runner';
import './index.css';

if (!pluginRegistry.get(luaPlugin.id)) {
  pluginRegistry.register(luaPlugin);
}

configureMonaco();

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
);
