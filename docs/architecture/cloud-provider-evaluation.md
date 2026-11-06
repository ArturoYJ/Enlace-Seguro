# Evaluación preliminar de nube administrada para EnlaceSeguro

**Fecha de consulta:** 2026-11-04
**Estado:** evaluación para diseño; AWS `mx-central-1` es candidato recomendado a costear/verificar, no seleccionado
**Mercado inicial:** México
**Alcance:** comparación documental de regiones y servicios potenciales para API, workers Playwright, cola, almacenamiento, MongoDB, secretos y observabilidad. No se crearon cuentas ni recursos.

## Contexto y supuestos

El checkout usa Node.js 22/TypeScript/Fastify, MongoDB 8.0.x y Sandbox Playwright. El propietario aprobó para dimensionamiento un piloto de 50 cuentas, 250 análisis/día, 10 concurrentes, cola máxima 20/espera 5 min, SLO API 99% y RPO 24 h/RTO 8 h. El gasto es flexible, sin límite numérico, y los datos/procesamiento del servicio deben permanecer en México. Esto no es promesa de servicio ni autorización de gasto. No hay infraestructura cloud versionada ni validación del aislamiento de red en una cuenta real.

La alternativa de base de datos comparada es **MongoDB Atlas** (servicio administrado del proveedor MongoDB) porque el modelo y drivers actuales son MongoDB. La selección debe validar capacidad/versión, región, conectividad privada, backups, costes y contratos; “MongoDB administrado” no obliga a elegir Atlas. Mantener MongoDB Community autogestionado en contenedores o VM no se evalúa como opción administrada equivalente.

## Comparación de candidatos

| Candidato y región en México | Compute/worker y red | Cola, base y archivos | Coste/operabilidad y límites que requieren validación |
|---|---|---|---|
| **AWS — `mx-central-1` (Querétaro)** | AWS lista tres AZ; ECS Linux sobre Fargate está soportado. API/worker pueden ir en subredes privadas con egress controlado. | Atlas ofrece `MX_CENTRAL_1`; SQS/S3/Secrets Manager/KMS/VPC son candidatos regionales que deben confirmarse antes del diseño final. SQS entrega al menos una vez: mantener idempotencia y DLQ/reintentos. | Candidato más verificable para siguiente gate. Cómputo Fargate usa CPU/memoria; NAT cuesta por hora y GB procesado; Atlas/private endpoint, egress, logs y firewall son costos adicionales. Verificar cuotas, Atlas private endpoint y firewall real de la cuenta. |
| **Azure — `mexicocentral` (Querétaro)** | Container Apps disponible; perfiles de consumo/dedicados y VNet/egress cambian según modalidad. | Atlas también ofrece región México; Service Bus, Blob, Key Vault y Monitor requieren confirmación regional y de residencia. | Alternativa si aporta ventaja de costo/operación. Calcular perfil mínimo, logging, red y egress; probar aislamiento del Sandbox. |
| **Google Cloud — `northamerica-south1` (Querétaro)** | Cloud Run disponible; se puede dirigir egreso por VPC y reglas de firewall. | Atlas ofrece región México; Pub/Sub/storage/logging deben configurarse regionalmente. | Alternativa de pago por uso. Cloud Run cobra CPU/memoria y el egress/VPC se cotiza aparte; validar Chromium, concurrencia y firewall. |

**Estimación de costo:** no hay base defendible para dar una cifra mensual antes de medir CPU/RAM de Chromium, duración/cold start y volumen de bytes externo. El límite actual restringe cantidad de requests, no tamaño total de descarga; el egress puede dominar. El propietario acepta gasto flexible, no gasto ilimitado: modelar caso piloto y pico y volver a pedir autorización antes de cualquier cargo.

## Hallazgos transversales

