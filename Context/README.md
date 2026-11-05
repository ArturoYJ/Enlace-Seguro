# Índice de contexto

Revisado el **2026-11-04** para separar la propuesta académica original del stack y la implementación presentes en el checkout. Las decisiones aprobadas sobre fechas administrativas, capacidad de jobs, estrategia E2E móvil, ventana de métricas/retención, contraste móvil y objetivos de diseño G0 se registran en ADR-0004/0005/0006/0008/0009/0011. No hay proveedor cloud seleccionado; la recomendación de AWS es candidata de evaluación, no decisión de despliegue. Para el estado vigente, iniciar en `project/overview.md`; `context.md` se conserva como traspaso histórico y no es canónico.

Para la entrega universitaria vigente, ADR-0012 reemplaza el alcance productivo: demo local, gratuita y sin PaaS. Usa React Native/Fastify/MongoDB/Playwright; iOS se presenta en iPhone con Expo Go y Android se entrega como APK local sin prueba en dispositivo. El plan acotado está en `../docs/roadmap/academic-demo.md`.

La decisión vigente para el cliente móvil es React Native y para persistencia MongoDB 8.0.x. Flutter/PostgreSQL siguen apareciendo en la propuesta original y no describen el stack local actual.

## Orden recomendado de consulta

1. `project/overview.md` — propósito, alcance y estado de la información.
2. `project/requirements.md` — requisitos con estado observado y límites del código local.
3. `architecture/system.json` — grafo estructurado; validar con `system.schema.json`.
4. `architecture/diagrams/` — vistas Mermaid del grafo.
5. `decisions/` — decisiones aceptadas y su justificación.

## Fuentes existentes

- [`project/sources.md`](project/sources.md) — registro de fuentes y su disponibilidad.
- La propuesta académica original no está publicada en el repositorio. El traspaso histórico está en [`context.md`](context.md) y se conserva con su contenido; ver su aviso de vigencia antes de reutilizar notas.
- [`../database/modeling/access-patterns.csv`](../database/modeling/access-patterns.csv) — patrones del ejercicio de base de datos; su objetivo MongoDB es consistente con la decisión vigente del checkout.
- [`architecture/auth-design.md`](architecture/auth-design.md) y [`architecture/system.json`](architecture/system.json) — stack y grafo actualizado con evidencia de código.
- [`../docs/security/network-boundary-contract.md`](../docs/security/network-boundary-contract.md) — requisitos cloud-neutral de flujos privados, egress y pruebas; no evidencia de reglas desplegadas.
- [`project/sources.md`](project/sources.md) — también registra el Figma y el repositorio externo de referencia visual.

## Convención de estado

`confirmed` = afirmación respaldada por una fuente vigente o una verificación directa, indicando qué se confirma; no equivale automáticamente a “implementado”. `proposed` = intención documentada. `unknown` = no decidido o no verificado. Cada afirmación técnica debe conservar su referencia.
