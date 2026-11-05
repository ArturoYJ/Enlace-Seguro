# Estado vigente

**Actualizado:** 2026-11-05
**Estado vigente:** objetivo actualizado a demo universitaria local y gratuita en cinco días; sin PaaS, tiendas ni requisitos de escala. API, worker, MongoDB, Sandbox y consola correrán localmente. iOS se demostrará en iPhone con Expo Go; Android tendrá APK local no probado en dispositivo. ADR-0012 y `docs/roadmap/academic-demo.md` rigen esta entrega; la hoja de ruta G0–G5 queda diferida como ruta futura de producción.

## Demo local — avance vigente — 2026-11-05

- En una copia aislada de archivos versionados pasaron `npm ci`, Expo prebuild y Gradle `assembleRelease` ARM64 con URL sintética; APK debug v2, target 36. No prueba instalación en Android ni reproducibilidad bit a bit; no se alteró el APK de demo.

- El usuario confirmó en iPhone que VoiceOver anuncia el campo de enlace y los botones Analizar, Historial y Cerrar sesión; otros estados, foco, texto y contraste siguen pendientes.

- El cliente usa Expo SDK 58. El usuario confirmó en iPhone registro de cuenta exclusiva de demo, login, navegación, análisis, historial y logout; informó que la interfaz se ve igual que la simulación. Persisten QA independiente contra Figma, VoiceOver y expiración de sesión en dispositivo.
- La suite Mongo desechable pasó con una prueba adicional de paginación de auditoría HTTP, incluidos eventos con la misma fecha/hora. La consola pasó también navegación siguiente/anterior en Chromium con respuestas sintéticas; no equivale a una prueba UI con múltiples páginas reales.
- Las cuatro fixtures locales (limpia, señal sospechosa, TLS inválido y timeout) pasaron por API/worker/Mongo/Sandbox reales en integración desechable; el timeout agotó cuatro intentos y terminó fallido sin veredicto. La excepción loopback y el deadline reducido aplican solo en el proceso de prueba.
- Con servicios locales y cuenta admin de demo, el análisis de `https://expired.badssl.com/` terminó `inconclusive` sin objeto de veredicto. Es una comprobación puntual con URL pública, no validación de aislamiento productivo.
- El APK documentado abajo es histórico, pertenece a SDK 57 y no tiene URL API; no representa la versión móvil actual. Regenerar solo tras estabilizar el flujo y probar conectividad HTTP Android.
- APK ARM64 SDK58 regenerado con código actual: package `com.anonymous.enlaceseguro`, target 36, firma debug v2 verificada; bundle contiene API LAN configurada al compilar. SHA-256 `421efcbc195bb040abae4c31330e5fb23680ffde554e4fac2e05f1c3d1a13dd1`. No instalado ni probado en Android; solo ARM64. Cleartext y firma debug son exclusivamente para demo local.

## G0 — baseline histórico de producción, diferido para la entrega

- Los valores de ADR-0011 (50 cuentas, 250 análisis/día, 10 simultáneos, SLO 99%, RPO/RTO) quedan solo como hipótesis futura; no son requisitos de esta entrega académica.
- La residencia vigente se satisface ejecutando aplicación y almacenamiento localmente en México; el Sandbox solo solicita los sitios web públicos que el usuario pega.
- AWS `mx-central-1` fue candidato de evaluación, no selección. No se requiere proveedor cloud ni gasto para la demo local.
- Preparé runbook cloud-neutral para despliegue/rollback staging (`docs/operations/staging-release-runbook.md`); es checklist de preparación, no evidencia de staging ni autorización de gasto.

## Android local — APK demo — 2026-11-04

- Con aprobación explícita de la licencia Android SDK, instalé command-line tools ARM64, Platform 36, Build Tools 36.0.0, NDK 27.1.12297006, CMake 3.22.1, platform-tools y OpenJDK 17. No instalé Android Studio ni emulador.
- Expo prebuild Android y `assembleRelease --no-daemon --max-workers=2` pasaron. APK universal de 106 MiB, SHA-256 `cdb1720b85eb0cfd6ab499c5cc5d59bb0efc9272949dd8c05f2fe3357b36cd71`, firma v2 verificada con debug keystore, package `com.anonymous.enlaceseguro`, target SDK 36.
- No hay Android físico/emulador; no se instaló ni probó. La build no recibió `EXPO_PUBLIC_API_URL`; recompilar con endpoint LAN y revisar el permiso de tráfico local antes de usar flujos conectados.

## G3-APP — errores API móviles seguros — 2026-11-04

- El happy-path E2E contempla resultado completado, inconcluso TLS y fallo terminal sintéticos. API+Mongo local confirmó los tres; el helper comprueba tres entradas cifradas, veredicto solo en completado y ausencia de payload en los otros. Maestro verifica copy de error y reintento explícito; UI nativa sigue sin ejecutar.
- Registro/login ya traducen estados API permitidos a mensajes seguros: login 400/401/429/red; registro 400/409/429/red; los estados restantes usan mensaje genérico. No se presenta `Error.message` remoto.
- API/OpenAPI documenta 400 para validación; la app ya no clasifica 422 no contratado. Validación local: 94/94 pruebas móviles, lint, typecheck y export Android/iOS/Web con verificación de bundle.
- El flujo Maestro de auth ahora empieza intentando registro con correo inválido y exige el mensaje controlado de HTTP 400 antes de crear cuenta. YAML se validó localmente; Maestro nativo/remoto todavía no ejecutado.
- UI tests ahora comprueban login 401, login sin red y registro 429; mensajes remotos no se presentan.
- Detalle, historial, cuenta, recientes, métricas y admisión ya usan mensajes controlados para fallos API; carga/polling no presentan Error.message remoto y mantienen mensajes de red/cuota específicos.
- No cierra G3: E2E nativo Android/iOS, QA visual/accesibilidad y CI remoto siguen pendientes.

## Validación adicional G3-ADMIN — 2026-11-04

- El E2E real de navegador ahora registra una cuenta `usuario`, intenta entrar a la consola y confirma el mensaje 403, permanece en login y no llama `/admin/*`; después ejecuta el flujo admin existente.
- MongoDB 8 replica set desechable, API fixture y Chromium pasaron E2E. Admin: lint, typecheck, 10/10 unitarias, build y `git diff --check` pasaron. No hubo cambios de API ni producción.
- G3-ADMIN continúa abierto: falta QA visual Figma/manual y validar hosting/CORS real; esta prueba local no sustituye CI remota.

## G1-SEC — regresión de logs API emitidos — 2026-11-04

- Añadí stream de log inyectable a `buildServer` para test y una prueba que dispara 500 sintético vía ruta real.
- Captura JSON confirma query/body/exception canarios ausentes; 500 conserva solo `requestId`, method, path saneado y status. Respuesta también no filtra detalles.
- API: 77/77 pruebas locales, typecheck/build pasan; cuatro integraciones Mongo se omitieron en `npm test`, suite Mongo general separada ya pasó después de agregar 401/409.

## G3-APP — fixture auth + postcondition E2E — 2026-11-04

- Corrí el API E2E fixture con MongoDB 8 replica set desechable y ejecuté login fallido, alta, alta duplicada y login correcto: HTTP 401/201/409/200.
- El helper real confirmó una cuenta sintética y un refresh token activo, sin consultar ni imprimir credenciales/hashes.
- Esto valida backend y assertion del workflow, no la interfaz Maestro instalada; Android/iOS remoto sigue pendiente. El contenedor temporal quedó limpio y el fixture de usuario anterior fue preservado.

## G3-APP — E2E móvil de errores auth — 2026-11-04

- El flujo Maestro Android/iOS crea primero la cuenta, prueba contraseña errónea real (401), registro duplicado (409), vuelve a acceso y completa login válido.
- Verificador Mongo exige exactamente una cuenta sintética y un refresh token activo, leyendo solo proyección de ID/estado, nunca hashes ni credenciales.
- Suite Mongo general exit 0; la secuencia API/Mongo en orden de UI confirmó register 201, wrong password 401, duplicate 409 y login válido 200. YAML/shell/typecheck pasan; ejecución instalada nativa/remota aún pendiente.

## G5 — prueba de seguridad del CLI de purga — 2026-11-04

- Añadí integración del CLI `purgeCaptures`: default dry-run no borra; `--execute` solo falla sin `--writes-paused`; con ambos elimina solo archivo UUID `.webp` vencido y preserva recientes, nombres inválidos y symlink/target.
- Sandbox: 55/55 unitarias, typecheck y build pasan. La retención aprobada es 30 días; scheduler diario y procedimiento operativo en staging siguen pendientes.

## G1-SEC/G2 — regresiones sintéticas egress en CI — 2026-11-04

- El workflow `ci.yml` ahora corre Envoy+Chromium, DNS rebinding, fallo de resolver, fallo de proxy y topología de redes Docker; cada regresión tiene timeout 180 s con cleanup de scripts.
- Las cinco suites pasaron localmente; el fixture móvil existente se preservó y no quedaron recursos temporales E2E.
- No equivale a ACL productiva: Envoy aún emite warning de API CIDR WIP. CI remota no se ha ejecutado; firewall/kernel independiente y staging siguen abiertos.

## G3-APP — logout y revocación en E2E — 2026-11-04

- API integration ahora confirma logout 204, refresh posterior 401 y revocación en Mongo.
- Maestro cierra sesión, relanza sin limpiar datos y espera login; workflow revisa que la cuenta sintética no conserve refresh tokens activos. No registra ni imprime tokens.
- La corrida nativa/remota aún no se ejecutó; el cambio no cierra G3 ni habilita producción.

## Incremento G1-JOBS — snapshot operativo de cola — 2026-11-04

