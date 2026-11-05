# Contrato cloud-neutral de límites de red

**Estado:** requisitos aprobados por el plan, no implementados ni evidencia de despliegue
**Alcance:** contrato lógico G1-SEC previo a elegir proveedor; los recursos, rutas, ACL y mecanismos específicos se decidirán en ADR de nube y POC.

## Principios obligatorios

1. La API es el único ingreso de aplicación público. Clientes llegan a la API por HTTPS. MongoDB y Sandbox no tienen ingreso público.
2. API/worker solo llaman a MongoDB y Sandbox por canales privados. API→Sandbox usa HTTPS con validación TLS estándar, URL configurada explícitamente y sin seguir redirects; el token de servicio es autenticación adicional, no sustituye cifrado ni segmentación.
3. El Sandbox trata todo destino de análisis como hostil. No puede iniciar conexiones a API, MongoDB, redes internas/de pares, servicios de plataforma ni otros workloads. Su único egreso es navegación HTTP(S) pública mediante un punto de enforcement independiente de Chromium.
4. Política por defecto: denegar. Si el firewall/proxy, política, DNS controlado o credencial de salida no está disponible, el análisis no obtiene ruta alternativa ni se degrada a salida directa.
5. Cada regla productiva tendrá propietario, fuente/destino, protocolo/puerto, identidad, propósito, logs de decisión redactados y prueba positiva/negativa. Una regla NAT no es una política de filtrado.

## Topología lógica

```mermaid
flowchart LR
  C[Cliente móvil/admin] -->|HTTPS público| A[API]
  A -->|TLS privado + token de servicio| S[Sandbox]
  A -->|TLS/red privada| M[(MongoDB)]
  S -->|HTTP(S) filtrado por enforcement| E[Proxy / firewall egress]
  E -->|HTTP(S) permitido| W[Internet: destino de análisis]
  S -. denegado .-> A
  S -. denegado .-> M
  S -. denegado .-> P[Metadata y plano de control]
  C -. denegado .-> S
  C -. denegado .-> M
```

## Matriz de flujos

| Origen | Destino | Protocolo/puerto | Decisión | Identidad/datos | Evidencia requerida |
|---|---|---|---|---|---|
| Cliente móvil/admin | API | HTTPS/443 en borde público | Permitir | Usuario/app; tokens de usuario protegidos | TLS/borde, auth, rate limit y prueba HTTP de rutas |
| Internet arbitrario | API | Solo listener HTTPS administrado | Permitir únicamente en el borde/API | Sin acceso directo a servicios internos | Inventario de ingress y escaneo externo aprobado |
| Internet | Sandbox, incluyendo `/health` | Cualquier protocolo | Denegar | Sin identidad pública | Regla ingress + prueba negativa externa desde red de prueba |
| API/worker | Sandbox | HTTPS, puerto privado acordado | Permitir | Identidad de servicio; Bearer secreto temporal como control actual | Handshake/hostname TLS real, ACL privada y análisis autenticado |
| API/worker | MongoDB | TLS, puerto privado del servicio DB | Permitir | Identidad DB mínima y usuario/rol propio | ACL, validación TLS, prueba de acceso solo a DB autorizada |
| Sandbox | API, MongoDB, otros workloads | Cualquier protocolo/puerto | Denegar | Ningún acceso de lectura/escritura | Prueba negativa TCP/HTTP/IPv4/IPv6 y logs de denegación |
| Sandbox | Resolver DNS controlado | DNS solo por endpoint autorizado | Permitir de forma acotada | Sin query logs con URL completa ni datos de usuario | Prueba que DNS directo alterno/UDP no evade el resolver |
| Sandbox | Internet público | HTTP/HTTPS por enforcement; destino validado al conectar | Permitir solo conforme a política de abajo | Sin cookies/credenciales de usuario fuera de la URL entregada | Pruebas A/AAAA, redirect, subrecurso y rebinding con fixtures |
| Sandbox | CIDR privado/reservado, loopback, link-local, metadata, plano de control, VPC/VNet/peering y endpoints internos | Cualquier protocolo/puerto, IPv4 e IPv6 | Denegar siempre | No aplica | Pruebas con simuladores seguros y logs de política; nunca sondear metadata real |
| Sandbox | UDP, WebRTC/STUN/TURN directo, QUIC u otros caminos no inspeccionados | Cualquier puerto | Denegar salvo excepción evaluada y aprobada | No aplica | Prueba de bypass desde el workload |

Los puertos numéricos exactos de servicios privados, resolver y enforcement son resultado de proveedor/POC; ninguna decisión concreta se infiere de esta tabla. El puerto exterior HTTPS 443 es requisito para los clientes, sujeto al diseño de borde.

