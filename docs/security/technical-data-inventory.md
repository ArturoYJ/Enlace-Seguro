# Inventario técnico de datos personales y flujos

**Estado:** borrador técnico basado en inspección estática del checkout, 2026-11-04.
**Propósito:** preparar revisión especializada de privacidad y decisiones de producto/despliegue.
**Límite:** no es aviso de privacidad, dictamen legal, evaluación completa de proveedores ni prueba de configuración/despliegue. “Observable” describe comportamiento previsto por el código; no afirma base legal, consentimiento, retención efectiva o ubicación real.

## Resumen de flujos

```text
Persona usuaria
  ├─ email/contraseña ── HTTPS pendiente de despliegue ──> API ──> MongoDB
  ├─ URL (pegado manual explícito) ──> API ──> job Mongo ──> Sandbox/Chromium ──> sitio indicado por la URL
  │                                      ├─ resultado/historial ──> MongoDB
  │                                      └─ captura WebP ──> almacenamiento local privado del Sandbox
  └─ refresh token ──> SecureStore móvil; hash del refresh ──> MongoDB

Admin web ── Bearer en memoria ──> API admin ──> métricas agregadas / eventos de auditoría
```

El sitio de destino recibe solicitudes de navegación del Sandbox y puede observar la actividad de red de esa navegación. No hay adaptadores de reputación externa integrados en el código inspeccionado. No se identificaron proveedor/región de Mongo, hosting, logs, backups ni transferencias efectivamente desplegados.

## Inventario

| Categoría y campos observados | Propósito técnico observable | Ubicación y acceso | Retención/borrado conocido | Estado y revisión pendiente |
|---|---|---|---|---|
| Cuenta: correo normalizado, hash bcrypt, rol, estado, timestamps | Registro, autenticación, autorización y estado de cuenta | Colección Mongo `users`; autenticación bearer | Sin TTL ni flujo de borrado de cuenta observado. No se observó cascada de tokens/auditoría | Definir retención y proceso de acceso/eliminación; no hay nombre/teléfono en entidad inspeccionada |
| Credenciales de acceso: email y contraseña durante registro/login | Verificar identidad y emitir sesión | Request al API; bcrypt costo 12 antes de persistir. El hash queda en `users`; contraseña clara no se persiste intencionalmente | No aplica retención persistente clara observada | Verificar red/TLS, protección de secretos y prácticas operativas en despliegue |
| Tokens: access JWT (user id, email, rol, `jti`, tiempos); refresh aleatorio | Autorización de requests y renovación/revocación de sesión | Access: memoria en cliente; refresh móvil: SecureStore. Admin: ambos en memoria. Mongo guarda hash SHA-256 del refresh, familia, usuario, estado y fechas | Access default 15 min; refresh default 7 días; TTL de Mongo al expirar, asíncrono | Confirmar configuración productiva, borrado de datos relacionados y política de sesiones |
| Rate limit de login: HMAC pseudónimo de IP o email, tiempos de intentos, expiración | Limitar abuso compartido entre réplicas | Mongo `login_rate_limit_buckets`; no guarda IP/email en claro en `_id`. Código fail-closed si Mongo falla | Ventanas: IP 60 s; cuenta 15 min; TTL asíncrono | Se aprobó 20/IP/min y 10 fallos/cuenta/15 min. Revisar gestión/rotación de secreto HMAC y retención real |
| URL de análisis: texto normalizado, SHA-256 digest, bytes y UUID de intento | Analizar entrada, recuperar trabajo durable y deduplicar/trazar | API y worker; entrada persistida cifrada AES-256-GCM con IV aleatorio y AAD usuario/fecha/intento; URL descifrada internamente para el worker. Contrato backend permite 64 KiB UTF-8; app actual limita su entrada a 480 caracteres | Aprobado: ventana móvil exacta de 365×24 h; TTL de 366 días para el documento diario. Jobs pendientes no expiran hasta cerrar. TTL asíncrono; intentos viejos pueden permanecer menos de 24 h adicionales por compartir documento | No confundir TTL configurado con borrado puntual. Verificar key management, backup, restore, rotación y purga real |
| Resultados: veredicto/estado, razones, señales, hasta 10 redirects, destino final, hasta 4 resultados de fuente, fallos, referencia de captura | Mostrar resultado e historial; evidencia técnica del análisis | Mongo `daily_analyses`; API filtra por propietario; historial del usuario | Misma retención de 366 días del documento de análisis | Algunos campos reflejan dominios/URLs de navegación. Revisar minimización, acceso y divulgación a usuarios |
| Eventos de seguridad/auditoría: tipo, actor/resource IDs, acción/resultado, requestId, allowlist de metadata | Trazabilidad de seguridad y vistas admin | Mongo `security_audit_events`; lectura admin autenticada; eventos no deberían incluir URL en metadata | 90 días codificados y TTL asíncrono; lecturas filtran vencidos | Aprobación/legal y operación de retención no verificadas. Admin ve actor/resource/request IDs; revisar necesidad, roles y minimización |
| Capturas: imagen WebP de la página y `attemptId` opaco | Evidencia visual para resultado; proxy API opcional | Archivos `captures/{attemptId}.webp` locales al Sandbox con permisos 0700/0600; acceso API autenticado y owner-only | Aprobado baseline 30 días y barrido diario; comando local dry-run por defecto, requiere `--execute --writes-paused`. No hay scheduler desplegado; Mongo TTL no elimina archivos | Retención efectiva aún no garantizada. Las imágenes pueden contener datos de la página/terceros. Proxy apagado hasta validar red privada |
| Caché de reputación (schema preparado): clave URL/dominio, resultados por fuente, códigos y expiración | Evitar consultas repetidas a fuentes | Validator e índices Mongo descritos; no se encontró repositorio/uso runtime ni adaptadores integrados | TTL por expiración de fuente en esquema | No hay proveedores externos aprobados/integrados; no afirmar que se consultan |
| Clipboard y UI móvil: texto copiado por la persona y URL extraída | Facilitar envío explícito de URL | El portapapeles solo se lee al tocar “Pegar”; texto permanece en UI, app extrae HTTP(S), envía campo `input` y borra el campo tras aceptación; no se observó persistencia local de URL en flujo revisado | No se observó retención local deliberada de URL; OS/backup no evaluados | Verificar en dispositivos reales, disclosure al enviar URL y pruebas de privacidad del ciclo UI |
| Métricas admin: agregados por cuenta/rango; eventos auditables filtrados | Operación administrativa | Consola separada; token en memoria, `credentials: omit`; backend impone rol admin | Derivada de análisis/auditoría, por lo que hereda retención de origen | Confirmar privilegios y política del hosting/CSP; E2E local no acredita despliegue |
| Logs y errores: método, path sin query, hostname; 500 con `requestId`, método, path y estado | Diagnóstico técnico | Serializer Fastify API elimina query; `ProblemDetails.instance` también; 500 no serializa Error, stack o message. Sandbox route handler responde texto genérico y loguea `attemptId`; prueba canary del stream Fastify no encontró URL/query, bearer, HTML ni mensaje crudo en respuesta/log. Body del POST contiene URL, pero no se registra en serializers inspeccionados. | Proveedor, acceso, retención, región y sinks productivos no identificados; logs de framework/dependencias requieren validación en destino | Redacción API y handler Sandbox tienen pruebas sintéticas; falta comprobar formato de sinks efectivos y logs de dependencias en staging, configurar acceso/retención |
| CI de pruebas | Verificar builds/tests con datos sintéticos | Workflows locales usan `example.test`, credenciales ficticias y Mongo desechable | No se ha verificado retención de logs/artifacts de una ejecución remota | Workflows definidos no equivalen a CI remoto ejecutado ni despliegue |

