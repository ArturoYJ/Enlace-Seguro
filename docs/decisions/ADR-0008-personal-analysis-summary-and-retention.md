# ADR-0008: Métricas personales y retención de análisis

- **Estado:** Aprobada por el usuario; API, UI y migración implementadas y verificadas localmente; E2E instalado remoto y staging pendientes.
- **Fecha:** 2026-11-04
- **Área:** Métricas personales, privacidad y retención de `daily_analyses`

## Contexto

La pantalla Figma `3.1 Inicio` incluye conteos de análisis, peligrosos y sospechosos. El backend guardaba intentos dentro de un documento por usuario y día local, con un único TTL por documento. Una ventana móvil de 365 días exactos podría subcontar en su borde si el documento diario se eliminara antes de que su último intento saliera del intervalo.

## Decisión

1. Exponer `GET /analyses/summary` solo a una sesión autenticada. Derivar el propietario del JWT; no aceptar `userId`, fechas ni período del cliente. Retornar únicamente conteos, sin IDs, URL/entrada, digest ni datos de proveedor.
2. Definir la ventana con un instante de referencia del servidor y el intervalo semiabierto exacto `[now − 365×24 h, now)`, aplicándolo a `attempts.receivedAt`.
3. `total` cuenta todos los intentos admitidos cuyo `receivedAt` cae en el intervalo, sin excluir estados pendientes, fallidos, no concluyentes o de validación fallida. Los conteos peligrosos/sospechosos usan solo `analysis.verdict` persistido igual a `peligroso` o `sospechoso`.
4. Retener historia `daily_analyses` durante 366 días desde el intento más reciente del documento. `purgeAt = max(attempts.receivedAt) + 366 días`; cada nueva admisión actualiza el vencimiento. La migración de documentos existentes calcula el valor desde su intento más reciente, no desde la fecha de migración.
5. Como todos los intentos de un mismo día comparten TTL, los intentos anteriores pueden persistir hasta menos de 24 horas adicionales; ninguno se purga antes de 366 días. Mantener lecturas con filtro de expiración aunque el borrado físico TTL sea eventual.
6. Figma muestra 18/4/3 solo como contenido de muestra. La aplicación usa respuesta real y estados de carga, error y cero; nunca presenta valores de muestra como datos del usuario.

## Consulta y seguridad

El repositorio deriva `userId` de autenticación y filtra propietario y fechas locales candidatas antes de `$unwind`. Después compara `receivedAt` con ambos límites exactos y agrupa. El índice diario existente `{ userId: 1, localDate: 1 }` sirve al prefiltro; no elimina el filtro exacto posterior al unwind. El endpoint no expone entradas, identificadores o hashes y debe responder como contenido privado/no almacenable.

## Consecuencias y límites

- La persistencia extiende el baseline académico de historia cifrada de 365 a 366 días para cubrir con margen la ventana rolling; esto no es política legal ni retención aprobada para producción.
- El TTL de MongoDB no equivale a purga física inmediata. Las lecturas excluyen documentos cuyo vencimiento ya ocurrió.
- No retener más allá del plazo configurado para la métrica; cualquier política productiva requiere revisión de privacidad, eliminación de usuario y operación de claves.
- Los conteos reflejan solicitudes admitidas, no la seguridad futura del enlace ni consultas a proveedores externos.

## Verificación requerida

- Pruebas HTTP: 401, aislamiento entre propietarios, intento sin veredicto, estados terminales, cero datos, rechazo de overrides `userId`/fechas y DTO sin identificadores/URL/digest.
- Mongo replica set desechable: límites inclusivo/exclusivo exactos del intervalo, transición por el borde, retención de 366 días al crear y al añadir intentos, y migración 006 desde datos anteriores usando `max(receivedAt)`.
- `explain()` con datos sintéticos; probar concurrencia/atomicidad de admisión existente y asegurar que TTL no permita subconteo.
- UI móvil: datos reales, carga/error/reintento/cero, accesibilidad y ninguna cifra del prototipo.
- No considerar producción validada hasta comprobar restauración, retención/purga, autorización y operación en staging.

## Referencias

- [`schema-proposal.md`](../../database/modeling/schema-proposal.md)
- [`query-catalog.md`](../../database/modeling/query-catalog.md)
- [`mobile-implementation-plan.md`](../roadmap/mobile-implementation-plan.md)
- [`006_extend_analysis_history_retention_366_days.js`](../../database/migrations/006_extend_analysis_history_retention_366_days.js)
