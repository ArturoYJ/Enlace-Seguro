# Evaluación preliminar de nube administrada

**Fecha:** 2026-11-04

**Estado:** recomendación de AWS como candidato de diseño; aún no es selección ni autorización de gasto
**Objetivo:** comparar opciones para API, worker, Sandbox de navegación hostil, base MongoDB, secretos, observabilidad y región inicial México.

## Restricciones y datos pendientes

- Se mantiene Node.js 22/TypeScript/Fastify, Playwright/Chromium y MongoDB 8.0.x como baseline del checkout.
- La decisión actual selecciona MongoDB Community 8.0.x para el ejercicio/checkout; operar Mongo administrado puede implicar Atlas, otra modalidad/licencia y cambios de operación que requieren ADR separado.
- El propietario aprobó para dimensionamiento: 50 cuentas, 250 análisis/día, 10 concurrentes, cola máxima 20/espera 5 min, API SLO 99%, RPO 24 h/RTO 8 h. Gasto flexible sin límite numérico; residencia «solo en México», interpretada para datos/procesamiento EnlaceSeguro. No es compromiso ni permiso de gasto.
- Ningún proveedor fue seleccionado y no se aprovisionaron recursos.
- Una opción Mongo administrada condiciona la topología: Atlas limita VPC peering/private endpoints por proveedor y tipo/tier de clúster; antes de elegir runtime se debe confirmar conectividad privada en la combinación exacta. Para app y clúster en una sola región, priorizar el mismo proveedor y validar la conexión antes de staging; no asumir que se puede unir una app GCP/Azure a un clúster Atlas AWS por peering.

## Candidatos iniciales

| Candidato | Evidencia regional/servicios | Ventaja a validar | Riesgo/pendiente |
|---|---|---|---|
| **AWS — `mx-central-1` Querétaro** | AWS lista México Central con 3 zonas y opt-in de región. MongoDB Atlas lista `mx-central-1` en Querétaro. ECS/Fargate puede salir a Internet desde subred privada vía NAT. SQS Standard es entrega al menos una vez. | Buena composición preliminar para API/worker privados, reglas de red y cola administrada; permite probar Mongo Atlas en la misma región. | Confirmar disponibilidad regional actual de cada servicio, costos NAT/egress/servicios, peering privado Atlas y controles de egress que permitan navegación pública sin alcanzar redes internas/metadata. SQS requiere consumidores idempotentes y DLQ; no es exactly-once. |
| **Azure — `Mexico Central` Querétaro** | Microsoft lista Mexico Central; Atlas lista soporte de Azure. Container Apps y sus opciones de salida/red deben comprobarse por modalidad de entorno. | Candidata si el equipo ya administra Azure; servicios gestionados de contenedores y mensajería. | Confirmar disponibilidad específica de Container Apps, Service Bus, Key Vault, monitor y peering Atlas; documentación advierte que NAT Gateway/proxy de salida de Container Apps depende de workload-profile environment. |
| **GCP — `northamerica-south1` Querétaro** | Google Cloud y MongoDB Atlas listan Querétaro. Cloud Run Direct VPC egress configura acceso a VPC/firewall y rutas de egreso. | Despliegue de servicios/worker gestionados con integración de VPC. | Probar comportamiento de Chromium y control de egress antes de usar para contenido web hostil; confirmar servicios/peering Atlas y costos según carga real. |

## Recomendación preliminar y siguiente acción

Priorizar el costeo y verificación de **AWS `mx-central-1` + ECS/Fargate + Atlas** como candidato de diseño; comparar Azure y GCP de forma acotada. AWS tiene las primitivas regionales más directamente verificables para el baseline. Esto es una recomendación de evaluación, no selección, compra ni aprobación de provisioning. Incluir Atlas como opción Mongo administrada y confirmar tier, backups y conectividad privada; Community Server y Atlas no son intercambiables en precio, operación o contrato.

Antes del ADR final, estimar costo para el piloto aprobado y escenario pico; incluir cómputo API/worker/Sandbox, Mongo, NAT/egress, logs/retención, cola, backups, capturas, firewall y soporte. El tamaño real de Chromium y volumen de bytes de navegación aún no están medidos. Confirmar residencia regional de backups/logs/soporte y probar egress con destinos sintéticos externos/privados; no aprovisionar hasta autorización separada.

## Criterios de decisión

1. Región y servicios necesarios disponibles al momento de decisión; región para app, Mongo, backups, logs, capturas y cola documentadas por separado.
2. Aislamiento privado de API↔Sandbox y egress controlable a Internet no confiable, incluyendo IPv4/IPv6, metadata y DNS/rebinding.
3. Entrega durable y mecanismos operativos de retry, DLQ/poison jobs, métrica y reproceso.
4. Costos reproducibles con supuestos de carga; no seleccionar por precio de free tier.
5. Recuperación documentada y ensayada; RTO/RPO aprobados antes de despliegue.
6. Acceso a secretos, cifrado, logs y copias sujeto a revisión de privacidad aplicable a México.

## Fuentes oficiales consultadas

- [AWS Regions](https://docs.aws.amazon.com/global-infrastructure/latest/regions/aws-regions.html)
- [MongoDB Atlas en AWS](https://www.mongodb.com/docs/atlas/reference/amazon-aws/)
- [ECS: salida a Internet](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/networking-outbound.html)
- [SQS: tipos de cola y entrega](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-queue-types.html)
- [Azure Regions](https://learn.microsoft.com/en-us/azure/reliability/regions-list?tabs=europe)
- [MongoDB Atlas en Azure](https://www.mongodb.com/docs/atlas/reference/microsoft-azure/)
- [Cloud Run Direct VPC egress](https://docs.cloud.google.com/run/docs/configuring/vpc-direct-vpc)
- [MongoDB Atlas en Google Cloud](https://www.mongodb.com/docs/atlas/reference/google-gcp/)
- [Atlas VPC peering](https://www.mongodb.com/docs/atlas/manage-vpc-peering/) y [Atlas private endpoints](https://www.mongodb.com/docs/atlas/security-private-endpoint/)
