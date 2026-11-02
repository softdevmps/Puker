# Publicar Puker en Railway

Esta es una alternativa al despliegue con Docker Compose en un VPS. Railway
construye el `Dockerfile` de la raíz y publica la web y el servidor juntos.
No hay que crear un servicio separado para React ni para SQLite.

## Preparar el proyecto

1. Subir el código a un repositorio privado de GitHub. No subir `.env`, bases
   de datos, certificados ni `node_modules`. `.gitignore` y `.dockerignore`
   excluyen esos archivos de Git y del build, respectivamente.
2. En Railway, crear un proyecto conectado a ese repositorio. Usar la raíz
   del repositorio y el `Dockerfile` existente.
3. Antes de usar la aplicación, adjuntar un **Volume** al servicio con ruta
   de montaje `/data`. Es necesario para conservar cuentas, fotos e historial.

## Configurar el servicio

En Variables, cargar:

| Variable | Valor |
| --- | --- |
| `NODE_ENV` | `production` |
| `HOST` | `0.0.0.0` |
| `PORT` | `3001` |
| `DATABASE_FILE` | `/data/puker.db` |
| `SESSION_SECRET` | Un secreto aleatorio generado para esta instalación |
| `RAILWAY_RUN_UID` | `0` |

El último ajuste sigue la indicación de Railway para escribir en volúmenes
montados como root cuando la imagen declara un usuario distinto.

Generar el secreto en tu computadora y pegarlo en Variables, no en el repositorio:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

En Settings:

- Mantener **una sola réplica**: las mesas se coordinan dentro de un proceso.
- Desactivar Serverless/suspensión por inactividad.
- Usar `/api/health` como Healthcheck Path.
- Mantener el comando de inicio del Dockerfile.
- En Networking → Public Networking, seleccionar **Generate Domain** y
  dirigir el dominio al puerto `3001`.
- Agregar `PUBLIC_URL` con esa dirección completa, incluyendo `https://`.

Guardar los ajustes y desplegar. No se necesita comprar un dominio propio.
Google y TURN son opcionales; dejar sus variables sin configurar inicialmente.

## Verificar antes de jugar

1. Abrir la URL HTTPS y comprobar que `/api/health` devuelve `ok: true`.
2. Registrar una cuenta nueva y cargar una foto y un alias. La instalación
   comienza vacía: la cuenta local `admin` no se copia automáticamente.
3. Entrar con tres cuentas desde dispositivos distintos, crear una mesa,
   unirse por código y completar una partida de prueba.
4. Con la mesa de prueba terminada, reiniciar el servicio y comprobar que
   siguen guardados el perfil, la foto, el alias y el historial.
5. Configurar backups del volumen y revisar el consumo del alojamiento.

El volumen conserva la base, pero todavía no recupera una mesa en curso si
el servidor se reinicia. Evitar desplegar cambios durante una partida; revisar
los despliegues automáticos del repositorio para que no interrumpan el juego.
La voz entre algunas redes requiere un servidor TURN externo: este despliegue
del juego no ejecuta el servicio coturn del Docker Compose.

## Documentación oficial

- [Precios y consumo](https://docs.railway.com/pricing/plans)
- [Volúmenes y permisos](https://docs.railway.com/volumes)
- [Dominio público y HTTPS](https://docs.railway.com/networking/public-networking)
- [Backups](https://docs.railway.com/volumes/backups)

El plan Hobby parte de US$5 mensuales e incluye US$5 de consumo. Si el uso
supera ese monto se cobra la diferencia; no es un precio final garantizado.
