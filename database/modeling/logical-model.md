# EnlaceSeguro — modelo lógico MongoDB

**Estado:** modelo lógico aprobado; su contrato físico MongoDB 8.0.x y bootstrap se prepararon por separado y aún no se han ejecutado.
**Alcance:** actividad BDaaS de modelado MongoDB. El baseline es Community Server 8.0.x último parche, despliegue de ejercicio autogestionado sin sharding; el despliegue y la conexión a servidor permanecen pendientes.

## 1. Objetivo y límites

Traducir los requisitos y patrones P1–P7 a tipos de documentos que sirvan a las consultas previstas, preserven la integridad de datos y permitan medir uso y eventos de seguridad. El diseño debe poder implementarse sin depender de transacciones multi-documento.

El usuario aprobó los baselines de integridad, transiciones, límites y retención en `schema-proposal.md`; sus validadores/índices están en `../schema/collection-validators.js` y `../migrations/001_create_mongodb_schema.js`. Aún falta verificación empírica. Los índices de consulta y formas de acceso se documentan por separado en [`query-catalog.md`](query-catalog.md). La propuesta original PostgreSQL es contexto del proyecto fuente, no el motor de esta actividad.

## 2. Requisitos confirmados

- Motor de la actividad: MongoDB.
- El flujo funcional de EnlaceSeguro permanece vigente; el alcance de esta etapa es diseño y creación de la base de datos.
- Roles permitidos: `admin` (una cuenta) y `usuario` (cuentas normales). El registro público crea cuentas `usuario`; la cuenta admin se provisiona de manera controlada.
- La cuota es de cinco solicitudes de análisis por usuario y día calendario en `America/Mexico_City`.
- Cada solicitud de análisis recibida consume una unidad, incluso si la validación posterior falla. Al agotarse la cuota, el backend rechaza solicitudes adicionales.
- Las solicitudes rechazadas por cuota agotada no se almacenan en el registro.
- Se requiere consultar historial propio y detalle de análisis. Se requiere también trazabilidad de solicitudes consumidoras y métricas/eventos de seguridad accesibles solo a admin.
- El frontend no se conecta directamente a MongoDB. La API/backend autentica y autoriza cada operación antes de acceder a la BD.
- Proveedor/entorno MongoDB no seleccionado: no depender de transacciones multi-documento.

## 3. Alternativas para registrar la cuota

| Alternativa | Ventajas | Costos y riesgos | Estado |
|---|---|---|---|
| **A. Documento por usuario/día con intentos y su análisis embebidos** | Un solo documento contiene la admisión/cuota y el registro inicial del análisis; las cinco admisiones máximas acotan el número de elementos y no requieren transacción multi-documento. | El historial se consulta desde arreglos agrupados por día; se deben limitar los detalles para no exceder el tamaño máximo BSON y soportar la paginación. | **Aprobada por el usuario como base para el diseño físico; detalles de consulta e índices aún en revisión.** |
| B. Documento diario de cuota y colección separada de análisis | P4/P5 usan documentos de análisis individuales de forma más directa. | La admisión de cuota y el alta del análisis serían dos documentos y no una sola escritura atómica sin transacción; además, si la solicitud falla entre escrituras queda inconsistencia o una reserva sin resultado. | No recomendada mientras se requiere atomicidad portable. |

