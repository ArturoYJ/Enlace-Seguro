# Evaluación preliminar de fuentes externas de reputación

**Revisado:** 2026-11-04  
**Estado:** evaluación documental; decisión de producto, compra e integración pendiente  
**Mercado de referencia:** México; no se presume que el servicio vaya a ser comercial, gratuito ni operado en una región específica.

## Propósito y conclusión ejecutiva

Evaluar VirusTotal, Google Safe Browsing / Web Risk, URLhaus y RDAP/WHOIS como posibles fuentes para enriquecer el análisis de enlaces. Esta comparación no autoriza contratación, uso de claves, transmisión de URLs reales ni implementación.

**Conclusión provisional:**

1. Si el proyecto puede ser comercial, **no basar un producto en Safe Browsing API v4 gratuita ni en VirusTotal Public API**. Ambas tienen restricciones explícitas de no uso comercial; para Google se debe cotizar/validar **Web Risk**, y para VirusTotal un plan privado/premium con autorización escrita para el caso de uso.
2. **URLhaus** puede complementar detección de URLs que distribuyen malware, pero su API Community está sujeta a fair use y el propio proveedor advierte que el uso comercial puede requerir el servicio mejorado de pago. Su cobertura declarada no equivale a detección general de phishing.
3. **RDAP/WHOIS** debe tratarse como enriquecimiento de dominio (edad/registrador/estado cuando estén disponibles), no como motor de reputación ni verdict. En el caso mexicano importa que la delegación IANA de `.mx` actualmente lista `whois.mx` y no publica una base URL RDAP para `.mx`; el flujo de RDAP general de gTLD no cubre automáticamente este ccTLD.
4. No se recomienda enviar URLs completas de usuarios a proveedores externos hasta aprobar finalidad, avisos, consentimiento/base aplicable, transferencia internacional, retención y contrato con revisión legal/de privacidad. Puede haber secretos, tokens, identificadores o datos personales en el path/query.

No se evaluó la calidad con un dataset representativo de México, latencia desde México, cobertura local medida, ni términos negociados. Los datos de precio/cuota son los publicados por cada proveedor al momento de consulta y pueden cambiar.

## Comparativo

| Fuente | Qué aporta | Licencia/uso y costo publicado | Privacidad de la consulta | Disponibilidad/latencia | Encaje provisional |
|---|---|---|---|---|---|
| VirusTotal Public API | Reputación de URL/dominio y análisis multi-motor/comunitario | Gratis; 4 solicitudes/minuto y 500/día; uso no comercial/académico; prohibido en productos o servicios comerciales | La documentación de Scan URL dice que los IoCs enviados **o consultados por API** se analizan y agregan al dataset accesible a la comunidad. No enviar indicadores sensibles/PII | Sin SLA en API pública; Private API es cotización, cuota personalizada y SLA sujeto al acuerdo | No elegible para producto comercial con key pública. Evaluar plan privado solo con aprobación escrita sobre el caso de uso y tratamiento de datos |
| Google Safe Browsing API v4 | Consulta de listas de Google para social engineering, malware y otras categorías listadas | Gratis, pero exclusivamente no comercial; cuota default variable y aumento sujeto a aprobación | Lookup transmite la URL completa en la solicitud. No se presenta como consulta privada/hashed | Cuota por proyecto configurable; cobertura del servicio Google, sin garantía de latencia publicada en Lookup | Solo posible para uso no comercial tras validar restricciones de visualización/atribución; no elegir para trayectoria comercial |
| Google Web Risk | Producto empresarial para consultar listas; Lookup y Update | Lookup `uris.search`: 100,000 llamadas/mes gratis; después US$0.50 por 1,000 hasta 10M, luego cotización. Update `hashes.search`: US$50 por 1,000. Cuotas de llamadas separadas y configurables | Lookup envía la URL real y Google conoce qué URLs se consultan. Update usa hashes locales y envía prefijos de hash/confirmación en casos de match; requiere mayor complejidad | Web Risk SLA publicado: 99.9% uptime bajo contrato aplicable. Lookup no garantiza tiempo de respuesta. Quotas publicadas: `uris.search` 6,000/min por proyecto (sujetas a cambio) | Mejor candidato comercial a prueba controlada, si costo, aviso/privacidad, términos de no redistribución y región/procesamiento se aprueban |
| URLhaus Community API | Indicadores de URL usados para distribución de malware | API Community gratuita bajo fair use y requiere Auth-Key; uso por empresas/comercial puede requerir enhanced commercial API; precio público no observado | Consultar URL remite indicador a abuse.ch. Los indicadores **enviados** a URLhaus se comparten con proveedores de seguridad, AV, blocklists y Google Safe Browsing; evitar usar submit API con contenido del usuario | Dumps/feeds se actualizan cada 5 minutos según docs; servicio mejorado dice ofrecer mayor reliability/stability, sin SLA numérico observado en la doc pública | Complemento de malware-download, no fuente general de phishing; usar solo después de confirmar fair use/entitlement comercial y sin reportar URLs arbitrarias de usuario |
| RDAP/WHOIS | Datos de registro de dominio: fechas/estado/registrador/entidades si publicados | Sin precio uniforme de protocolo; los límites y condiciones dependen del registro/registrador/servicio. El lookup ICANN es gratuito para personas, no constituye SLA de API para producción | Consulta el dominio en el operador autoritativo; datos del titular pueden estar redactados o restringidos. El nombre de dominio consultado se revela al servidor correspondiente | RDAP gTLD es fuente definitiva desde 28-01-2025. Disponibilidad, rate limits y formato en ccTLD dependen del operador; `.mx` figura actualmente con `whois.mx` y sin RDAP Base URL en IANA | Complemento opcional de metadata; definir WHOIS `.mx` por separado, con límites y normalización; no usar antigüedad como señal concluyente |