- El worker emite `analysis_queue_snapshot` en stdout al iniciar y cada intervalo configurado (default 60 s). Incluye pending/cap, queued, leased, expired lease, reintentos, dead, antigüedad del más viejo, in-flight y fallos de polling; no incluye IDs, URL, correo ni secreto.
- El API mantiene la métrica interna; no agregué ruta pública ni amplié contrato admin. Umbrales y alertas quedan pendientes de objetivos G0 y sink cloud.
- Validación: API 76/76 unitarias, typecheck/build; prueba worker unitaria; integración enfocada MongoDB 8 desechable; suite general MongoDB de migraciones/matriz/explain/TTL/restore pasó. `git diff --check` pasa.
- Añadí `docs/operations/durable-analysis-queue.md`; no hay reproceso manual. G1-JOBS/G4 siguen abiertos para sizing, alertas, carga y staging.

## G0 — worksheet de objetivos operativos

- Creé `docs/architecture/production-operating-targets.md`. Separa límites observados del código (cuota 5/día, worker API 2, Sandbox 3, deadline 25 s, queue cap productivo explícito, capturas 30 días) de tráfico esperado, SLO, RPO/RTO, presupuesto y residencia de datos que requieren decisión del propietario.
- La comparación de nube aún es filtro preliminar, no ADR. No elegir proveedor/región ni aprovisionar hasta confirmar objetivos y validar cuotas, red privada/egress, Atlas/backups y costo en las cuentas candidatas.

## Incremento central G1-SEC — proxy egress candidato

- El propietario pidió continuar el plan original; no reactivar la POC OCI como precondición. Tres auditorías paralelas confirmaron que el guard DNS previo no fija la IP que Chromium conecta.
- Playwright ahora admite `SANDBOX_EGRESS_PROXY_URL` por `BrowserContext`, no agrega `bypass` y falla al construir el pool en `NODE_ENV=production` si falta. En desarrollo/tests aún puede omitirse; eso no demuestra un entorno protegido.
- Añadí candidato Envoy 1.40.2 en `sandbox/egress-proxy/`: HTTP absoluto solo puerto 80, CONNECT solo 443, sin MITM; filtros de direcciones reservadas, upstream RBAC y marker en errores locales. El marker se elimina de respuestas upstream y Sandbox transforma respuesta marcada a error retryable 502 antes de veredicto/captura.
- Evidencia local: Envoy `--mode validate` aceptó configuración; pruebas sintéticas aisladas observaron bloqueos de loopback/private/mixed DNS y CONNECT passthrough con TLS estricto. Un upstream 418 que intentó falsificar el marker fue limpiado. Chromium local probó marker en documento/subrecurso y preserva respuestas normales 403/503. `sandbox/egress-proxy/tests/smoke.sh` repite config validation, denegación IPv4/DNS privado, puertos 8081/444 y cero solicitudes al canary en red Docker `--internal`. Sandbox 52/52 unit, 11/11 Chromium browser, typecheck/build y `git diff --check` pasan.
- Nueva evidencia local (2026-11-04): `cd sandbox && npm run test:egress-proxy` pasó con Chromium, `PlaywrightContextPool`, Envoy real y canary DNS privado. Preflight se simuló como permitido; el proxy resolvió alias privado, respondió 503 con marker, pool no guardó captura y canary recibió cero requests. La prueba confirma integración, no una secuencia DNS cambiante ni ACL real. El puerto de prueba Envoy se publica solo en `127.0.0.1` y Docker limpia recursos por nombre único.
- `sandbox/egress-proxy/tests/topology-boundary.sh` agrega prueba con dos redes Docker `--internal`: cliente no confiable solo en red Sandbox; canary solo en red proxy; Envoy dual-homed. El cliente no alcanzó IP canary directo (curl exit 7); vía proxy recibió 503 marcado; canary recibió cero requests. No publicó puertos ni contactó destinos públicos. Solo prueba topología Docker local, no ACL host/cloud.
- G1-SEC pruebas locales ampliadas: `npm run test:egress-rebinding` usa DNS autoritativo sintético (dos IP documentación y luego canary privado) y confirma API 502 reintentable, sin captura ni request al destino; `npm run test:dns-resolver-outage` corta respuestas después de las dos consultas de preflight y obtiene el mismo fail-closed; `npm run test:proxy-outage` confirma proxy inaccesible, sin fallback directo y API 502. No contactan DNS público ni destinos externos.
- G1-SEC **no cerrado**: Envoy CIDR APIs siguen WIP; conservar proxy como candidato L7, no frontera IP productiva. Falta enforcement independiente kernel/cloud, validar red del runtime Sandbox, proxy/subrecursos y ACL en staging, y decidir proveedor/región/SLO en G0. Topología Docker no equivale a staging. No hay IaC ni proveedor seleccionado. Mantener captura apagada.
- Siguiente: cerrar objetivos operativos G0 y evaluar el firewall del proveedor elegido; no usar OCI como precondición del plan.

## G0 — candidato adicional de aislamiento cloud — 2026-11-04

- Evalué en paralelo AWS, GCP y Azure con fuentes oficiales. Ninguna pila completa gratuita cumple producción: Atlas M0 carece de private networking/backups requeridos, y runtime/red/NAT/backup/egress añaden coste. No aprovisioné ni seleccioné proveedor.
- Azure Container Apps Sandboxes merece spike separado: microVM por sandbox, OCI custom image, egress por host/CIDR/VNet y región Mexico Central; límites publicados son 300 cores concurrentes y 3,000 API requests/min por región/suscripción, a confirmar en cuenta.
- El estado de disponibilidad es documentalmente inconsistente: Azure anuncia Sandboxes generalmente disponible; un quickstart antiguo dice preview. La guía de fiabilidad no ofrece SLA ni zone/automatic regional failover. Mantener candidato, confirmar acceso/API/costo en cuenta, y probar Chromium, DNS/SSRF, TLS, egress, WebP y ciclo completo de 25 s antes de plantear cambiar el Sandbox actual.
- Hallazgo y fuentes añadidos en `docs/architecture/cloud-provider-evaluation.md`, `docs/architecture/free-cloud-poc-options.md` y `docs/roadmap/production-readiness.md`.
- Revalidé oficialmente las ofertas gratuitas: OCI Always Free reclama VM tras 7 días con CPU p95/red <20% y (A1) memoria <20%; solo home region, región/capacidad A1 no garantizada. AWS Free account es US$100 + hasta US$100, seis meses y subconjunto de servicios. Azure Container Apps Consumption concede 180k vCPU-s/360k GiB-s/2M requests mensuales, pero Sandboxes custom-container se factura vía Dedicated plan. Atlas Free: 0.5 GB, 100 ops/s, 500 conexiones, sin private endpoint/peering ni pruebas de failover/región; auto-pausa a 30 días sin conexiones.
- Conclusión G0 sin cambios de alcance: local efímero es única opción sin cargo para mantener suite completa sintética; OCI es una POC autogestionada, GCP/otros créditos son temporales y ningún free tier resuelve de forma comprobada la topología administrada/privada de producción. No se creó cuenta, no se aprobó costo ni se aprovisionó nada.
- El propietario priorizó diseñar una POC sintética OCI; esto no autoriza crear recursos. El diseño viable para probar API↔Sandbox requiere dos A1 1 OCPU/6 GB si home-region capacity lo permite; single A1 solo prueba empaquetado. Gate crítico: la validación DNS actual es TOCTOU porque Chromium resuelve de nuevo al conectar; reglas VCN no filtran `169.254.0.0/16`, NAT no filtra destinos y OCI Network Firewall cuesta US$2.75/h y exige cuenta de pago. Una POC gratuita solo podría probar enforcement host/proxy y no demostraría un firewall cloud administrado; costos de NAT y A1/ARM64 deben confirmarse.
- El propietario aprobó diseñar dos VM A1 para la POC sintética. Escribí `docs/superpowers/specs/2026-11-04-enlaceseguro-oci-free-poc-design.md`; el review independiente no halló contradicción grave y recomendó precisar stateful replies, aislamiento del proxy y egreso de mantenimiento; el texto ya fue afinado y espera revisión final del propietario. No hay código, IaC ni recursos OCI.
- El propietario cuestionó si este spike desviaba el plan original. Queda explícito que la POC OCI es un spike exploratorio, no un entregable G0–G5 ni precondición; no avanzar el spec a implementación/provisión ni dejarlo desplazar tareas centrales hasta que el propietario reafirme prioridad.

## Incremento M1/G3 showcase — 2026-11-04

- Showcase dev-only integrado desde Cuenta, sin crear ruta. Presenta tokens actuales, muestras IBM Plex Sans, escala espacial, radios, cuatro variantes de botón, alertas seleccionables y skeleton. Está protegido por `__DEV__`, cierre accesible y botón Atrás.
- `npm run export` ahora llama a `scripts/verify-release-bundle.mjs` y busca marcadores en bundles `.hbc`/`.js` Android, iOS y web; la verificación pasó los tres. El primer intento confirmó que iOS/Android salen como `.hbc`, no `.js`.
- Prueba de Cuenta resuelve perfil diferido dentro de `act`, evitando warnings React. Test de showcase pasa sin warnings; lint y typecheck pasan. QA instalada, visual, dynamic type y accesibilidad nativa siguen pendientes.

## Incremento M1/G3 accesibilidad — 2026-11-04

