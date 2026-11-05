# Preparación del carril de consola administrativa

**Estado:** especificación aprobada; consola Vite + React/TypeScript implementada localmente. No valida hosting, CORS ni operación productiva.

## Contrato verificado en el código

- Ambos endpoints requieren JWT Bearer y rol `admin`; la API responde 401 si falta autenticación y 403 si el rol no tiene permiso.
- `GET /api/v1/admin/metrics?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD` retorna total de intentos y agregados por estado/veredicto.
- `GET /api/v1/admin/audit-events?startDate&endDate&eventType&limit&cursor` pagina eventos por `(occurredAt, _id)` descendente; la página lleva `items`, `hasMore` y `nextCursor`. `startDate`/`endDate` son días civiles inclusivos de `America/Mexico_City`; la consulta usa `[inicio local, inicio del día posterior)` sobre instantes UTC sin mutar `occurredAt`.
- Filtros aprobados para UI: rango de fechas y tipo de evento; cursor solo para paginación. No añadir filtros por actor, resultado ni identificadores.
- La respuesta de auditoría se proyecta a DTO allowlist conforme a OpenAPI; no expone `purgeAt`.
- La API valida fechas reales y ordenadas, enum de evento, `limit` 1–100 y parámetros desconocidos; errores de consulta son Problem Details 400.

## Verificación disponible

`api/tests/unit/presentation/AdminRoutes.test.ts` cubre 401/403, fechas imposibles/reversas, parámetros no admitidos, enum/limit, rango válido y respuesta sin `purgeAt`. `api/tests/integration/AnalysisFlowHttp.integration.test.ts` cubre también los endpoints admin por Fastify contra MongoDB desechable: autenticación, rol, métricas, eventos y DTO sin `purgeAt`. El runner de MongoDB 8.0.34 pasó en ejecución desechable. La consola en `frontend/admin-console/` ya implementa login/gate admin, tokens solo en memoria, métricas y auditoría por rango/tipo/cursor; la especificación aprobada está en `docs/superpowers/specs/2026-11-03-enlaceseguro-admin-console-design.md`. Nueve pruebas locales, typecheck, lint y build pasan. E2E Chromium local con API fixture + MongoDB desechable verifica login, gate, CORS de fixture, métricas, auditoría y pérdida de sesión al recargar; axe-core pasó WCAG A/AA en login/resumen/auditoría a escritorio y 390 px. Esto no valida hosting/CORS real ni accesibilidad manual.

La misma auditoría encontró que tanto la paginación admin como el historial móvil devolvían silenciosamente la primera página ante un cursor inválido. Ahora ambos rechazan cursor corrupto con Problem Details 400, validan forma/canonicalización/fecha/ID y establecen longitudes máximas (128 admin; 256 historial). `/analyses` valida también el límite 1–50 en runtime. La suite de integración cubre invalid cursor y límite fuera de rango.

## Riesgos y decisiones antes de construir la consola

1. **Semántica de fechas — resuelta:** el usuario aprobó unificar métricas y auditoría en días civiles inclusivos de `America/Mexico_City`. La auditoría busca desde medianoche local inclusive hasta medianoche del día siguiente exclusiva, usando la zona IANA en vez de asumir un offset fijo; `occurredAt` se conserva como instante UTC. La integración cubre eventos exactamente al inicio, el último milisegundo del día y justo antes/después de los límites.
2. **Cursor inválido — corregido:** cursor admin malformado, no canónico, con fecha/ID inválidos o mayor de 128 caracteres devuelve Problem Details 400; historial móvil aplica validación equivalente con máximo de 256 caracteres. Ninguno vuelve silenciosamente a la primera página. La suite HTTP+Mongo incluye regresiones.
3. **Paginación/fecha+evento en Mongo real — verificado localmente:** la suite desechable cubre límites temporales, cursor/filtros y autorización por rol; repetir en staging con la configuración real.
4. **Seguridad/privacidad de visualización:** `actorId`, `resourceId` y `requestId` son datos operativos; aplicar DTO allowlist, no añadir filtros no aprobados y revisar CSP/redacción de consola durante integración con hosting real.
5. **Framework — resuelto:** Vite + React/TypeScript, separado de Expo y con sesión Bearer en memoria. La decisión de hosting/origen, CORS real y headers de seguridad permanece pendiente de G0/G4.

## Salida del carril

Contrato con semántica de fecha aprobada y pruebas HTTP/Mongo; acceso admin probado; filtros limitados a fecha/tipo; estados vacíos/error/paginación; build reproducible local. Falta verificar hosting, CORS y headers reales, y cerrar QA visual/accesibilidad manual antes de desplegar.
