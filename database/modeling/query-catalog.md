# EnlaceSeguro — catálogo de consultas físicas (borrador)

**Estado:** catálogo revisado y aprobado por el usuario como base de diseño; los índices siguen siendo candidatos pendientes de validación empírica y no es código ejecutable ni esquema final.
**Fuente de patrones:** [`access-patterns.csv`](access-patterns.csv), P1–P7. El CSV fuente se conserva sin cambios; las decisiones confirmadas posteriores y el modelo vigente se explican en [`logical-model.md`](logical-model.md).
**Convenciones:** los nombres de colección/campo siguientes son nombres conceptuales del modelo; no se cierran nombres BSON definitivos. Los ejemplos de filtros son formas de consulta, no sintaxis de implementación.

## 1. Decisiones que condicionan las consultas

- MongoDB es el motor de la actividad BDaaS.
- Un documento `daily_analyses` por usuario y fecha local contiene `attempts[]`; su longitud determina consumo hasta cinco por día.
- La escritura de admisión crea el intento inicial en ese mismo documento. La sexta solicitud no se añade ni se registra.
- `attemptId` será único globalmente; la ruta de detalle puede conocer `localDate` (confirmado después de la revisión P4/P5).
- `localDate` representa el día calendario de `America/Mexico_City`; el backend calcula el valor.
- El historial personal y el detalle son lecturas backend. Solo el rol `admin` puede consultar métricas y auditoría.
- Baseline seleccionado: MongoDB Community Server 8.0.x, último parche disponible. Los índices aquí son candidatos; no incluyen opciones de hosting ni afirman costo/rendimiento comprobado.

## 2. Consultas por patrón

Los selectores se expresan de forma abreviada: `Q(filter, projection, sort, limit)` representa el filtro/proyección/orden/paginación previstos. Las operaciones de escritura se describen en términos de precondiciones e invariantes, no como un pipeline definitivo.

