# Spike de viabilidad: recibir enlaces compartidos

**Estado:** el propietario decidió diferir la recepción externa para el lanzamiento inicial y conservar pegar URL. Evaluación revisada el 2026-11-03 contra Expo SDK 57 y el checkout móvil vigente; no se implementó la función.

## Alcance y evidencia

- El flujo base aprobado sigue siendo pegar o escribir la URL. `frontend/mobile/` usa Expo SDK 57, Expo Router y generación nativa continua; no incluye `expo-sharing` ni un receptor de intents.
- Expo SDK 57 documenta recepción con `expo-sharing`: el plugin crea un filtro Android `ACTION_SEND` y una Share Extension iOS, y Expo Router puede redirigir mediante `+native-intent.ts`. Para este producto solo se necesitarían `text/plain`/URL y una única entrada; no imágenes, archivos ni `ACTION_SEND_MULTIPLE`.
- La recepción está marcada **experimental** por Expo. En iOS la extensión abre la app principal, mecanismo que Expo declara no soportado oficialmente por Apple y sujeto a dejar de funcionar. La disponibilidad documental no prueba compatibilidad real, aceptación de tienda ni estabilidad.
- `getResolvedSharedPayloadsAsync()` puede hacer una conexión de red al resolver detalles. Eso contradice la promesa de no visitar enlaces desde el dispositivo. Cualquier prototipo debe usar solo payload crudo (`getSharedPayloads()`), sin resolver metadatos ni cargar previews, y comprobar por instrumentación que la app no abre el destino.
- Android requiere intent filter de `ACTION_SEND` con `text/plain`; un filtro no resuelve por sí mismo extracción, navegación, autenticación ni confirmación de análisis.

Fuentes primarias: [Expo Sharing SDK 57](https://docs.expo.dev/versions/v57.0.0/sdk/sharing/), [Android: recibir datos simples](https://developer.android.com/develop/ui/compose/sharing/receive), [Expo Router native intent](https://docs.expo.dev/router/advanced/native-intent/).

## Opciones

1. **Diferir la recepción externa (recomendada para release inicial).** Conservar pegar URL como flujo multiplataforma estable. No se introduce una dependencia experimental ni una extensión iOS con limitación declarada. El costo es un paso manual adicional.
2. **POC Android aislada, sin promesa de release.** Probar `expo-sharing` con `ACTION_SEND text/plain`, extracción local y pantalla de confirmación. No habilitar iOS ni incluir la función en criterios de publicación hasta resolver su mecanismo nativo. Esto mide UX Android, pero crea asimetría temporal.
3. **Extensiones nativas propias para iOS y Android.** Diseñar Share Extension iOS que procese el payload dentro de la extensión y lo transfiera mediante App Group, más receptor Android. Requiere plugin/configuración CNG, firma/provisioning, QA de ciclo de vida y revisión de privacidad; costo y riesgo mayores. No se ha demostrado factibilidad en este repositorio.

## Contrato mínimo si se aprueba una POC

- Aceptar solo un texto/URL explícitamente compartido; no leer automáticamente clipboard ni archivos adjuntos. Si el texto contiene cero o varias URLs, mostrar selección/error sin enviar ninguna.
- Limitar entrada a 64 KiB UTF-8 antes de navegar. Reutilizar las reglas de esquema del flujo manual y no abrir la URL en `WebView`, navegador ni resolver preview.
- Mantener el texto solo en memoria; si falta sesión, pedir acceso y conservarlo solo mientras dure el proceso, con cancelación clara. No poner URL en rutas, logs, analytics, notificaciones ni storage persistente.
- Mostrar dominio y URL recibida en una pantalla de confirmación editable. Solo `POST /analyses` tras pulsar **Analizar enlace**. Evitar duplicados al reabrir app o recibir un segundo intent.
- Probar instalación real en iOS y Android: Chrome/Safari, mensajería, texto libre, URL válida/inválida, múltiples URLs, app fría/caliente, sesión activa/expirada, cancelación, offline y no-egress al destino. La disponibilidad en Expo Go o los tests Jest no bastan.

## Gate

No instalar `expo-sharing`, añadir filtros ni anunciar compartir externo para el lanzamiento inicial. El propietario aprobó la opción 1; el flujo manual permanece base y no bloquea G3/G4. Una futura POC requiere nueva decisión sobre UX, permisos y riesgo iOS.
