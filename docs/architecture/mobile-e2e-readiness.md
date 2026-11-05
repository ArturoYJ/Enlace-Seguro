# Preparación E2E móvil contra API

**Estado:** estrategia aprobada; workflow, flujo E2E base y flujo de cuota implementados localmente. No hay ejecución instalada comprobada en simuladores ni corrida remota de Actions.

## Evidencia actual

- `frontend/mobile` tiene Jest, React Native Testing Library y Expo Router tests. Sus respuestas `fetch` y SecureStore son controladas; las 63 pruebas unitarias/de UI no prueban una app instalada contra backend real.
- `api/tests/integration/AnalysisFlowHttp.integration.test.ts` cubre Fastify + MongoDB + HTTP API→Sandbox con navegador sintético/determinista. Prueba backend, no el bundle Expo ni navegación móvil nativa.
- `expo export` compila bundles iOS/Android/web y produce rutas estáticas; no instala ni ejecuta una app en un dispositivo/emulador.
- Entorno local revisado: Node 22; Xcode completo/simulador iOS, `adb`, Android SDK/AVD, Maestro y Detox no están disponibles. El runner local no tiene simuladores; `.github/workflows/mobile-e2e.yml` ya define Android/iOS instalados, pero falta ejecutarlo remotamente.

## Flujo E2E requerido por el plan

Usar cuentas/datos sintéticos aislados por ejecución y un destino Sandbox determinista, sin navegación a sitios públicos reales:

1. Registrar cuenta usuario e iniciar sesión desde la app instalada.
2. Enviar URL sintética permitida y esperar polling hasta estado terminal.
3. Consultar resultado y encontrar el intento en historial/detalle.
4. Cerrar sesión; validar que la app local deja de presentar contenido autenticado.
5. Validar offline/429/reintento como escenarios separados, sin producir un resultado simulado de reputación.

El flujo base está en `.maestro/enlaceseguro-happy-path.yaml`. Añadí `.maestro/enlaceseguro-quota-boundary.yaml`: en la app instalada crea otra cuenta, completa cinco análisis sintéticos y verifica que el sexto sea rechazado por la cuota diaria. `api/tests/e2e/assert-mobile-quota-boundary.ts` comprueba en la DB que existan exactamente cinco intentos completados, URLs cifradas únicas y cero jobs pendientes. El fixture en `api/tests/e2e/server.ts` usa Mongo real en replica set y worker durable, pero un Sandbox sintético que no navega la URL. El script de base desechable crea una DB distinta por job y el workflow limpia el contenedor; los dos flujos usan cuentas sintéticas separadas. Verifiqué localmente el límite por HTTP en el fixture Mongo: cinco admisiones completadas, la sexta devuelve 429 y el verificador confirma que no se persiste. Esto no valida Maestro ni app instalada. No hay artifacts ni secretos productivos. Capturas permanecen fuera del flujo hasta endpoint API autenticado, aislamiento privado y purga.

## Estrategia seleccionada y revisión de costo

El usuario aprobó GitHub Actions con simuladores Android+iOS y pidió revisar costo antes de habilitar.

- Propuesta técnica para una primera iteración: job Android en `ubuntu-24.04` y job iOS en `macos-26-intel`, separados. **Corrección de compatibilidad:** la app usa Expo SDK 57 / React Native 0.86 y su matriz requiere Xcode 26.4 o superior; `macos-15` ya no es opción válida para este proyecto, aunque lo sugerí inicialmente antes de contrastar la versión real del SDK. GitHub lista `macos-26-intel` como runner estándar Intel; se fija Xcode 26.6 explícitamente. Docker es necesario para la fixture Mongo: `docker/setup-docker-action` está fijada a commit SHA y `docker info` falla el job temprano si el daemon no está operativo. No asumir disponibilidad hasta completar una corrida remota.
- El remoto del proyecto se verificó como **público** al 2026-11-04; los runners estándar alojados de GitHub son gratuitos e ilimitados en repos públicos. Por tanto, el costo de cómputo estimado para la estrategia seleccionada es **US$0** mientras el repo permanezca público y se usen runners estándar; la gratuidad no elimina costo de mantenimiento, cuota/retención de artifacts u otros productos facturables.
- Si el repo pasa a privado, aplican las tarifas estándar publicadas: Linux 2-core US$0.006/minuto y macOS US$0.062/minuto; los minutos por job se redondean. GitHub Free incluye uso computacional mensual de US$12, compartido con otros consumos elegibles, no una bolsa fija de minutos.
- Estimación privada hipotética —no medida—: Android 15 min + iOS 20 min serían US$1.33 por ciclo (US$0.09 + US$1.24); cuatro ciclos/mes serían US$5.32 antes del saldo incluido y sin otros consumos. La ejecución en paralelo reduce el tiempo de pared, no el costo agregado. Medir una corrida real antes de fijar presupuesto.
- Controles propuestos antes de habilitar: no usar secretos productivos ni URLs reales en workflows/artifacts, `timeout-minutes`, `concurrency` para cancelar duplicados, retención corta de artifacts y ejecutar E2E en merge/nightly, no en cada reintento repetido de CI. Si el repo se privatiza, revisar plan/uso/budget hard-stop y alertas antes de correr.

