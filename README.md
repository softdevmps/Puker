# Puker ♠ ♥ ♦ ♣

Texas Hold'em por navegador para jugar con amigos, desde la compu o el celular.
Sin plata real, sin cuentas, sin instalar nada: creás una mesa, pasás el código
de 4 letras y se sientan.

## Arrancar en 30 segundos

```bash
npm install
npm run dev
```

Abrí **http://localhost:5173**. Eso levanta tres procesos a la vez: el compilador
del paquete compartido, el servidor de juego (puerto 3001) y el cliente con
recarga en caliente (puerto 5173).

Para probar con dos jugadores en la misma máquina, abrí la segunda pestaña en una
**ventana de incógnito**: la sesión se guarda en `localStorage`, así que dos
pestañas normales del mismo navegador se reconectan como el *mismo* jugador.

## Jugar con tus amigos

**En la misma red (casa, wifi compartida).** Al arrancar, Vite imprime algo como
`Network: http://192.168.0.165:5173/`. Esa dirección la pueden abrir desde el
celular estando en la misma red. No hace falta nada más.

**Por internet.** Hay dos caminos:

1. **Túnel rápido**, para una partida suelta sin deployar nada:

   ```bash
   npm run build
   npm start                        # queda sirviendo todo en el puerto 3001
   npx cloudflared tunnel --url http://localhost:3001
   ```

   Te da una URL pública temporal. Pasala y listo.

2. **Deploy**, si querés que la mesa esté siempre disponible. `npm run build`
   deja el cliente compilado y `npm start` levanta un único proceso de Node que
   sirve la web *y* los websockets. Eso funciona tal cual en Render, Railway,
   Fly.io o un VPS:

   - Build: `npm install && npm run build`
   - Start: `npm start`
   - El puerto se toma de la variable `PORT` (por defecto 3001)

   Importante: tiene que ser un servicio con **websockets** y **una sola
   instancia**. El estado vive en memoria, así que varias réplicas detrás de un
   balanceador se pelearían por las mesas.

## Cómo está armado

```
shared/   Motor puro, sin dependencias: cartas, evaluador de manos, botes
          laterales y el contrato de tipos entre cliente y servidor.
server/   Express + Socket.IO. La máquina de estados de la mesa vive acá.
client/   React + Vite. Solo pinta lo que recibe y manda intenciones.
```

La decisión de fondo: **el servidor es la única autoridad**. El cliente nunca
sabe las cartas ajenas (no están "ocultas con CSS": directamente no se mandan),
no calcula ganadores y no decide si una apuesta es válida. `getStateFor(playerId)`
en [server/src/table.ts](server/src/table.ts) es el único lugar que decide qué ve
cada jugador, y la validación de acciones está toda en `act()` y `legalActions()`.

El mazo se mezcla con el CSPRNG del sistema (`node:crypto`), no con
`Math.random`, cuyo estado es predecible.

## Reglas implementadas

- Texas Hold'em sin límite, con ciegas chica y grande.
- Reglas de posición correctas, incluido el **mano a mano**: ahí el botón pone la
  ciega chica y habla primero preflop, pero último del flop en adelante.
- Subida mínima = apuesta actual + la última subida completa.
- **All-in y botes laterales**: quien va all-in por menos solo puede ganar la
  parte que cubrió. Un all-in que no llega a subida completa no reabre la ronda
  para quien ya había igualado.
- Devolución de la apuesta no igualada (si subís y todos se van, vuelve el
  excedente).
- Empates: se parte el bote, y las fichas que no se pueden dividir van al primero
  a la izquierda del botón.
- Reloj por turno con auto-check si es gratis y auto-fold si hay que pagar.

## Qué pasa si se corta internet

La sesión se guarda con un token en `localStorage`. Si recargás, cerrás el
navegador o se te va la señal en el celular, al volver entrás al mismo asiento
con tus fichas. El asiento se guarda **90 segundos**; pasado ese tiempo te levanta
de la mesa. Mientras tanto, el reloj del turno te hace fold automático para no
trabar a los demás.

Las salas viven en memoria y se borran solas cuando quedan vacías. Si reiniciás el
servidor, se pierden las mesas: es a propósito, para que el proyecto no necesite
base de datos.

## Scripts

| Comando | Qué hace |
| --- | --- |
| `npm run dev` | Los tres procesos de desarrollo |
| `npm test` | Los 43 tests (motor, mesa e integración por sockets) |
| `npm run build` | Compila todo para producción |
| `npm start` | Sirve web + juego en un solo proceso |
| `npm run typecheck` | Chequeo de tipos de los tres paquetes |

## Tests

Son la parte que más conviene no romper, porque el motor de poker tiene muchos
casos de borde silenciosos:

- **Evaluador**: cada categoría de mano, la escalera `A-2-3-4-5`, desempates por
  kicker, y un fuzz de 5000 manos de 7 cartas que verifica que la mano elegida se
  reproduce al evaluarla sola y que ninguna otra combinación le gana.
- **Botes**: botes laterales con varios all-in y el invariante de que las fichas
  no se pierden ni se inventan.
- **Mesa**: ciegas, orden de habla, timeouts, abandono en medio de la mano, y un
  fuzz que juega cientos de manos con acciones al azar verificando el cuadre de
  fichas después de cada una.
- **Integración**: levanta el servidor real y lo maneja con clientes de Socket.IO,
  incluyendo la reconexión con token y el rechazo de acciones fuera de turno.

## Ideas para seguir

- Variar las ciegas con el tiempo (formato torneo).
- Historial de manos para revisar la jugada anterior.
- Mostrar quién ganó más en la noche.
- Guardar las mesas en SQLite para que sobrevivan a un reinicio.
