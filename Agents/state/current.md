# Estado vigente

**Actualizado:** 2026-10-26
**Estado:** entregable académico formal de BDaaS completado en `deliverables/academic/entrega-actividad-bdaas.md` y formalizado en ADR-0002 bajo metodología COVE; backend REST (Fastify) y microservicio sandbox (Playwright) implementados y comunicados; 34 pruebas unitarias pasando; compilación limpia.

## Confirmado en el workspace

- Elaborado el documento integral de entrega académica en `deliverables/academic/entrega-actividad-bdaas.md`, estructurado conforme a los 7 puntos solicitados:
  1. Caso de uso seleccionado: P3/P7 (admisión atómica y control de cuota diaria en `daily_analyses`).
  2. Diagramas Mermaid: arquitectura hexagonal y flujo de datos/secuencia.
  3. Árbol de carpetas real y justificación modular bajo principios SOLID/Clean Architecture.
  4. Contratos formales: API (OpenAPI 3.1.0) y Base de Datos (validador estricto `$jsonSchema` e índices).
  5. Código implementado del caso de uso: entidad de dominio, puerto, caso de uso y adaptador MongoDB con `findOneAndUpdate` atómico.
  6. Matriz de pruebas categorizada por análisis de riesgos técnicos (condición de carrera, cuota, Anti-SSRF, inyección, consistencia).
  7. Resultados reproducibles: evidencia de 34 pruebas unitarias pasando (13 en API, 21 en Sandbox) e instrucciones de ejecución deterministas.
  8. Registro de decisiones técnicas formalizado en `Context/decisions/ADR-0002-atomic-quota-and-embedded-daily-analysis.md` evaluado bajo marco COVE (Chain of Verification / comparativa adversarial).
- El servicio de Sandbox está implementado en `sandbox/` como microservicio aislado:
  - `core/AntiSsrfGuard`: validación estricta de esquemas (`http:`, `https:` exclusivamente), resolución DNS obligatoria y bloqueo determinista de IPv4 privadas (RFC 1918), loopback (`127.0.0.0/8`), metadatos de nube (`169.254.169.254`), carrier-grade NAT (`100.64.0.0/10`) e IPv6 reservadas/locales (`::1`, `fc00::/7`, `fe80::/10`).
  - `core/VerdictEvaluator`: categorización en `peligroso`, `sospechoso` y `sin_amenazas_detectadas` (con aclaración explícita de no garantía absoluta), y justificaciones en lenguaje natural.
  - `infrastructure/PlaywrightContextPool`: pool de contextos Playwright efímeros con límite de concurrencia configurable, intercepción de red (`context.route`) contra saltos SSRF en tiempo de ejecución, revocación de permisos (`permissions: []`), cancelación de descargas y captura de pantalla.
  - `infrastructure/ScreenshotStorage`: persistencia local de capturas en formato WebP con identificador opaco.
  - `presentation/sandboxServer`: API HTTP Fastify exponiendo `GET /health`, `POST /analyze` y `GET /captures/:attemptId`.
  - 21 pruebas unitarias pasando en `sandbox/tests/` (cobertura total de rangos IP, esquemas y veredictos).
- El backend en `api/` se conectó al Sandbox mediante `HttpSandboxService` y `ProcessAnalysisJobUseCase`:
  - Recepción de solicitud `POST /analyses` admite atómicamente en cuota (`received`).
  - Despacho asíncrono hacia el sandbox para transicionar `received` → `processing` → `completed` (o `failed`).
  - Almacenamiento del subdocumento `analysis` con veredicto, razones, señales, redirecciones y referencia de captura.
  - Eventos de auditoría emitidos: `analysis.accepted`, `analysis.completed`, `analysis.failed`.
  - Endpoint `GET /health` ahora supervisa tanto la conectividad con MongoDB como la salud del servicio sandbox.
  - 13 pruebas unitarias pasando en `api/tests/`.
