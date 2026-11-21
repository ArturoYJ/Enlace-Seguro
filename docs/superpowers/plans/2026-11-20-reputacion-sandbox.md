# Plan: Sandbox y VirusTotal

Diseño aprobado: `docs/superpowers/specs/2026-11-20-reputacion-virustotal-sandbox-design.md`.

1. Corregir DNS no resoluble e inspección DOM incompleta sin generar veredicto; propagar los códigos en el contrato Sandbox/API y probar ambos casos.
2. Registrar redirecciones de la navegación principal en orden; separar recursos secundarios y cubrir límites y regresiones.
3. Diseñar y probar una interfaz de reputación deshabilitada por defecto, transporte simulado, validación estricta y lista exacta de URLs públicas de prueba autorizadas.
4. Implementar consulta GET VirusTotal, control persistente y atómico de cuota y tratamiento explícito de fallos; sin llamadas reales ni exponer secretos.
5. Integrar resultados con worker, Mongo, API, OpenAPI y móvil sin rebajar el riesgo ni presentar fallos como seguros; comprobar compatibilidad y concurrencia.
6. Ejecutar pruebas locales autorizadas con transporte simulado; registrar pruebas omitidas, límites, resultado y próximos pasos. No publicar ni hacer commit.

El aislamiento de egreso productivo no queda demostrado por estos cambios. La prueba real de VirusTotal no está autorizada en esta etapa.
