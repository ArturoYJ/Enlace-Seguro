# Infraestructura y Servicios de Ejecución

## Servicio Sandbox Aislado (`sandbox/`)
- Servicio HTTP independiente desarrollado en Node.js 22 + TypeScript + Fastify, escuchando en el puerto `3001`.
- Gestiona un pool configurable de contextos de navegador efímeros mediante Playwright (`chromium`).
- **Defensas Anti-SSRF:**
  - Inspección estricta de esquemas (`http:` y `https:` exclusivamente).
  - Bloqueo en preflight e in-flight de rangos IPv4 privados (RFC 1918), loopback (`127.0.0.0/8`), link-local y metadatos de nube (`169.254.169.254`), y rangos IPv6 locales/reservados (`::1`, `fc00::/7`, `fe80::/10`).
  - Intercepción de todas las peticiones secundarias y redirecciones en el navegador (`context.route`).
- **Aislamiento y mitigación:**
  - Contextos limpios por análisis: cookies y almacenamiento no compartidos.
  - Permisos revocados (`permissions: []`), descargas canceladas y diálogos bloqueados.
  - Timeout de navegación de 15 segundos.
  - Capturas de pantalla almacenadas de forma opaca y referenciadas sin exponer el sistema de archivos.