1. **Residencia no se deduce solo de la región.** El requisito aprobado cubre datos del servicio, procesamiento, backups y logs en México. También hay que comprobar metadatos del plano de control y soporte por contrato. En GCP los buckets `_Required`/`_Default` se crean en `global` salvo que se configure localización por organización/carpeta, y `_Required` no se redirige; esto puede complicar el requisito México. Los destinos visitados por Sandbox son externos por definición; no integrar reputación API que reciba URLs sin decisión de transferencia.
2. **MongoDB Atlas en Querétaro aparece como opción en los tres proveedores.** AWS `mx-central-1`, Azure `mexicocentral` y GCP `northamerica-south1` están documentados. Atlas Cloud Backups requieren M10+; la redundancia geográfica multi-región debe quedar desactivada para cumplir México. El tier/backup impactan costo y disponibilidad; validar conectividad privada y plan de migración antes de producción.
   Atlas también restringe el peering y los private endpoints según proveedor y tier del clúster. No asumir conectividad privada entre proveedores; confirmar la combinación exacta en la cuenta seleccionada antes de staging. Para reducir incertidumbre, evaluar runtime y Atlas en el mismo proveedor/región.
3. **El Sandbox es el discriminante de arquitectura.** No basta con poner una app en una VPC/VNet. El navegador debe tener Internet para abrir enlaces arbitrarios y, al mismo tiempo, quedar impedido de alcanzar metadata cloud, redes privadas, endpoints de datos y servicios internos. La app anti-SSRF no sustituye aislamiento de infraestructura. Los tres candidatos necesitan una prueba adversarial de DNS, redirecciones, IPv4/IPv6, DNS rebinding y dominios que resuelven a direcciones prohibidas. Evaluar un proxy/firewall de salida administrado con política de destino y logging de mínimos datos, o una arquitectura de worker aislado; no aprobar diseño solo por tener NAT.
4. **Cola no significa exactly-once.** SQS documenta entrega al menos una vez, y Pub/Sub necesita elegir una política/endpoint regional para controlar localización. Sea cual sea el producto, almacenar estado de job idempotente, retries con límites/backoff, cola de errores/DLQ y recuperación son requisitos de la aplicación.
5. **Coste total incluye egress y operación.** Fargate cobra CPU/memoria; NAT añade horas + datos; Atlas, endpoint privado, backups M10+, logs, almacenamiento WebP, firewall y egress a sitios externos suman por separado. El costo Cloud Run también depende de CPU/memoria y egress; Azure de perfil, red y logs. No hay tope mensual numérico, pero antes de cualquier gasto debe mostrarse estimación reproducible para piloto y pico.

## Recomendación preliminar

**Recomendar AWS `mx-central-1` como candidato primario de diseño y costeo; mantener Azure `mexicocentral` y GCP `northamerica-south1` como comparadores. No seleccionar ni desplegar aún.** AWS combina ECS/Fargate y Atlas disponibles en México con tres AZ documentadas. Es la ruta más directa para evaluar API/worker privados y una base de datos en la misma región. Esta recomendación no prueba capacidad de cuenta, conectividad privada ni enforcement del egress.

La evaluación no prueba que Network Firewall, Azure Firewall, servicios de datos auxiliares, zonas de Atlas o límites de cuotas estén disponibles/configurados para la cuenta del proyecto. Una prueba de concepto debe comprobarlo directamente y producir diagrama, reglas de red, coste estimado y resultados de test antes de emitir ADR.

## Próximas acciones de evaluación

1. Dimensionar el baseline aprobado con datos sintéticos: CPU/RAM por navegación, duración, descarga y egreso; usar límite de costo flexible como parámetro, no autorización.
2. Modelar TCO bajo/piloto/pico para AWS y una comparación breve con Azure/GCP, incluyendo Atlas, backup, red privada, NAT/firewall, logs, capturas y egress.
3. Confirmar con fuente oficial y luego en cuenta la disponibilidad, cuotas, endpoint privado Atlas y residencia de backups/logs/soporte; no asumir que escoger una región basta.
4. Preparar ADR de proveedor/región y diagrama de red para aprobación. El siguiente paso autoriza diseño solamente; cualquier recurso o gasto requiere aprobación separada.

