# Entrega académica — demo local de EnlaceSeguro

**Alcance aprobado:** demo local y gratuita, cinco días, México. No requiere nube ni criterios de producción.

**Avance verificado (2026-11-05):** API/worker/Sandbox y consola pasaron pruebas locales; Mongo disposable/integración y fixtures del flujo real pasan. Admin Chromium, lint, typecheck y 94 pruebas móviles pasan. APK Android ARM64 SDK 58 fue generado y verificado; no probado en dispositivo. A las 15:34 UTC, el smoke completo pasó (fixtures, E2E admin, API/worker/Sandbox sobre MongoDB replica set desechable, migraciones, TTL y backup/restore). A las 15:36 UTC, Sandbox inspeccionó directamente `https://example.com` y respondió HTTP 200 con `sin_amenazas_detectadas` y sin señales; a las 15:38 UTC, `https://expired.badssl.com/` devolvió `inconclusive`/`tls_certificate_invalid`, con señal de validación TLS y sin veredicto ni captura. Son pruebas directas del Sandbox, no garantía de seguridad ni prueba del flujo API/app. La purga local en dry-run reportó `eligible: 0`, `deleted: 0`, `skipped: 2`, sin borrar archivos. También comprobé que `reset` sin `--confirm` rechaza con código 2 y preserva el volumen; no ejecuté la variante destructiva. Revisé los cuatro `.env.local`: están ignorados por Git, el token Sandbox coincide, el límite API/migración es 20, CORS y binds son locales y el móvil usa la IP LAN. Mongo local estaba healthy, API/Sandbox healthy, Metro SDK 58 respondía y consola servía HTTP 200. A las 16:05 UTC, `npx expo whoami` confirmó sesión CLI como `arturolz`; Metro primero registró que Expo Go no estaba autenticado. A las 16:10 UTC, Metro recibió la solicitud iOS y terminó `iOS Bundled 6254ms ... (1492 modules)`. Después, el usuario confirmó en iPhone bienvenida, registro de una cuenta exclusiva de demostración, inicio de sesión y navegación; también informó que al analizar el enlace de prueba vio “sin amenazas detectadas” y que el análisis se guardó en el historial. Indicó que la interfaz se ve igual que en la simulación, sin aportar capturas para una comparación visual independiente con Figma. Más tarde confirmó que “Cerrar sesión” lo devuelve a la pantalla de inicio de sesión y que VoiceOver anuncia el campo de enlace y los botones Analizar, Historial y Cerrar sesión. Estos son reportes manuales del usuario; el mensaje de análisis no garantiza seguridad. Falta validar recuperación/expiración de sesión, QA visual contra Figma y el resto de accesibilidad (foco, tamaño de texto, contraste y otros estados). Ver [runbook local](../operations/local-demo-runbook.md).

## Qué se entregará

- API, worker, MongoDB 8 y Sandbox Playwright ejecutados localmente.
- Consola admin en el navegador local.
- App iOS abierta en el iPhone del propietario con Expo Go.
- APK Android compilado localmente e instalable, pero no probado en dispositivo.
- Flujo: registro/inicio de sesión, pegar URL pública, analizar, ver resultado e historial. Administración local con métricas y auditoría.

## Plan de cinco días

1. **Día 1 — Arranque local:** configurar variables, Mongo y Sandbox; comprobar health checks y una prueba API↔worker↔Chromium. No usar infraestructura externa.
2. **Día 2 — Flujos web/backend:** probar registro, login, análisis de URL pública, resultado e historial; abrir y validar consola admin.
3. **Día 3 — iPhone:** configurar `EXPO_PUBLIC_API_URL` con IP LAN del Mac, ejecutar Expo Go en el iPhone y verificar el flujo principal en la misma Wi-Fi. Corregir solo bloqueos de demo.
4. **Día 4 — Android:** reproducir el build APK local y validar firma, manifest y bundle incluido. No afirmar prueba de instalación o UI Android.
5. **Día 5 — Ensayo:** limpiar datos de demostración, ensayar el recorrido completo, preparar URL(s) públicas seguras y conservar APK, capturas y pasos de arranque.

## Criterio mínimo de aceptación

- El recorrido API/worker/Sandbox termina con un resultado honesto y aparece en historial.
- La app funciona en iPhone contra servicios locales por LAN.
- La consola admin inicia sesión y carga métricas/auditoría locales.
- El APK Android se verifica como instalable, pero se etiqueta **no probado en dispositivo**.
- No se muestran proveedores de reputación, no se promete que una URL sea segura y no se filtra información personal en logs.

## No es parte de esta entrega

PaaS/nube, publicación en tiendas, compartir enlaces desde otras apps, reputación externa, operación pública, escala, SLO, RPO/RTO, alta disponibilidad, restore administrado, CI remota obligatoria, E2E Android en dispositivo o pruebas de carga.

## APK Android demo actual

El APK está en `frontend/mobile/android/app/build/outputs/apk/release/app-release.apk`: 47 MiB, solo ARM64, package `com.anonymous.enlaceseguro`, target SDK 36, firma debug v2. El bundle contiene la URL LAN configurada durante el build y el manifest permite HTTP local para esta demo. No fue instalado ni probado en dispositivo; revisa que la IP LAN siga vigente. No distribuir en tiendas. Para producción usa HTTPS, retira `usesCleartextTraffic` y una firma release.

## CI remoto — validación

La ejecución [CI de `453cd91`](https://github.com/ArturoYJ/Enlace-Seguro/actions/runs/42065193732) falló en las pruebas Chromium del Sandbox: el runner reportó `No usable sandbox` al iniciar Chromium con `chromiumSandbox: true`. En macOS esas pruebas pasaron localmente (11 aprobadas, 3 omitidas). La causa inmediata es la falta de un sandbox Chromium utilizable en ese runner; no se ha confirmado la configuración de AppArmor/user namespaces que la provoca. No desactivar el sandbox para obtener un CI verde. Los pasos posteriores del workflow no se ejecutaron en esa corrida.

La [ejecución de `022f7d6`](https://github.com/ArturoYJ/Enlace-Seguro/actions/runs/42075712330) pasó completa con Chromium sandbox habilitado, pruebas de egress y contenedor hardened. Se fijó temporalmente Ubuntu 22.04; GitHub prevé retirarlo en abril de 2027, por lo que debe migrarse a un runner soportado antes de esa fecha. La configuración DNS sintética de Envoy usa permisos de lectura para el usuario no root del contenedor.
