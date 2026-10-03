import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// Interface de jeu : implémentée par l'agent web.
const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <p>AI Reality</p>
    </StrictMode>,
  );
}