## Decisiones pendientes del propietario

- Proveedor y región cloud, condicionados a costos verificados y controles de egress.
- Atlas frente a MongoDB autogestionado administrado por el proveedor cloud; edición/tier de Atlas y conectividad privada.
- Alcance de la exigencia México respecto a soporte técnico/metadatos de control del proveedor; gasto flexible sin tope numérico.
- Retención y clasificación para URLs/mensajes posiblemente sensibles, resultados, logs, copias y capturas. No ejecutar aprovisionamiento hasta aprobación explícita.

## Fuentes oficiales consultadas

Consultadas/actualizadas el **2026-11-04**. Disponibilidad y precios cambian; volver a verificar matriz regional, cuotas y calculadoras antes de ADR final.

- AWS: [regiones y AZ](https://docs.aws.amazon.com/global-infrastructure/latest/regions/aws-regions.html), [servicios por región](https://aws.amazon.com/about-aws/global-infrastructure/regional-product-services/), [ECS/Fargate por región](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/AWS_Fargate-Regions.html), [red de salida ECS](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/networking-outbound.html), [tipos de cola SQS y entrega](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-queue-types.html).
- Microsoft Azure: [lista de regiones](https://learn.microsoft.com/en-us/azure/reliability/regions-list), [zonas de disponibilidad](https://learn.microsoft.com/en-us/azure/reliability/availability-zones-overview), [regiones Azure Container Apps](https://learn.microsoft.com/en-us/azure/container-apps/express-overview), [red de Container Apps](https://learn.microsoft.com/en-us/azure/container-apps/networking), [workload profiles y facturación](https://learn.microsoft.com/en-us/azure/container-apps/workload-profiles-overview).
- Facturación de servicios: [AWS Fargate](https://aws.amazon.com/fargate/pricing/), [AWS NAT Gateway](https://docs.aws.amazon.com/vpc/latest/userguide/nat-gateway-pricing.html), [Azure Container Apps](https://learn.microsoft.com/en-us/azure/container-apps/billing), [Google Cloud Run](https://cloud.google.com/run/pricing), [Atlas private endpoint por región](https://www.mongodb.com/docs/atlas/billing/additional-services/).
- Residencia y recuperación: [Cloud Logging regionalización y buckets globales](https://docs.cloud.google.com/logging/docs/regionalized-logs), [Atlas Cloud Backups y niveles](https://www.mongodb.com/docs/atlas/backup-restore-cluster/).
- Google Cloud: [ubicaciones Cloud Run](https://docs.cloud.google.com/run/docs/locations), [Cloud Run Direct VPC egress](https://docs.cloud.google.com/run/docs/configuring/vpc-direct-vpc), [red privada/egress Cloud Run](https://docs.cloud.google.com/run/docs/securing/private-networking), [endpoints regionales Pub/Sub](https://docs.cloud.google.com/pubsub/docs/reference/service_apis_overview), [precios Cloud Run](https://cloud.google.com/run/pricing).
- MongoDB Atlas: [proveedores y regiones](https://www.mongodb.com/docs/atlas/cloud-providers-regions/), [regiones AWS](https://www.mongodb.com/docs/atlas/reference/amazon-aws/), [regiones Azure](https://www.mongodb.com/docs/atlas/reference/microsoft-azure/), [regiones Google Cloud](https://www.mongodb.com/docs/atlas/reference/google-gcp/), [almacenamiento vs geografía de procesamiento](https://www.mongodb.com/docs/atlas/geographies/).
- MongoDB Atlas: [VPC peering](https://www.mongodb.com/docs/atlas/manage-vpc-peering/) y [private endpoints](https://www.mongodb.com/docs/atlas/security-private-endpoint/).
