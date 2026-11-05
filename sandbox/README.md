# EnlaceSeguro — Servicio Sandbox Aislado

Servicio independiente de ejecución y análisis de enlaces sospechosos en navegador aislado con Playwright/Chromium.

Las rutas `POST /analyze` y `GET /captures/:attemptId` exigen `Authorization: Bearer <SANDBOX_SERVICE_TOKEN>`. Configura la misma clave aleatoria de al menos 32 bytes que la API; `/health` permanece sin autenticación para probes. CORS está deshabilitado porque el cliente es servicio-servidor. El token no sustituye TLS ni aislamiento de red en despliegues productivos.

La respuesta de captura protegida envía `image/webp`, `Cache-Control: private, no-store` y `X-Content-Type-Options: nosniff`. El almacenamiento local rechaza bytes PNG mal etiquetados; la purga diaria sigue pendiente de programar y verificar.

Cada análisis tiene deadline global configurable `SANDBOX_ANALYSIS_DEADLINE_MS` (default 25 s; permitido 1–28 s), que incluye preflight, espera de cola y operaciones Chromium. Mantén el timeout API `SANDBOX_ANALYSIS_TIMEOUT_MS` al menos 5 s por encima; su default es 30 s. Un vencimiento devuelve HTTP 504 + `Retry-After`, cierra el contexto y nunca genera veredicto; fallos normales de navegación responden 502 reintentable. El worker aplica sus reintentos acotados y termina en `failed` al agotarlos. El resolver DNS y la escritura local no aceptan cancelación: la petición puede expirar antes de que el pool termine cleanup y libere el slot.

## Imagen de contenedor

`Dockerfile` construye el servicio con Chromium Headless Shell de Playwright (sin descargar el navegador headed innecesario), proceso no-root `enlaceseguro` (UID 10001) y sandbox de Chromium habilitado. El perfil [`seccomp_profile.json`](./seccomp_profile.json) está fijado a Playwright 1.64.1 y permite los syscalls necesarios para crear user namespaces; `SYS_CHROOT` es la única capacidad añadida. Se mantienen `--cap-drop=ALL`, `no-new-privileges`, root filesystem de solo lectura, tmpfs limitado y red desconectada en el smoke.

El smoke hardened anterior fallaba con el seccomp predeterminado porque bloqueaba `unshare`; al habilitar namespace syscalls Chromium después requería `SYS_CHROOT`. La prueba reproducible `npm run test:container-hardening` ahora reconstruye la imagen y verifica arranque/health bajo el perfil fijado. No desactiva el sandbox de Chromium, no usa `seccomp=unconfined`/`apparmor=unconfined`, `SYS_ADMIN` ni `--privileged`.

Antes de staging, seleccionar el runtime y repetir este smoke en el proveedor para verificar user namespaces o sandbox de OS equivalente bajo el seccomp/AppArmor efectivo. El smoke local no comprueba ACL cloud ni egress. En despliegue, montar almacenamiento de capturas separado y writable; exponer `/health` solo a la red de operación y `/analyze`/`/captures` solo a la API. La red debe bloquear metadata, RFC1918/loopback y egress no aprobado, independientemente del Anti-SSRF de aplicación. No usar `--privileged`, desactivar perfiles LSM ni agregar fallback sin sandbox.