## Detalle por proveedor

### VirusTotal

- **API y cobertura:** REST API v3 permite consultar reportes de URL/domino/IP y enviar URLs para análisis. El sitio documenta múltiples motores de antivirus, blocklists y herramientas; el número de motores y resultados puede variar por objeto/plan. No equivale a una verdad binaria ni a cobertura garantizada de todas las URLs mexicanas.
- **Restricciones y precio:** el Public API es gratuito y apropiado para uso académico/no comercial, pero la documentación establece límites de 4 solicitudes/minuto y 500 solicitudes/día, y prohíbe integrar el Public API en productos o servicios comerciales. El API privado/premium es de pago por cotización, con rate custom; la documentación de diferencia público/privado indica términos premium y un SLA, sujeto a suscripción.
- **Privacidad:** el endpoint `POST /api/v3/urls` establece expresamente que cualquier IoC enviado o consultado vía API será analizado y añadido al dataset de VirusTotal, accesible a la comunidad; indica no enviar IoCs sensibles, confidenciales o con PII. Por diseño, las URLs recibidas por EnlaceSeguro podrían llevar tokens de restablecimiento, códigos de invitación, identificadores de usuarios o datos de tracking. Antes de cualquier consulta, excluir credenciales y datos sensibles cuando sea viable y revisar si el proveedor permite ese tratamiento; el filtrado no debe alterar la URL que analiza el Sandbox local.
- **Recomendación:** descartar key pública en producción/comercial. Para evaluar VT privado, obtener oferta y contrato, precisar que EnlaceSeguro analiza enlaces aportados por usuarios y solicita resultados para mostrarlos a esos usuarios, aclarar si se puede mostrar/redistribuir scores/atributos y si hay modo privado de lookup. No asumir que “Private API” equivale a “Private Scanning”.

### Google Safe Browsing API v4 y Web Risk

- **Distinción de producto:** Safe Browsing API v4 documenta uso solo no comercial y redirige usos comerciales a Web Risk. No tratar el nombre “Safe Browsing” como sinónimo de un plan gratuito comercial.
- **API/cobertura:** Web Risk Lookup consulta una URL por solicitud (`GET uris.search`) y devuelve tipos de amenazas y vencimiento de la coincidencia; threat types se seleccionan al invocar. Update mantiene una copia local de listas hash y confirma matches; Google sugiere Update si la privacidad/latencia es prioritaria, a cambio de canonicalización, sincronización y más operaciones. Esas listas representan amenazas identificadas por Google; una respuesta vacía no demuestra que la URL sea segura.
- **Costo y cuota:** pricing oficial publica 100,000 búsquedas Lookup al mes sin costo, luego US$0.50 por cada 1,000 solicitudes entre 100,001 y 10M; por encima requiere ventas. Consultas `hashes.search` del Update se publican a US$50 por 1,000; los `computeDiff` son gratuitos. La cuota publicada de `uris.search` es 6,000/min por proyecto, pero cuotas pueden cambiar y cada proyecto debe revisar consola y límites reales. El costo se escala por llamadas a proveedor, no por cantidad de usuarios: instrumentar llamadas reales y presupuesto máximo antes del piloto.
- **Privacidad y presentación:** Web Risk Lookup envía la URL sin hash; la documentación reconoce que el servidor conoce la URL consultada. El Update usa hashes locales y consulta servidor solo para coincidencias/confirmaciones, con mayor complejidad y tráfico periódico. La documentación dice que información de Web Risk no debe redistribuirse. Safe Browsing v4 también requiere atribución de Google en alertas atribuibles a sus datos, lenguaje de riesgo no absoluto y aviso visible de que protección no es perfecta. Antes de diseñar UI comercial, confirmar términos aplicables de Web Risk para mostrar resultados agregados.
- **Recomendación:** candidato primario comercial para un piloto si el contrato cubre el producto y la privacidad es aceptable. Comparar Lookup directo frente a Update/local antes de elegir; empezar con Lookup solo con muestra sintética o consentimiento y medir desde el entorno de despliegue previsto. Confirmar región/data processing, DPA y términos de mostrar resultados con Google Cloud antes de datos reales.

