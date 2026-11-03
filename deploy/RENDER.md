# Publicar Puker en Render

La raíz contiene `render.yaml`: prepara un único Web Service de Node 24,
con la web, Socket.IO y un disco persistente de 1 GB para SQLite. Esta opción
usa el entorno Node de Render, no el Dockerfile ni Docker Compose.

1. Crear una cuenta en Render y conectar el repositorio privado que contenga
   el código de Puker. No subir la base local ni archivos `.env`.
2. Elegir **New → Blueprint**, seleccionar el repositorio y revisar los recursos
   que propone `render.yaml` antes de confirmar el pago.
3. Usar un workspace Hobby sin cargo de workspace y el servicio pago Starter
   (también llamado `0.5c-512mb`). La referencia consultada es US$7/mes para
   ese servicio y US$0,25/mes por 1 GB de disco, más eventuales excedentes e
   impuestos. Confirmar siempre el precio que muestre Render.
4. Al terminar el despliegue, abrir la dirección HTTPS `*.onrender.com`
   asignada al servicio. Agregar esa dirección completa como `PUBLIC_URL`
   en Environment y aplicar el cambio antes de empezar a jugar.
5. Crear una cuenta, guardar una foto y un alias y probar una partida con
   tres cuentas. La cuenta `admin` de la computadora no se copia al servidor.
6. Cuando termine la prueba, reiniciar el servicio y comprobar que el perfil
   y el historial sobreviven. Verificar también `/api/health`.

## Si las cuentas se borran en cada despliegue

Quiere decir que el archivo SQLite no está sobre el disco persistente, así que
se va junto con el contenedor anterior. En el log de arranque se ve:

    Base de datos: /var/data/puker.db · 7 cuentas

Si en cada despliegue dice `0 cuentas (creada recién)`, revisar en este orden:

1. **Cómo se creó el servicio.** Si se hizo con **New → Web Service** en vez de
   **New → Blueprint**, Render ignora `render.yaml` por completo: no adjunta el
   disco ni define las variables. Hay que crearlo como Blueprint, o agregar a
   mano el disco en `/var/data` y la variable `DATABASE_FILE`.
2. **Que el disco exista.** En el servicio, pestaña *Disks*: tiene que haber uno
   montado en `/var/data`. El plan Free no admite discos.
3. **Que `DATABASE_FILE` apunte adentro del disco**, o sea `/var/data/puker.db`.
   Desde esta versión el servidor no arranca en producción si falta la variable,
   justamente para no borrar cuentas sin avisar.

Recrear el servicio crea un disco nuevo y vacío: para conservar las cuentas hay
que bajar el archivo antes (*Shell* del servicio) o volver a empezar de cero.

El plan Free no sirve para conservar esta SQLite: no admite discos persistentes.
No agregar PostgreSQL: esta configuración ya guarda cuentas, fotos e historial
en el disco adjunto. Mantener una sola instancia.

Los despliegues automáticos quedan desactivados para que un cambio de código
no reinicie una partida. Las mesas en curso todavía no se recuperan después
de un reinicio, aunque la base permanezca. Publicar actualizaciones entre partidas.

El juego y el chat no requieren TURN. Para que la voz funcione entre redes
que bloquean conexiones directas, configurar un proveedor TURN aparte.

Documentación:

- [Blueprints](https://render.com/docs/blueprint-spec)
- [Discos persistentes](https://render.com/docs/disks)
- [WebSockets](https://render.com/docs/websocket)
- [Precios](https://render.com/pricing)
