# Puker ♠ ♥ ♦ ♣

Texas Hold'em por navegador para jugar con amigos, desde la compu o el celular.
Con cuentas, ranking histórico, chat de texto y **voz en vivo**. Sin plata real:
solo fichas.

## Arrancar en desarrollo

```bash
npm install
npm run dev
```

Abrí **http://localhost:5173**. Eso levanta tres procesos: el compilador del
paquete compartido, el servidor de juego (puerto 3001) y el cliente con recarga
en caliente (5173). No hace falta configurar nada: la base se crea sola en
`data/puker.db` y el login con Google queda desactivado hasta que le pongas
credenciales.

Para probar con dos jugadores en la misma máquina, la segunda pestaña tiene que
ser una **ventana de incógnito**: la sesión vive en una cookie, así que dos
pestañas normales son el mismo jugador.

## Jugar con tus amigos

**En la misma red.** Vite imprime al arrancar una dirección tipo
`Network: http://192.168.0.165:5173/`. Esa la pueden abrir desde el celular.
Ojo: **la voz no va a funcionar por IP**, porque el navegador exige HTTPS para
dar acceso al micrófono. El juego y el chat sí.

**Por internet.** Mirá la sección de deploy más abajo.

## Cómo está armado

```
shared/   Motor puro, sin dependencias: cartas, evaluador de manos, botes
          laterales y el contrato de tipos entre cliente y servidor.
server/   Express + Socket.IO + SQLite. La máquina de estados vive acá.
client/   React + Vite. Solo pinta lo que recibe y manda intenciones.
deploy/   Caddyfile y certificados para producción.
```

La decisión de fondo: **el servidor es la única autoridad**. El cliente nunca
sabe las cartas ajenas (no están "ocultas con CSS": directamente no se mandan),
no calcula ganadores y no decide si una apuesta es válida. `getStateFor()` en
[server/src/table.ts](server/src/table.ts) es el único lugar que decide qué ve
cada jugador.

El mazo se mezcla con el CSPRNG del sistema (`node:crypto`), no con
`Math.random`, cuyo estado es predecible.

### Qué se guarda y qué no

| Vive en memoria (se pierde al reiniciar) | Vive en SQLite (sobrevive) |
| --- | --- |
| Mesas en curso, fichas de la partida, cartas | Cuentas, sesiones, resultado de cada mano |

Es a propósito: una partida interrumpida no vale la pena persistirla, pero el
ranking sí.

La base usa **`node:sqlite`**, el SQLite que ya viene en Node 24. Eso evita
`better-sqlite3` y con él toda compilación nativa: la imagen de Docker no
necesita toolchain de C y en Windows no hay nada que compilar.

## Cuentas y contraseñas

Se puede entrar de dos formas, y una cuenta puede tener las dos:

- **Usuario y contraseña.** Hasheadas con **scrypt** (N=2^16, ~64 MB por hash),
  que es una función *memory-hard*: encarece muchísimo el ataque por fuerza
  bruta con GPUs. Está entre las recomendadas por OWASP. Se usa la variante
  asíncrona a propósito: la sincrónica bloquearía el event loop ~100 ms y
  congelaría la partida de todos mientras alguien hace login.
- **Google.** Flujo de código de autorización; el `client_secret` nunca toca el
  navegador. Si no configurás credenciales, el botón simplemente no aparece.

La sesión va en una **cookie httpOnly**, no en `localStorage`: así un XSS no
puede robarla. En la base solo se guarda el *hash* del token de sesión.

El login tiene límite de 8 intentos fallidos por usuario+IP cada 10 minutos, y
el registro 20 por hora por IP (alto a propósito: los amigos de una misma casa
salen todos por la misma IP).

> Una cosa para tener presente: desde el momento en que guardás contraseñas sos
> responsable de ellas, y la gente reutiliza contraseñas entre sitios. Si esto
> va a estar expuesto a internet, usá el login con Google cuando puedas.

## Voz

El audio va **directo entre los navegadores** (WebRTC en malla). El servidor
solo hace dos cosas: entregar la lista de servidores ICE y pasar mensajes para
que dos navegadores se encuentren. El audio nunca lo toca.

Eso da la mínima latencia posible y costo de ancho de banda casi cero. Funciona
bien hasta unas 6-8 personas: con 6, cada uno sube unos 200 kbps (cinco
streams). Más arriba habría que pasar a un servidor de medios (SFU).

Para evitar que dos navegadores se manden oferta a la vez hay una regla simple:
**el que llega después es el que ofrece**. Así cada par tiene un único iniciador.

Dos requisitos que no se pueden saltear:

1. **HTTPS.** El navegador bloquea el micrófono en HTTP plano. Por eso el deploy
   incluye Caddy.
2. **Un servidor TURN.** Entre el 10% y el 25% de las conexiones no logran
   conectar directo, y el caso típico es un amigo con datos móviles: las
   operadoras usan CGNAT de forma masiva. El `docker-compose` incluye `coturn`
   en la misma máquina **a propósito**: si el relay queda lejos (por ejemplo en
   Europa), las llamadas que caigan en él se van a más de 250 ms y se vuelven
   incómodas. Sin TURN el juego anda igual, pero la voz le va a fallar a algunos
   y la app lo avisa en pantalla.

## Deploy