| ID | Operación y forma de acceso | Índice candidato | Estado / límites |
|---|---|---|---|
| P1a | Iniciar sesión: buscar una cuenta por `emailNormalized` y proyectar solo identificador, hash, rol y estado necesarios para verificar credenciales/autorización. | `users { emailNormalized: 1 }`, **único**. | Candidato directo; confirmar collation/normalización con esquema físico. No devolver hash al cliente. |
| P1b | Leer cuenta para sesión/autorización por `_id`. | Índice `_id` automático. | No se requiere índice adicional si se consulta por `_id`. La cuota se decide con P7, no leyendo un contador en `users`. |
| P2 | Caché por `{ keyType, normalizedKey }`; leer resultados de fuente y validar su vigencia individual antes de reutilizar. | `reputation_cache { keyType: 1, normalizedKey: 1 }`, **único**. | La clave se distingue por tipo (`url`/`domain`) para que la misma representación no colisione entre espacios; canonicalización exacta la hace backend. `purgeAt` TTL se calcula con la expiración más tardía de fuentes; cada resultado se valida por separado al leer. |
| P3/P7a | Admitir solicitud: ubicar el único documento por `{ userId, localDate }`; en una actualización atómica añadir el nuevo intento inicial solo cuando `attempts` tenga menos de cinco elementos y el `attemptId` no esté ya incluido. | `daily_analyses { userId: 1, localDate: 1 }`, **único**. | Es la invariante de cuota/registro. Si el documento aún no existe, usar upsert con manejo de colisión por unicidad y reintento de la misma operación; sintaxis/compatibilidad debe probarse con la versión elegida. La operación de aceptación debe devolver información suficiente al backend para distinguir admitido, ya admitido por reintento y cuota agotada. Rechazos agotados no escriben. |
| P3/P7b | Completar el intento ya admitido: actualizar el subdocumento correspondiente mediante `userId + localDate + attempts.attemptId` y cambiar estado/resultado; mantener juntos propietario y fecha en el selector. | Índice único `{ userId: 1, localDate: 1 }` para encontrar el documento; el índice multikey global de `attemptId` es para unicidad/global lookup y no se requiere en esta actualización que ya conoce la fecha. | La clave diaria localiza el documento; la actualización filtra el arreglo por `attemptId` y estado esperado. El índice global ya recomendado por integridad no elimina la guardia anti-duplicado dentro del documento. |
| P4 | Historial propio: `userId` se obtiene de la sesión autenticada. Filtrar documentos diarios del usuario y `purgeAt > now` (además de fechas UI si se incorporan), aplanar `attempts`, ordenar por `localDate DESC, receivedAt DESC, attemptId DESC`; continuar desde cursor compuesto. | `{ userId: 1, localDate: 1 }` único puede localizar días; no garantiza sort posterior a `$unwind` ni optimiza necesariamente el filtro adicional de `purgeAt`. | `attemptId` global desempata `receivedAt`; keyset recomendado frente a `$skip` profundo. Leer solo resumen. La retención de 365 días acota el conjunto lógico; el TTL físico es asíncrono, así que la consulta debe excluir vencidos. Validar costo con `explain`. |
| P5a | Detalle propio: `userId` se obtiene de sesión autenticada y la ruta conoce `localDate`; buscar el documento diario y seleccionar dentro de `attempts` el elemento con `attemptId`. | Índice único `{ userId: 1, localDate: 1 }` para localizar el padre. No se necesita multikey adicional para el lookup de esta ruta. | `attemptId` globalmente único está confirmado por el usuario; el filtro de elemento debe aun así seleccionar el subdocumento coincidente y autorizar por pertenencia. No indexar el subdocumento completo. |
| P5b | Detalle admin: localizar globalmente el padre por `attemptId` y extraer el elemento. La ruta admin devuelve `userId + localDate` en el resultado de búsqueda; esa información también puede servir para una segunda lectura por clave diaria si se prefiere ese flujo. | Índice único multikey `{ "attempts.attemptId": 1 }` para unicidad global y búsqueda de detalle global. La fila de listado admin también expone `userId + localDate`, que permite resolver por el índice diario único como alternativa de lectura. | La unicidad global confirmada se aplica como regla de integridad con el índice único multikey, aunque P5 propio ya conoce usuario y fecha. MongoDB no impide que el mismo documento repita una clave de arreglo; la escritura atómica debe verificar ausencia de duplicado en ese `attempts[]`. El índice también permite localizar globalmente P5 admin si la ruta solo recibe `attemptId`; su costo y plan real quedan por medir. |
| P6 | Alta de cuenta: insertar cuenta con correo normalizado y rol asignado por backend (`usuario`). | Índice único `{ emailNormalized: 1 }`. | Evita correos duplicados. La regla de una sola cuenta `admin` no la garantiza por sí solo este índice; el aprovisionamiento controlado sigue siendo necesario. |
| A1 | Panel admin — eventos por intervalo: filtrar `occurredAt` en el rango elegido y `purgeAt > now`, ordenar por `occurredAt` y `_id` descendentes, paginar con cursor. | `security_audit_events { occurredAt: -1, _id: -1 }`; `purgeAt` puede quedar como filtro residual. | Baseline de retención 90 días. TTL es eventual; la consulta excluye vencidos por fecha efectiva. El índice candidato no implica que el filtro residual sea barato; comprobarlo. |
| A2 | Panel admin — eventos cuando se selecciona tipo: filtrar `eventType` por igualdad, intervalo temporal y `purgeAt > now`; ordenar por `occurredAt` y `_id` descendentes y paginar. | `{ eventType: 1, occurredAt: -1, _id: -1 }`; `purgeAt` puede quedar como filtro residual. | Filtros de usuario confirmados: intervalo y tipo solamente. No se contemplan filtros por actor ni resultado. Retención 90 días; validar ambos filtros de sistema/usuario en `explain`. |
| A3 | Panel admin — métricas de intentos/análisis: filtrar documentos diarios por rango de `localDate`, opcionalmente por `userId`; aplanar `attempts` y agrupar por dimensiones confirmadas (p. ej. estado/veredicto si se solicitan). | Global por rango: candidato `{ localDate: 1 }`; por usuario/rango: `{ userId: 1, localDate: 1 }` único. | La selección de días puede usar índice; el cálculo agregado sobre el arreglo requiere validación. No incluir solicitudes rechazadas por cuota porque no existen en los registros. Las métricas exactas y dimensiones permanecen abiertas. |

