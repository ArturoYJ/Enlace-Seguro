# ADR-0006: E2E móvil instalado con Maestro y GitHub Actions

- **Estado:** aceptada e implementada localmente; pendiente de build/ejecución en simuladores y de corrida remota.
- **Fecha:** 2026-11-03
- **Contexto:** el cliente Expo SDK 57/React Native 0.86 solo tiene tests Jest/RNTL con API simulada y export de bundles. El equipo local carece de Xcode/simulador iOS y Android SDK/AVD. El usuario eligió GitHub Actions con simuladores iOS y Android, sujeto a revisar costo antes de habilitar. El remoto se verificó público.
- **Decisores:** coordinador técnico, en el marco del plan G0–G5 aprobado y la selección explícita de runner hecha por el usuario.

## Decisión

1. Usar **Maestro CLI** como primera herramienta de E2E nativo; pilotar UI desde accesibilidad sin añadir dependencias de instrumentación a la app. El mismo flujo de producto debe cubrir ambas plataformas.
2. Ejecutar jobs alojados separados: Android en `ubuntu-24.04`; iOS en `macos-26`. La elección inicial anterior `macos-15` se descarta: el SDK actual requiere Xcode 26.4+ y `macos-15` no satisface ese baseline. Verificar Xcode/runtime en cada corrida y fijar los valores de uso efectivos en logs.
3. Construir e instalar la app para simulador con Continuous Native Generation de Expo; no versionar a mano los directorios `ios/` o `android/`. Usar identificadores de bundle/package exclusivos del variante E2E para evitar promover el placeholder actual del app.json como identidad release.
4. Probar con API Fastify accesible por HTTP desde el simulador, MongoDB 8 desechable en replica set y worker real; el Sandbox responderá con un adaptador determinista sintético que jamás abre conexiones a la URL enviada. Crear base de datos única para cada job e inspeccionada con allowlist `enlaceseguro_test_e2e_*`; destruirla al terminar.
5. El primer flujo validará registro → login → admisión de URL sintética → resultado terminal → historial/detalle → cierre de sesión. No usar proveedores externos, redes públicas, credenciales reales ni capturas.
6. Sin secretos de producción, tokens de servicios cloud ni permisos de escritura GitHub. `pull_request` puede ejecutar el código propuesto en el job; mantener `permissions: contents: read`, entorno efímero, sin artifacts que contengan datos sensibles y tiempos límite. No usar `pull_request_target`.
7. El repositorio actual es público: runners estándar de GitHub Actions no generan costo de cómputo en repos públicos. Este cálculo debe revisarse si cambia la visibilidad o se usan runners grandes/servicios facturables.

## Razones y alternativas

- **Maestro vs Detox:** Maestro es una capa black-box por accesibilidad y sus acciones son compatibles con el flujo en Expo/React Native sin instrumentación nativa. Detox podría ofrecer integración más estrecha con JS, pero aumenta el acoplamiento a la estructura nativa/configuración y requiere validación de compatibilidad para RN 0.86.
- **GitHub Actions vs EAS/Maestro Cloud:** el usuario seleccionó GitHub Actions y el repo público permite usar runners estándar sin costo de cómputo. Servicios EAS/Maestro Cloud agregarían credenciales, costo y procesamiento de artifacts fuera del repositorio; no son necesarios para el piloto.
- **Sandbox real vs sintético:** el objetivo es comprobar app instalada + API + Mongo + worker, no repetir navegación arbitraria de internet. Un Sandbox sintético determinista evita depender de DNS/TLS de terceros y no produce accesos externos durante CI.

## Consecuencias y límites

- Esto comprueba un flujo integrado reproducible en simuladores, no la seguridad de red del Sandbox productivo, dispositivos físicos, paridad visual de Figma, privacidad legal, store signing ni staging cloud.
- Los tests actuales HTTP+Mongo continúan siendo una capa aparte; el E2E nativo no reemplaza las pruebas de propiedad, concurrencia ni seguridad del backend.
- La primera ejecución medirá duración y estabilidad; ajustar timeouts/concurrencia y revisar artifacts después. No se debe convertir una corrida verde aislada en certificación de release.

## Criterios de aceptación

- Una ejecución desde workflow instala y lanza la app nativa en Android y iOS con una API de prueba aislada y sin mocks en el cliente móvil.
- El flujo confirma con datos del backend synthetic que el análisis llega a `completed`, aparece en historial/detalle y la sesión cierra.
- El Sandbox no efectúa solicitudes web, el job no tiene secretos reales y la base temporal se elimina incluso ante fallo/timeout.
- La identidad de la app para E2E es distinta de una identidad release pendiente de decisión.
- CI guarda solo evidencia técnica no sensible y falla si no cumple algún paso.

## Verificación de plataforma

El 2026-11-03 se consultaron las referencias versionadas de Expo SDK 57, las imágenes oficiales GitHub runner y el CLI Maestro. SDK 57 requiere Xcode 26.4+; la imagen `macos-26` actual incluye Xcode 26.6 y runtimes de simulador iOS 26.5. Las imágenes y soporte de OS cambian: el workflow debe validar existencia de herramientas/runtimes antes de compilar.

Fuentes: [Expo SDK 57](https://docs.expo.dev/versions/v57.0.0/), [Expo CLI / CNG](https://docs.expo.dev/more/expo-cli/), [GitHub runner macOS 26](https://github.com/actions/runner-images/blob/main/images/macos/macos-26-Readme.md), [runners y precios GitHub](https://docs.github.com/en/actions/reference/runners/github-hosted-runners), [Maestro Quickstart](https://docs.maestro.dev/get-started/quickstart.md), [Maestro launchApp](https://docs.maestro.dev/reference/commands-available/launchapp.md).