- Añadí primitives móviles reutilizables `Alert` y `Skeleton` con pruebas: cuatro tonos semánticos, anuncio polite salvo error assertive; skeleton estático y fuera del árbol de accesibilidad. No cambian tokens; consumidores en Cuenta, Inicio e Historial quedaron integrados en el siguiente slice. Móvil 70/70 al crear primitives.
- La consola admin expone la vista activa por `aria-current="page"` y vincula la tabla de auditoría al rótulo visible mediante `aria-labelledby`. Regresiones cubren ambos. Admin 10/10, lint/typecheck/build pasan.
- El E2E browser admin contra fixture API + Mongo efímero pasó login/gate, métricas, auditoría, CORS, sesión en memoria, axe A/AA, overflow móvil y semántica de vista/tabla. Una primera corrida reportó no-cero al asignar `status` (variable readonly de zsh) en cleanup; corregí el wrapper ejecutándolo con Bash y repetí E2E con exit 0. Limpié solo contenedor/servidores/temp propios; los dos contenedores antiguos permanecen intactos.
- Pendiente M1: QA nativa/visual/dynamic type; pendiente admin: comparación visual manual con Figma y hosting/CORS real. Sin commit/push.

## Integración de primitives móviles — 2026-11-04

- Integré `Alert` en errores inline de Cuenta/Inicio/Historial, y `Skeleton` en carga de perfil/cuenta, recientes e historial. Cargas mantienen texto, `progressbar`, `busy=true` y polite live region; placeholders son decorativos. Errores conservan CTA de retry y copy.
- Revalidación local previa a variantes: mobile 72/72 en 12 suites, typecheck y lint. M1 aún queda parcial: showcase y QA nativa/dynamic type/visual sin probar.
- Gotcha de test: RNTL excluye `accessibilityElementsHidden` del árbol usado por `getByTestId`; pruebas del placeholder usan `UNSAFE_getByProps`, mientras que el anuncio se prueba por rol y nombre accesible.

## Variantes de botones M1 — 2026-11-04

- `PrimaryButton` ahora implementa primary/secondary/inverted/outlined con colores existentes de theme. La referencia de Figma muestra esas cuatro formas; las rampas siguen aproximadas/no verificadas, y no añadí hex nuevos.
- Cuatro pruebas verifican fondo/borde/label; otra confirma loading/disabled y que no se dispara el callback. Mobile 77/77 en 13 suites, typecheck/lint y export Android/iOS/Web pasan.
- Restan showcase de design system y QA nativa/visual/dynamic type; export es bundle, no build instalada.

## Validación móvil adicional — 2026-11-04

- Se corrigió `frontend/mobile/src/app/__tests__/analysis-router.test.tsx`: el test de abrir un análisis reciente resolvía la respuesta de detalle fuera de `act`, generando advertencias React aunque Jest pasara. Se usa una promesa diferida resuelta dentro de `act`.
- Verificación: mobile 63/63 Jest en 10 suites, sin warnings `act`; lint y typecheck pasan. Sandbox subrecurso TLS Chromium real 1/1 y typecheck pasan. Esto no cubre builds nativas, QA visual ni entorno productivo.

## E2E móvil de cuota y verificación de logs Sandbox — 2026-11-04

- Amplié `.github/workflows/mobile-e2e.yml` para correr un escenario Maestro separado en Android/iOS: crear una segunda cuenta, completar cinco análisis sintéticos y verificar el 429 del sexto. `.maestro/enlaceseguro-quota-boundary.yaml` conserva URL `example.test`; `api/tests/e2e/assert-mobile-quota-boundary.ts` exige cinco resultados terminales, inputs cifrados y cola vacía.
- Reproduje por HTTP la cuota 5/6 con MongoDB 8 desechable, API fixture y worker sintético: cinco admisiones completadas, sexta 429; el verificador confirmó exactamente cinco URLs únicas cifradas y ningún sexto intento. No es prueba de UI nativa.
- También añadí un stream logger opcional (solo para inyección al construir Sandbox) para capturar logs en test. Regresión canary verifica que URL/query, bearer, HTML y mensaje de error crudo no salen en respuesta/log. Sandbox 47/47 pruebas, typecheck y build pasan.
- Repositorio sigue sin `simctl`, `adb` ni Maestro instalado; el workflow local no se ejecutó remoto y no se publicó. Los dos Mongo E2E antiguos siguen activos mientras se espera autorización explícita para detenerlos.

## Revalidación local de CI — 2026-11-04

- Revalidación más reciente (2026-11-04): API 75/75 unitarias/typecheck/build; Sandbox 47/47 unitarias y 10/10 Chromium loopback/typecheck/build; consola admin lint/typecheck/9 pruebas/build; móvil lint/typecheck/63 pruebas/export iOS+Android+web; suite MongoDB 8.0.34 desechable (migraciones 001–006, integraciones, 55 matriz, 22 smoke, TTL, explain y dump/restore); harness de dos procesos confirma drain SIGTERM y recuperación tras SIGKILL/lease expirado. Workflow remoto y simuladores instalados siguen sin correr.
- API unit suite omitió cuatro suites Mongo por ausencia de `MONGO_TEST_URI`; el runner Mongo aislado sí ejecutó sus integraciones. Los logs sintéticos previos mostraron `req.url` completo; ya se redacta query tras aprobación.
- Validación local no sustituye CI remota, staging, runner nativo ni red/egress cloud.

## Retiro de opción Fastify deprecada — 2026-11-04

- Reemplacé `disableRequestLogging` top-level por `new LogController({ disableRequestLogging: false })`, conservando logging de requests y eliminando el warning `FSTDEP023`; no se alteró la política de URL/query.
- Verificación al momento de ese cambio: API typecheck, 71/71 tests y build; `FSTDEP023` ausente y request logging conservado. La política de query/logs se aprobó e implementó posteriormente, documentada en G1-SEC.

## G1-SEC aprobado — límite de requests y redacción API — 2026-11-04

- El usuario aprobó un máximo de 256 requests del navegador por análisis: HTTP y WebSocket comparten presupuesto. `context.route` cuenta HTTP; `context.routeWebSocket` cuenta y bloquea WebSocket (sin validación de destino compatible). La 257 causa `inconclusive/resource_limit_exceeded`, sin veredicto ni captura.
- Contrato API/OpenAPI acepta solo razones inconclusas enumeradas; worker persiste estado terminal sin analysis/veredicto. Se actualizó el test de redirecciones a 127 iframes porque 256 iframes ya excedían el presupuesto total.
- Chromium loopback probó 256 HTTP admitidas y WebSocket en posición 257 bloqueado sin conectar al fixture, veredicto ni captura; Sandbox 10/10 browser tests en 8 suites pasa. MongoDB/API/worker/Sandbox/Chromium también pasó el exceso HTTP con análisis terminal inconcluso y sin proxy de captura.
- El usuario aprobó omitir query en logs y `ProblemDetails.instance`, y registrar 500 con allowlist + `requestId`. Implementado en serializer y `errorHandler`, con canarios sintéticos. API 75/75 tests, typecheck/build pasan; error stack/message y query no aparecen en respuesta/log.
- Las pruebas son loopback; egress, DNS rebinding, ACL cloud y hardening siguen sin validar.

## Reconciliación de Context — 2026-11-04

- Reconcilié `Context/project/overview.md`, `Context/project/requirements.md`, `Context/architecture/auth-design.md`, `Context/architecture/system.json` y el diagrama `analysis-flow.mmd` con la implementación vigente.
- Se corrigieron conteos antiguos (móvil 63 pruebas; Sandbox 9 casos Chromium), extracción local de una URL desde mensaje, TLS inconcluso ante certificado inválido de documento/subrecursos y el E2E real Chromium/Mongo/API de captura WebP por proxy.
- El endpoint de captura existe pero sigue deshabilitado hasta validar red privada; sharing desde apps externas sigue diferido. La prueba base API conserva pool determinista; los dos casos adicionales usan pool Chromium real.
- `system.json` valida contra `system.schema.json`; `git diff --check` y búsqueda de espacios finales pasan. No se tocó `Context/context.md` histórico.

## Revisión técnica de privacidad G5 — 2026-11-04

- Se creó `docs/security/technical-data-inventory.md` como inventario técnico basado en código, no aviso de privacidad ni dictamen legal. Consolida campos observados, propósitos técnicos, localización, retenciones previstas y límites de evidencia para cuenta/auth, URLs/análisis, auditoría, capturas, clientes, logs y CI.
- Retención de análisis aprobada por el propietario: ventana móvil exacta de 365 días, TTL técnico de 366 días. Los jobs pendientes suprimen expiración y el TTL es asíncrono; documentos diarios comparten el ancla de purga, por lo que intentos anteriores podrían permanecer hasta <24 h adicionales.
- Capturas baseline aprobadas a 30 días con purga diaria, pero el comando manual no está programado ni probado en staging; no declarar borrado efectivo.
- La inspección no encontró integración de proveedores de reputación, almacenamiento de URLs en SecureStore, ni SDK de analytics explícito. No se infiere ausencia de componentes externos fuera del checkout.
- Pendientes de G5: revisión especializada México, ciclo de eliminación de cuenta, proveedores/región y transferencias, gestión/rotación de claves, retención/log sinks, backups, purga programada y comprobación de despliegue.
- Tres auditorías read-only apoyaron el inventario; no se modificó código de producto. `docs/roadmap/production-readiness.md` marca G5 parcial, no completado.

## Siguiente slice G1-SEC — decisiones y gates abiertos — 2026-11-04

- Auditoría read-only identificó filtración potencial de query en `req.url`, `ProblemDetails.instance` y logs 500. Tras aprobación, request logs conservan solo method/path/hostname; errores Problem Details omiten query; 500 registra `requestId`, method, path y status. No se registran stack/message crudos. `FSTDEP023` también se eliminó con `LogController` sin cambiar request logging.
- El usuario aprobó máximo 256 solicitudes de Chromium total; request 257 activa `inconclusive/resource_limit_exceeded`, se cierra el contexto y no se persiste captura/veredicto. E2E Chromium loopback y API/Mongo worker integración pasan. Egress/ACL cloud, DNS/rebinding, límites de bytes/CPU/memoria, runtime hardened y log sinks/retención productivos siguen pendientes.

