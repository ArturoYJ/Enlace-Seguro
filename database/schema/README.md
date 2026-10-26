# Esquema físico MongoDB

## Motor y alcance

El usuario confirmó MongoDB para la actividad BDaaS y aprobó el esquema propuesto. Para que los artefactos sean reproducibles, se adopta como baseline **MongoDB Community Server 8.0.x, autogestionado y sin sharding para el ejercicio, siempre en el último parche disponible de la serie**. Esta versión se usa para redactar y revisar el contrato; el script no se ha ejecutado contra un servidor. La documentación oficial actualmente identifica la serie 8.0 como release estable y recomienda usar el parche más reciente. [Release notes 8.0](https://www.mongodb.com/docs/v8.0/release-notes/), [versiones y actualizaciones](https://www.mongodb.com/docs/mongodb-versions/).

## Artefactos

- `collection-validators.js`: contratos `$jsonSchema` con BSON types, campos allowlisted, enums y límites aprobados para la propuesta.
- `../migrations/001_create_mongodb_schema.js`: crea colecciones nuevas, instala validadores e índices de integridad/consulta. Es un script de migración de una sola aplicación en una base nueva; falla sin modificar datos si alguna colección existe ya.
- `validation-cases.md`: matriz de casos positivos/negativos que debe ejecutarse en una instancia de prueba MongoDB 8.0.x antes de considerar validadores verificados.

## Límites de responsabilidad

- Los validadores limitan la forma de los documentos; la API todavía debe controlar RBAC, pertenencia de `userId`, transiciones entre estados, cálculo de `localDate`/`purgeAt`, deduplicación de `attemptId` dentro del mismo arreglo, referencias entre colecciones, normalización y requisitos condicionales de campos.
- El índice único multikey protege la unicidad de `attemptId` entre documentos, pero no rechaza claves repetidas generadas dentro del mismo documento.
- Un JSON Schema no impone el tamaño BSON serializado total de 8 MiB propuesto; el backend debe medir bytes antes de actualizar y no truncar silenciosamente.
- Los índices `expireAfterSeconds: 0` procesan documentos vencidos de forma asíncrona. Las lecturas deben respetar `purgeAt` aun cuando un documento vencido siga físicamente presente. El TTL no aplica a capturas externas ni resuelve expiración heterogénea de fuentes dentro de la caché.
- El script no crea usuarios/roles de MongoDB, no concede permisos, no inserta cuentas admin, no elimina ni modifica colecciones existentes y no establece conexión por sí mismo. Las credenciales y el acceso del backend deben configurarse fuera del repositorio con mínimo privilegio.

## Ejecución y estado

No ejecutar el script contra una BD con datos reales. Primera verificación prevista: un MongoDB 8.0.x de prueba limpio, carga de casos válidos/ inválidos de `validation-cases.md`, prueba de índices únicos/TTL y confirmación de rechazo por validador. Hasta completar eso, los validadores son artefactos preparados pero no comprobados por MongoDB.
