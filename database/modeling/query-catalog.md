# Catálogo de patrones de acceso

El detalle completo y filtrable está en [`access-patterns.csv`](access-patterns.csv). Los identificadores P1–P7 son los del CSV. Las frecuencias registradas son valores del ejercicio, no mediciones de uso en producción.

| ID | Operación resumida | Tipo/frecuencia del artefacto |
|---|---|---|
| P1 | Autenticar y validar sesión/cuota | Lectura / Alta |
| P2 | Consultar caché reciente de URL o dominio | Lectura / Alta |
| P3 | Registrar resultado completo de análisis | Escritura / Media-Alta |
| P4 | Listar historial personal paginado | Lectura / Alta |
| P5 | Consultar detalle de un análisis | Lectura / Media |
| P6 | Registrar cuenta | Escritura / Baja |
| P7 | Actualizar cuota y registrar intento | Escritura / Alta |

Este catálogo es independiente del motor; todavía no prescribe forma de documentos, tablas ni índices. Validar cada patrón con el flujo actual antes de usarlo para un diseño físico.
