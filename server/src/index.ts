/** Punto de entrada: levanta el servidor y lo apaga con prolijidad. */

import { config } from './config.js';
import { createPukerServer, pinnedOrigin } from './server.js';

const server = createPukerServer();

const port = await server.listen(config.port, config.host);

console.log(`\n  Puker escuchando en http://localhost:${port}`);
if (!server.servingClient) {
  console.log('  Cliente en desarrollo: http://localhost:5173');
}
console.log(
  `  Base de datos: ${config.databaseFile} · ${server.store.countUsers()} cuentas${
    server.store.isNew ? ' (creada recién)' : ''
  }`,
);
if (config.isProduction && server.store.isNew) {
  console.warn(
    '  ATENCIÓN: la base arrancó vacía. Si pasa en cada despliegue, DATABASE_FILE no está\n' +
      '  sobre un disco persistente y las cuentas se pierden cada vez que publicás.',
  );
}
console.log(`  URL pública: ${config.publicUrl}`);
if (config.isProduction && !pinnedOrigin) {
  console.warn(
    '  ATENCIÓN: PUBLIC_URL quedó con la URL de desarrollo. El login con Google no va a\n' +
      '  volver bien y el websocket acepta cualquier origen. Cargá la URL real del sitio.',
  );
}
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