### URLhaus

- **API/cobertura:** requiere Auth-Key, ofrece consulta automatizada y feeds. La misión descrita es rastrear URLs de distribución de malware. Las reglas de envío dicen que recibe URLs activas que alojan payload de malware; URL shorteners o sitios de redirección sin payload y phishing/phishing kits no son lo que se debe reportar. Puede complementar pero no sustituir una lista de phishing.
- **Licencia/costo:** Community API se declara gratuita bajo fair use, pero su documentación advierte que uso por empresas, redes o personas con fines comerciales/lucrativos puede requerir una suscripción pagada al enhanced abuse.ch commercial API, que promete mejor confiabilidad/estabilidad. Precio/SLAs exactos no quedaron publicados en documentación consultada; pedir confirmación antes de uso de producto.
- **Privacidad:** la búsqueda comparte el IOC consultado con el servicio de abuso.ch; el envío de una URL al repositorio es distinto: datos enviados se comparten con security solution providers, AV vendors, blocklists y Google Safe Browsing, y la política prohíbe URLs privadas/especiales y restringe el tipo de amenaza. EnlaceSeguro no debería auto-reportar URLs recibidas por usuarios.
- **Recomendación:** evaluar solo como feed/lookup secundario de malware, con filtro/normalización local, cache acotada y circuit breaker. No marcar phishing con base en un no-match URLhaus. Obtener confirmación escrita de fair use/licencia comercial y límites para uso de consulta transaccional por usuario.

### RDAP / WHOIS

- **API/cobertura:** RDAP es el protocolo estructurado sucesor de WHOIS para registros gTLD; desde 28-01-2025 los registros/registradores gTLD deben proveer RDAP y ya no necesitan WHOIS (con excepciones especificadas por ICANN). La resolución de servicio se debe hacer desde bootstraps RDAP/IANA, no codificando un servidor universal. Los resultados son variables, algunos campos se redactan y la devolución de datos de registro no autentica al titular ni determina reputación.
- **México:** el archivo de IANA para `.mx`, actualizado el 28-02-2026 al momento consultado, indica NIC-Mexico como manager, `whois.mx` como servidor WHOIS y guion para RDAP Base URLs. Por tanto, para dominios `.mx` no asumir la cobertura de RDAP gTLD; investigar acceso, términos, formato, cuotas y permiso de automatización de WHOIS de Registry .MX antes de integrarlo. El aviso de privacidad de Registry .MX explica que WHOIS consulta nombres de dominio y datos principales; revisar la versión vigente con asesoría.
- **Costo/latencia/privacidad:** no existe tarifa, cuota o SLA de RDAP/WHOIS unificada; varía por registry/registrar/servicio. Las consultas contactan al operador y pueden verse limitadas o degradadas; implementar cache respetando términos y `429`/timeouts por servicio. Los nombres de dominio pueden revelar relaciones comerciales/personales y el servidor receptor conoce la consulta.
- **Recomendación:** opcional para contexto temporal de dominio cuando haya datos disponibles (p. ej., registrar/creación/status), con valores ausentes/redactados tratados como “sin dato”, nunca como benignos. Separar adaptador por TLD y no usar WHOIS raw como proveedor externo genérico.

## Privacidad, datos personales y México — revisión necesaria

Una URL suministrada por una persona no es necesariamente dato personal, pero su query string, path, token, cuenta o parámetros de seguimiento pueden identificar a una persona o exponer secretos. Las consultas también pueden producir logs del proveedor, transferencia transfronteriza o inclusión en corpus comunitarios dependiendo del servicio y método.