## Ciclo de vida de jobs durable — verificación local — 2026-11-04

- Se agregó `api/tests/operations/worker-shutdown-recovery.mjs`, harness opt-in con MongoDB 8.0.34 replica set sin volumen, dos procesos API construidos y Sandbox HTTP loopback sintético. Pasa drain por SIGTERM con API2 atendiendo y recuperación tras SIGKILL/expiración de lease con token de fencing nuevo. No equivale a staging/cloud ni usa Chromium real.
- El harness reveló que `$$REMOVE` dentro de un objeto `$mergeObjects` anidado no eliminaba `leaseOwner`, `leaseToken` ni `leaseExpiresAt`. Reproducción: cuatro transiciones Mongo fallaron (completed, retry queued, failed al agotar crashes, inconclusive). Corregí las expresiones para aplicar `$unsetField` sobre el job combinado y añadí aserciones de integración para esos estados.
- Verificación posterior: `database/tests/run-mongodb-suite.sh` PASS con MongoDB 8.0.34 desechable; `api/tests/operations/worker-shutdown-recovery.mjs` PASS en ambos escenarios; API typecheck y build pasan. Staging, timeout real del proveedor y Playwright/red permanecen pendientes.

## Estado comprobado en esta sesión

- Se repitió `bash database/tests/run-mongodb-suite.sh` después del cambio de presupuesto WebSocket; la suite imprimió aprobación de integraciones, migraciones, TTL, explain y restore. Integración over-budget cubre HTTP; el límite WebSocket se cubre en Chromium loopback, no en el fixture API/Mongo.
- Se repitió `node api/tests/operations/worker-shutdown-recovery.mjs`: SIGTERM drena job mientras otra réplica atiende y SIGKILL permite reclaim con token fencing nuevo; exit 0.
- Verificación de cliente local: API 75/75 unitarias (cuatro suites Mongo se omiten al no definir `MONGO_TEST_URI`, cubiertas por runner desechable); Sandbox 47/47 unitarias + 10/10 Chromium; admin 9/9 y build/lint/typecheck; móvil 63/63, lint/typecheck y export iOS/Android/Web. La exportación no es E2E nativa.
- Hallazgo operativo: existen dos contenedores `enlaceseguro-mobile-e2e-fixture-*` de 12 h, MongoDB 8.0.34, publicados solo en `127.0.0.1:59007` y `127.0.0.1:59013`, ~304 MiB RAM combinados y ~4.5% CPU. No se atribuyeron a un proceso activo de esta sesión. No los detuve ni borré; se solicitó autorización antes de limpiar.