## Semántica de egreso del navegador

- No se permite ruta de salida directa del Sandbox a Internet: todos los protocolos pasan por el enforcement seleccionado. El permiso de HTTP/HTTPS no se interpreta como permiso para IPs privadas o internas.
- El enforcement debe evaluar la IP de destino efectiva en el momento de conexión, no confiar solo en la URL, la comprobación DNS previa de la aplicación ni el hostname. Debe cerrar las carreras DNS/TOCTOU, redirecciones y recursos secundarios.
- Denegar loopback, RFC1918, link-local, IPv4-mapped a destinos denegados, IPv6 ULA/link-local/multicast/reservado, CIDRs de la plataforma, servicios de control/metadata, peering y endpoints privados; enumerar rangos específicos del proveedor al crear la implementación.
- Usar resolución DNS designada; bloquear resolutores alternos, DoH/DoT directo y egress DNS no autorizado. Controlar TCP/UDP y protocolos no web para impedir bypass desde Chromium/procesos auxiliares.
- Un fallo de DNS, proxy/policy o validación del destino aborta el análisis de forma fail-closed y no produce veredicto de seguridad. Los logs de enforcement no deben conservar URL, query, token ni contenido; usar identificadores de intento o categorías de regla con retención definida.

## Identidad, TLS y secretos

- Baseline de transporte ya implementado en cliente: producción exige `SANDBOX_SERVICE_URL` HTTPS, TLS estándar de Node y no sigue redirects; HTTP solo se admite para loopback fuera de producción. Ver [ADR-0006](../decisions/ADR-0006-api-sandbox-transport-security.md).
- El despliegue debe validar confianza de certificado y hostname en la ruta realmente utilizada, incluyendo terminación TLS, proxy y certificados internos. No hay excepción `ignoreHTTPSErrors`, `rejectUnauthorized: false` ni fallback plaintext.
- El token Bearer API↔Sandbox actual se mantiene como defensa en profundidad: cargar desde secret manager, no imagen/archivo versionado/log, compartirlo de forma controlada y definir rotación/rollback. Token común no prueba identidad workload ni impide acceso lateral si se filtra.
- Al elegir proveedor se debe adoptar identidad de workload/mTLS o documentar una alternativa equivalente con amenaza residual y revisión explícita. La decisión debe cubrir probes de salud: `/health` puede ser sin token en la app únicamente si la red impide acceso público y limita la sonda al plano de operación autorizado.

## Pruebas de aceptación de red

Con datos sintéticos, destinos locales simulados y ambiente aislado:

1. API accede al Sandbox por ruta privada HTTPS con hostname/certificado válido; un certificado inválido y un redirect fallan sin entregar Bearer a un segundo destino.
2. Cliente no puede llegar a Sandbox ni Mongo; `/health` solo es alcanzable desde la sonda interna permitida.
3. Sandbox puede alcanzar solo el origen HTTP/HTTPS de fixture por el enforcement; conexiones directas de proceso y paths alternos se niegan.
4. Sandbox no puede alcanzar API, Mongo, un sink interno simulado, metadata simulada ni cualquier CIDR privado/reservado, para IPv4 e IPv6.
5. DNS A/AAAA público, mixto, privado, NXDOMAIN/error y secuencia de rebinding se comprueban incluyendo redirects, iframes, XHR y subrecursos; al resolver a rango denegado, la conexión se bloquea.
6. DNS directo, UDP, WebRTC/QUIC y servicios auxiliares no pueden evadir la política; si el enforcement/DNS falla, no hay salida directa.
7. Se conservan evidencias de regla/flujo, prueba/fecha/imagen de runtime y motivo de denegación sin URLs, query, tokens o contenido de páginas.

## Qué puede cerrarse ahora y qué espera

**Antes de proveedor:** aceptar este contrato, completar threat/rule matrix, tener fixtures y pruebas diseñadas; pruebas unitarias de URL cliente/transporte en ADR-0006 no sustituyen aceptación de red.

**Después de elegir proveedor y región:** mapear cada flujo a subred, ACL/firewall, NAT/proxy, DNS, IAM/secrets, TLS/certificados y servicio Mongo. Ejecutar POC, validar capacidades/cuotas/costo/retención regional y probar los siete casos en staging. Actualizar este contrato con referencias a reglas reales y evidencias; sin ellas, G1-SEC permanece parcial.

Un harness Docker/iptables local, si se desarrolla, sirve como prueba de regresión del contrato pero no acredita ACL de nube, egress managed ni peering de MongoDB. No desplegar, abrir captura proxy ni declarar producción lista por aprobar este documento.
