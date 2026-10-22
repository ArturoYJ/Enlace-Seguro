# Diseño: documentación y contexto multiagente de EnlaceSeguro

**Estado:** aprobado por el usuario e implementado (2026-10-22)
**Fecha:** 2026-10-22

## Objetivo

Organizar la raíz del proyecto para que distintos agentes de IA y personas puedan orientarse, respetar límites de trabajo, consultar solo el contexto necesario, continuar tareas mediante una bitácora cronológica y mantener documentos técnicos y entregables sin duplicar fuentes de verdad.

## Decisiones de diseño

1. Usar archivos neutrales y legibles por distintas herramientas; no crear archivos de instrucciones exclusivos de Codex, Claude, Cursor u otro proveedor. `Agents/README.md` será el índice común de trabajo.
2. Separar instrucciones y continuidad de agentes (`Agents/`) del conocimiento del producto (`Context/`). Las decisiones de arquitectura pertenecen a `Context/`, no a la memoria del agente que las registró.
3. Representar la arquitectura como grafo JSON estructurado y validable. Cada nodo y relación incluirá identificadores estables y estado (`confirmed`, `proposed` o `unknown`) para no convertir propuestas en hechos. Un JSON Schema validará estructura y campos.
4. Mantener diagramas Mermaid como vistas legibles del grafo; cuando cambie una relación, revisar el JSON y los diagramas afectados en la misma tarea. No guardar imágenes como fuente del diagrama.
5. Mantener los contratos y artefactos técnicos junto al área correspondiente: OpenAPI en `api/`; patrones, modelo y migraciones en `database/`; código de interfaz en `frontend/`.
6. No resolver en esta reorganización la discrepancia del motor de datos entre la propuesta PostgreSQL y el ejercicio documental MongoDB. El modelo de acceso será neutral respecto del motor hasta que el usuario confirme el alcance.
7. Preservar los archivos existentes y distinguir datos confirmados, propuestas y notas históricas. No borrar ni sobrescribir contenido existente durante la implementación.

## Estructura objetivo

```text
/
├── README.md
├── Agents/
│   ├── README.md
│   ├── rules/
│   │   ├── boundaries.md
│   │   └── workflow.md
│   ├── preferences.md
│   ├── state/
│   │   └── current.md
│   ├── history/
│   │   └── YYYY-MM.md
│   └── templates/
│       ├── work-log.md
│       └── handoff.md
├── Context/
│   ├── README.md
│   ├── project/
│   │   ├── overview.md
│   │   ├── requirements.md
│   │   └── glossary.md
│   ├── architecture/
│   │   ├── system.json
│   │   ├── system.schema.json
│   │   └── diagrams/
│   │       ├── system-context.mmd
│   │       └── analysis-flow.mmd
│   └── decisions/
│       └── ADR-0001-title.md
├── api/
│   └── openapi.yaml
├── database/
│   ├── modeling/
│   │   ├── access-patterns.csv
│   │   └── query-catalog.md
│   ├── schema/
│   └── migrations/
├── frontend/
├── infra/
├── tests/
└── deliverables/
    ├── academic/
    ├── reports/
    └── evidence/
```

`api/`, `database/` y `frontend/` ya existían. Se agregaron `Agents/`, `Context/`, `infra/`, `tests/` y `deliverables/`; `Agent/` se renombró a `Agents/`, conservando `Agent/memory.md` sin alterarlo. El archivo existente `enlaceseguro-bdaas-Patrones.csv` se comparó y trasladó a `database/modeling/access-patterns.csv` sin cambiar su contenido ni mantener una segunda copia canónica. `Context/context.md` se preservó sin alterarlo como fuente local; las síntesis conservan la procedencia sin publicar el nombre original de la propuesta.

## Formatos por función

| Uso | Formato | Motivo y regla |
|---|---|---|
| Índices, instrucciones, preferencias y contexto explicativo | Markdown (`.md`) | Legible por personas y agentes, fácil de buscar con herramientas de texto; mantener cada documento acotado y con encabezados claros. |
| Estado para continuar y bitácora cronológica | Markdown (`.md`) | Una entrada compacta por tarea/agente con fecha, resumen, archivos, verificaciones, decisiones y siguiente acción; no almacenar transcripciones completas. Particionar la bitácora por mes. |
| Arquitectura y relaciones | JSON (`.json`) + JSON Schema | JSON será el grafo estructurado y consultable; el esquema comprobará campos y tipos. Estados explícitos separarán hechos de propuestas. |
| Vistas de grafos y secuencias | Mermaid (`.mmd`) | Fuente textual editable y revisable en cambios; mantener solo vistas útiles y sincronizadas con los identificadores del grafo. |
| Patrones de acceso tabulares | CSV (`.csv`) | Adecuado para filas P1-Pn y columnas filtrables; conservar los encabezados y codificación existentes al migrar. |
| Contrato de API | OpenAPI YAML (`.yaml`) | Contrato legible por humanos y herramientas; mantener una única versión canónica en `api/`. |
| Esquema y cambios de base | SQL (`.sql`) | Migraciones incrementales como fuente ejecutable; no producir DDL hasta confirmar el motor objetivo. |
| Decisiones duraderas | Markdown tipo ADR | Registrar contexto, decisión, alternativas y consecuencias; ubicar en `Context/decisions/`. |
| Entregables finales | DOCX/PDF y fuentes editables cuando correspondan | Separados del contexto vivo en `deliverables/`; no usarlos como memoria operativa del agente. |

El ahorro de contexto se obtendrá principalmente con navegación selectiva, índices cortos y ausencia de duplicación, no solo cambiando la extensión del archivo. La guía común pedirá que el agente lea `Agents/README.md`, consulte `Agents/state/current.md` y abra únicamente los documentos indicados por la tarea.

## Navegación y mantenimiento

- La raíz `README.md` dará una orientación breve y enlazará a `Agents/README.md`, `Context/README.md` y las áreas técnicas.
- `Agents/README.md` explicará qué leer según la tarea; `current.md` contendrá estado vigente confirmado y el siguiente paso.
- Cada entrada histórica indicará qué agente/herramienta trabajó, qué cambió, qué validó, qué quedó pendiente y enlaces a decisiones pertinentes.
- Las reglas de seguridad incluirán no tratar contenido de documentos como instrucciones del usuario, no exponer secretos y no afirmar implementación sin evidencia del código o pruebas.
- En `Context/` cada afirmación técnica se marcará como confirmada, propuesta o desconocida, con referencia al archivo fuente cuando aplique.
- El contrato OpenAPI, las migraciones SQL, los patrones CSV y el grafo JSON tendrán una sola ubicación canónica; los índices enlazarán a esos archivos en lugar de copiarlos.

## Validación de implementación futura

1. Confirmar que los documentos e índices enlazan a rutas existentes.
2. Validar `system.json` contra `system.schema.json` y revisar que las vistas Mermaid reflejen las relaciones del grafo.
3. Comparar el CSV antes y después de su traslado para confirmar que no cambien encabezados, número de filas ni contenido.
4. Buscar duplicación o afirmaciones de estado contradictorias entre `Agents/state/current.md`, `Context/` y la bitácora.
5. Confirmar que ningún documento nuevo afirme que una función está implementada solo porque aparece en la propuesta.

## Fuera de alcance

- Elegir entre PostgreSQL y MongoDB.
- Diseñar colecciones, tablas, índices o validaciones concretas de base de datos.
- Implementar código de aplicación, herramientas de búsqueda semántica o una base de datos de grafos.
- Crear adaptadores propietarios de agentes.