## 2.1 P4 — alternativas concretas de paginación

| Opción | Cursor/orden | Qué resuelve | Limitación relevante |
|---|---|---|---|
| `$skip` + `$limit` | Orden total descendente `localDate, receivedAt, attemptId`; saltar N filas después de aplanar. | Páginas numeradas sencillas y saltos directos. | En páginas profundas debe recorrer/procesar las filas anteriores; además el índice diario no garantiza el sort posterior a `$unwind`. No recomendada frente a keyset; historial limitado por retención v1 de 365 días. |
| Keyset/cursor compuesto | Continuar estrictamente después de la última tupla `(localDate, receivedAt, attemptId)` de la página anterior; conservar el mismo orden en cada petición. | Evita offsets crecientes y mantiene orden estable entre páginas mientras los datos de la ventana no cambien. | Requiere clave de desempate única y serializar la tupla en el cursor. Como los documentos contienen arreglos, cursor y filtro de continuación se aplican a las filas de intento después del aplanado. No quita el costo de leer días ni de ordenar resultados. |
| Cursor con fecha inferior | Además de la tupla anterior, limitar días a `localDate <= cursor.localDate`; en la primera página, usar el rango temporal solicitado. | Reduce días que deben considerarse al avanzar hacia atrás. | El rango solo es correcto si `localDate` se deriva consistentemente de `receivedAt` con `America/Mexico_City`; rango y desempate deben tratar el borde de medianoche local. |

**Recomendación provisional:** keyset compuesto para historial, con orden lexicográfico por día local, hora de recepción e identificador. En cada página se requieren `userId` autenticado, filtros de fecha únicamente si la interfaz los incorpora, límite de página y cursor opaco. La proyección debe retornar solo los campos del resumen P4, no toda la evidencia del análisis. La página puede mezclar intentos de varios documentos diarios; por ello el índice `{ userId, localDate }` es un prefiltro de padres, no prueba que el agregado entero esté cubierto por índice. Si se requiere orden cronológico absoluto, confirmar que `localDate` y `receivedAt` se calculan de modo que el orden por día y luego hora es equivalente a ordenar por instante.

## 2.2 P5 — alternativas concretas de detalle

| Parámetros disponibles en la ruta | Búsqueda del documento padre | Índice candidato | Decisión/condición |
|---|---|---|---|
| `userId + localDate + attemptId` | Buscar el único documento diario del usuario y día, después seleccionar el `attempt` con ese ID. | `{ userId: 1, localDate: 1 }` único. | Ruta compatible con los parámetros confirmados; el usuarioId procede de sesión para usuarios normales. El motor carga el documento diario, máximo cinco intentos; validar proyección/operador de extracción con versión elegida. |
| `userId + attemptId` | Buscar el documento del usuario que contiene el ID. | Candidato `{ userId: 1, "attempts.attemptId": 1 }` multikey. | Alternativa si la ruta no entrega `localDate`; ahora es menos necesaria porque la ruta podrá conocerlo. No aprobado como índice adicional. |
| `attemptId` solamente | Buscar globalmente el documento diario que contiene el ID. | Índice único `{ "attempts.attemptId": 1 }` multikey recomendado por unicidad global; también localiza el padre. | No impide duplicados dentro del mismo arreglo: la actualización debe verificar ausencia de ID en ese documento. |

