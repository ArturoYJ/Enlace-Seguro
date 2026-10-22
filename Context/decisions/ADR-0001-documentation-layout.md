# ADR-0001: Organización documental multiagente

- **Estado:** aceptada por el usuario
- **Fecha:** 2026-10-22

## Contexto

El proyecto necesita continuidad cronológica de trabajo realizado por agentes, reglas neutrales entre herramientas, contexto navegable, arquitectura estructurada y formatos que eviten cargar documentación irrelevante. Se conservarán las áreas existentes de API, base de datos y frontend.

## Decisión

- Mantener reglas, preferencias, estado y bitácora neutral en `Agents/`.
- Mantener el conocimiento del producto, requisitos, arquitectura y ADRs en `Context/`.
- Usar Markdown para explicación/continuidad, un grafo JSON validado por JSON Schema para arquitectura, Mermaid como vistas, CSV para patrones tabulares, YAML/OpenAPI para contrato de API y SQL para migraciones una vez definido el motor.
- Mantener una sola fuente canónica para cada artefacto; indexar y enlazar en lugar de copiar.
- No crear archivos propietarios de proveedores de IA.

## Consecuencias

- Herramientas que no descubran archivos neutrales automáticamente deberán recibir una indicación de leer `Agents/README.md`.
- El JSON y sus vistas Mermaid requieren revisión coordinada para evitar deriva.
- El modelado físico queda bloqueado hasta resolver PostgreSQL frente a MongoDB.
- Los archivos fuente existentes se conservan; los cambios de ruta se validan por contenido.
