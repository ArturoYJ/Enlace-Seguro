# ADR-0011: Objetivos operativos para el piloto de EnlaceSeguro

- **Estado:** Hipótesis histórica de producción; diferida para la entrega académica por ADR-0012.
- **Fecha:** 2026-11-04
- **Contexto:** Para comparar nube administrada y preparar G4 se necesitan supuestos explícitos de demanda, disponibilidad, recuperación y residencia. El código local no demuestra capacidad ni SLO productivos.
- **Alcance:** Hipótesis de diseño del piloto; no selecciona proveedor/región ni autoriza gasto o provisioning.

## Decisión

1. Diseñar el piloto cerrado para hasta **50 cuentas** y **250 análisis por día**.
2. Dimensionar una primera carga de hasta **10 análisis simultáneos**, cola máxima de **20 jobs** y espera objetivo de hasta **5 minutos** para empezar un análisis.
3. Usar **99% mensual** como SLO preliminar de disponibilidad del API. Medir por separado estados `inconclusive` y fallas de sitios externos; no tratarlos como análisis exitosos.
4. Usar **RPO 24 h / RTO 8 h** preliminares para MongoDB y servicios. Demostrarlos con backup/restore en staging antes de producción.
5. El propietario indicó gasto **flexible**, sin límite mensual numérico. Comparar costo total bajo/pico; esta flexibilidad no autoriza cargos.
6. La residencia requerida es **México** para datos del servicio, procesamiento, logs y backups. Verificar por separado el tratamiento de soporte y metadatos de control. La navegación del Sandbox consulta destinos arbitrarios de enlaces y, por definición, sale a Internet. No integrar fuentes externas de reputación sin decisión de privacidad/transferencia.

## Consecuencias y límites

- Estos valores son supuestos aprobados para evaluación, no resultados medidos ni garantías al usuario.
- Ningún proveedor o región queda seleccionado por este ADR. AWS `mx-central-1` es candidato recomendado de evaluación; Azure `mexicocentral` y GCP `northamerica-south1` siguen como comparadores. Se deben validar costo, conectividad privada, cuotas, residencia, backups, logs y controles de egress.
- El costo mensual defendible requiere medir recursos Chromium y egreso, y decidir tier/backup de MongoDB Atlas. Presentar estimación antes de cualquier autorización de gasto.
- Un SLO 99% y RPO/RTO no se declaran cumplidos hasta probar restauración, degradación, alertas y recuperación en staging.

## Evidencia relacionada

- [Worksheet G0](../../docs/architecture/production-operating-targets.md)
- [Evaluación de nube administrada](../../docs/architecture/cloud-provider-evaluation.md)
- [Hoja de ruta de producción](../../docs/roadmap/production-readiness.md)
