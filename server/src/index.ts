/** Punto de entrada: levanta el servidor y lo apaga con prolijidad. */

import { createPukerServer } from './server.js';

const PORT = Number(process.env.PORT ?? 3001);
const HOST = process.env.HOST ?? '0.0.0.0';

const server = createPukerServer();

const port = await server.listen(PORT, HOST);

console.log(`\n  Puker escuchando en http://localhost:${port}`);
if (!server.servingClient) {
  console.log('  Cliente en desarrollo: http://localhost:5173');
}
console.log('');

let closing = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (closing) return;
    closing = true;
    console.log('\nCerrando servidor...');
    const forced = setTimeout(() => process.exit(0), 3000);
    forced.unref();
    void server.close().then(() => process.exit(0));
  });
}
