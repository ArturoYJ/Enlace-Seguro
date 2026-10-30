# Guía común para agentes

Esta documentación es neutral respecto de la herramienta o proveedor. Al iniciar una tarea:

1. Lee `Agents/rules/boundaries.md` y `Agents/rules/workflow.md`.
2. Lee `Agents/preferences.md` y `Agents/state/current.md`.
3. Desde `Context/README.md`, abre solo las fuentes pertinentes a la tarea.
4. No cargues toda la bitácora: busca por fecha/tema y consulta la entrada necesaria.
5. Al terminar, actualiza `Agents/state/current.md` y agrega una entrada concisa a `Agents/history/YYYY-MM.md`.

## Mapa

- `rules/` — límites y procedimiento estable.
- `preferences.md` — preferencias de colaboración del usuario.
- `state/current.md` — estado vigente verificado y siguiente acción.
- `history/` — resúmenes cronológicos de trabajo por agente/tarea; no transcripciones.
- `templates/` — formatos reutilizables para bitácoras y traspasos.
- `memory.md` — archivo preexistente preservado; no es la bitácora canónica.

## Prompt de inicio para sesiones nuevas

Pega el siguiente texto al inicio de una sesión cuando el agente no tenga contexto previo del proyecto. Reemplaza `<RUTA_BASE>` con la ruta real del repositorio en tu equipo.

```
Eres un agente de trabajo del proyecto EnlaceSeguro.
El repositorio base está en: <RUTA_BASE>

Lee estos cuatro archivos en orden antes de hacer cualquier cosa:
  1. Agents/rules/boundaries.md
  2. Agents/rules/workflow.md
  3. Agents/preferences.md
  4. Agents/state/current.md

Después de leerlos, pregunta qué tarea concreta hay que realizar hoy.
Solo abre archivos adicionales si la tarea los requiere.
No afirmes que algo está implementado sin inspeccionar código o pruebas.
```

**Ruta base actual del proyecto en esta máquina:**
`/Users/arturoyj/Universidad Politecnica/Proyectos/EnlaceSeguro`

**Contexto condicional** — abre solo si la tarea lo necesita:

| Tarea | Archivos adicionales |
|---|---|
| Entender el proyecto o sus requisitos | `Context/project/overview.md`, `Context/project/requirements.md` |
| Revisar o extender la arquitectura | `Context/architecture/system.json` |
| Diseño o consulta de base de datos | `database/modeling/logical-model.md`, `database/modeling/schema-proposal.md` |
| Endpoints o contrato de API | `api/openapi.yaml` |
| Infraestructura o contenedores | `infra/README.md` |
| Historial de decisiones | `Context/decisions/ADR-0001-documentation-layout.md` |
| Bitácora de trabajo anterior | `Agents/history/YYYY-MM.md` (buscar solo por fecha/tema) |
