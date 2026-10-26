# EnlaceSeguro — propuesta de esquema y validación MongoDB

**Estado:** baseline aprobado por el usuario; contrato MongoDB Community Server 8.0.x autogestionado y sin sharding preparado en [`../schema/collection-validators.js`](../schema/collection-validators.js), pendiente de verificación en servidor.  
**Base:** modelo lógico y catálogo de consultas aprobados.  
**Límite:** bootstrap y validadores están preparados, pero no ejecutados. No contiene código de aplicación ni se conectó a MongoDB.

## 1. Decisiones incorporadas

- MongoDB para la actividad BDaaS. Baseline del contrato físico: Community Server 8.0.x, último parche disponible, despliegue autogestionado sin sharding; la selección se hace para reproducibilidad y se revisa antes de cada despliegue.
- Colecciones conceptuales: `users`, `daily_analyses`, `reputation_cache`, `security_audit_events`.
- Cada documento `daily_analyses` corresponde a un usuario y fecha local; `attempts` es un arreglo de máximo cinco elementos y su longitud deriva el consumo diario. No se persiste contador duplicado.
- Cada solicitud recibida se registra y consume cuota antes de validación posterior; una sexta solicitud no se agrega ni registra.
- `attemptId` es globalmente único; para el detalle personal la ruta conoce `userId` autenticado, `localDate` y `attemptId`.
- Estados aprobados para solicitud/análisis: `received`, `validation_failed`, `processing`, `completed`, `inconclusive`, `failed`.
- Roles: `admin` único y `usuario`; la API/backend autoriza todo acceso y el navegador no accede directamente a MongoDB.

## 2. Estrategia de integridad propuesta

Separar responsabilidades según lo que MongoDB puede comprobar:

| Regla | Control propuesto | Observación |
|---|---|---|
| Tipo de documento, campos requeridos y tipos BSON | Validador `$jsonSchema` por colección | Debe corresponder a documentos realmente escritos por la aplicación. |
| Roles y estados definidos | `enum` en validador | `processingStatus` y los catálogos v1 de cuenta, veredicto y eventos fueron aprobados para el ejercicio. |
| Máximo cinco intentos/día | `maxItems: 5` en `attempts`, además de condición atómica de admisión | El validador rechaza una escritura inválida; no sustituye el filtro condicional que impide concurrencia por encima de cinco. |
| Correo único; máximo una cuenta admin; documento diario único por usuario/fecha | Índice único de correo, índice parcial único sobre rol `admin` e índice único diario | El índice parcial garantiza como máximo un admin (no su existencia); comprobar opciones con pruebas en 8.0.x. El índice diario es también identidad del documento. |
| `attemptId` global único | UUID v4 canónico en backend + índice único multikey en `attempts.attemptId` + guardia atómica anti-duplicado en el mismo documento | El índice evita duplicados entre documentos; la guardia de escritura evita repetición dentro del mismo `attempts[]`. Se recomienda aun cuando P5 personal dispone de `localDate`, porque la unicidad es requisito confirmado. El costo se medirá posteriormente. |
| Propietario del análisis, referencias a cuenta y RBAC | API/backend | El validador de documento no proporciona claves foráneas ni autorización contextual de la sesión. |
| Tamaño y cardinalidad de señales, redirecciones, respuestas de fuentes | Aplicar límites iniciales aprobados de §2.1 y verificarlos con datos sintéticos | Baseline elegido para el ejercicio, todavía no medido; no aceptar arreglos/documentos sin límite. |
| Retención y expiración de eventos/caché/historial | Aplicar baselines de §2.1 mediante `purgeAt` + TTL en documentos y lectura que excluye vencidos | Aprobado para el ejercicio; no es obligación legal ni período de producción. TTL no es borrado inmediato. |