La LFPDPPP publicada en el DOF el 20-03-2025 incluye reglas de tratamiento, aviso de privacidad, encargados y transferencias; esta nota no determina si el proyecto está sujeto a una obligación concreta ni si cada URL es dato personal. Antes de habilitar proveedores, asesoría legal/de privacidad debe confirmar: (1) responsable/encargado y finalidades; (2) texto y momento del aviso/consentimiento/base aplicable; (3) tratamiento/transferencia internacional y contratos; (4) minimización/redacción, retención, derechos y eliminación; (5) reglas de compartir o redistribuir datos de reputación; (6) si el uso cambia cuando el prototipo se ofrece o monetiza.

No usar la API o credenciales reales para experimentar con URLs de usuarios hasta que esos puntos estén aprobados. Probar con URLs sintéticas/de prueba publicadas por proveedor y credenciales sandbox/test cuando existan.

## Recomendación de decisión por etapas (gated; no aprobada)

1. **Definir modelo de distribución:** académico interno, producto gratuito al público, producto con publicidad, servicio B2B o comercial. La categoría puede cambiar términos, compra y privacidad; no inferirla del estado actual.
2. **Revisión de privacidad/legal:** elaborar inventario de campos enviados por endpoint; revisar aviso, base de tratamiento/consentimiento, transferencias y acuerdos de encargado/DPA con cada proveedor; establecer política de exclusión de URLs sensibles.
3. **Prototipo comparativo sin datos reales:** tomar corpus sintético/test y medir coverage por tipo de señal (phishing, malware, shortener, dominio nuevo, `.mx`), hit/miss y conflicto, latencia p50/p95/p99 desde el despliegue previsto, error/429, volumen/costo proyectado y estacionalidad.
4. **Confirmación comercial:** pedir por escrito a Web Risk, VirusTotal Premium y abuse.ch comercial: producto elegible, derecho a mostrar campos al usuario final, límites, precio/overage, retención, ubicación/procesamiento, SLA y soporte. No aceptar una comparación basada solo en páginas públicas si el contrato estándar aplica condiciones distintas.
5. **Seleccionar de forma explícita:** la primera decisión futura debe poder aprobar una fuente primaria de reputación (o ninguna), cero o más fuentes auxiliares, política de caché/TTL y mensajes de atribución. Mantener `provider unavailable`, `not queried` y `no match` como estados distintos.
6. **Implementar solo después de decisión:** secretos solo servidor, adaptadores aislados, timeouts y límites, cache de acuerdo con vencimientos/terms, circuit breaker, trazabilidad sin URLs completas, y tests con respuestas sintéticas/contract tests. Nunca convertir error/timeouts en veredicto benigno.

**Recomendación actual:** diferir integración. Para exploración comercial, pedir primero oferta y términos de Web Risk Lookup (y evaluar Update si el objetivo de privacidad compensa la complejidad), aclarar plan/privacidad con VirusTotal solo como alternativa contratada, y mantener URLhaus como suplemento sujeto a licencia. Tratar RDAP como metadata opcional por TLD y validar `.mx` aparte. La decisión final permanece pendiente de producto, costo, privacidad y revisión legal.

## Actualización de revisión — Safe Browsing v5 (2026-11-04)

La documentación primaria ahora incluye una sección explícita de **Safe Browsing API v5** (última actualización indicada: 2026-03-10). La conclusión de elegibilidad no cambia: Google señala que Safe Browsing es solo para uso no comercial y dirige usos comerciales a Web Risk. v5 agrega modos Real-Time, Local List y No-Storage Real-Time, y métodos `urls.search` y `hashes.search`; `urls.search` envía URLs sin ocultarlas, mientras que `hashes.search` envía prefijos de hash y exige implementar canonicalización, sufijos/prefijos y comparación local. La opción hash reduce exposición de la URL en la petición, pero no elimina la necesidad de revisar términos, tratamiento de datos y restricciones del modo elegido. No se verificaron cobertura de `.mx`, latencia desde México ni el comportamiento operativo de v5 mediante llamadas; no se enviaron URLs.

