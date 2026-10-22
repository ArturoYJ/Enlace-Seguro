# Estado vigente

**Actualizado:** 2026-10-22
**Estado:** estructura documental inicial creada; no se ha verificado código de aplicación.

## Confirmado en el workspace

- Las áreas `api/`, `database/` y `frontend/` existían, pero no contenían archivos de implementación.
- `Context/context.md` y la propuesta PDF se conservaron como fuentes.
- El CSV de patrones se trasladó sin cambio de contenido a `database/modeling/access-patterns.csv`.
- El repositorio GitHub indicado es público y estaba vacío al conectar el remoto; `origin` apunta a `https://github.com/ArturoYJ/Enlace-Seguro.git`.
- Los anexos fuente con datos académicos se conservan localmente y están excluidos mediante `.gitignore`; el registro público de fuentes no expone sus nombres de archivo.

## Pendientes de decisión/verificación

- Confirmar si el modelado físico del proyecto debe usar PostgreSQL o MongoDB.
- Revisar el estado real del código cuando exista o se conecte un checkout con implementación.
- Definir endpoints y esquemas físicos solo después de validar el alcance.

## Siguiente paso recomendado

Revisar esta organización y confirmar el motor de datos que debe guiar el diseño físico; mantener mientras tanto los patrones de acceso independientes del motor.
