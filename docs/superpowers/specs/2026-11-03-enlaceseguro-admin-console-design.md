# Diseño: consola web de administración EnlaceSeguro

**Estado:** especificación aprobada por el usuario; habilitada la implementación con Vite + React/TypeScript, tokens en memoria y estilo EnlaceSeguro.

## Objetivo

Crear una consola web independiente de la app móvil para que administradores revisen métricas agregadas y eventos de auditoría. La consola consume solo `/auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/me`, `/admin/metrics` y `/admin/audit-events`. La autorización real permanece en Fastify; ocultar controles en UI no sustituye el rol admin.

## Decisiones aprobadas

- **Framework:** Vite + React + TypeScript en `frontend/admin-console/`, separado de Expo móvil.
- **Sesión:** tokens en memoria; no `localStorage`, `sessionStorage`, IndexedDB, cookies ni persistencia URL. Al recargar se inicia sesión de nuevo. Refresh token, si se usa para rotación dentro de la pestaña, permanece solo en memoria. Sin registro de administradores.
- **Estilo:** interfaz oscura EnlaceSeguro derivada del tema móvil/Figma: azul tinta, superficies azul pizarra, acento cobalt, IBM Plex Sans, estados semánticos y densidad propia de una herramienta operativa. No afirmar fidelidad pixel-perfect porque faltan medidas de rampas, radios y espaciado en el Figma disponible.
- **Origen API:** `VITE_API_BASE_URL` explícita; no construir endpoints desde entrada del usuario. CORS API desactivado por defecto y allowlist exacta `CORS_ALLOWED_ORIGINS` en deployment.

## Navegación y flujos

1. **Acceso:** formulario email/contraseña; nunca almacenar credenciales. Tras login, consultar `/auth/me`; solo `role=admin` entra. Cuenta normal recibe mensaje de acceso denegado y logout local.
2. **Resumen:** selector de rango `startDate`/`endDate` (días civiles inclusivos en `America/Mexico_City`). Default: primer día del mes actual hasta hoy en esa zona. Métricas muestran total de intentos, estado de procesamiento y distribución de veredictos usando exclusivamente la respuesta de API. Cero datos se presentan como cero; error no se disfraza como cero.
3. **Auditoría:** mismo rango de fecha, filtro opcional `eventType` y paginación cursor opaco. No se inventan filtros actor/URL ni se construyen/modifican cursores. La tabla muestra fecha local, tipo, resultado, actor, acción, recurso, requestId y metadatos que entrega API; detalle expandible preserva procedencia. Sin almacenar ni emitir valores sensibles en logs del navegador.
4. **Sesión:** botones salir y expiración explícitos. Ante 401 se limpia memoria y se regresa a acceso; ante 403 se muestra acceso denegado. Los errores de red/5xx tienen retry manual y no fabrican datos.

## Dirección visual

- Composición de consola: navegación lateral persistente, cabecera de contexto/rango, resumen de métricas arriba y panel de auditoría tabular. En pantallas pequeñas, sidebar pasa a navegación compacta.
- Jerarquía visual: fondo profundo `#0A1220`, superficies separadas, texto frío legible, cifras tabulares, cobalt para acciones y ámbar/menta/coral solo para estados observados. Reusar los anclajes comprobados de Figma y tokens móviles donde aplique; estilos auxiliares siguen marcados como aproximaciones.
- Filtros visibles y accesibles, foco de teclado, contraste, encabezados semánticos, tabla desplazable, `aria-live` para carga/error. Animación discreta y no bloqueante; `prefers-reduced-motion` respetado.
- No mostrar captura, URL analizada, datos de proveedores o métricas no presentes en el contrato.

## Seguridad y privacidad

- Solo HTTPS en despliegues; `CORS_ALLOWED_ORIGINS` con origen web exacto. No cookies ni CORS con credenciales.
- Bearer en memoria y cabecera Authorization; el cliente de red centraliza expiración, refresh en memoria, redacción y cancelación de solicitudes.
- Validar fechas civiles antes de solicitar; no alterar `nextCursor`. Autorización admin se vuelve a exigir en cada endpoint.
- No persistir correos, IDs o eventos en telemetría/errores del navegador. Evitar copiar cuerpos completos de auditoría a consola de desarrollo.

## Alcance inicial y aceptación

- Login admin, gate de rol, dashboard de métricas, filtros y auditoría con cursor.
- Pruebas de cliente para Bearer, 401/403, token no persistido, refresh/error, fechas `America/Mexico_City`, filtro de tipo y cursor sin modificación; pruebas de componente para loading/empty/error y teclado/responsive.
- `npm run lint`, `typecheck`, pruebas y `build` de producción. Verificar visualmente en escritorio y viewport móvil antes de considerar el carril G3-ADMIN implementado.
- Fuera de alcance: gestión de usuarios, exportación, filtros no incluidos en contrato, asignación de roles, almacenamiento de sesión persistente, deployment/hosting y cambios a los endpoints existentes.

## Pendientes

- Definir después el origen de hosting real y configurar CORS en staging. El origen productivo sigue sin elegirse.
- La consola no consumirá ni mostrará referencias internas de capturas.