Implementación local actual: `.github/workflows/mobile-e2e.yml` (PR + `workflow_dispatch`; Android API 36 en `ubuntu-24.04`; iOS Simulator en `macos-26-intel`, Xcode 26.6), scripts efímeros Mongo en `database/tests/start-mobile-e2e-mongo.sh` y `stop-mobile-e2e-mongo.sh`, fixture API sintético y flujo Maestro 2.11.0 con SHA-256 verificado. Ambos jobs corren el happy path y el límite de cuota, cada cual con su usuario aislado. `frontend/mobile/app.config.ts` separa la identidad E2E (`com.enlaceseguro.e2e`), permite HTTP solo en build E2E (iOS loopback; Android cleartext) y deja la configuración normal sin esas excepciones. El workflow no usa artifacts ni secrets; sus permisos son `contents: read`. Los directorios nativos los genera Expo CNG.

Validado localmente: configuración Expo E2E/prod aislada, lint, typecheck, 63 pruebas móviles, export, guardas del fixture, flujo API+Mongo desechable de happy path y cuota 5/6. El nuevo flujo Maestro, builds instalados y simuladores no se ejecutaron localmente porque faltan `simctl`, Xcode completo, `adb`, Android SDK y Maestro. La definición de workflow aún no se ha ejecutado remotamente; por tanto, Docker en macOS Intel y el runtime completo del simulador siguen sin verificación remota. El remoto se comprobó público; mientras se mantenga público y use runners estándar, el cómputo de Actions sigue gratuito. No se hizo push. El export de Expo y las pruebas HTTP no equivalen a E2E móvil. EAS u otros servicios administrados siguen fuera del alcance.

## Salida antes de declarar el gate satisfecho

- ADR de runner/framework (`Context/decisions/ADR-0006-mobile-native-e2e-strategy.md`), matriz de plataformas, variables/secretos y entorno sintético.
- Ejecución reproducible Android + iOS instalada, con evidencia de registro→análisis→resultado→historial→logout.
- Pruebas separadas de reanudación de sesión, conectividad/cuota y fallos; limpieza de datos tras cada run.
- QA visual/accesibilidad en dispositivos reales o simuladores representativos, no inferida del export web.

**Fuentes oficiales de runner/plataforma** (revisadas 2026-11-04): [GitHub-hosted runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners), [tarifas de runner](https://docs.github.com/en/billing/reference/actions-runner-pricing), [uso incluido por plan](https://docs.github.com/en/billing/reference/product-usage-included), [billing de Actions](https://docs.github.com/en/actions/concepts/billing-and-usage), [presupuestos y límites](https://docs.github.com/en/billing/how-tos/set-up-budgets), [Expo SDK 57](https://docs.expo.dev/versions/v57.0.0/), [imagen `macos-26-intel`](https://github.com/actions/runner-images/blob/main/images/macos/macos-26-Readme.md), [Docker Setup Action](https://github.com/docker/setup-docker-action).

**Conclusión:** estrategia y costo inicial revisados; framework, fixture y workflow ya existen en el checkout. En la visibilidad pública actual el cómputo con runners estándar no genera cargos. Siguen pendientes una corrida remota, builds instalados en ambos simuladores, revisión de estabilidad/tiempos y QA visual/accesibilidad. Ninguna prueba local se etiqueta como E2E móvil completado.
