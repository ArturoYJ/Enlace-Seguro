# Objetivos operativos — decisión G0

**Estado:** baseline histórico para una eventual ruta de producción; diferido para la demo universitaria local definida en ADR-0012.

**Alcance:** fijar el sobre del piloto antes del ADR de nube y cualquier aprovisionamiento.
**Mercado inicial:** México. El propietario indicó residencia «solo en México»; se interpreta como residencia en México de datos y procesamiento de EnlaceSeguro.

## Lo que el código ya fija

| Límite | Valor observado | Significado |
|---|---:|---|
| Cuota individual | 5 análisis/día `America/Mexico_City` | Límite funcional por cuenta; no determina tráfico global. |
| Worker API | 2 jobs concurrentes por proceso (default actual) | Debe dimensionarse y validarse con más de una réplica. |
| Sandbox | 3 navegaciones concurrentes por proceso (default actual) | No es capacidad certificada ni objetivo de throughput. |
| Cola global | **20 jobs pendientes** aprobados para dimensionamiento; `1000` aparece solo en `.env.example` | Ajustar configuración de producción al baseline; validar con carga antes de prometer capacidad. |
| Análisis | Deadline Sandbox 25 s; timeout HTTP 30 s; reintentos acotados | Un timeout/fallo de infraestructura no equivale a resultado benigno. |
| Retención | Entrada cifrada TTL 365 días; historial TTL 366; capturas baseline 30 días | La purga diaria aún requiere operación probada en staging. |

Estos valores describen implementación, no promesas de servicio.

## Decisiones que faltan

| Decisión | Confirmación necesaria |
|---|---|
| Costo | El presupuesto es flexible, sin tope mensual numérico. Modelar el costo estimado del piloto y egress; pedir autorización antes de cualquier gasto o provisioning. |
| Residencia del proveedor | Mantener almacenamiento y procesamiento de datos del servicio en México, incluidos logs y backups. Verificar por contrato el tratamiento de soporte y metadatos de control. |
| Proveedor/región | AWS `mx-central-1` es candidato recomendado para evaluación; falta confirmar costo, residencia y controles antes de proponer selección. |
| Proveedores externos | Aún no hay fuentes de reputación aprobadas. Toda transferencia fuera de México requiere evaluación/decisión separada antes de integrar. |

## Baseline aprobado para diseño (no es compromiso de servicio)

- Piloto cerrado de hasta **50 cuentas**; capacidad de diseño de **250 análisis/día** (5 por cuenta), pico de **10 análisis simultáneos** y máximo de **20 jobs pendientes**.
- Meta inicial de cola: hasta **5 minutos** para comenzar; debe validarse con carga y el deadline de 25 segundos, no inferirse como capacidad ya probada.
- SLO preliminar de API: **99.0% mensual**. Medir disponibilidad del endpoint; reportar `inconclusive` aparte y nunca contarlo como análisis exitoso. Definir exclusiones finales antes del ADR.
- Recuperación preliminar: **RPO 24 h / RTO 8 h** para MongoDB y servicios; demostrarlo con backup/restore administrado en staging.
- Presupuesto: **flexible; no se fijó un tope numérico**. El cálculo de costo sigue pendiente; esta respuesta no aprueba gasto ni provisioning.
- Residencia: **solo México** para datos del servicio, procesamiento, logs y backups. Verificar por separado soporte y metadatos de control del proveedor.

Estos valores son hipótesis para diseño y carga, no mediciones ni promesas contractuales. El usuario los aprobó para avanzar la evaluación.

## Criterio para cerrar G0

El baseline, gasto flexible sin tope numérico y requisito de residencia en México ya fueron aprobados. AWS `mx-central-1` es candidato recomendado, no seleccionado. Para completar G0, cerrar comparación breve de costo piloto/pico y controles de residencia/seguridad, proponer proveedor/región y redactar ADR. No autoriza gasto ni provisioning.

## No aprobado por este documento

No selecciona aún proveedor, región ni tier de base de datos. «Presupuesto flexible» no es autorización de gasto. No autoriza infraestructura, cuenta cloud o datos reales. OCI no es condición ni paso del plan original G0–G5.
