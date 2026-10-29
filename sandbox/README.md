# EnlaceSeguro — Servicio Sandbox Aislado

Servicio independiente de ejecución y análisis de enlaces sospechosos en navegador aislado con Playwright/Chromium.

## Arquitectura y Controles de Seguridad
1. **Protección Anti-SSRF en Capas:**
   - Preflight estático de esquema (solo `http:` y `https:`).
   - Resolución DNS obligatoria previa con inspección de todas las direcciones IP resultantes.
   - Bloqueo determinista de rangos privados (RFC 1918), loopback (`127.0.0.0/8`), metadatos cloud (`169.254.169.254`) y direcciones IPv6 reservadas.
   - Intercepción continua de red en tiempo de ejecución (`context.route`) para detectar redirecciones hacia IPs privadas.
2. **Ciclo de Vida Efímero:**
   - Cada análisis crea un `BrowserContext` nuevo con permisos vacíos (`permissions: []`).
   - Cero persistencia de cookies, localStorage o credenciales entre ejecuciones.
   - Bloqueo de descargas automáticas (`download.cancel()`) y supresión de alertas/diálogos.
3. **Extracción de Señales y Capturas:**
   - Detección de formularios de contraseñas en conexiones no cifradas (HTTP).
   - Detección de iframes ocultos y envíos de formularios cross-origin.
   - Registro de saltos de redirección HTTP.
   - Captura de pantalla de la ventana gráfica almacenada localmente de forma opaca (`local://captures/{attemptId}.webp`).
