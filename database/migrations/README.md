# Migraciones

El motor de la actividad es MongoDB. `001_create_mongodb_schema.js` es un bootstrap de una sola aplicación dirigido a una base vacía; crea las cuatro colecciones, validadores e índices iniciales. **No ejecutarlo aún contra datos reales**. Primero validar en un servidor MongoDB Community 8.0.x desechable con `schema/validation-cases.md`.

El script requiere que la persona operadora establezca `globalThis.EnlaceSeguroExpectedDb` y que coincida con la BD actual; rechaza bases de sistema y nombres de colección existentes. No ejecuta `drop`, `collMod` ni inserta datos. Cambios posteriores deben ir en migraciones incrementales específicas, con revisión de compatibilidad y datos; no editar silenciosamente el bootstrap ya aplicado. No mezclar SQL/PostgreSQL con esta secuencia MongoDB.

Ejemplo de uso **solo cuando exista una BD de prueba desechable** y la persona confirme su nombre: desde la raíz del repo, `mongosh "$MONGODB_URI" --eval 'globalThis.EnlaceSeguroExpectedDb="enlaceseguro_dev"; load("database/migrations/001_create_mongodb_schema.js")'`. `MONGODB_URI` debe apuntar a esa base; no guardar credenciales en el repositorio.
