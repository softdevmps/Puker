import { createRoot } from 'react-dom/client';

import { App } from './App';
import './styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('No se encontró el nodo #root');

// Sin StrictMode a propósito: el doble montaje de desarrollo duplica los
// handshakes del socket y vuelve difícil de leer el flujo de reconexión.
createRoot(container).render(<App />);