MongoDB documenta atomicidad a nivel de un solo documento; para operaciones multi-documento ofrece transacciones en despliegues compatibles. [Atomicidad y transacciones](https://www.mongodb.com/docs/manual/core/write-operations-atomicity/).

## 4. Tipos de documentos propuestos

Los nombres son etiquetas conceptuales, no decisiones finales sobre nombres de colecciones. La propuesta revisada agrupa cuota y solicitud/análisis del día en un documento diario; por ello el análisis no sería una colección separada en esta variante.

### 4.1 Cuenta (`users` / `usuarios`)

Propósito: autenticar, identificar titular de análisis y aplicar RBAC.

Campos conceptuales: identificador, correo normalizado, hash de contraseña, rol (`admin` | `usuario`), estado de cuenta, fechas de creación/actualización.

Integridad prevista: correo único; rol validado contra los dos valores permitidos; una cuenta admin como máximo, con aprovisionamiento controlado. La existencia garantizada de un admin inicial es una regla de despliegue/provisionamiento, no algo que un validador de documento por sí solo asegure. MongoDB permite validar listas de valores con `enum`. [Valores permitidos en validación de esquema](https://www.mongodb.com/docs/manual/core/schema-validation/specify-json-schema/specify-allowed-field-values/).

### 4.2 Solicitud/análisis embebido

Propósito: que la admisión que consume cuota y el registro inicial de esa solicitud existan juntos en la misma escritura atómica. Una solicitud con validación fallida también se conserva como intento consumidor; el contenido de resultado de análisis será opcional si nunca se crea un análisis válido.

La solicitud/análisis sería un subdocumento de `attempts` dentro del documento diario descrito en 4.4, con identificador de intento, fecha de recepción, digest/tamaño del original, estado de procesamiento y, si corresponde, entrada acotada y datos del análisis. Los datos de resultado confirmados por el flujo incluyen categoría/veredicto, razones, destino final, resultados/fallas de fuentes, señales, redirecciones y referencia a captura.

Estados de procesamiento aprobados para cada solicitud: `received`, `validation_failed`, `processing`, `completed`, `inconclusive` y `failed`. `received` representa la admisión inicial; `validation_failed`, un rechazo de validación posterior a la recepción (y por tanto consumidor de cuota); `processing`, trabajo en curso; `completed`, análisis con resultado; `inconclusive`, resultado no concluyente/parcial; `failed`, fallo técnico que impidió completar el proceso. Transiciones aprobadas para el diseño: `received → validation_failed | processing | failed` y `processing → completed | inconclusive | failed`; los estados destino son terminales. Reintentos transitorios permanecen en `processing` con el mismo `attemptId`. No mantener historial de transiciones separado en v1; guardar estado actual y timestamps. La API debe comparar estado esperado al actualizar, ya que JSON Schema no valida transición desde el valor anterior.

**Límite importante de atomicidad:** una sola escritura puede consumir cuota y crear el registro inicial `received`. La validación, reputación, sandbox y resultado ocurren después; sus actualizaciones no pueden estar dentro de la escritura inicial que ocurre al recibir la solicitud. Se actualizaría el mismo subdocumento del mismo documento diario conforme avanza el proceso. Así un fallo intermedio deja el intento consumido y su estado visible, pero no se presenta la cadena completa de llamadas externas como una transacción atómica.

Los arreglos de redirecciones, fuentes y señales deben tener máximos una vez confirmado el límite funcional. La captura se almacena como referencia/URI, no como bytes dentro de BSON; se recomienda almacenamiento privado externo y una retención inicial de 30 días, sujeta a revisión antes de datos reales. Los detalles de respuesta externa deben limitarse para que el documento diario (hasta cinco intentos) no exceda el máximo de 16 MiB por documento. [Límite BSON y documentos embebidos](https://www.mongodb.com/docs/manual/core/document/).

### 4.3 Caché de reputación (`reputation_cache` / `cache_reputacion`)

Propósito: reutilizar resultados recientes por clave normalizada de URL o dominio y fuente.

Campos conceptuales: clave normalizada, tipo de clave y resultados separados por fuente. Cada resultado de fuente debe conservar su propio estado, instante de consulta y vencimiento: un vencimiento único para todo el documento podría tratar resultados vigentes como vencidos o reutilizar uno vencido junto a otro aún vigente. La consulta debe comprobar explícitamente el vencimiento de cada fuente. Baseline aprobado para el ejercicio: purgar cada documento cuando todas sus fuentes hayan vencido; TTL es eventual, no inmediato, y no sustituye validar el vencimiento individual de cada fuente. [Índices TTL](https://www.mongodb.com/docs/manual/core/index-ttl/).

### 4.4 Documento diario de análisis (`daily_analyses` / `analisis_diarios`)

Propósito: aplicar cuota y conservar cada solicitud consumidora junto con su ciclo de análisis, sin documento de análisis ni evento de uso separado.

Un documento representa un usuario y una fecha calendario en `America/Mexico_City`. Campos de contrato: `_id` ObjectId, `schemaVersion: 1`, `userId` ObjectId, `localDate` string `YYYY-MM-DD`, `attempts` de hasta cinco solicitudes consumidoras y `purgeAt` BSON Date. Cada elemento registra el intento y contiene datos analíticos si corresponden. La cantidad consumida se deriva del número de elementos; no se persiste contador duplicado.

Flujo conceptual: (1) al recibir una solicitud autenticada, el backend lee la entrada dentro de su límite de transporte, calcula fecha local, longitud UTF-8 y SHA-256, y genera `attemptId`; persiste el texto original solo si cabe en 8 KiB y omite el raw mayor, sin truncarlo; (2) ejecuta una sola actualización/upsert sobre el documento diario, añadiendo el registro inicial solo si quedan menos de cinco posiciones y `attemptId` no está; (3) si se agrega, ya consume cuota, aunque la validación funcional posterior falle; (4) una solicitud por encima del límite raw igualmente queda trazada mediante digest/longitud si alcanzó el punto de admisión; (5) si quota ya está agotada, rechaza sin añadir ni registrar; (6) después, actualiza ese subdocumento con el resultado. El índice de usuario/fecha evita documentos diarios duplicados. Colisiones/reintentos deben reutilizar el mismo `attemptId` y no doblar consumo.

La forma candidata es un único `findOneAndUpdate` con una actualización condicional tipo pipeline y `upsert`, que devuelve el documento resultante para comprobar si quedó incluido el `attemptId`. La operación completa se ejecuta atómicamente sobre un documento. La sintaxis concreta y su compatibilidad se verifican al conocer la versión del servidor; no asumir aquí proveedor ni versión. Para la admisión, una escritura separada de contador no se necesita.

**Riesgo de estado parcial:** la admisión inicial deja cuota e intento juntos en una escritura; la validación/procesamiento actualiza después el mismo subdocumento con otra escritura atómica. Si el proceso falla antes de esa actualización, queda un intento admitido en estado inicial, que sigue explicando el consumo. No se promete atomicidad de todo el flujo externo —validación, consultas de reputación, sandbox— como una única operación; se deben definir estados de procesamiento y cómo mostrar intentos incompletos.

La solicitud rechazada por cuota agotada no incrementa `attempts` y **no se registra en el registro de uso** (decisión confirmada por el usuario). Si en el futuro se desea contabilizar rechazos en otro lugar, deberá solicitarse como requisito separado; el modelo actual no los almacena.

### 4.5 Auditoría y eventos de seguridad (`security_audit_events` / `eventos_auditoria`)

Propósito: registrar acciones y resultados relevantes para trazabilidad y métricas administrativas, sin mezclar esos eventos con el perfil mutable de la cuenta.

Campos conceptuales: `_id`, `schemaVersion`, `occurredAt`, `purgeAt`, tipo de evento, tipo/ID de actor opcional, acción, resultado, recurso/referencia, requestId y metadatos allowlisted. Preferir referencias a solicitud/análisis y no duplicar la URL completa en auditoría; los parámetros de URL pueden contener valores sensibles. No registrar contraseñas, tokens, secretos de proveedores ni contenido sensible innecesario. Acceso de lectura solo mediante rutas backend autorizadas para `admin`. La colección no es inmutable por el mero hecho de ser de auditoría; el principal normal de aplicación solo inserta/consulta, mientras que la purga requiere privilegio operativo separado.

El catálogo inicial de eventos y la retención de 90 días aprobados para este ejercicio se describen en `schema-proposal.md`; no son políticas legales ni de producción. Los rechazos por cuota agotada se excluyen conforme a la decisión del usuario.

## 5. Integridad, acceso y seguridad

- Validadores de esquema para tipos y dominios de valores: rol, estados, veredictos, estructura del intento y campos requeridos; aplicar `maxItems: 5` al arreglo de solicitudes consumidoras. El consumo se deriva de `attempts.length`; no se persiste un contador duplicado (decisión confirmada).
- Restricciones de unicidad: correo normalizado; rol `admin` mediante índice parcial único (para impedir más de una cuenta admin, sin garantizar que exista una); combinación usuario/fecha para uso diario; `attemptId` global mediante índice único multikey más guardia contra duplicados dentro del arreglo; pareja `{keyType, normalizedKey}` para caché.
- Las referencias entre documentos se validan en la API (por ejemplo, que un análisis pertenezca al usuario autenticado). Un índice único no es una clave foránea ni garantiza integridad referencial entre colecciones.
- El backend verifica autenticación y rol en cada solicitud administrativa; no se confía en el rol declarado por el cliente.
- Las respuestas de métricas e historial se limitan y paginan; no se exponen hashes de contraseña ni metadatos de seguridad a usuarios normales.
- La cuenta pública debe recibir el rol `usuario` desde el backend; no aceptar el rol solicitado por el cliente. El aprovisionamiento de `admin` debe ser separado y controlado.
- Los validadores deben limitar cada arreglo de evidencia según los topes aprobados en `schema-proposal.md`, todavía pendientes de comprobar con datos sintéticos, para evitar crecimiento no acotado del documento. La captura permanece como referencia externa al documento, no como bytes embebidos.

## 6. Mapeo inicial a patrones

| Patrón | Documento(s) principalmente involucrados |
|---|---|
| P1 Autenticar y validar cuenta | Cuenta; documento diario para determinar uso actual |
| P2 Consultar caché reciente | Caché de reputación |
| P3 Admitir solicitud y registrar resultado | Una actualización del documento diario crea intento y consumo; actualizaciones posteriores completan el análisis en el mismo subdocumento |
| P4 Historial personal paginado | Seleccionar documentos diarios del usuario y aplanar/ordenar sus `attempts` por recepción; cursor estable debe considerar fecha e identificador de intento |
| P5 Detalle de análisis | Encontrar el intento/análisis embebido por su identificador y autorizar propietario salvo admin; validar índice y proyección |
| P6 Registrar cuenta | Cuenta |
| P7 Actualizar cuota y registrar intento | Documento diario de análisis; el tamaño de `attempts` determina consumos |
| Auditoría/seguridad acordada | Eventos de auditoría; los intentos consumidores se guardan junto con su registro de análisis diario |

Este mapeo es lógico; no incluye aún el catálogo completo de consultas ni sus índices.

### Patrones adicionales del panel admin

P1–P7 se complementan con consultas administrativas. Para eventos, el usuario confirmó únicamente filtros por intervalo de fechas y tipo; no agregar actor o resultado. Los índices candidatos A1/A2 están en `query-catalog.md`. Las agrupaciones exactas de métricas continúan sin definición; no se inventan filtros ni dimensiones. No medir ni persistir rechazos por cuota agotada.

**Costo de agrupar análisis por día:** P4/P5 dejan de ser consultas directas sobre documentos independientes. La opción elegida prioriza la atomicidad cuota + alta de solicitud; se debe probar la agregación/paginación P4 y búsqueda P5 con datos sintéticos representativos y `explain`. Si el costo no es aceptable, volver a separar análisis exigiría transacción para mantener la atomicidad original o una decisión explícita de cambiar el requisito.

## 7. Criterios de validación del diseño

Antes de implementarlo, comprobar que:

1. Dos solicitudes concurrentes no permiten superar cinco consumos para el mismo usuario/día.
2. La fecha local se calcula correctamente alrededor de medianoche y cambios de fecha en `America/Mexico_City`.
3. Una solicitud recibida con URL inválida consume cuota y deja su registro, pero no produce un resultado de análisis inexistente.
4. La sexta solicitud no consume cuota, se rechaza desde backend y no se añade al registro de uso ni de auditoría.
5. Usuarios normales solo listan y consultan sus análisis; admin puede consultar métricas/eventos a través de backend.
6. Los arreglos de resultados no exceden límites que se definan; la expiración de caché se verifica por fecha en consulta.
7. Cada consulta frecuente se corresponde con un índice candidato, que después se valida con planes `explain` y datos de prueba.
8. Dos solicitudes que inicializan el primer documento usuario/día no crean documentos duplicados ni pierden un consumo; reintentar una misma operación usa el mismo `attemptId` y no duplica su consumo.
9. Una solicitud admitida queda en el mismo documento que cuota incluso si un proceso se interrumpe; el estado permite distinguir que el intento consumió cuota aunque el análisis no finalice.
10. Una fuente vencida de caché no hace que se reutilice como vigente otra fuente con expiración diferente.

## 8. Verificación y alcance aún pendiente

El usuario aprobó los baselines de la propuesta para la actividad académica. Sus límites y períodos son parámetros del ejercicio, no valores legales ni de producción; el siguiente paso es comprobar su aplicación en MongoDB y con datos sintéticos.

Baseline seleccionado: MongoDB Community Server 8.0.x último parche, despliegue de ejercicio autogestionado sin sharding disponible. Falta probar validador, índices, TTL y actualización atómica en servidor. También se medirán P4/P5 con `explain` y datos representativos antes de afirmar rendimiento. Agrupaciones exactas del panel admin y proveedores concretos de reputación siguen abiertas; no se añaden filtros de actor/resultado.
