# ADR-0002: Atomicidad de cuota y modelo de análisis diarios embebidos en MongoDB

- **Estado:** Aceptada
- **Fecha:** 2026-10-26
- **Área:** Base de Datos como Servicio (BDaaS) y Arquitectura de Persistencia

---

## 1. Contexto y Problema

El sistema EnlaceSeguro requiere imponer una cuota estricta de consumo: **máximo 5 solicitudes de análisis por usuario por día calendario** en la zona horaria `America/Mexico_City`.

En un entorno BDaaS (MongoDB 8.0.x), se deben satisfacer simultáneamente los siguientes invariantes:
1. **Consistencia y prevención de condiciones de carrera:** Dos solicitudes simultáneas que compitan por la quinta posición nunca deben permitir que se admita una sexta solicitud.
2. **Atomicidad de admisión:** La deducción de cuota y el alta del intento de análisis (con su estado inicial `received`, `attemptId` UUID v4 y digest SHA-256) deben ocurrir en una única operación atómica indivisible.
3. **No registrar solicitudes rechazadas:** Conforme a la política de privacidad y auditoría, los rechazos por cuota agotada no deben persistirse en el almacenamiento ni incrementar contadores.
4. **Minimización de latencia:** Evitar bloqueos pesados o sobrecostos de coordinación en despliegues distribuidos o entornos de réplica.

---

## 2. Alternativas Evaluadas (Comparativa Adversarial / COVE)

### Propuesta A: Modelo Normalizado con Transacciones Multi-Documento

Separar el almacenamiento en dos colecciones:
*   `quotas`: `{ userId, date, count }`
*   `analyses`: `{ attemptId, userId, date, ... }`
*   Flujo: Abrir sesión transaccional (`session.withTransaction`), verificar `count < 5`, incrementar `count` e insertar el documento en `analyses`.

**Análisis Adversarial (Contra-argumentos):**
*   *Sobrecosto de red y latencia:* En arquitecturas BDaaS (Atlas, Replica Sets), `withTransaction` exige coordinar bloqueos distribuidos y replicación sincrónica con write concern `majority`, elevando la latencia de 3 ms a más de 50 ms por solicitud de admisión.
*   *Requisitos de topología:* Exige obligatoriamente un Replica Set configurado; falla en instancias standalone de prueba o prototipado simple.
*   *Riesgo de transacciones huérfanas:* Ante cortes transitorios de red, las sesiones abiertas consumen memoria en el pool de transacciones de WiredTiger.

### Propuesta B: Documento Diario Agrupado con Arreglo Acotado Embebido (Elegida)

Unificar la partición diaria y los intentos de análisis en un solo documento por usuario y día en la colección `daily_analyses`:
*   Estructura: `{ userId, localDate, attempts: [Attempt], purgeAt }`
*   Flujo: ejecutar un único `findOneAndUpdate` atómico por `{ userId, localDate }`, usando una actualización pipeline que evalúa longitud y duplicidad dentro del documento y concatena el intento solo si hay capacidad. El filtro de identidad excluye el mismo `attemptId`; los índices únicos diario/global cubren carreras de upsert y el adaptador traduce colisiones a `duplicate_attempt_id` o `quota_exceeded`.

    **Restricción descubierta en validación:** MongoDB 8.0.34 rechaza `$expr` dentro de un filtro usado con `upsert` (`QueryFeatureNotAllowed`, código 224). Por ello, la condición de cuota vive en el pipeline de actualización; la sintaxis ejecutable está en `api/src/infrastructure/database/mongo/MongoDailyAnalysisRepository.ts`.

**Análisis Adversarial (Evaluación de Riesgos y Mitigación):**
    *   *¿Riesgo de exceder el límite BSON de 16 MiB?*
    *Verificación inicial (supuesto histórico, supersedido):* La estimación original suponía entrada en claro ≤8 KiB y ~180 KiB/documento; ya no describe el contrato actual.
*   *¿Sobrecosto en consultas de historial (P4) por necesitar `$unwind`?*  
    *Verificación:* Cada usuario genera a lo sumo un documento por día activo. Un usuario con un año continuo de uso acumula como máximo 365 documentos. Mediante un índice compuesto `{ userId: 1, localDate: 1 }` y paginación por cursor compuesto (keyset), el pipeline de agregación procesa un subconjunto mínimo de documentos en memoria sin escaneos masivos de colección (`COLLSCAN`).

---

## 3. Decisión

Se aprueba la **Propuesta B**:
1. Implementar la colección `daily_analyses` con esquema `$jsonSchema` estricto limitando `attempts` con `maxItems: 5`.
2. Resolver cuota y registro inicial mediante una sola operación `findOneAndUpdate` atómica por documento.
3. Imponer índice único compuesto `{ userId: 1, localDate: 1 }` para identidad diaria e índice único multikey en `attempts.attemptId` para integridad global.
4. Descartar contadores duplicados redundantes; el consumo se deriva directamente de la cardinalidad de `attempts.length`.

## 3.1 Verificación de implementación (2026-11-03)

- Bootstrap, validadores e índices ejecutados en MongoDB 8.0.34 efímero; smoke de esquema con 21 assertions aprobado.
- Prueba de integración API↔Mongo ejecutó 20 admisiones concurrentes: exactamente cinco aceptadas y quince rechazadas por cuota, sin errores del driver; también verificó duplicado, sexto intento, colisión global de `attemptId` y lectura/actualización del intento.
- La prueba inicial falló reproduciblemente por `$expr` en upsert. La actualización pipeline pasó en tres ejecuciones. P4/P5 `explain`, TTL eventual, backup/restore y despliegue siguen pendientes; no se afirma rendimiento productivo.

---

## 4. Consecuencias

*   **Positivas:**
    *   Atomicidad garantizada sin transacciones multi-documento.
    *   Admisión y cuota se verifican en una sola operación atómica por documento. La latencia aún no se ha medido.
    *   Compatibilidad universal con MongoDB standalone, réplica y clusters BDaaS gestionados.
    *   Purga automática simplificada mediante índice TTL en `purgeAt` a 366 días sobre el documento padre.
*   **Negativas / Compromisos mitigados:**
    *   La consulta de detalle P5 o de historial P4 requiere `$unwind` o proyección posicional (`$elemMatch`), requiriendo pruebas con `explain()` y paginación por cursor keyset implementadas en el backend.

## 4.1 Actualización aprobada de política de entrada (2026-11-03)

El usuario aprobó conservar el contrato de entrada de hasta 64 KiB UTF-8 y cifrar cada entrada con AES-256-GCM antes de persistirla en `daily_analyses.attempts.submittedInputEncrypted`, con retención diaria aprobada de 366 días (no es política legal/productiva); los detalles de ventana personal constan en ADR-0008. El backend autentica como AAD `userId`, `localDate` y `attemptId`; nuevas escrituras no conservan `submittedInput` en claro. `ANALYSIS_INPUT_ENCRYPTION_KEY` es una clave base64url canónica de 32 bytes, externa al repo y común a réplicas. Migración forward-only 003 amplía el validador sin reescribir plaintext histórico (hasta 8 KiB), que sigue siendo legible.

El ciphertext base64url puede medir hasta 87,382 caracteres por intento; cinco valores máximos suman aproximadamente 427 KiB de ciphertext, alrededor de 2.6% de BSON 16 MiB (sin contar metadatos/resultados); el total final debe mantenerse bajo el objetivo de 8 MiB por documento y seguir midiéndose. Respaldo y rotación de clave, gestor de secretos, eliminación de usuario y retención productiva quedan pendientes antes del lanzamiento.