**Recomendación actual para EnlaceSeguro:** mantener G3-REP como evaluación cerrada documentalmente, pero dejar integración bloqueada. No se aprueba fuente alguna por defecto. Si el propietario decide avanzar, la decisión pendiente es seleccionar explícitamente una fuente (o ninguna) y confirmar el modelo de distribución, tratamiento/transferencias de URLs, derechos de mostrar resultados, costos y licencia. Safe Browsing v5 no resuelve por sí solo el gate comercial; Web Risk requiere evaluación/confirmación contractual. URLhaus sigue siendo una señal auxiliar acotada a distribución de malware; VirusTotal Public no es apto para producto comercial; RDAP/WHOIS `.mx` queda como enriquecimiento no concluyente.

## Fuentes primarias consultadas

Acceso a las fuentes: **2026-11-03 y 2026-11-04**.

### VirusTotal

- [VirusTotal API Overview](https://docs.virustotal.com/docs/api-overview) — límite y prohibición del Public API comercial.
- [VirusTotal Public vs Premium API](https://docs.virustotal.com/reference/public-vs-premium-api) — cuotas y elegibilidad de planes.
- [VirusTotal Public vs Private API](https://docs.virustotal.com/docs/difference-public-private) — pricing por cotización, rate custom y SLA de documentación.
- [VirusTotal Scan URL API](https://docs.virustotal.com/reference/scan-url) — POST URL y advertencia de inclusión de IoCs enviados/consultados en el dataset comunitario.
- [VirusTotal URL object](https://docs.virustotal.com/reference/url-object) — campos reportados y accesibilidad de información.
- [VirusTotal How it works](https://docs.virustotal.com/docs/how-it-works) — uso y compartición de submissions con partners.

### Google

- [Safe Browsing API v4: Usage restrictions](https://developers.google.com/safe-browsing/v4/usage-limits) — no comercial, cuota y guidelines de warning/atribución.
- [Safe Browsing API overview (v5)](https://developers.google.com/safe-browsing/reference) — documentación v5, métodos y modos; identifica uso no comercial y deriva el uso comercial a Web Risk.
- [Safe Browsing API Terms of Service](https://developers.google.com/safe-browsing/terms) — términos generales, restricciones comerciales, avisos/atribución y tratamiento de URLs consultadas mediante SearchUrls.
- [Web Risk: Lookup API](https://docs.cloud.google.com/web-risk/docs/lookup-api) — una URL por query, request y campos de respuesta.
- [Web Risk overview](https://docs.cloud.google.com/web-risk/docs/overview) — tradeoff de privacidad/latencia entre Lookup y Update, resultados no redistribuibles.
- [Web Risk pricing](https://cloud.google.com/web-risk/pricing) — nivel gratis y tarifas publicadas.
- [Web Risk quotas and limits](https://docs.cloud.google.com/web-risk/quotas) — cuotas sujetas a cambios por proyecto.
- [Web Risk SLA](https://cloud.google.com/web-risk/sla) — uptime de 99.9% bajo el acuerdo aplicable.

### URLhaus / abuse.ch

- [URLhaus Community API](https://urlhaus.abuse.ch/api) — API, fair use, Auth-Key, feeds y aviso de suscripción comercial.
- [URLhaus About](https://urlhaus.abuse.ch/about/) — objetivo de la plataforma y divulgación de submissions a proveedores y listas.
- [URLhaus Submission Policy/API](https://urlhaus.abuse.ch/api/#policy) — ámbito de malware y reglas para submissions.
- [abuse.ch Commercial usage contact](https://contact.abuse.ch/) — canal oficial de preguntas comerciales; no se observó tarifa pública.

### RDAP / WHOIS y México

- [ICANN: RDAP information for users](https://www.icann.org/en/contracted-parties/registry-operators/registration-data-access-protocol/information-for-rdap-users-31-08-2018-en) — obligación gTLD y sunset WHOIS.
- [ICANN: RDAP/WHOIS transition](https://www.icann.org/en/announcements/details/icann-update-launching-rdap-sunsetting-whois-27-01-2025-en) — RDAP definitivo para gTLD desde 28-01-2025.
- [IANA Root Database: `.mx`](https://www.iana.org/domains/root/db/.mx.html) — registry, WHOIS server y estado de RDAP Base URLs de `.mx`.
- [Registry .MX: aviso de privacidad de usuarios de dominios `.MX`](https://beta.dominios.nic.mx/docs/Aviso_de_Privacidad.pdf) — contexto oficial del registro y WHOIS; confirmar versión vigente antes de tomar decisión.
- [DOF: decreto LFPDPPP de 20-03-2025](https://www.dof.gob.mx/nota_detalle.php?codigo=5752569&fecha=20/03/2025) — texto legal mexicano vigente de referencia; aplicación al proyecto pendiente de revisión jurídica.