- Repositorio: `develop`, remoto `origin` del usuario, commit base `d1248a2`; hay cambios locales de código y documentación sin commit.
- Diseño móvil: `docs/superpowers/specs/2026-11-03-enlaceseguro-mobile-client-design.md` está aprobado; plan en `docs/roadmap/mobile-implementation-plan.md`. En `frontend/mobile/` hay onboarding, auth, sesión, avisos 5.4/5.5, flujo de análisis, historial y cuenta. Inicio e Historial comparten `analysisPresentation` e iconos/badges derivados de veredicto/estado; Inicio conserva cuota compacta y las listas solo muestran fecha/hostname. No copian URLs/datos de muestra. Figma 5.1 usa email/fecha de alta reales y conteos `/analyses/summary` de ventana 365 días, TTL366; sin nombre ni cifras inventadas. Figma 5.3 conserva confirmación inferior explícita con CTA destructiva. El POST abre pantalla 3.2; resultados 3.3/3.6 reflejan estado y motivos reales, dejan `inconclusive` sin veredicto y exigen toque explícito para retry `failed`. Sin rutas/queries, señales crudas, proveedores no integrados o captura bloqueada. Validación móvil vigente: 63/63 Jest en diez suites, lint, typecheck, export iOS/Android/web pasan. Falta visual a 390×1016, safe-area/lector/foco nativos, E2E instalado remoto y builds nativas. Browser local 335×710 muestra solo onboarding; no API en 3000. Mac carece de `simctl`, Xcode, `adb` y Maestro. Repo público y runners estándar sin costo de minutos; workflow remoto no publicado/ejecutado. PNGs serían descargables públicamente; captura/retención de artifacts requieren aprobación antes de upload. Expo Doctor 21/21; `npm audit --omit=dev`: 14 LOW, cero moderate/high/critical.
- Hoja de ruta: `docs/roadmap/production-readiness.md` organiza G0–G5, gates, evidencia y carriles de agentes. `docs/architecture/free-cloud-poc-options.md` registra ofertas oficiales vigentes al 2026-11-04: OCI Always Free es candidato para POC pequeña/autogestionada (2 OCPU+12 GB, capacidad/home region por confirmar), GCP solo para POC temporal con créditos; no se seleccionó proveedor ni se provisionó nada. Atlas M0 no cubre endpoints privados ni backups confiables/locales. Evaluaciones adicionales en `docs/decisions/cloud-platform-evaluation-2026-11.md`, `database/operations/mongodb-production-validation-plan.md`, `docs/architecture/durable-analysis-processing.md` y `docs/security/production-threat-model.md`.
- API: 75 pruebas unitarias, typecheck y build pasan. Requests y `ProblemDetails.instance` omiten query; logs 500 son allowlist más requestId. Las entradas nuevas hasta 64 KiB UTF-8 se cifran con AES-256-GCM. Login rate limit, jobs durables, lease/fencing/retries/drain y cap global singleton/tx siguen activos. MongoDB 8 desechable integra API→worker→Sandbox HTTP→Chromium para TLS inválido y exceso de 256 requests; ambos terminan inconclusos sin veredicto/captura. Son fixtures loopback, no egress productivo. Staging, alertas, estrés multiproceso, secret manager, backup/PITR y red privada siguen pendientes.
- Auditoría de dependencias revalidada el 2026-11-04: API/Sandbox/admin tienen cero vulnerabilidades; móvil tiene 16 LOW en árbol completo y 14 LOW con `--omit=dev`, cero moderate/high/critical. El CI local falla desde moderate, no se forzó upgrade Expo.
- Revalidación local de superficies el 2026-11-04: API 71 tests + typecheck/build; Sandbox 47 unit tests + 7 Chromium loopback tests + typecheck/build; móvil 61 Jest + lint/typecheck/export Android/iOS/web; consola admin 9 tests + lint/typecheck/build. `git diff --check` pasa. API unit runner salta sus cuatro suites Mongo cuando no hay `MONGO_TEST_URI`; la suite desechable MongoDB separada las ejecutó y pasó. No es CI remota, E2E móvil instalado ni QA visual nativa.
- Contrato admin: métricas y auditoría interpretan fechas civiles inclusivas en `America/Mexico_City`; la búsqueda de auditoría usa rango semiabierto y la integración HTTP+Mongo cubre límites temporales. Usuario aprobó consola separada Vite + React/TypeScript, tokens solo en memoria y la especificación `docs/superpowers/specs/2026-11-03-enlaceseguro-admin-console-design.md`. En `frontend/admin-console/` se implementaron login/gate admin, refresh/logout en memoria, métricas, auditoría con fecha/tipo/cursor y estados loading/error/empty. E2E Chromium local contra API fixture + MongoDB 8 replica set valida login/gate, métricas, auditoría, CORS y descarte de sesión al recargar. Nueve pruebas + typecheck/lint/build pasan. Se corrigió `fetch` invocado con `this` de `AdminApi`; el transporte default ahora está ligado a `globalThis`, con prueba de regresión. CI agrega flujo con seed fijo condicionado a `E2E_SEED_ADMIN=true`, solo en fixture; no hay endpoint público. Axe WCAG A/AA pasa en login/resumen/auditoría desktop y móvil 390 px; overflow móvil pasa. `.caption` usa `--faint` tras hallar contraste 4.47:1; capturas móviles inspeccionadas. Comparación con Figma, auditoría manual, hosting/CORS real y CI remota siguen pendientes.
- CI local: `.github/workflows/ci.yml` ahora instala consola admin y ejecuta typecheck, lint, pruebas y build; `npm audit --audit-level=moderate` corre en API, Sandbox, móvil y consola. Auditoría local reportó cero advisories moderate+ en API/Sandbox/admin; móvil conserva 16 LOW por dependencias Expo/Jest. YAML parsea; los comandos de admin pasan localmente. GitHub Actions remoto aún no ejecutado.
- Revalidación integral de servicios 2026-11-04: API 71/71; Sandbox 47/47 y Chromium 9/9 en 7 suites seriales; móvil actualizado a 63/63; admin 9/9. `database/tests/run-mongodb-suite.sh` completó migraciones 001–006, integraciones, explain, matriz 55, smoke 22, TTL y dump/restore en MongoDB 8.0.34 desechable. E2E admin Chromium local pasó contra API fixture/Mongo: login, gate, métricas, auditoría, CORS, sesión en memoria, axe WCAG A/AA desktop/390px y overflow. Usa fakePool; no valida Sandbox real. Sin E2E móvil instalado ni GitHub Actions remoto.
- G3.2/G3.3/G3.6 móvil: detalle dedicado con polling abortable (hasta 90 s), resultados semánticos y errores neutrales; hostname-only y estados ajustados al contrato. Retry failed inicia un nuevo POST solo al tocar CTA y advierte cuota. No muestra proveedores, señales internas ni captura bloqueada.
- Validación: móvil 63/63 Jest en diez suites, lint, typecheck y export Android/iOS/web; pruebas cubren resumen de cuenta, estados semánticos compartidos, progreso, retry explícito, redacción de URL y motivos reales. Export no equivale a instalación/E2E; pantallas requieren QA visual y nativa.
- CORS API: se reprodujo que `origin:true` + `credentials:true` reflejaba `https://untrusted.example` en `/health`. La API ahora desactiva CORS por defecto; `CORS_ALLOWED_ORIGINS` admite solo orígenes exactos HTTPS (HTTP loopback fuera de producción) y nunca permite credenciales. Tests verifican origen no autorizado, permitido/preflight y configuración inválida. CORS no sustituye auth admin.
- G1-SEC: `docs/security/network-boundary-contract.md` define topología, flujos permitidos/denegados, semántica egress y aceptación cloud-neutral sin seleccionar proveedor. Es un contrato documental, no IaC ni evidencia de reglas aplicadas; health debe quedar accesible solo por red de operación. La implementación y pruebas IPv4/IPv6, DNS/rebinding y aislamiento esperan proveedor/región y POC staging.
- El flujo HTTP API de registro → login → admisión → procesamiento → resultado → historial, denegación cross-owner y captura tiene cobertura Fastify+Mongo real. El caso de captura usa Playwright Chromium real: subrecursos TLS inválidos producen `inconclusive` sin veredicto/captura; una página limpia persiste WebP y la API devuelve bytes RIFF/WEBP. Los fixtures solo permiten loopback; no valida navegador/SSRF de Internet ni red productiva. El flujo encontró otro caso de `undefined` serializado como BSON null (`screenshotRef`/`submittedInput` opcionales); se creó `omitUndefinedDeep` para persistencia de análisis/auditoría.
- Sandbox: 47/47 pruebas unitarias, 10/10 Chromium loopback en 8 suites seriales antes del cambio WebSocket; typecheck/build y prueba específica actual pasan. Cualquier `ERR_CERT_*` observado en documento/subrecurso da `inconclusive/tls_certificate_invalid`; request 257 (HTTP o WebSocket) da `inconclusive/resource_limit_exceeded`; ambos sin veredicto ni captura. El límite cuenta HTTP, documento, subrecursos, redirecciones y WebSocket; WebSocket se bloquea por seguridad. El test de evidencia de redirecciones mantiene <=255 HTTP requests. Stubs solo loopback; no prueba egress. Deadline 25 s, 504/502 retryables. Captura WebP y purge local probados; scheduler/staging pendientes. DNS/FS no son cancelables, cleanup puede extender ocupación tras timeout. WebRTC/UDP aún requieren egress cloud. Pool tiene dedup process-local, cache TTL 10 min, cola `maxConcurrency*2`, 503 Retry-After, cache máximo 5,000.
- Se validó integración API↔MongoDB y bootstrap en MongoDB 8.0.34 desechable mediante `database/tests/run-mongodb-suite.sh` (`--rm`, sin volumen, loopback); cuatro archivos de integración, incluida transición a `inconclusive` sin análisis/veredicto, migraciones 004/005/006 desde baseline strict 003 e idempotencia, 55 aserciones de matriz, 22 smoke, TTL, explain y dump/restore pasaron el 2026-11-04. El runner terminó con éxito y eliminó el contenedor con trap; no se conectó a bases persistentes. Esto no acredita backups administrados/PITR ni restore en staging.
- La suite `database/tests/run-mongodb-suite.sh` se reejecutó en esta continuación y volvió a terminar con código 0 en MongoDB 8.0.34, incluido el test de migración 006 y dump/restore. `database/README.md` ahora coincide con la evidencia: migraciones 001–006 y métricas con ventana `[ahora−365×24 h, ahora)`/retención 366 días.
- Se corrigió el uso de texto de error crudo en auditoría/logs de análisis: ahora `reasonCode` es estable y el logger solo identifica `attemptId`; hay prueba de regresión.
- Deadline global Sandbox aprobado por el propietario: 25 s por análisis (API default 30 s). Incluye preflight, espera de cola y Chromium; timeout cierra el BrowserContext y responde 504 sin veredicto. Navegación fallida responde 502. API/worker tratan ambos como retryables con backoff acotado. Prueba Chromium loopback comprueba navegación colgada, sin veredicto y cierre del contexto. DNS del SO y escritura de archivo no aceptan abort real; la petición puede expirar antes de que cleanup libere el slot.
- Repositorio del compañero: Flutter scaffold con `main.dart` de contador, no fuente de UI funcional. El Figma contiene todos los flujos elegidos; el stack local confirmado sigue React Native.
- Capturas API: `GET /analyses/{attemptId}/capture` con auth, propiedad incluso para admin y proxy privado WebP, deshabilitado por defecto (`CAPTURE_PROXY_ENABLED=false`). Errores no revelan rutas; referencia interna eliminada de DTO detalle e historial. Se validan MIME, magic bytes y límite streaming de 5 MiB. API 71/71 unitarias, typecheck/build y suite Mongo desechable pasan; la integración ejercita Chromium real con captura WebP por el proxy y prueba por separado owner/cross-owner + MIME/cabeceras. Red privada y staging siguen sin verificar; mantener apagado.
- Brechas de integración: proveedores externos no integrados; queue con cap global transaccional local, pero sin sizing productivo ni alertas y recuperación no probada en stage; aislamiento de red/contenedor, egress y DNS rebinding siguen sin certificar.
- Auditoría read-only G1/G2/G3 (2026-11-04): jobs tienen retries terminales y recuperación Mongo desechable; `AnalysisJobWorker.stop()` ya drena con deadline derivado del timeout, conserva leases y sale no-cero si vence. Unit tests cubren drain, claim en curso y timeout; falta probar el handler de SIGTERM y restart real multiproceso en staging. Chromium fixture confirma 256 solicitudes loopback pese al límite de 10 destinos guardados; presupuesto por análisis y estado de exceso siguen sin definir. Móvil requiere E2E instalado/QA nativo; workflow Maestro existe, pero no está publicado/ejecutado. No sustituir estos gates por mocks o export.
- Seguridad Chromium: se sustituyeron flags `--no-sandbox`/`--disable-setuid-sandbox` por `chromiumSandbox: true`; typecheck, 42 unitarias, 4 pruebas de navegador, build y arranque real de `PlaywrightContextPool` con Chromium pasan localmente. El host corre como usuario no-root; falta validar soporte userns/seccomp y ejecutar pool dentro del contenedor/cloud de destino.
- Contenedor Sandbox: smoke anterior aisló la causa `unshare` bloqueado por seccomp predeterminado; luego identificó `SYS_CHROOT` requerido por Chromium. Se fijó el perfil seccomp oficial Playwright 1.64.1 por hash; con `--cap-drop=ALL` + única `SYS_CHROOT`, usuario no-root, `no-new-privileges`, root read-only y red desconectada, `npm run test:container-hardening` pasa localmente (arranque Chromium, probe userns, health 200). ADR-0010 y workflow CI agregados. Aún falta ejecutar en runner Linux y verificar seccomp/AppArmor, red/ACL y egress del runtime staging/cloud; no declarar producción lista.
- Sandbox: `POST /analyze` y `GET /captures/:attemptId` ya requieren `SANDBOX_SERVICE_TOKEN` Bearer (mínimo 32 bytes, sin whitespace); `/health` sigue abierto. Se retiró CORS del Sandbox. ADR-0003 y pruebas de autorización/client están agregados. Esto no prueba TLS ni red privada.
- Sigue sin validar: aplicación 004/005 forward-only en staging, backup administrado/PITR y restore staging, integración de otros repositorios, E2E móvil instalado en simuladores y aislamiento de red. El smoke API+Mongo sintético local ya pasó. La última suite efímera pasó 55 aserciones de matriz + 22 smoke, TTL, explain P4/P5/A1/A2/A3 y cursor P4; dump/restore lógico a DB hermana conserva conteos/índices. Spill no se certifica con los contadores recolectados. Ver `database/operations/partial-bootstrap-recovery-runbook.md`.
- Evaluaciones G0 documentales: `docs/architecture/cloud-provider-evaluation.md` compara AWS/Azure/GCP sin elegir ni aprovisionar; `docs/security/reputation-source-evaluation.md` fue actualizada el 2026-11-04 al verificar Safe Browsing v5 y sus modos Real-Time/Local List/No-Storage. Ningún proveedor está aprobado; Safe Browsing sigue siendo no comercial y Web Risk requiere decisión contractual/privacidad. VirusTotal Public no es apto para producto comercial, URLhaus es suplemento limitado a malware y RDAP `.mx` no se presume disponible. No se enviaron URLs reales ni se crearon credenciales.
- Se atendió la solicitud de proponer alternativas cloud gratuitas en `docs/architecture/free-cloud-poc-options.md`: recomendación actual, seguir con stack local desechable; evaluar créditos AWS/GCP/Azure solo para POC temporal sintética, con presupuesto/consentimiento separados; Atlas M0 no satisface private networking/backup de producción. Sin cuentas ni recursos creados.
- El propietario aprobó retención baseline de capturas 30 días y barrido diario, sujeto a revisión de privacidad. `docs/architecture/capture-purge-design.md` y `sandbox/src/infrastructure/CapturePurge.ts` describen/implementan barrido local independiente, con simulación por defecto, nombres UUID y borrado solo tras confirmar ventana sin escrituras. Pruebas en directorio temporal pasan; no hay scheduler ni evidencia de operación staging/productiva.
- El usuario seleccionó GitHub Actions con simuladores Android+iOS para E2E. `ADR-0006`, `.github/workflows/mobile-e2e.yml`, scripts Mongo efímero, fixture API sintético y flujo Maestro 2.11.0 están implementados localmente. Config Expo E2E separa ID y permisos HTTP del build normal. Verificados localmente: YAML/Bash, SHA Maestro, config aislada, lint/typecheck/export y 29 pruebas móviles; el flujo real API+worker+Mongo completó análisis sintético y lo listó en historial. Aún no hay build instalado/flujo Maestro en simuladores ni corrida remota; no se hizo push. Remoto público, runners estándar sin costo de cómputo mientras conserve esa visibilidad.
- El spike de recepción externa quedó documentado en `docs/architecture/incoming-share-viability.md`: Expo SDK 57 ofrece `expo-sharing` inbound experimental, pero su mecanismo iOS abre la app principal y Expo advierte que Apple no lo soporta oficialmente. `getResolvedSharedPayloadsAsync()` puede conectar a red, contrario al objetivo de no visitar enlaces desde el dispositivo. El propietario decidió diferir compartir para release inicial y conservar pegar URL. No se instaló el módulo ni se cambiaron intents/extensiones.
- Se intentó consultar ejecuciones remotas de GitHub Actions con `gh`, pero GitHub CLI no está instalado (`command not found`); por tanto, no hay evidencia de corrida remota en esta sesión.
- `.github/workflows/ci.yml` incluye Node 22, `npm ci`, typecheck/tests/build API-Sandbox, lint/typecheck/export móvil y suite MongoDB 8.0.34 desechable por Docker. YAML revisado localmente; GitHub Actions no se ha ejecutado y la primera ejecución remota sigue pendiente.
- La suite Mongo usa `mongosh` del contenedor y copia scripts de `database/` al entorno temporal. La ejecución revalidada el 2026-11-04 terminó con exit code 0: cuatro archivos de integración API/DB, migraciones 001–006 (upgrade desde validator 003 e idempotencia), explain, 55 aserciones de matriz, 22 smoke, TTL e import/export restore de colecciones. Las pruebas de integración se ejecutan secuencialmente porque comparten la BD desechable. No se accedió a DB persistente.
- Se corrigió la contradicción de `database/README.md` que decía que la última suite integral seguía incompleta. La evidencia vigente está en `database/operations/mongodb-production-validation-plan.md`; documentación de esquema, Context y roadmap ahora reporta 55 aserciones + 22 smoke. Backups/PITR y restore en staging siguen sin verificar.
- Auditoría estática read-only original: detectó TOCTOU DNS, discrepancia PNG/WebP, fallos TLS de subrecursos y falta de límite de fanout. IPv4-mapped, formato WebP, TLS secundario, presupuesto de 256 requests, DNS rebinding sintético y fallos proxy/resolver se implementaron/probaron después; captura Chromium real también se probó por API loopback. Siguen pendientes enforcement de egress/aislamiento productivo y purge en staging. La auditoría no fue pentest ni visitó destinos externos.
- Corrección verificada después de la auditoría: la clasificación IPv4-mapped IPv6 convierte la representación hexadecimal (`::ffff:7f00:1`) a su IPv4 embebido; tests incluyen loopback, RFC1918, link-local y mapped público. `validateDestination` ahora admite resolver inyectable para fixtures; tests cubren DNS público A+AAAA, respuesta mixta con dirección privada (rechazo) y fallo DNS fail-closed. El handler Sandbox ya redacta errores HTTP. Sin consultas públicas ni prueba de Chromium/egress; la prueba de redacción valida respuesta, no log sink.
- Nuevo E2E local de seguridad Sandbox: Chromium real pide imagen e iframe desde fixture loopback permitido hacia otro puerto privado; el guard aborta, el resultado señala SSRF y el destino recibe cero requests. Suite serializada por contención de Chromium/deadline 1 s. El usuario aprobó y ya se implementó `inconclusive` sin captura/veredicto ante TLS inválido de subrecurso; prueba de imagen autofirmada loopback confirma. No valida egress, DNS rebinding ni aislamiento cloud.
- Se reconciliaron estos hallazgos y pruebas locales seguras propuestas en `docs/security/production-threat-model.md`; se ajustó `infra/README.md` para no afirmar aislamiento/formato demostrado y `docs/roadmap/production-readiness.md` para mantener G1-SEC/G2 abiertos. No se cambió comportamiento ni se declaró producción lista.