El objetivo: un VPS chico (2 vCPU / 2 GB alcanza de sobra) con Docker. Para
jugar desde Argentina conviene una región cercana como São Paulo, sobre todo
por el TURN.

```bash
# 1. En el VPS, con el repo clonado
cp .env.example .env

# 2. Generá los dos secretos
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # SESSION_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # TURN_SECRET

# 3. Completá .env (DOMAIN, PUBLIC_URL, SERVER_IP y los dos secretos)
nano .env

# 4. Apuntá el dominio a la IP del VPS (registro A) y levantá todo
docker compose up -d --build
```

Caddy saca y renueva el certificado solo. Después de eso, `https://tu-dominio`
ya sirve el juego con voz funcionando.

**Puertos a abrir en el firewall:**

| Puerto | Protocolo | Para qué |
| --- | --- | --- |
| 80, 443 | TCP | Web y certificados |
| 3478, 5349 | TCP + UDP | TURN (negociación y relay) |
| 49160-49200 | UDP | Rango de relay de coturn |

**Si querés login con Google:** creá credenciales en
[console.cloud.google.com/apis/credentials](https://console.cloud.google.com/apis/credentials)
(tipo "Aplicación web") y poné como URI de redirección autorizada exactamente
`https://tu-dominio/api/auth/google/callback`.

**Importante:** tiene que ser **una sola instancia**. El estado de las mesas vive
en memoria, así que varias réplicas detrás de un balanceador se pelearían por
las partidas. Tampoco sirve un servicio que duerma por inactividad: tus amigos
abrirían el link y no pasaría nada durante un minuto.

### Respaldo

Toda la data está en un único archivo. Para copiarlo sin corromperlo:

```bash
docker compose exec puker node -e "
  const { DatabaseSync } = require('node:sqlite');
  new DatabaseSync('/data/puker.db').exec(\"VACUUM INTO '/data/backup.db'\");
"
docker compose cp puker:/data/backup.db ./backup-$(date +%F).db
```

## Reglas implementadas

- Texas Hold'em sin límite, con ciegas chica y grande.
- Reglas de posición correctas, incluido el **mano a mano**: ahí el botón pone la
  ciega chica y habla primero preflop, pero último del flop en adelante.
- Subida mínima = apuesta actual + la última subida completa.
- **All-in y botes laterales**: quien va all-in por menos solo puede ganar la
  parte que cubrió. Un all-in que no llega a subida completa no reabre la ronda
  para quien ya había igualado.
- Si alguien queda all-in al poner la ciega, el turno lo saltea en vez de
  trabarse esperándolo.
- Devolución de la apuesta no igualada.
- Empates: se parte el bote, y las fichas indivisibles van al primero a la
  izquierda del botón.
- Reloj por turno con auto-check si es gratis y auto-fold si hay que pagar.

## Ranking

Una fila por jugador por mano, de donde sale todo lo demás:

- **Fichas netas**: lo ganado menos lo apostado, acumulado en todas las mesas.
  La suma de toda la tabla siempre da cero (lo que gana uno lo pierde otro).
- **Manos jugadas y ganadas**, con porcentaje.
- **La mejor mano** con la que ganaste un bote.

Cuenta como mano jugada toda aquella en la que recibiste cartas, aunque te
hayas retirado sin pagar ciega.

## Qué pasa si se corta internet

La sesión está atada a la cuenta, así que reconectar es automático: volvés al
mismo asiento con tus fichas. El asiento se guarda **90 segundos**; mientras
tanto el reloj del turno te hace fold automático para no trabar a los demás.

## Scripts

| Comando | Qué hace |
| --- | --- |
| `npm run dev` | Los tres procesos de desarrollo |
| `npm test` | Los 52 tests |
| `npm run build` | Compila todo para producción |
| `npm start` | Sirve web + juego en un solo proceso |
| `npm run typecheck` | Chequeo de tipos de los tres paquetes |

## Tests

Son la parte que más conviene no romper, porque el motor de poker tiene muchos
casos de borde silenciosos. De hecho el fuzz ya encontró un bug real: con stacks
cortos, si la ciega chica quedaba all-in al postear en mano a mano, la mesa se
trababa apuntando a alguien que no podía actuar.

- **Evaluador**: cada categoría, la escalera `A-2-3-4-5`, desempates por kicker,
  y un fuzz de 5000 manos de 7 cartas que verifica que la mano elegida se
  reproduce al evaluarla sola y que ninguna otra combinación le gana.
- **Botes**: botes laterales con varios all-in, y el invariante de que las fichas
  no se pierden ni se inventan.
- **Mesa**: ciegas, orden de habla, timeouts, abandono en medio de la mano, y un
  fuzz de 40 partidas (mezclando stacks largos con stacks de 2-3 ciegas) que
  verifica el cuadre de fichas después de cada mano.
- **Integración**: levanta el servidor real y lo maneja con clientes de Socket.IO
  autenticados por cookie. Cubre registro, login, reconexión, rechazo de
  acciones fuera de turno, el ranking y la señalización de voz.

## Ideas para seguir

- Ciegas que suben con el tiempo (formato torneo).
- Historial de manos para revisar la jugada anterior.
- Estadísticas por sesión además del acumulado.
- Pasar a un SFU si alguna vez son más de 8 en la mesa.
