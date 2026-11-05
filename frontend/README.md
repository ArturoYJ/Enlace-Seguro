# Frontends de EnlaceSeguro

## Cliente móvil

El proyecto iOS/Android activo está en [`mobile/`](./mobile/): React Native + Expo SDK 58 + Expo Router + TypeScript. La especificación aprobada, los gates visuales y el avance se documentan en [`docs/roadmap/mobile-implementation-plan.md`](../docs/roadmap/mobile-implementation-plan.md).

Actualmente cubre onboarding, registro/login, gestión de sesión, análisis manual/paste/polling, historial cursor-paginado, detalle autenticado y cuenta/cuota. Las pruebas Jest son mayormente de UI con respuestas controladas; no sustituyen E2E contra backend ni QA nativa. Las instrucciones de ejecución están en [`mobile/README.md`](./mobile/README.md).

## Consola de administración

La consola separada [`admin-console/`](./admin-console/) usa Vite + React/TypeScript y tokens solo en memoria, según la [especificación aprobada](../docs/superpowers/specs/2026-11-03-enlaceseguro-admin-console-design.md). Implementa acceso admin, métricas y auditoría con filtros de fecha/tipo y cursor. Sus pruebas usan respuestas sintéticas; falta verificar integración con API real, presentación visual, accesibilidad y hosting.

## Decisiones vigentes

- No incorporar el scaffold Flutter del repositorio del compañero; el cliente móvil local aprobado es React Native.
- No conectar fuentes reputacionales ni exponer capturas como si ya estuvieran disponibles.
- No declarar paridad visual completa: faltan medidas/tokens exactos de Figma para algunos estilos y QA por plataforma.