En todos los casos P5 recibe el intento identificado, verifica propiedad para usuario normal (admin solo mediante autorización backend) y proyecta únicamente los campos de detalle necesarios. Como la ruta puede conocer `localDate`, la recomendación para P5 propio es resolver padre con `{ userId, localDate }` y extraer el elemento por `attemptId`, evitando un índice multikey propio adicional. El listado admin debe devolver `userId + localDate` junto al resumen para dar opción al detalle por clave diaria; el índice único global multikey se conserva principalmente para garantizar unicidad global y también admite búsqueda por `attemptId` solo. No indexar campos grandes de resultados ni la captura.

## 3. Inventario inicial de índices candidatos

Lista consolidada: el bootstrap declara estos índices, pero aún no se han creado ni medido; “único” describe la condición que se intenta imponer, no una restricción ya verificada:

| Colección | Índice candidato | Motivo / decisión |
|---|---|---|
| `users` | `{ emailNormalized: 1 }` único | P1 inicio de sesión y P6 alta sin duplicar correo. |
| `users` | `{ role: 1 }` único con filtro parcial `role == "admin"` | Recomendación de integridad para permitir como máximo una cuenta admin; no garantiza que exista una. Validar opciones con la versión MongoDB elegida. |
| `daily_analyses` | `{ userId: 1, localDate: 1 }` único | P3/P7 cuota atómica, localización diaria e identidad del documento. |
| `daily_analyses` | `{ userId: 1, localDate: -1 }` (o verificar si el único basta) | P4 localiza documentos diarios por usuario y día. No garantiza sort de filas tras `$unwind`; confirmar si duplica valor frente al único con datos/plan real. |
| `daily_analyses` | `{ userId: 1, "attempts.attemptId": 1 }` multikey | P5 solo si una ruta no recibe `localDate`; menos necesario ahora que la ruta podrá conocerla. No aprobado. |
| `daily_analyses` | `{ "attempts.attemptId": 1 }` multikey único | Garantizar unicidad global confirmada de `attemptId`; además soporta localización global para P5 admin si llega solo el ID. La actualización debe impedir duplicados dentro del mismo documento porque unique multikey no los impide. Candidato de integridad recomendado; costo/compatibilidad aún sin medir. |
| `daily_analyses` | `{ localDate: 1 }` | A3 métricas globales por intervalo; candidato sujeto a las consultas admin que se confirmen. |
| `reputation_cache` | `{ keyType: 1, normalizedKey: 1 }` único | P2 cache por valor normalizado y tipo de clave para evitar colisión URL/dominio. |
| `security_audit_events` | `{ occurredAt: -1, _id: -1 }` | A1 consultas paginadas por intervalo, incluso cuando no se filtra por tipo; verificar el filtro residual de `purgeAt`. |
| `security_audit_events` | `{ eventType: 1, occurredAt: -1, _id: -1 }` | A2 con igualdad por tipo y rango temporal; verificar `purgeAt` residual. Sin filtros por actor o resultado. |
| `daily_analyses` | `{ purgeAt: 1 }` TTL (`expireAfterSeconds: 0`) | Purga eventual de documentos diarios después de 365 días según `purgeAt`; lecturas también excluyen vencidos. |
| `reputation_cache` | `{ purgeAt: 1 }` TTL (`expireAfterSeconds: 0`) | Purga eventual al haber vencido todas las fuentes; la lectura sigue comprobando cada fuente por separado. |
| `security_audit_events` | `{ purgeAt: 1 }` TTL (`expireAfterSeconds: 0`) | Purga eventual al cumplir 90 días; lecturas no muestran datos vencidos aunque sigan presentes físicamente. |

La dirección de los campos debe coincidir con los filtros/orden reales. Los índices que comparten campos no son automáticamente redundantes ni automáticamente útiles; el bootstrap prepara las restricciones y candidatos anteriores, pero su permanencia/beneficio debe evaluarse con explain antes de considerar rendimiento validado.

## 4. Límites conocidos del modelo y validación