## Próximo paso

- Siguiente slice móvil: habilitar QA visual autenticado con simuladores vía `.github/workflows/mobile-e2e.yml`; falta publicar cambios locales/workflow, aún sin autorización específica. Antes de correr, preparar screenshots artefacto para Inicio/Historial/Cuenta/Resultado con fixtures sintéticos. Costo standard runner: $0 en repo público, según docs oficiales enlazadas en roadmap; revisar retención/visibilidad de artefactos antes de subirlos.
- La UI web local disponible da solo onboarding a 335×710 y no autentica; no usar como evidencia de Home/Cuenta. No se puede probar safe-area/VoiceOver/TalkBack sin simulador/dispositivo nativo.
- Continuar pruebas accesibles/revisión de contenido mientras el E2E nativo queda pendiente; no confundir export local con build instalada. Ampliar escenarios 429/offline/cursor y QA visual Figma después.
- Resolver G0 antes de provisionar: proveedor/región, Mongo administrado, carga, disponibilidad, RTO/RPO y presupuesto; no elegir proveedor ni incurrir en gasto por inferencia.
- Probar backups administrados/PITR + restore en staging; verificar migraciones forward-only sin DB persistentes, restore y operación multi-réplica.
- Mantener captura móvil apagada hasta probar aislamiento de red Sandbox y purga en staging. El proxy API autenticado ya devuelve WebP real en integración loopback; jobs, cap global y rate limit locales no sustituyen telemetría, sizing, secrets manager ni trusted proxy real.
- Integrar consola admin con API/hosting real, revisar CSP y completar accesibilidad/QA visual. Cerrar G1 de red/egress, Sandbox hardened y scheduler de purga antes de declarar producción lista. Límite de requests y redacción básica API ya están aprobados/implementados; faltan pruebas de red real, sinks/retención y operación.

---

## Estado histórico al 2026-10-26

El resto de este archivo conserva el resumen al cierre de esa fecha. Sus afirmaciones de pruebas, stack de la propuesta y próximos pasos se deben leer como históricas salvo que se confirmen arriba o en las fuentes actuales.

## Confirmado en el workspace

- Elaborado el documento integral de entrega académica en `deliverables/academic/entrega-actividad-bdaas.md`, estructurado conforme a los 7 puntos solicitados:
  1. Caso de uso seleccionado: P3/P7 (admisión atómica y control de cuota diaria en `daily_analyses`).
  2. Diagramas Mermaid: arquitectura hexagonal y flujo de datos/secuencia.
  3. Árbol de carpetas real y justificación modular bajo principios SOLID/Clean Architecture.
  4. Contratos formales: API (OpenAPI 3.1.0) y Base de Datos (validador estricto `$jsonSchema` e índices).
  5. Código implementado del caso de uso: entidad de dominio, puerto, caso de uso y adaptador MongoDB con `findOneAndUpdate` atómico.
  6. Matriz de pruebas categorizada por análisis de riesgos técnicos (condición de carrera, cuota, Anti-SSRF, inyección, consistencia).
  7. Resultados reproducibles: evidencia de 34 pruebas unitarias pasando (13 en API, 21 en Sandbox) e instrucciones de ejecución deterministas.
  8. Registro de decisiones técnicas formalizado en `Context/decisions/ADR-0002-atomic-quota-and-embedded-daily-analysis.md` evaluado bajo marco COVE (Chain of Verification / comparativa adversarial).
- El servicio de Sandbox está implementado en `sandbox/` como microservicio aislado:
  - `core/AntiSsrfGuard`: validación estricta de esquemas (`http:`, `https:` exclusivamente), resolución DNS obligatoria y bloqueo determinista de IPv4 privadas (RFC 1918), loopback (`127.0.0.0/8`), metadatos de nube (`169.254.169.254`), carrier-grade NAT (`100.64.0.0/10`) e IPv6 reservadas/locales (`::1`, `fc00::/7`, `fe80::/10`).
  - `core/VerdictEvaluator`: categorización en `peligroso`, `sospechoso` y `sin_amenazas_detectadas` (con aclaración explícita de no garantía absoluta), y justificaciones en lenguaje natural.
  - `infrastructure/PlaywrightContextPool`: pool de contextos Playwright efímeros con límite de concurrencia configurable, intercepción de red (`context.route`) contra saltos SSRF en tiempo de ejecución y revocación de permisos (`permissions: []`). El BrowserContext configura bloqueo SW/no aceptar descargas; dos pruebas reales aisladas en Chromium loopback validan esas opciones pero no el pool productivo; el handler de cancelación sigue siendo asíncrono.
  - `infrastructure/ScreenshotStorage`: persistencia local de capturas con identificador opaco; hoy guarda bytes PNG bajo extensión `.webp`, una discrepancia pendiente de resolver antes de servirlas.
  - `presentation/sandboxServer`: API HTTP Fastify exponiendo `GET /health`, `POST /analyze` y `GET /captures/:attemptId`.
  - 21 pruebas unitarias pasando en `sandbox/tests/` (cobertura total de rangos IP, esquemas y veredictos).
- El backend en `api/` se conectó al Sandbox mediante `HttpSandboxService` y `ProcessAnalysisJobUseCase`:
  - Recepción de solicitud `POST /analyses` admite atómicamente en cuota (`received`).
  - Despacho asíncrono hacia el sandbox para transicionar `received` → `processing` → `completed` (o `failed`).
  - Almacenamiento del subdocumento `analysis` con veredicto, razones, señales, redirecciones y referencia de captura.
  - Eventos de auditoría emitidos: `analysis.accepted`, `analysis.completed`, `analysis.failed`.
  - Endpoint `GET /health` ahora supervisa tanto la conectividad con MongoDB como la salud del servicio sandbox.
  - 13 pruebas unitarias pasando en `api/tests/`.
