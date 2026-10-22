# EnlaceSeguro — resumen del proyecto

## Propósito propuesto

La propuesta describe una aplicación móvil para revisar enlaces sospechosos antes de abrirlos. La API coordinaría validación, consultas de reputación, análisis en un navegador aislado y almacenamiento del resultado; la aplicación presentaría un veredicto explicado y una captura. El análisis está pensado para apoyar la decisión del usuario, no para garantizar seguridad.

## Estado de evidencia

- El PDF es una **propuesta**, no evidencia de que las funciones estén implementadas.
- El documento propone Flutter/Dart para la aplicación, Node.js 22 + TypeScript + Fastify para la API, PostgreSQL 16 para persistencia, y Playwright/Chromium en tres servicios sandbox.
- El CSV de patrones indica MongoDB como objetivo del ejercicio BDaaS. La discrepancia PostgreSQL/MongoDB continúa **sin resolver**.
- No se encontró código de aplicación en las carpetas locales `api/`, `database/` ni `frontend/` al crear esta documentación.

## Fuentes

- Registro de fuentes y disponibilidad: [`sources.md`](sources.md).
- [Patrones de acceso](../../database/modeling/access-patterns.csv)

No usar notas previas sobre avances como prueba actual sin inspeccionar código, pruebas o evidencia correspondiente.