- Compilación de TypeScript (`npm run build` y `npm run typecheck`) sin errores en `api/` y `sandbox/`.
- `Context/context.md` y la propuesta PDF se conservaron como fuentes.
- El CSV de patrones se trasladó sin cambio de contenido a `database/modeling/access-patterns.csv`.
- El repositorio GitHub indicado es público y estaba vacío al conectar el remoto; `origin` apunta a `https://github.com/ArturoYJ/Enlace-Seguro.git`.
- Los anexos fuente con datos académicos se conservan localmente y están excluidos mediante `.gitignore`; el registro público de fuentes no expone sus nombres de archivo.
- El scaffold documental aprobado se publicó en `origin/main` en el commit `cf4b2cc`; se incluyeron 37 archivos de documentación no sensible.
- El usuario confirmó MongoDB como motor de la práctica BDaaS; se mantiene independiente la propuesta original PostgreSQL.
- El usuario confirmó el stack tecnológico de aplicación: backend Node.js 22 + TypeScript + Fastify, frontend móvil React Native, y 1 servicio sandbox unificado con pool configurable de contextos Playwright/Chromium. `Context/architecture/system.json` actualizado con nodos en estado `confirmed`.
- El usuario aprobó las decisiones de autenticación: bcrypt costo 12 para contraseñas, Access Token JWT stateless de 15 minutos (HS256), y Refresh Token rotativo de 256 bits con validez de 7 días, persistido en MongoDB como hash SHA-256 con tracking de familias (`familyId`) para detección y neutralización de reúso. Documentado en `Context/architecture/auth-design.md`.
- Se definió el contrato formal de la API en `api/openapi.yaml` bajo OpenAPI 3.1.0: 10 endpoints cubriendo `/health`, autenticación (`/auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/me`), análisis (`/analyses`, `/analyses/{attemptId}`), y administración (`/admin/audit-events`, `/admin/metrics`). Manejo de errores estandarizado bajo RFC 9457 (Problem Details).
- Se incorporó la colección `refresh_tokens` al validador `$jsonSchema` (`database/schema/collection-validators.js`), al script de bootstrap (`database/migrations/001_create_mongodb_schema.js`) con índices único en hash, búsqueda por usuario/familia y TTL en `expiresAt`, y a la matriz `database/schema/validation-cases.md`.
- El modelo lógico revisado propone cuentas, caché de reputación, auditoría y un documento diario por usuario con hasta cinco solicitudes consumidoras; cada intento/solicitud y su resultado de análisis se embeben en ese mismo documento para admitir cuota y crear el registro inicial en una escritura atómica.
- Consumo diario derivado del tamaño de `attempts`; no se persiste un contador duplicado (confirmado por el usuario).
- Cuota confirmada: cinco solicitudes recibidas por usuario por día calendario en `America/Mexico_City`; las solicitudes posteriores se rechazan desde backend.
- Los rechazos por cuota agotada no se almacenan en el registro (confirmado por el usuario).
- RBAC confirmado: `admin` único y `usuario`; panel de métricas integrado al frontend oficial, con acceso a datos únicamente a través del backend.
- Filtros de eventos del panel admin confirmados: intervalo de fechas y tipo de evento solamente; no se requiere filtrar por actor ni resultado.
- P4 usa historial aplanado desde documentos diarios; el índice candidato `{ userId, localDate }` localiza documentos padres, pero no garantiza el orden de intentos después de `$unwind`. Se recomienda evaluar cursor/keyset compuesto contra `$skip` con datos y `explain` antes de afirmar costo/rendimiento.
- El usuario confirmó que `attemptId` será único globalmente y que la ruta de detalle podrá conocer `localDate`; P5 propio usa como candidato el índice diario único `{ userId, localDate }`. Se recomienda además índice único multikey global por integridad (y lookup por ID si admin lo requiere), más guardia anti-duplicado intradocumento.
- Índices de auditoría candidatos separados: fecha+`_id` para rango sin tipo, y tipo+fecha+`_id` cuando hay filtro de tipo; no se agregan filtros/índices por actor ni resultado.
- El usuario aprobó el catálogo `database/modeling/query-catalog.md`; la aprobación no convierte índices candidatos en índices finales ni confirma rendimiento.
- El usuario aprobó estos estados de procesamiento para solicitudes de análisis: `received`, `validation_failed`, `processing`, `completed`, `inconclusive`, `failed`. Las transiciones y ausencia de un historial separado fueron aprobadas y constan en `schema-proposal.md`.
- El bootstrap crea colecciones, validadores estrictos, índices únicos/consulta y TTL. Es de una sola aplicación, falla si las colecciones ya existen y no elimina ni modifica datos existentes.
- `schemaVersion: 1`, `purgeAt`, allowlists cerradas, límite de 5 intentos y catálogos de estados/eventos son parte de los validadores; RBAC, transiciones, pertenencia y deduplicación intradocumento siguen siendo responsabilidad del backend.

## Pendientes de decisión/verificación

- Ejecutar la migración bootstrap y la matriz `database/schema/validation-cases.md` contra una instancia activa de MongoDB 8.0.x de prueba.
- Implementar la purga de capturas privadas externa a MongoDB; el TTL de la BD no borra esas capturas.
- Acordar proveedor de reputación externa (VirusTotal / Google Safe Browsing) y sus adaptadores.
- Iniciar el andamiaje del proyecto cliente móvil en React Native en `frontend/`.

## Siguiente paso recomendado

Inicializar el proyecto cliente móvil React Native en `frontend/` y configurar el cliente HTTP para interactuar con la API REST de autenticación y análisis.