## Hallazgos que requieren decisión/revisión

1. **URLs y navegación:** comunicar que una URL enviada se analiza navegando al destino; el servidor del destino recibe solicitudes del Sandbox. Definir minimización y tratamiento de URLs, destinos y resultados.
2. **Retenciones efectivas:** demostrar TTL/purgas en operación, no solo migración/comando. En especial capturas, logs, backups y datos de cuentas.
3. **Ciclo de vida de cuenta:** no se observó endpoint de eliminación ni borrado/cascade. Definir flujo, exportación/acceso y tratamiento de análisis, tokens y auditoría.
4. **Protección de claves:** revisar secret manager, rotación/recuperación, acceso y cifrado de backups para claves AES-GCM/HMAC/JWT.
5. **Operadores y transferencias:** elegir nube, región, Mongo/backup, logging y fuentes externas después de evaluar; no hay evidencia del despliegue en este checkout. No hay proveedores de reputación integrados.
6. **Capturas:** evaluar datos personales de terceros dentro de screenshots; habilitar acceso y purga solo después de probar aislamiento/red privada y ejecución programada.
7. **Logs:** validar formato redaccionado contra sinks efectivos; revisar framework/Sandbox y dependencias, establecer acceso/retención y probar con canarios en staging.
8. **Revisión de México y tiendas:** usar este inventario como insumo de asesoría especializada sobre avisos, consentimiento/disclosures, transferencias, derechos y formularios de tiendas. Este documento no determina obligaciones legales.

## Evidencia de código principal

- `api/src/core/entities/User.ts`; `api/src/infrastructure/database/mongo/MongoUserRepository.ts`; `api/src/presentation/routes/authRoutes.ts`.
- `api/src/use-cases/analysis/SubmitAnalysisUseCase.ts`; `api/src/infrastructure/security/AesGcmAnalysisInputCipher.ts`; `api/src/infrastructure/database/mongo/MongoDailyAnalysisRepository.ts`.
- `api/src/use-cases/auth/LoginUserUseCase.ts`; `api/src/infrastructure/database/mongo/MongoLoginRateLimitRepository.ts`; `api/src/infrastructure/database/mongo/MongoRefreshTokenRepository.ts`.
- `api/src/core/entities/SecurityAuditEvent.ts`; `api/src/infrastructure/database/mongo/MongoSecurityAuditRepository.ts`.
- `api/src/presentation/server.ts`; `api/src/presentation/plugins/errorHandler.ts`; `api/src/presentation/routes/analysisRoutes.ts`.
- `frontend/mobile/src/lib/session.tsx`; `frontend/mobile/src/app/analysis.tsx`; `frontend/admin-console/src/lib/api.ts`.
- `sandbox/src/infrastructure/ScreenshotStorage.ts`; `sandbox/src/operations/purgeCaptures.ts`; `docs/architecture/capture-purge-design.md`.

## Alcance y límites de verificación

Inventario construido por inspección estática local y tres auditorías de solo lectura. No se ejecutó despliegue/staging, revisión legal, pentest, medición de retención efectiva ni inspección de cuentas cloud. Configuración de ejemplo no demuestra valores productivos. Antes de cerrar G5, anexar evidencia de despliegue, operadores/subprocesadores, región, logs, backup/restore, purga efectiva y revisión especializada.
