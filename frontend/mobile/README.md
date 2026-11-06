# EnlaceSeguro Mobile

Cliente iOS/Android en React Native + Expo SDK 58, Expo Router y TypeScript. La implementación visual toma de referencia los anclajes medidos en Figma (`#2F7BF5`, `#1F2D45`, `#16233A`, `#0A1220`, IBM Plex Sans); algunas medidas y tonos semánticos son provisionales hasta completar la extracción con el inspector.

## Configuración local

1. Requiere Node 22.13+ y npm; instala dependencias desde este directorio con `npm ci`.
2. Copia `.env.example` a `.env.local` y configura `EXPO_PUBLIC_API_URL` con la URL base que incluya `/api/v1`.
   - iOS Simulator: normalmente `http://localhost:3000/api/v1`.
   - Android Emulator: normalmente `http://10.0.2.2:3000/api/v1`.
   - Dispositivo físico: usa una dirección LAN accesible desde el teléfono y la máquina donde corre la API.
3. Inicia API/Mongo/Sandbox conforme a sus runbooks y corre `npm run start`.
4. Abre con Expo Go SDK 58 o un development build compatible. El usuario confirmó en iPhone el recorrido login → análisis → historial → logout. Un APK Android ARM64 se compiló, pero no se instaló ni probó en dispositivo; la recompilación posterior se interrumpió y su salida actual no está verificada. Falta QA visual y accesibilidad restante. Esta Mac no tiene Xcode.

No uses una URL pública de API sin TLS fuera de un entorno local controlado. No agregues `.env.local`, tokens ni URLs de usuarios al repositorio/logs.

## Comandos

- `npm run start` — Metro/Expo
- `npm run ios` / `npm run android` — abrir con simulador conectado
- `npm run lint` — ESLint
- `npm run test:ci` — pruebas móviles (Jest)
- `npm run typecheck` — TypeScript
- `npm run export` — export estático de bundles Android/iOS/web

`npm run export` verifica la compilación Metro; **no** equivale a firmar, instalar o validar la app en un dispositivo.

## Estado funcional

- Implementado: onboarding de tres pantallas; registro/login y errores 409/429; access token en memoria y refresh token en SecureStore; URL manual y pegado explícito; análisis, cuota de `/auth/me`, polling acotado/resultados; avisos 5.4/5.5 diferenciados para error de transporte y cuota agotada real; historial con cursor y detalle autenticado; cuenta/cuota/logout con confirmación de alcance a este dispositivo; pantalla dedicada de sesión expirada con guards que distinguen token inválido de error temporal al restaurar sesión.
- Cobertura local al 2026-11-03: 22 pruebas en 6 suites para sesión, acceso, onboarding, análisis, historial y cuenta; incluyen expiración permanente vs temporal, navegación protegida, confirmación/cancelación de logout y reintentos offline. Validación repetida: `npm run test:ci` (22/22), lint, typecheck y export Metro Android/iOS/web pasan. Sus respuestas son controladas, no son E2E contra API/Mongo/Sandbox.
- No se ejecutaron builds ni simuladores/dispositivos nativos: esta máquina no cuenta con Xcode ni Android SDK.
- Pendiente: E2E móvil conectado a API, UX de reconexión durante bootstrap, QA visual y accesible por plataforma, builds nativos y los gates documentados en [`../../docs/roadmap/mobile-implementation-plan.md`](../../docs/roadmap/mobile-implementation-plan.md).
- Capturas permanecen deshabilitadas hasta que exista el endpoint API autenticado con comprobación de pertenencia y la red privada del Sandbox esté verificada. Proveedores externos no se simulan.

El cliente no promete que un sitio sin señales detectadas sea seguro; las URLs completas no deben persistirse ni registrarse.
