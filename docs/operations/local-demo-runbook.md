# Demo local de EnlaceSeguro

Este procedimiento es para una red privada de confianza, no para producción. La API usa HTTP en la LAN: contraseñas y URLs viajan sin cifrar entre el teléfono y el Mac. Usa cuentas de demostración y contraseñas que no utilices en otros servicios. No analices enlaces con datos personales, tokens ni secretos.

El Sandbox local navega por Internet y **no tiene el aislamiento de red productivo verificado**. Para el ensayo usa únicamente páginas públicas conocidas; no lo expongas fuera del Mac. La salida del Sandbox a un sitio remoto es necesaria para analizarlo.

## Preparar una vez

Desde la raíz del repositorio, con Docker Desktop iniciado y Node 22 instalado:

```sh
npm ci --prefix api
npm ci --prefix sandbox
npm ci --prefix frontend/mobile
npm ci --prefix frontend/admin-console
(cd frontend/admin-console && npx playwright install chromium)
scripts/local/up
scripts/local/configure
scripts/local/migrate
scripts/local/seed-admin
```

La instalación de Playwright se necesita para el smoke de la consola. En este Mac, el Sandbox usa Google Chrome instalado; los requisitos pueden variar en otros sistemas.

`configure` crea los cuatro `.env.local` y secretos sin sobrescribir los existentes. Fija `ANALYSIS_JOB_MAX_PENDING=20`, sincroniza el token API↔Sandbox, permite CORS solo desde `http://localhost:5173` y coloca el endpoint móvil en la IP LAN. Si no detecta la IP Wi-Fi, acepta la IPv4 LAN como argumento. `migrate` solo acepta la base vacía `enlaceseguro_dev`, aplica 001–006 con límite 20 y exige API/worker detenidos; si existe un estado parcial, detente e inspecciónalo: no borra ni continúa automáticamente. `seed-admin` conserva las credenciales locales y verifica el admin existente.

Las credenciales del admin están en `api/.env.admin.local`, archivo privado ignorado por Git. Consúltalo solo en tu computadora; no compartas ni pegues su contenido en chat. La cuenta de usuario de prueba se registra en la app.

## Arrancar para la demo

En terminales separadas, desde la raíz:

```sh
scripts/local/up
scripts/local/sandbox
scripts/local/api
scripts/local/admin
```

Abre la consola en `http://localhost:5173/`, no en `127.0.0.1:5173`: CORS permite el primer origen. Revisa que Sandbox escuche solo en `127.0.0.1:3001`; la API escucha en el puerto 3000 de la LAN para el iPhone.

En otra terminal:

```sh
cd frontend/mobile
npm run start -- --lan --port 8082
```

Conecta el iPhone a la misma Wi‑Fi y escanea el QR desde Expo Go compatible con SDK 58. El archivo `frontend/mobile/.env.local` debe contener `EXPO_PUBLIC_API_URL=http://IP-DEL-MAC:3000/api/v1`. Si cambia la IP, edita únicamente esa línea y reinicia Metro; `configure` no modifica archivos existentes. No uses la dirección `localhost` del teléfono para alcanzar el Mac.

En iPhone físico, Expo requiere iniciar sesión con **la misma cuenta de Expo** en Expo Go y en Expo CLI. En otra terminal, dentro de `frontend/mobile`, ejecuta `npx expo login`; no compartas la contraseña. Después inicia sesión en Expo Go e inténtalo de nuevo. Referencia: https://docs.expo.dev/troubleshooting/expo-go-sign-in-required/.

Si el iPhone no conecta, confirma IP, red, firewall y que `/status` de Metro y `/api/v1/health` respondan. Esas comprobaciones desde el Mac no prueban acceso desde el teléfono.

## Ensayo y verificación

1. Inicia sesión en la consola admin y consulta resumen y auditoría.
2. En el iPhone registra una cuenta de demo, inicia sesión, pega una URL pública conocida y espera el resultado; revisa historial y cuenta.
3. Un resultado sin amenazas detectadas no garantiza seguridad. Si el análisis falla o es inconcluso, no muestres un veredicto inventado.
4. Con los servicios anteriores ejecutándose, `scripts/local/smoke` revisa health, UI admin y la suite de integración con Mongo y fixtures desechables. No sustituye la prueba en el iPhone.

El APK demo actual está en `frontend/mobile/android/app/build/outputs/apk/release/app-release.apk`: Expo SDK 58, solo ARM64, API LAN configurada en `.env.local` al compilar, target Android 36, firma debug (v2). Su SHA-256 actual es `421efcbc195bb040abae4c31330e5fb23680ffde554e4fac2e05f1c3d1a13dd1`. Verifica primero que la IP del Mac no haya cambiado. El paquete fue compilado, pero no se instaló ni probó en dispositivo Android. Para release/producción no reutilizarlo: requiere HTTPS y firma release; elimina `usesCleartextTraffic` y reevalúa minificación.

Para repetir el build en este Mac, con Android SDK y OpenJDK 17 instalados, revisa primero la IP en `frontend/mobile/.env.local`. Después, desde `frontend/mobile/android/`:

```sh
export JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home
export ANDROID_HOME="$HOME/Library/Android/sdk"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a
```

El directorio `android/` es generado e ignorado por Git. En un checkout nuevo debe generarse con Expo prebuild antes del build; ese procedimiento desde cero aún no se ha verificado como parte de esta demo. No uses `--clean` sobre cambios nativos que quieras conservar. Recalcula el SHA-256 y verifica firma, arquitectura y URL LAN después de cada build.

## Purga local de capturas

La retención inicial es de 30 días. Desde `sandbox/`, ejecuta `npm run purge:captures` para simular la purga; sin banderas no borra archivos. Verificado el 2026-11-05: `eligible: 0`, `deleted: 0`, `skipped: 2`. Para borrar capturas vencidas, primero detén Sandbox y confirma que no haya escrituras activas; luego usa `npm run purge:captures -- --execute --writes-paused`. `--writes-paused` es una confirmación del operador, no una detección automática.

## Detener o reiniciar

Detén solo los procesos de demo que tú hayas iniciado. `scripts/local/down` detiene Mongo del proyecto y conserva su volumen; detén antes la API y el worker. No afecta intencionadamente otros proyectos.

**`scripts/local/reset --confirm` elimina el volumen Mongo de este proyecto y sus cuentas/análisis.** Solo úsalo si decides borrar esos datos; requiere que la API esté detenida y no elimina archivos `.env.local` ni credenciales. Después ejecuta `up`, `migrate` y `seed-admin`. Verifiqué la barrera sin `--confirm`: rechazó con código 2, conservó el volumen y la API siguió healthy. La ruta destructiva confirmada aún no ha sido ensayada en un Mongo desechable.