El perfil seccomp proviene del perfil oficial Playwright [`utils/docker/seccomp_profile.json`](https://github.com/microsoft/playwright/blob/v1.64.1/utils/docker/seccomp_profile.json), SHA-256 `cc3e61cabda6bbc1e53e54d27ba4d55a9d3be829b6dd1a596f4a7b31b1cc7849`. Revisar diff y repetir el smoke antes de actualizar Playwright o cambiar el perfil.

Esta imagen es una base local, no IaC ni deployment productivo. Faltan pin de digest/escaneo SBOM, montaje persistente y purga diaria, política de red efectiva, secretos gestionados y prueba del runtime cloud.

## Purga local de capturas

El propietario aprobó retención baseline de **30 días** y barrido **diario**, sujeto a revisión de privacidad antes de producción. El cutoff usa 30 × 24 horas desde la última modificación del archivo; el TTL de MongoDB no borra estos archivos. La suite prueba el CLI: dry-run por defecto, rechazo de `--execute` sin `--writes-paused`, y borrado selectivo solo con ambas banderas; esto valida el gate del comando, no pausa los writers automáticamente.

Después de `npm run build`, ejecuta `npm run purge:captures` desde `sandbox/` para ver conteos sin borrar. Para borrar, detén primero escrituras del Sandbox, comprueba el directorio de trabajo y la vista previa, y ejecuta `npm run purge:captures -- --execute --writes-paused`. El segundo flag afirma que las escrituras están pausadas; el comando no puede comprobarlo por sí solo. Solo procesa archivos regulares con nombre UUID canónico y extensión `.webp`; ignora symlinks y otros nombres. No imprime IDs, rutas ni URLs.

No existe scheduler ni despliegue de almacenamiento privado: configurar y probar la ejecución diaria en staging cuando se elija nube. No usar este comando para afirmar retención productiva ya validada.

## Arquitectura y Controles de Seguridad
1. **Protección Anti-SSRF en Capas:**
   - Preflight estático de esquema (solo `http:` y `https:`).
   - Resolución DNS obligatoria previa con inspección de todas las direcciones IP resultantes.
   - Bloqueo determinista de rangos privados (RFC 1918), loopback (`127.0.0.0/8`), metadatos cloud (`169.254.169.254`) y direcciones IPv6 reservadas.
   - Intercepción continua de red en tiempo de ejecución (`context.route`) para detectar redirecciones hacia IPs privadas.
   - Cada `BrowserContext` usa `SANDBOX_EGRESS_PROXY_URL` cuando está configurado; en producción su ausencia detiene el arranque. No se configura bypass. La candidata Envoy y sus límites están en [`egress-proxy/README.md`](egress-proxy/README.md). Las respuestas de error locales del proxy generan 502 reintentable, sin veredicto ni captura; Chromium verifica ese marcador con fixtures locales. Esto no demuestra la ACL de egress ni cierra el gate G1-SEC.
2. **Ciclo de Vida Efímero:**
   - Cada análisis crea un `BrowserContext` nuevo con permisos vacíos (`permissions: []`).
   - Cero persistencia de cookies, localStorage o credenciales entre ejecuciones.
   - El BrowserContext se crea con `acceptDownloads: false` y `serviceWorkers: 'block'`; además se registra/cancela el evento de descarga y se suprimen alertas/diálogos. `npm run test:browser` corre serialmente en Chromium real y confirma service workers, adjuntos y bloqueo de solicitudes secundarias de imagen/iframe a IP privada con fixtures loopback; no prueba egress, DNS rebinding, el pool desplegado ni tamaño/persistencia de descargas.
   - La validación TLS del navegador es estricta (`ignoreHTTPSErrors: false`). Si falla un certificado de la navegación principal o de un subrecurso (`ERR_CERT_*`), Sandbox devuelve `outcome: inconclusive` y `reasonCode: tls_certificate_invalid`, sin veredicto ni captura; esos errores no pasan por `VerdictEvaluator`. Playwright espera el evento `load`, escucha `requestfailed` y cierra Chromium antes de persistir captura; no se ignoran certificados ni se serializa el mensaje/URL del navegador. `page.goto` conserva 15 s dentro del deadline global de 25 s; un recurso lento puede dar 504 reintentable. La API persiste estado `inconclusive` y audita el código estable. Chromium loopback verifica documento principal e imagen/iframe; egress y staging siguen pendientes.
   - El deadline global de 25 s aborta el BrowserContext y responde 504 sin veredicto; navegación fallida no TLS responde 502. Chromium real con fixture loopback demuestra que una navegación colgada no produce veredicto y permite cleanup del contexto. No prueba DNS/egress, disco bloqueado ni hard-kill del proceso.
3. **Extracción de Señales y Capturas:**
   - Detección de formularios de contraseñas en conexiones no cifradas (HTTP).
   - Detección de iframes ocultos y envíos de formularios cross-origin.
   - Registro de saltos de redirección HTTP.
   - Captura de pantalla de la ventana gráfica almacenada localmente de forma opaca (`local://captures/{attemptId}.webp`).
