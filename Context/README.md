# Índice de contexto

## Orden recomendado de consulta

1. `project/overview.md` — propósito, alcance y estado de la información.
2. `project/requirements.md` — funciones y controles descritos como propuesta.
3. `architecture/system.json` — grafo estructurado; validar con `system.schema.json`.
4. `architecture/diagrams/` — vistas Mermaid del grafo.
5. `decisions/` — decisiones aceptadas y su justificación.

## Fuentes existentes

- [`project/sources.md`](project/sources.md) — registro de fuentes y su disponibilidad.
- La propuesta académica y el contexto histórico amplio se conservan como archivos locales excluidos del control de versiones por contener información académica/personal. Verificar las afirmaciones contra las fuentes originales antes de usarlas como evidencia.
- [`../database/modeling/access-patterns.csv`](../database/modeling/access-patterns.csv) — patrones del ejercicio de base de datos; conserva tanto datos comunes como su objetivo MongoDB y deja visible el conflicto con PostgreSQL en la propuesta.

## Convención de estado

`confirmed` = afirmación respaldada por una fuente vigente o una verificación directa, indicando qué se confirma; no equivale automáticamente a “implementado”. `proposed` = intención documentada. `unknown` = no decidido o no verificado. Cada afirmación técnica debe conservar su referencia.
