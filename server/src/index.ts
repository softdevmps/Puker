/** Punto de entrada: levanta el servidor y lo apaga con prolijidad. */

import { config } from './config.js';
import { createPukerServer } from './server.js';

const server = createPukerServer();

const port = await server.listen(config.port, config.host);

console.log(`\n  Puker escuchando en http://localhost:${port}`);
if (!server.servingClient) {
  console.log('  Cliente en desarrollo: http://localhost:5173');
}
console.log(`  Base de datos: ${config.databaseFile}`);
console.log(`  Login con Google: ${config.google.enabled ? 'activado' : 'desactivado'}`);
console.log(
  `  Voz: STUN ${config.voice.stunUrls.length} servidor(es), TURN ${
    config.voice.turnUrls.length > 0 && config.voice.turnSecret ? 'configurado' : 'SIN configurar'
  }`,
);
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