MongoDB permite validar documentos con JSON Schema, incluidos `bsonType`, `required`, `enum` y restricciones de arreglos. La validación debe probarse con MongoDB Community Server 8.0.x último parche. [Documentación de validación de esquema](https://www.mongodb.com/docs/manual/core/schema-validation/).

### 2.1 Decisiones aprobadas para esta versión académica

| Tema | Decisión aprobada | Motivo / alcance |
|---|---|---|
| Identificadores | `_id` y `userId`: `ObjectId`; `attemptId`: UUID v4 en string canónica minúscula | IDs nativos sencillos para entidades MongoDB; UUID aleatorio no expone secuencia. El tipo se conserva uniforme en todas las rutas. |
| Versionado contractual | Campo raíz `schemaVersion: 1` en cada colección | Permite identificar la revisión del documento y preparar migraciones; no sustituye versionar el código/validadores. |
| Unicidad global de intento | Índice único multikey en `daily_analyses.attempts.attemptId` + precondición atómica que impide duplicados dentro del documento | La unicidad global es requisito confirmado aunque P5 personal use fecha; el índice garantiza duplicados entre documentos. MongoDB permite repetición dentro del mismo documento para unique multikey, por lo que la precondición es obligatoria. |
| Ciclo de vida | `received → validation_failed | processing | failed`; `processing → completed | inconclusive | failed`; los cuatro destinos terminales no se reabren | Separar rechazo de entrada, trabajo activo, resultado normal/no concluyente y fallo técnico. Reintentos transitorios permanecen en `processing` y reutilizan `attemptId`; política de reintento se limita al backend y no consume cuota adicional. |
| Historial de transiciones | No mantener un arreglo aparte de transiciones en v1; conservar estado actual y timestamps (`receivedAt`, `updatedAt`, `completedAt` cuando aplique) | Evita duplicar información y crecimiento no acotado. Los eventos de auditoría se reservan para eventos de seguridad/acciones definidos; se reconsidera un historial de transiciones solo si se requiere trazabilidad por transición. |
| Valores de veredicto | `peligroso`, `sospechoso`, `sin_amenazas_detectadas` | Alineados con categorías descritas en la propuesta; no afirmar que el último significa seguro garantizado. |
| Estado de cuenta | `active`, `disabled` | Conjunto mínimo para permitir/deshabilitar cuenta; sin estados de invitación/borrado que no exige el flujo actual. Índice parcial único para el único rol admin. |
| Evento auditado | Enum cerrado en catálogo: `auth.login.succeeded`, `auth.login.failed`, `authz.denied`, `account.registered`, `analysis.accepted`, `analysis.validation_failed`, `analysis.completed`, `analysis.inconclusive`, `analysis.failed`, `admin.audit.read` | Cubre acciones de seguridad y ciclo relevante; no incluye cuota agotada porque el usuario decidió no registrarla. Ajustar solo si se agrega requisito, no por conveniencia de filtros. |
| Retención inicial de ejercicio | `daily_analyses`: 365 días; auditoría: 90 días; capturas: 30 días; caché: respetar expiración independiente indicada por fuente y borrar documento cuando todas las entradas estén vencidas | Defaults de diseño para un prototipo con trazabilidad e historial, no requisito legal ni política de producción. `purgeAt` es campo fecha en documentos diarios, auditoría y caché. TTL/limpieza es eventual; las lecturas deben excluir eventos ya vencidos. |
| Datos en logs | Guardar `actorId` solo si se conoce; no guardar IP, user-agent, tokens, credenciales, URL completa ni respuestas crudas de proveedores en auditoría | No hay filtros confirmados por IP/actor/result; minimizar exposición. Para correlación usar `requestId`, `attemptId` y referencias opacas. |
| Auditoría | Append-only a nivel de aplicación: backend inserta y consulta por endpoints admin; el principal de aplicación no actualiza/elimina eventos ordinarios. No declarar inmutabilidad fuerte | Adecuado a la trazabilidad requerida y al nivel académico; privilegio de retención/limpieza separado. |
| Validación | `validationAction: error`, `validationLevel: strict`, allowlist de campos (`additionalProperties: false`) con `schemaVersion: 1` | Rechaza documentos fuera del contrato y limita campos inesperados. La evolución futura requiere cambios versionados/migración; validar sintaxis en 8.0.x. |
| Límites para primer validador | Entrada raw ≤ 8 KiB UTF-8 para persistirla; redirecciones ≤ 10; fuentes ≤ 4; razones ≤ 10; señales ≤ 50; `metadata` allowlisted ≤ 5 claves; objetivo ≤ 1 MiB por intento y ≤ 8 MiB por documento diario serializado | Topes conservadores iniciales para un máximo de cinco intentos y margen frente al máximo BSON de 16 MiB. Una solicitud que supera el tope de entrada y ya fue recibida consume cuota; guardar SHA-256 y longitud, omitir el raw (no truncarlo). Contar UTF-8 bytes en backend; `maxLength` BSON/JSON Schema solo limita caracteres. Revisar con datos sintéticos. |

La ventana de retención y los topes anteriores son **baselines aprobados para el ejercicio**, no normas externas ni valores medidos ni política de producción. OWASP recomienda definir retención por finalidad, minimizar/sanitizar datos de log y no conservarlos más allá del periodo necesario; el proyecto debe tratarlos como parámetros configurables. [OWASP Logging Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html). MongoDB TTL no garantiza borrado inmediato; por ello las lecturas filtran documentos vencidos además del índice de expiración. [MongoDB TTL indexes](https://www.mongodb.com/docs/manual/core/index-ttl/).

## 3. Reglas propuestas por colección

Tipos aprobados para esta versión: `_id` y `userId` como BSON `ObjectId`; `attemptId` como UUID v4 codificado en string canónica minúscula. El backend valida el formato y el índice global asegura unicidad entre documentos.

### 3.1 `users`

| Campo conceptual | Tipo/validación propuesta | Estado |
|---|---|---|
| `_id`, `schemaVersion` | BSON `ObjectId`; entero 1 | Campos requeridos para identidad y versión contractual |
| `emailNormalized` | string no vacío; único por índice | Regla aprobada como necesaria; normalización exacta pendiente |
| `passwordHash` | string; requerido; nunca proyectar al cliente | No validar algoritmo/costo criptográfico desde JSON Schema |
| `role` | string enum: `admin`, `usuario` | Valores confirmados |
| `accountStatus` | enum: `active`, `disabled` | Estado aprobado mínimo |
| `createdAt`, `updatedAt` | BSON Date | Tipos propuestos para marcas de tiempo |

Política de alta: el backend asigna `usuario` a altas públicas; no acepta privilegios seleccionados por el cliente. La existencia de un admin único requiere aprovisionamiento controlado además de controles de unicidad; queda fuera del validador de cada documento.

### 3.2 `daily_analyses`

| Campo conceptual | Tipo/validación propuesta | Estado |
|---|---|---|
| `_id`, `schemaVersion` | BSON `ObjectId`; entero 1 | Campos requeridos para identidad y versión contractual |
| `userId` | Mismo tipo que `_id` de `users`; requerido | Relación validada en backend |
| `localDate` | string `YYYY-MM-DD`, requerido | Fecha calendario calculada por backend en `America/Mexico_City`; formato/regex se prueba en 8.0.x |
| `attempts` | array requerido, `minItems: 0`, `maxItems: 5` | Regla límite aprobada por la cuota |
| `purgeAt` | BSON Date, requerido | Fecha de elegibilidad para purga al cumplir baseline aprobado de 365 días |
| `attempts[].attemptId` | string UUID v4 canónica minúscula; requerido, globalmente único | Formato aprobado; índice único multikey + guardia anti-duplicado dentro del documento |
| `attempts[].receivedAt`, `updatedAt` | BSON Date, requeridos | Instante de recepción y última actualización; distintos de la fecha local de partición |
| `attempts[].processingStatus` | enum con los seis estados aprobados | Requerido; la API aplica las transiciones de §2.1 |
| `attempts[].inputDigest`, `inputSizeBytes` | SHA-256 hexadecimal y longitud UTF-8 del original, requeridos | Trazabilidad para cualquier entrada; el hash es dato potencialmente correlacionable y no se expone como anonimización |
| `attempts[].submittedInput` | string opcional de hasta 8192 caracteres | Solo se almacena si el original está dentro del límite UTF-8 aprobado; para entradas mayores se omite, no se trunca |
| `attempts[].analysis` | subdocumento opcional con allowlist cerrada | Se omite cuando la validación falla o no existe resultado; API exige que estados terminales exitosos tengan el resultado requerido |

La opción aprobada es UUID v4 canónico en string e índice multikey único global para garantizar unicidad entre documentos; en la actualización se comprueba que el ID no esté ya en `attempts` del mismo documento porque el índice no detecta ese caso.

Transiciones aprobadas: `received → validation_failed | processing | failed`; `processing → completed | inconclusive | failed`. `validation_failed`, `completed`, `inconclusive` y `failed` son terminales. Reintentos transitorios conservan `processing` y `attemptId`; no guardamos un array de transiciones en v1. Actualizaciones de worker comparan estado esperado para que un evento atrasado no reabra una solicitud terminal.

Subdocumento `analysis` v1: veredicto (`peligroso`, `sospechoso`, `sin_amenazas_detectadas`), razones, destino final, resultados/fallas por fuente, señales, redirecciones y referencia a captura. Sus tipos allowlisted y topes están concretados en [`../schema/collection-validators.js`](../schema/collection-validators.js); backend debe seguir comprobando coherencia entre estado y presencia de resultado.

La validación de `attempts.length <= 5` protege forma; la admisión requiere además una actualización atómica condicional sobre el documento. Un validador solo no resuelve carreras. El índice único `{ userId: 1, localDate: 1 }` evita documentos diarios duplicados. Índices adicionales están en el [catálogo aprobado](query-catalog.md).

### 3.3 `reputation_cache`

| Campo conceptual | Tipo/validación propuesta | Estado |
|---|---|---|
| `_id`, `schemaVersion` | BSON `ObjectId`; entero 1 | Campos requeridos para identidad y versión contractual |
| `normalizedKey` | string requerido | La forma/canonicalización URL/dominio se controla en backend |
| `keyType` | enum `url`, `domain` | Distingue espacios de claves; pareja `{keyType, normalizedKey}` única |
| `sources` | arreglo de resultados por proveedor | Tipo/estructura requerida por P2; proveedor y límites pendientes |
| `sources[].sourceName` | string requerido | String acotado; no cerrar enum mientras proveedores no estén implementados |
| `sources[].status` | string requerido | String acotado; valores canónicos se fijarán al integrar proveedores |
| `sources[].checkedAt`, `sources[].expiresAt` | BSON Date | Expiración evaluada por fuente |
| `updatedAt`, `purgeAt` | BSON Date | `purgeAt` se establece según la expiración más tardía entre fuentes; el backend filtra resultados vencidos individualmente |

Baseline aprobado: purgar una entrada/documento de caché cuando todas sus fuentes hayan vencido, conservando la verificación de expiración por fuente en lectura. `purgeAt` refleja la mayor expiración; no usar TTL único como sustituto de validar vigencia de cada fuente.

### 3.4 `security_audit_events`

| Campo conceptual | Tipo/validación propuesta | Estado |
|---|---|---|
| `_id`, `schemaVersion` | BSON `ObjectId`; entero 1 | Campos requeridos para identidad y versión contractual |
| `occurredAt`, `purgeAt` | BSON Date requerido | `purgeAt` aplica baseline de 90 días; el índice TTL solo purga eventualmente |
| `eventType` | enum aprobado con catálogo aprobado de §2.1 | Filtros por tipo confirmados; no incluye rechazo por cuota agotada |
| `actorType` / `actorId` | string acotado / BSON ObjectId opcional | Contenido conceptual; no es filtro del panel |
| `action`, `outcome` | `action` derivada de evento; `outcome` enum `success`, `failure`, `denied`, `partial` cuando aplique | No se usan como filtros del panel |
| `resourceType`, `resourceId`, `requestId` | strings acotados opcionales | No guardar IP ni user-agent por defecto; minimizar y correlacionar sin URL sensible |
| `metadata` | allowlist con tamaño máximo 4 KiB | No almacenar credenciales, tokens, URL completa ni respuestas de proveedor |

Los accesos del panel consultan por intervalo y opcionalmente por tipo, no actor ni resultado. La API restringe lectura de eventos a admin. El principal normal de la API inserta/consulta, con privilegio operativo separado para purga; retención inicial 90 días, sin declarar inmutabilidad fuerte.

## 4. Contrato de validación aprobado

1. **MongoDB:** tipos BSON, campos requeridos, enums aprobados, topes de arreglos/campos, y allowlist cerrada por colección.
2. **Backend:** normalización de correo y URL; autorización; pertenencia `userId`; cálculo `localDate`; generación/no duplicidad de IDs; transiciones válidas; validación de datos dependientes de otras colecciones; aplicación de topes de entrada/evidencia aprobados y digest/byte length para raw que excede el límite persistible.
3. **Índices:** correo único, parcial único para `role: admin`, documento diario único por `{userId, localDate}`, índice único multikey global de `attemptId` con guardia de duplicados intradocumento, índice compuesto único `{keyType, normalizedKey}` para caché, y candidatos de auditoría/historial sujetos a `explain`.
4. **Política ante documento inválido:** proponer `validationAction: error`, `validationLevel: strict`, `schemaVersion: 1` y `additionalProperties: false` para colecciones nuevas. Las actualizaciones del contrato deben ser versionadas; limitar el bypass de validación al principal operativo autorizado.
5. El `$jsonSchema` ejecutable y el bootstrap de colecciones/índices están en `../schema/collection-validators.js` y `../migrations/001_create_mongodb_schema.js`; no han sido ejecutados.

## 5. Verificación e implementación pendiente

1. Validar en servidor MongoDB Community 8.0.x el dialecto JSON Schema, UUID/collation, índices y la operación atómica de admisión; no se afirma aún compatibilidad en ejecución.
2. Probar con datos sintéticos si los topes aprobados de arreglos/tamaño representan el flujo; el objetivo de bytes diarios debe verificarse en backend ya que JSON Schema no cuenta el tamaño BSON total.
3. Implementar el proceso de purga de capturas privadas a 30 días fuera de MongoDB; la referencia opaca no borra el objeto externo.
4. Las agrupaciones exactas de métricas admin, proveedores reales de reputación y detalle de normalización permanecen fuera de esta fase; no agregar filtros de actor/resultado.

## 6. Criterios de aceptación de la propuesta

- Solo acepta roles `admin` y `usuario`; alta pública crea `usuario`.
- Un documento diario no puede contener más de cinco intentos y no persiste contador redundante.
- Acepta los seis estados aprobados y rechaza otros estados de procesamiento.
- Valida transiciones aprobadas y evita reabrir estados terminales desde backend.
- Distingue intento consumidor con fallo de validación de un análisis completado; `analysis` puede no estar presente cuando no se alcanza esa etapa.
- Deja claro que unicidad global y referencias entre documentos requieren índice/backend; no las atribuye a `enum` ni al validador JSON Schema.
- No introduce filtros de auditoría por actor o resultado.
- Aplica los baselines de límites/retención aprobados para el ejercicio y declara que aún faltan pruebas sintéticas y verificación del TTL eventual.
- Antes de conectar la aplicación, se valida el contrato contra MongoDB Community 8.0.x y casos de inserción/actualización válidos e inválidos.

## Referencias

- [MongoDB: schema validation](https://www.mongodb.com/docs/manual/core/schema-validation/) — validadores JSON Schema y reglas de documentos.
- [MongoDB: JSON Schema allowed values](https://www.mongodb.com/docs/manual/core/schema-validation/specify-json-schema/specify-allowed-field-values/) — enum de valores permitidos.
- [MongoDB: unique multikey index behavior](https://www.mongodb.com/docs/manual/core/index-unique/) — unicidad entre documentos; claves repetidas del mismo documento no violan índice único multikey.
- [MongoDB: multikey indexes](https://www.mongodb.com/docs/manual/core/indexes/index-types/index-multikey/) — comportamiento e índice de arreglos.
- [MongoDB: partial indexes](https://www.mongodb.com/docs/manual/core/index-partial/) — índices parciales, incluyendo la posibilidad de combinar el filtro parcial con unicidad.