- Compilación de TypeScript (`npm run build` y `npm run typecheck`) sin errores en `api/` y `sandbox/`.
- `Context/context.md` y la propuesta PDF se conservaron como fuentes.
- El CSV de patrones se trasladó sin cambio de contenido a `database/modeling/access-patterns.csv`.
- El repositorio GitHub indicado es público y estaba vacío al conectar el remoto; `origin` apunta a `https://github.com/ArturoYJ/Enlace-Seguro.git`.
- Los anexos fuente con datos académicos se conservan localmente y están excluidos mediante `.gitignore`; el registro público de fuentes no expone sus nombres de archivo.
- El scaffold documental aprobado se publicó en `origin/main` en el commit `cf4b2cc`; se incluyeron 37 archivos de documentación no sensible.
- El usuario confirmó MongoDB como motor de la práctica BDaaS; se mantiene independiente la propuesta original PostgreSQL.
- El usuario confirmó el stack tecnológico de aplicación: backend Node.js 22 + TypeScript + Fastify, frontend móvil React Native, y 1 servicio sandbox unificado con pool configurable de contextos Playwright/Chromium. `Context/architecture/system.json` actualizado con nodos en estado `confirmed`.
- El usuario aprobó las decisiones de autenticación: bcrypt costo 12 para contraseñas, Access Token JWT stateless de 15 minutos (HS256), y Refresh Token rotativo de 256 bits con validez de 7 días, persistido en MongoDB como hash SHA-256 con tracking de familias (`familyId`) para detección y neutralización de reúso. Documentado en `Context/architecture/auth-design.md`.
- Se definió el contrato formal de la API en `api/openapi.yaml` bajo OpenAPI 3.1.0: 10 endpoints cubriendo `/health`, autenticación (`/auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/me`), análisis (`/analyses`, `/analyses/{attemptId}`), y administración (`/admin/audit-events`, `/admin/metrics`). Manejo de errores estandarizado bajo RFC 9457 (Problem Details).
- Se incorporó la colección `refresh_tokens` al validador `$jsonSchema` (`database/schema/collection-validators.js`), al script de bootstrap (`database/migrations/001_create_mongodb_schema.js`) con índices único en hash, búsqueda por usuario/familia y TTL en `expiresAt`, y a la matriz `database/schema/validation-cases.md`.
- El modelo lógico revisado propone cuentas, caché de reputación, auditoría y un documento diario por usuario con hasta cinco solicitudes consumidoras; cada intento/solicitud y su resultado de análisis se embeben en ese mismo documento para admitir cuota y crear el registro inicial en una escritura atómica.
- Consumo diario derivado del tamaño de `attempts`; no se persiste un contador duplicado (confirmado por el usuario).
- Cuota confirmada: cinco solicitudes recibidas por usuario por día calendario en `America/Mexico_City`; las solicitudes posteriores se rechazan desde backend.
- Los rechazos por cuota agotada no se almacenan en el registro (confirmado por el usuario).
- RBAC confirmado: `admin` único y `usuario`; panel de métricas integrado al frontend oficial, con acceso a datos únicamente a través del backend.
- Filtros de eventos del panel admin confirmados: intervalo de fechas y tipo de evento solamente; no se requiere filtrar por actor ni resultado.
- P4 usa historial aplanado desde documentos diarios; el índice candidato `{ userId, localDate }` localiza documentos padres, pero no garantiza el orden de intentos después de `$unwind`. Se recomienda evaluar cursor/keyset compuesto contra `$skip` con datos y `explain` antes de afirmar costo/rendimiento.
- El usuario confirmó que `attemptId` será único globalmente y que la ruta de detalle podrá conocer `localDate`; P5 propio usa como candidato el índice diario único `{ userId, localDate }`. Se recomienda además índice único multikey global por integridad (y lookup por ID si admin lo requiere), más guardia anti-duplicado intradocumento.
- Índices de auditoría candidatos separados: fecha+`_id` para rango sin tipo, y tipo+fecha+`_id` cuando hay filtro de tipo; no se agregan filtros/índices por actor ni resultado.
- El usuario aprobó el catálogo `database/modeling/query-catalog.md`; la aprobación no convierte índices candidatos en índices finales ni confirma rendimiento.
- El usuario aprobó estos estados de procesamiento para solicitudes de análisis: `received`, `validation_failed`, `processing`, `completed`, `inconclusive`, `failed`. Las transiciones y ausencia de un historial separado fueron aprobadas y constan en `schema-proposal.md`.
- El bootstrap crea colecciones, validadores estrictos, índices únicos/consulta y TTL. Es de una sola aplicación, falla si las colecciones ya existen y no elimina ni modifica datos existentes.
- `schemaVersion: 1`, `purgeAt`, allowlists cerradas, límite de 5 intentos y catálogos de estados/eventos son parte de los validadores; RBAC, transiciones, pertenencia y deduplicación intradocumento siguen siendo responsabilidad del backend.

## Continuación — entrada de análisis y navegación Figma (2026-11-04)

- La pantalla Inicio ahora acepta URL o texto copiado de hasta 480 caracteres. `frontend/mobile/src/lib/analysisInput.ts` extrae localmente exactamente una URL HTTP(S); el POST contiene solo esa URL. Si no encuentra una, encuentra varias, URL inválida/con credenciales, o excede el límite, no envía el análisis. El mensaje original no sale de memoria del componente; al admitir se limpia el campo. Pruebas cubren casos y no-POST.
- Navegación fija alineada con Figma: Inicio / Analizar / Historial. Analizar reutiliza el formulario y lo enfoca; Cuenta queda en avatar del encabezado. Se usa identidad genérica porque `/auth/me` no da nombre.
- Verificación anterior de entrada/clipboard: `npm run test:ci` 44/44 en 7 suites, `npm run lint`, `npm run typecheck` y export Android/iOS/web pasaron; la validación vigente de contraste suma seis pruebas y se detalla abajo. Son pruebas UI con respuestas controladas + export; no son ejecución nativa ni E2E con backend. `.maestro/enlaceseguro-happy-path.yaml` usa el nuevo label y mensaje con una URL; el workflow verificará ciphertext descifrado en BD efímera contra URL esperada, digest y tamaño, nunca plaintext. El verificador se probó localmente con API fixture + Mongo replica set desechable y confirmó PASS; el Maestro aún no se corrió en simulador local/remoto.
- Pendiente: comparar UI completa contra Figma en dispositivos, QA de accesibilidad móvil, instalar/E2E iOS+Android en CI, validar mensajería con API integrada y resolver persistencia/uso seguro del portapapeles en plataformas reales. No commit/push.


## Continuación — contraste WCAG móvil (2026-11-04)

- Una auditoría calculó contraste real de `textMuted #65758E` en 2.95:1–3.97:1 y el blanco sobre CTA azul en 3.98:1; ambos incumplían WCAG AA para texto normal. Se conservaron `primary #2F7BF5` y tonos semánticos, pero se crearon variantes derivadas: `primaryText #8BB6FF`, `textMuted #94A2B8`, `primaryAction #2A6FD8`. Links/kickers/acciones usan `primaryText`; el CTA usa `primaryAction`, su pressed `#2467D4`.
- Contraste estático calculado: texto muted min 5.34:1 en surfaceRaised; texto primary min 6.73:1; CTA blanco 4.81:1 (pressed 5.30:1); colores de veredicto también superan 4.5:1 en los cuatro fondos. Agregados 4 tests de tema en `frontend/mobile/src/theme/__tests__/tokens.test.ts` y 2 tests de `NoticeDialog` para el uso del color accesible en los tonos info/warning.
- Validación móvil actual: 51/51 tests en 9 suites, lint, typecheck y export web/iOS/Android pasan. `git diff --check` pasa. Variantes son derivadas, no Figma-exactas; falta QA visual/nativa, dynamic type y accesibilidad real de lector/foco. Ver `Context/decisions/ADR-0009-mobile-accessible-contrast-tokens.md`.


## Continuación — límite de entrada móvil sin truncamiento (2026-11-04)

- Root cause del pegado manual >480: `TextInput maxLength={480}` junto con `value.slice(0,480)` oculta el exceso; `submit()` ve el prefijo y podría aceptarlo, contrario al spec. La acción Pegar personalizada ya rechazaba tamaño antes de cargar.
- Quité el límite nativo que escondía exceso; `onChangeText` rechaza entrada >480, limpia campo y muestra error. El botón Pegar también limpia contenido previo si el clipboard es demasiado largo. Así no se persiste texto grande ni se puede procesar una URL previa tras un error.
- Regresión reproducida antes del fix: test Router falló por error de límite ausente. Después: móvil 51/51 tests en 9 suites, lint, typecheck y export iOS/Android/web pasan. `git diff --check` pasa. No native simulator; no commit/push.
- Plan actualizado: captura API ya existe, pero `CAPTURE_PROXY_ENABLED=false` y red API↔Sandbox aún no se verifica; móvil mantiene capturas ocultas hasta el gate de red privada.


## Revalidación local de CI extendida — 2026-11-04