1. **Un documento diario tiene como máximo cinco intentos** y los arreglos de evidencia aplican límites v1 aprobados. El objetivo total ≤8 MiB no lo hace cumplir JSON Schema: medir BSON serializado en backend y comprobar con pruebas.
2. **Historial P4 es el riesgo principal de rendimiento:** la unidad de almacenamiento es un día, no un análisis. La paginación por cursor evita el costo de offsets crecientes, pero no elimina el aplanado/orden global de filas. Validar `$match` inicial por usuario/días, `$unwind`, sort compuesto y páginas que cruzan fechas. No asumir que el índice multikey ordena la salida aplanada.
3. **Detalle P5:** para usuario normal, ruta con `userId` autenticado + `localDate` conocida permite usar solo el índice diario único y extraer por `attemptId`; se descarta índice multikey propio salvo que medición revele necesidad distinta. La unicidad global de `attemptId` está confirmada; un índice multikey global único se recomienda como control de unicidad global y puede atender lookup admin directo por ID. MongoDB no aplica unicidad de valores de arreglo repetidos dentro del mismo documento, por lo que también debe validarse en escritura.
4. **Cuota:** pruebas concurrentes deben cubrir creación simultánea del primer documento, solicitudes compitiendo por el quinto lugar, sexto rechazo sin escritura, y reintento de una operación sin doble consumo.
5. **Auditoría/métricas:** los filtros admin de eventos confirmados son intervalo y tipo; A1 cubre intervalo sin tipo y A2, igualdad por tipo con rango/orden temporal. No agregar filtros ni índices por actor/resultado. La lista de eventos y retención inicial están en la propuesta aprobada; las agrupaciones de métricas siguen abiertas. Excluir rechazos por cuota agotada en todos los contadores persistidos.
6. **Plan de verificación posterior:** cargar datos sintéticos representativos, ejecutar cada consulta con `explain("executionStats")`, observar índice ganador, documentos examinados/de vueltos, necesidad de sort/uso de memoria y costo de escritura; revisar índices tras cada ajuste. No se ha ejecutado aún MongoDB ni un benchmark.

## 5. Decisión confirmada sobre filtros admin

El usuario confirmó que la primera versión del panel admin filtrará eventos únicamente por intervalo de fechas y tipo. No incluir filtros por actor ni resultado. Los índices A1 y A2 anteriores son candidatos coherentes con esos dos accesos; su conveniencia final debe comprobarse con los patrones ejecutados y `explain`.

## Referencias técnicas

- [MongoDB: multikey indexes](https://www.mongodb.com/docs/manual/core/indexes/index-types/index-multikey/) — las consultas sobre arreglos pueden usar índices multikey; el ordenamiento sobre un campo multikey puede requerir sort en memoria.
- [MongoDB: unique indexes](https://www.mongodb.com/docs/manual/core/index-unique/) — la unicidad de un índice multikey impide colisiones entre documentos, pero permite claves repetidas que provengan del mismo documento.
- [MongoDB: compound indexes](https://www.mongodb.com/docs/manual/core/indexes/index-types/index-compound/) — un índice compuesto atiende consultas con sus campos o prefijos, y el orden de claves importa.
- [MongoDB: use indexes to sort query results](https://www.mongodb.com/docs/manual/tutorial/sort-results-with-indexes/) — requisitos de correspondencia entre orden e índice.
- [MongoDB: atomicity and transactions](https://www.mongodb.com/docs/manual/core/write-operations-atomicity/) — una escritura es atómica a nivel de documento.
- [MongoDB: partial indexes](https://www.mongodb.com/docs/manual/core/index-partial/) — útil para recomendar una restricción única que aplique solo a documentos con `role: admin`.
- [MongoDB: upsert with unique index](https://www.mongodb.com/docs/manual/reference/method/db.collection.findandmodify/#upsert-with-unique-index) — filtros de upsert deben estar cubiertos por unicidad para evitar documentos duplicados; la colisión/reintento debe manejarse en la aplicación.
- [MongoDB: unique multikey indexes](https://www.mongodb.com/docs/manual/core/index-unique/) — un índice único multikey permite duplicados de claves dentro del mismo documento pero no entre documentos.
