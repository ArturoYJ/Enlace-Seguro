# Consola administrativa — EnlaceSeguro

Aplicación separada en Vite + React/TypeScript para consultar métricas y eventos de auditoría de la API. No administra usuarios ni consulta Sandbox directamente. Su diseño es una interpretación del sistema visual móvil; la paridad con Figma y la revisión visual de escritorio/móvil siguen pendientes.

## Desarrollo local

Requiere Node.js 22.12 o posterior compatible con Vite. Instala con `npm ci`, copia `.env.example` a `.env.local` y configura `VITE_API_BASE_URL` con el origen y prefijo `/api/v1` de la API. Solo desarrollo admite HTTP loopback; los builds desplegados exigen HTTPS. En la API, configura el origen exacto de la consola en `CORS_ALLOWED_ORIGINS`; no habilites wildcard o credenciales CORS.

```sh
npm ci
npm run dev
npm run typecheck
npm run lint
npm test
npm run build
```

## E2E de navegador

`npm run test:e2e` corre Chromium real contra la app Vite, el API fixture y una base MongoDB 8 desechable. El flujo valida login admin, gate, CORS, métricas, auditoría y que recargar descarte la sesión en memoria. Axe-core revisa WCAG A/AA en login, resumen y auditoría, en desktop y viewport móvil de 390 px; también se comprueba que las vistas móviles no desborden horizontalmente. `ADMIN_E2E_SCREENSHOT_DIR=/ruta/local` guarda capturas de esas seis vistas para inspección visual. En el API fixture, el usuario sintético `admin@enlaceseguro.example.test` solo se crea si `E2E_SEED_ADMIN=true`; sus credenciales fijas son exclusivamente de prueba. El fixture rechaza URI Mongo remota y base que no siga el patrón de E2E. No agregamos una ruta pública de seed.

La CI prepara Mongo replica set migrada 001–005, inicia el fixture en `127.0.0.1:3000`, configura `VITE_API_BASE_URL=http://127.0.0.1:3000/api/v1` y permite exactamente `http://127.0.0.1:4173` en CORS. La ejecución local requiere preparar esas mismas condiciones, instalar Chromium con `npx playwright install chromium` y levantar Vite en el puerto 4173. Las comprobaciones Axe no sustituyen revisión manual con teclado/lector de pantalla ni paridad contra Figma; este E2E no valida hosting ni producción.

`npm test` incluye una comprobación axe-core de reglas estructurales WCAG A/AA para login; `color-contrast` se excluye del test JSDOM porque no ofrece canvas. No sustituye revisión manual/visual de contraste, teclado, focus ni lector de pantalla.

Inicia sesión con una cuenta admin existente y autorizada. El backend verifica rol en cada solicitud. Las credenciales de sesión se conservan únicamente en memoria de la pestaña; se pierden al recargar. El cierre de sesión limpia el estado local inmediatamente e intenta revocar el refresh token. No se almacenan tokens ni credenciales en `localStorage`, `sessionStorage`, cookies o URL. Como en toda aplicación web, esto no protege frente a código malicioso ejecutado en el origen (XSS); la política CSP y el hosting seguro requieren validación de despliegue.

El resumen usa los conteos reales de `/admin/metrics`; auditoría consume `/admin/audit-events`, con fechas civiles inclusivas de `America/Mexico_City`, tipo de evento opcional y cursor opaco. No se muestran capturas ni se inventan datos de fuentes. Las pruebas unitarias y de componente usan respuestas sintéticas; el E2E de navegador usa API/Mongo fixture y datos sintéticos, no datos productivos. No cubre QA visual, accesibilidad completa, aislamiento ni despliegue de producción.
