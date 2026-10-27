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
*   Flujo: Ejecutar un único `findOneAndUpdate` atómico a nivel de documento con filtro condicional:
    ```javascript
    {
      userId: ObjectId,
      localDate: "YYYY-MM-DD",
      $expr: { $lt: [{ $size: { $ifNull: ["$attempts", []] } }, 5] },
      "attempts.attemptId": { $ne: newAttemptId }
    }
    ```
    combinado con operador `$push: { attempts: newAttempt }` y `upsert: true`.

**Análisis Adversarial (Evaluación de Riesgos y Mitigación):**
*   *¿Riesgo de exceder el límite BSON de 16 MiB?*  
    *Verificación:* Con un límite duro de $5$ intentos por documento, un límite de entrada UTF-8 cruda $\le 8\text{ KiB}$ y almacenamiento de evidencias ligeras (señales y capturas como referencia opaca URI, no bytes binarios dentro de BSON), el tamaño máximo proyectado por documento es de aproximadamente $180\text{ KiB}$, lo que representa el **1.1% del límite máximo de 16 MiB de MongoDB**.
*   *¿Sobrecosto en consultas de historial (P4) por necesitar `$unwind`?*  
    *Verificación:* Cada usuario genera a lo sumo un documento por día activo. Un usuario con un año continuo de uso acumula como máximo 365 documentos. Mediante un índice compuesto `{ userId: 1, localDate: 1 }` y paginación por cursor compuesto (keyset), el pipeline de agregación procesa un subconjunto mínimo de documentos en memoria sin escaneos masivos de colección (`COLLSCAN`).

---

## 3. Decisión

Se aprueba la **Propuesta B**:
1. Implementar la colección `daily_analyses` con esquema `$jsonSchema` estricto limitando `attempts` con `maxItems: 5`.
2. Resolver cuota y registro inicial mediante una sola operación `findOneAndUpdate` atómica por documento.
3. Imponer índice único compuesto `{ userId: 1, localDate: 1 }` para identidad diaria e índice único multikey en `attempts.attemptId` para integridad global.
4. Descartar contadores duplicados redundantes; el consumo se deriva directamente de la cardinalidad de `attempts.length`.

---

## 4. Consecuencias

*   **Positivas:**
    *   Atomicidad garantizada sin transacciones multi-documento.
    *   Tiempo de respuesta de admisión $O(1)$ sub-5ms.
    *   Compatibilidad universal con MongoDB standalone, réplica y clusters BDaaS gestionados.
    *   Purga automática simplificada mediante índice TTL en `purgeAt` a 365 días sobre el documento padre.
*   **Negativas / Compromisos mitigados:**
    *   La consulta de detalle P5 o de historial P4 requiere `$unwind` o proyección posicional (`$elemMatch`), requiriendo pruebas con `explain()` y paginación por cursor keyset implementadas en el backend.
