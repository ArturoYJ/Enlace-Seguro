# ADR-0005: TLS estricto y resultado inconcluso ante certificado inválido

- **Estado:** Aprobada por el usuario e implementada localmente
- **Fecha:** 2026-11-03
- **Contexto:** G1-SEC

## Contexto

El Sandbox analiza destinos adversariales con Chromium. La opción `ignoreHTTPSErrors: true` aceptaba certificados no confiables y permitía inspeccionar/renderizar el documento. Clasificar esa condición como `peligroso` confundiría una falla de validación con evidencia de phishing; continuar y producir un veredicto normal podría presentarse como señal de seguridad pese a no haber cargado el documento.

## Decisión

- Chromium aplica validación TLS normal (`ignoreHTTPSErrors: false`).
- Si la navegación del documento principal o cualquier recurso de la página falla con un error Chromium de validación de certificado (`ERR_CERT_*`), Sandbox responde con resultado discriminado `outcome: inconclusive`, `reasonCode: tls_certificate_invalid`; no incluye `verdict`, razones de seguridad ni captura.
- El API valida estrictamente esa forma, termina el job como `processingStatus: inconclusive`, guarda el reason code estable en los metadatos de job y registra `analysis.inconclusive` con outcome `partial`.
- El cliente móvil presenta el estado no concluyente y no inventa un veredicto. `VerdictEvaluator` rechaza señales TLS que se intenten convertir accidentalmente en un verdict.

## Alternativas

1. **Ignorar TLS:** rechazado porque anula autenticidad/confidencialidad y hace invisibles certificados inválidos.
2. **Marcar peligroso/sospechoso:** rechazado porque una falla de transporte no es por sí misma evidencia de phishing o malware.
3. **TLS estricto + inconclusive si falla cualquier request de la página:** elegida; expresa que no se obtuvo evidencia suficiente y evita afirmar seguridad cuando el documento o parte de su contenido no pudo validarse.

## Ampliación aprobada — 2026-11-04

El propietario aprobó ampliar la política a TLS inválido en subrecursos. La detección usa `requestfailed` de Playwright y clasifica únicamente errores `ERR_CERT_*`. La navegación espera el evento `load` para observar recursos iniciales; falla sin veredicto ni captura si algún documento/recurso informa certificado inválido. Chromium se cierra antes de persistir captura, evitando guardar una captura si se detectó un error. `page.goto` conserva timeout de 15 s y el deadline global es 25 s; recursos lentos pueden producir 504 reintentable antes de un veredicto. No se ignoran certificados ni se exponen mensajes/URLs de Chromium.

## Pruebas y límites

- Unit tests clasifican errores Chromium `ERR_CERT_*` sin serializar el mensaje/URL.
- Prueba con Chromium real y servidor HTTPS loopback con certificado autofirmado verifica que el navegador rechaza el documento y el servidor no recibe la solicitud.
- Pruebas de adaptador, worker/use-case, Mongo, flujo HTTP y cliente verifican código estable, terminalidad `inconclusive` y ausencia de veredicto.
- Pruebas Chromium del `PlaywrightContextPool` cubren certificado autofirmado de documento principal e imagen/iframe secundarios; la segunda confirma outcome `inconclusive` sin veredicto/captura. Los stubs Anti-SSRF solo permiten puertos loopback fixture. No visitan destinos públicos ni prueban DNS rebinding, egress, WebSocket TLS, red privada ni staging.
- Esta decisión no reemplaza filtro de egress, red privada, identidad entre servicios ni contenedor rootless/seccomp. Chromium ahora configura sandbox de proceso (`chromiumSandbox: true`); falta verificarlo en la imagen/runtime de despliegue.
