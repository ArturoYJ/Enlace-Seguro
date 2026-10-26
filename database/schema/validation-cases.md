# Matriz de pruebas para validadores MongoDB

**Estado:** casos diseñados; no se han ejecutado en MongoDB. Correr en una instancia de prueba limpia compatible con MongoDB 8.0.x antes de usar los validadores.

## Casos comunes

| Caso | Ejemplo/operación | Resultado esperado |
|---|---|---|
| Documento con todos los campos requeridos y tipos correctos | Insertar un ejemplo válido de cada colección | Aceptado |
| Propiedad extra en raíz o subdocumento con allowlist cerrada | Añadir `unexpected: true` | Rechazado |
| `schemaVersion` distinto de 1 | Usar 2 o texto | Rechazado |
| BSON type incorrecto | Por ejemplo, fecha ISO string en lugar de BSON Date | Rechazado |

## `users`

| Caso | Resultado esperado |
|---|---|
| `role` es `admin` o `usuario`; `accountStatus` es `active` o `disabled` | Aceptado |
| Rol/estado fuera del enum o faltar `passwordHash` | Rechazado |
| Dos documentos con mismo `emailNormalized` | Segundo rechazo por índice único |
| Dos documentos con rol `admin` | Segundo rechazo por índice parcial único |
| Ningún documento con rol `admin` | Permitido por esquema; provisionamiento inicial se controla fuera de índice/validador |

## `daily_analyses`

| Caso | Resultado esperado |
|---|---|
| Documento con 0 a 5 intentos y UUID v4 canónicos | Aceptado si cumple el resto del contrato |
| `attempts` con seis elementos, status desconocido, ID UUID no canónico o `purgeAt` ausente | Rechazado |
| Intento admitido con `inputDigest` SHA-256 hex y `inputSizeBytes`; `submittedInput` está presente solo si el original está dentro del tope | Aceptado |
| Solicitud recibida que excede 8 KiB UTF-8 | Backend admite/cuota primero; guarda hash y longitud, omite `submittedInput`, marca `validation_failed`; no guarda/trunca el contenido largo |
| Estado `validation_failed` sin `analysis` | Aceptado; el resultado analítico puede no existir tras error de validación |
| `completed` sin `analysis` | El validador estructural actual lo acepta; la API debe imponer la regla condicional |
| Dos documentos diarios del mismo `{userId, localDate}` | Segundo rechazo por índice único |
| Mismo `attemptId` en dos documentos diarios | Segundo rechazo por unique multikey |
| Mismo `attemptId` repetido dos veces dentro de `attempts[]` del mismo documento | No confiar en unique multikey; debe rechazarse mediante guardia atómica del backend y probarse en test de concurrencia |
| `attempts.length` cruza 4 a 5 concurrentemente y luego otra admisión | La API admite como máximo una quinta posición; el siguiente intento no se escribe. No se verifica con JSON Schema solo |
| Campo de evidencia/redirecciones que supere el tope o tipo inesperado | Rechazado |

## `reputation_cache`

| Caso | Resultado esperado |
|---|---|
| `keyType` `url` o `domain`, 1–4 resultados fuente con fechas BSON | Aceptado |
| `keyType` fuera de catálogo o 5 fuentes | Rechazado |
| Igual `{keyType, normalizedKey}` repetido | Segundo rechazo por índice único |
| Una fuente expirada junto a otra vigente | La lectura ignora la fuente vencida; no se infiere validez del documento entero |

## `security_audit_events`

| Caso | Resultado esperado |
|---|---|
| `eventType` del catálogo, fecha/`purgeAt` BSON y metadatos allowlisted | Aceptado |
| Evento no listado, metadato arbitrario, texto demasiado largo o `outcome` desconocido | Rechazado |
| Lectura de eventos con rol `usuario` | Rechazo por autorización del backend; no lo impone el validador de documentos |
| Rechazo por cuota agotada | No insertar documento de auditoría, según política confirmada |

## `refresh_tokens`

| Caso | Resultado esperado |
|---|---|
| Documento con `userId` ObjectId, `tokenHash` SHA-256 (64 hex), `familyId` UUID v4, fechas BSON | Aceptado |
| `tokenHash` que no sea string hexadecimal de 64 caracteres | Rechazado |
| `familyId` que no sea UUID v4 válido | Rechazado |
| Campo no permitido (violación de `additionalProperties: false`) | Rechazado |
| Dos documentos con el mismo `tokenHash` | Segundo rechazo por índice único |
| Múltiples tokens con el mismo `familyId` o `userId` | Aceptado (para tracking de rotación y sesiones concurrentes) |
| Token con `expiresAt` en el pasado | Eliminación asíncrona por índice TTL (`expireAfterSeconds: 0`) |
| Intento de rotación con `isRevoked: true` | Detección de reúso en backend: revocación de toda la familia `familyId` |

## Índices TTL y retención

- Insertar documentos con `purgeAt` en el pasado y verificar que el proceso TTL los elimina eventualmente, no asumir borrado inmediato.
- Verificar que endpoints excluyan datos vencidos incluso antes del borrado físico.
- Validar que `daily_analyses.purgeAt` corresponda al fin del día local más la ventana de 365 días, `security_audit_events.purgeAt` a 90 días y el `purgeAt` de caché a la fecha más tardía entre sus fuentes.
- La captura externa expira en su almacenamiento privado a 30 días; la base solo conserva una referencia y no purga el objeto externo.

## Invariantes fuera de `$jsonSchema`

Los casos siguientes requieren funciones de API/integración y no pueden declararse verificados con pruebas de JSON Schema: RBAC y aislamiento de usuarios; transiciones de estado frente al estado previo; fecha local y consistencia `localDate`/`receivedAt`; unicidad intradocumento con concurrencia; cuota atómica/idempotencia; política de reintentos; consistencia entre estado final y presencia de `analysis`; el límite total de bytes BSON; y purga de capturas externas.