- Corrí los equivalentes locales de audit moderate, API, Sandbox unit + Chromium + cinco regresiones egress, build y smoke container endurecido, móvil (94/94 + lint/typecheck/export), admin (10/10 + lint/typecheck/build), MongoDB 8 suite completa y E2E admin con Chromium. Todo pasó.
- La suite de browser Sandbox reporta 11 pass + 3 skip explícitos de tests de integración opcionales; egress fue ejecutado por separado y pasó.
- MacOS no trae GNU `timeout`; la primera secuencia paró al llegar a egress. La reanudé con Perl alarm como bound y concluyó en PASS. No ejecuté `npm ci`, GitHub Actions remoto ni E2E móvil instalado.
- Se conservaron intactos los contenedores preexistentes; el Mongo temporal creado por esta suite se detuvo por su nombre único.


## Revalidación CI desde lockfiles — 2026-11-04

- Ejecuté `npm ci` en API, Sandbox, mobile y admin-console con Node 22.23.1. Los cuatro terminaron correctamente; `npm audit --audit-level=moderate` pasa en todos. El árbol móvil reporta 16 vulnerabilidades LOW, sin moderate+; conservar sin `npm audit fix` automático por posibles cambios fuera de alcance.
- Ambos `npx playwright install --with-deps chromium` terminaron con código 0. Luego se repitió la secuencia local completa: API 77, Sandbox 55 + Chromium (11 pass/3 skip) + egress y smoke hardened, mobile 94 + lint/typecheck/export, admin 10 + build/E2E, MongoDB suite con TTL/restore. Todo pasó.
- No hubo GitHub Actions remoto ni Maestro móvil instalado; `npm ci` y suite equivalente no certifican runner Linux o staging.


## Revalidación de toolchains móviles — 2026-11-04

- xcodebuild está presente como stub de Command Line Tools, pero falla indicando Xcode requerido; `xcrun --find simctl` falla. ANDROID_HOME/ANDROID_SDK_ROOT no están configurados; adb y Maestro no están instalados.
- E2E iOS/Android local no disponible; el camino definido permanece GitHub Actions. Requiere que los workflows/branch se publiquen para ejecutarse remotamente; aún no se ha autorizado push.


## G3-APP — QA accesible de exportación web — 2026-11-04

- Playwright + axe-core reprodujeron dos defectos en onboarding web: el indicador de pasos tenía `aria-label` en un `div` sin rol y el documento exportado no declaraba título/idioma español. El indicador ahora es un `progressbar` accesible con valores mínimo/máximo/actual. Expo Head fija título/description; `web.lang` declara español en manifest; el arranque web pone `lang=es-MX` y el verificador release localiza las páginas estáticas a `es-MX`.
- Se agregó regresión de progressbar y verificación HTML al export. `npm run test:ci`: 94/94; lint/typecheck/export pasan. axe WCAG 2 A/AA/2.1 AA pasa en los tres slides de bienvenida y acceso/registro con viewport 390×844 y 320×844; scroll width coincide con viewport y no hubo errores JS.
- Alcance exclusivamente web/export: no acredita VoiceOver/TalkBack, lectores nativos, dynamic type, Figma parity ni builds/E2E instalados iOS/Android. Los workflows GitHub siguen locales.


## G3-ADMIN — corrida y revisión visual E2E local — 2026-11-04

- Ejecuté el E2E de consola con API fixture + MongoDB 8 replica set desechable, `E2E_SEED_ADMIN=true` y CORS limitado a `http://127.0.0.1:4173`; PASS completo. Se guardaron seis capturas sintéticas bajo `/tmp/es-admin-qa-screenshots` (desktop/móvil de login, resumen y auditoría) y se revisaron visualmente resumen escritorio/móvil y auditoría móvil.
- No vi desborde horizontal ni defectos visuales evidentes en esas capturas. No hay referencia Figma cotejada; esto no cierra paridad visual, teclado/lector, hosting/CORS real ni CI remota. Solo se detuvo el contenedor Mongo temporal creado por la prueba; el fixture preexistente se dejó intacto.

## G3-APP — alineación de errores al contrato API — 2026-11-04

- `api/openapi.yaml` y `errorHandler` devuelven 400 para validación; ningún contrato o handler define 422. Móvil clasificaba ambos como validación y un test llamaba erróneamente a 422 «documentado».
- Quité la interpretación de 422 en auth y admisión de análisis. Una prueba confirma que el 422 no documentado recibe mensaje genérico, sin exponer detalle del servidor.
- Verificación: prueba auth 10/10; `npm run test:ci` 94/94; typecheck y lint pasan. No hubo cambio de OpenAPI ni del API.

## G3-APP — validación posterior al ajuste de contrato — 2026-11-04

- Tras eliminar el mapeo móvil de 422 no contratado, ejecuté `npm run test:ci` (94/94), typecheck, lint y `npm run export`.
- Export actual generó bundles iOS/Android/Web y 10 rutas estáticas; verificador pasó para las tres plataformas, verificó `es-MX` en 10 páginas y título accesible. Esto confirma bundle/export, no build instalada ni E2E nativo.
- Alineé `docs/roadmap/mobile-implementation-plan.md` para exigir 400 y fallback genérico para statuses no documentados.

## G3-APP — auditoría read-only posterior a la corrección — 2026-11-04

- Revisión independiente de navegación, historial/paginación, detalle, análisis fallido/inconcluso, sesión y accesibilidad: no encontró otra discrepancia concreta que justifique un cambio local. Campos de detalle nullable (`submittedInput`, `analysis`) y retry condicional al input están cubiertos por la UI.
- Siguiente evidencia G3 es instalada: E2E Maestro Android/iOS y QA visual/accesible en simulador/dispositivo. No se sustituye por más pruebas de componentes ni export.

## G2/G3 — prueba API integrada de validación de registro — 2026-11-04

- Añadí a `api/tests/integration/AnalysisFlowHttp.integration.test.ts` una llamada real Fastify + Mongo con email inválido. Afirma HTTP 400, `application/problem+json`, status 400 y tipo `validation-failed`, validando el contrato que usa el cliente móvil.
- `bash database/tests/run-mongodb-suite.sh` pasó completo en MongoDB 8.0.34 desechable: integración API↔Sandbox, migraciones, matriz, smoke, TTL y restore lógico. El runner limpió solo su contenedor efímero. `git diff --check` pasa.

## Preflight del workflow E2E móvil — 2026-11-04

- Revisión read-only de `.github/workflows/mobile-e2e.yml`, flujos Maestro, fixture API/Mongo y aserciones no halló fallo determinista local. Variables sintéticas, outcomes y helpers coinciden; Android usa `10.0.2.2`/bind `0.0.0.0` e iOS loopback.
- Fuente oficial runner-images confirma `macos-26-intel` y Xcode 26.6 para el selector fijado. Esto valida configuración, no ejecución: runtime/emulador/selector Maestro requieren primer run remoto.
- Sin cambios de producto. Siguiente avance del gate es publicar el trabajo en una rama autorizada y ejecutar workflows; no hay autorización de push todavía.

## Continuación — secuencia de pendientes G0–G5 — 2026-11-04

- Reemplacé la sección obsoleta de «Ola actual» en `docs/roadmap/production-readiness.md`, que aún decía que migraciones estaban pendientes, móvil tenía 18 tests y captura carecía de endpoint.
- La nueva secuencia mantiene solo el plan original: cerrar decisiones G0; validar G1/G2 en entorno real; completar QA G3; después staging G4 y privacidad/publicación G5. OCI queda explícitamente fuera de esos entregables.
- No cambié código de producto. El tablero marca con claridad los bloqueos externos: aprobación de objetivos operativos, publicación autorizada para CI remota y entorno cloud/staging.
- `git diff --check` no reporta whitespace en archivos rastreados; la hoja de ruta está sin seguimiento junto con el conjunto de documentación local, por eso la validación directa de cambios nuevos sigue pendiente con el futuro stage/commit curado.
- También reconcilié en este archivo el bloque inicial obsoleto que pedía bootstrap, purga y scaffold móvil, y corregí referencias viejas a HTTP 422. `docs/roadmap/production-readiness.md` sigue siendo tablero canónico para pendientes.

## Verificación de remoto para habilitar E2E — 2026-11-04

- `origin` apunta a `https://github.com/ArturoYJ/Enlace-Seguro.git`; la consulta read-only confirma que `develop` sigue en `d1248a27` y `main` en `a7b4131`. Los workflows/fixtures locales todavía no existen en una rama remota ejecutable.
- Por tanto, el E2E nativo GitHub Actions no puede arrancarse aún. No publiqué ni comprometí cambios; el siguiente gate requiere autorización explícita para preparar y publicar una rama curada, excluyendo POC OCI.

## G0 — baseline aprobado y nube candidata — 2026-11-04

- El usuario aprobó el baseline como hipótesis de diseño: 50 cuentas, 250 análisis/día, 10 simultáneos, cola 20/5 min, SLO API 99%, RPO 24 h/RTO 8 h. Indicó gasto flexible sin tope numérico y residencia «solo México».
- Registré ADR-0011 en Context. Interpretación: datos/procesamiento de EnlaceSeguro en México; backups/logs también deben verificarse, y la ubicación del control-plane/soporte sigue sujeta a contrato. No es promesa de servicio ni autorización de gasto.
- La evaluación oficial actual confirma Fargate ECS y Atlas en `mx-central-1`, Azure Container Apps + Atlas en `mexicocentral`, y Cloud Run + Atlas en `northamerica-south1`. AWS queda candidato de diseño recomendado, no seleccionado.
- No hay TCO defendible sin medir sizing Chromium/bytes de egreso y fijar tier/backup Atlas; Atlas Cloud Backups son M10+ y la distribución multi-región puede mover copias fuera de México. Sin cuentas, POC, gasto ni provisioning.
- G0 sigue parcial: modelar costo piloto/pico, validar disponibilidad/quotas/private endpoints/egress y proponer ADR final.
