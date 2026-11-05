# Diseño: cliente móvil React Native de Enlace Seguro

**Fecha:** 2026-11-03
**Estado:** aprobado por el usuario el 2026-11-03; implementación por incrementos iniciada
**Alcance:** primera fase del cliente móvil y brechas mínimas de API necesarias para sus pantallas

## Objetivo

Construir en `frontend/` un cliente móvil React Native que reproduzca la experiencia visual y los flujos definidos en el archivo de Figma Enlace-Seguro, adaptándolos a las capacidades reales del backend local. La UI debe distinguir claramente las funciones soportadas de las que aún no existen; no simular resultados de reputación, notificaciones ni capacidades de seguridad no verificadas.

## Decisiones y restricciones

- **Stack del cliente:** React Native, de acuerdo con la decisión vigente del proyecto; no adoptar Flutter por el scaffold sin funcionalidad encontrado en el repositorio público del compañero.
- **Fuente visual:** Figma es la referencia para tokens, componentes, jerarquía, espaciado y estados. No inferir valores hexadecimales ni inventar variantes antes de extraer los tokens del archivo.
- **Cobertura inicial:** todos los grupos de pantallas enumerados abajo, incluyendo estados de error, vacío, carga, offline y cuota. Tener una pantalla diseñada no implica que su capacidad de backend esté implementada.
- **API:** el cliente consume Fastify; nunca accede directamente a MongoDB ni al Sandbox.
- **Alcance excluido:** panel administrativo y endpoints `/admin/*`; integración con proveedores externos de reputación; push/centro de notificaciones; despliegue y endurecimiento de infraestructura.
- **Seguridad:** no registrar URLs analizadas, contraseñas ni tokens en logs; no afirmar aislamiento de red/contenedor del Sandbox, aún sin verificar.
- **Proceso:** la revisión del usuario y el plan de implementación fueron aprobados antes de iniciar el scaffold; las puertas de API, seguridad y release siguen vigentes.

## Enfoques considerados

1. **Aplicación React Native modular, respaldada por API, con todas las pantallas de Figma (recomendado):** se alinea con el stack local y permite implementar los flujos completos sin ocultar brechas. Requiere una ruta autenticada nueva para capturas.
2. **Reutilizar Flutter del compañero:** descartado porque el repositorio analizado solo aporta un scaffold de contador y no UI implementada; implicaría cambiar el stack confirmado sin beneficio demostrable.
3. **Limitarse a pantallas ya respaldadas por API:** reduce trabajo inicial, pero contradice la selección de cobertura completa de Figma y posterga validar la navegación/estados objetivo.

## Arquitectura propuesta

Separar la app por responsabilidad y dominio, conservando interfaces para que componentes y casos de uso se puedan probar sin servidor real:

- **Design system compartido:** tokens extraídos de Figma, tipografía, color, espaciado, iconografía, controles y componentes reutilizables; soporta safe areas y tamaños móviles.
- **Navegación y sesión:** rutas públicas/privadas, restauración de sesión, expiración y salida.
- **Módulo de autenticación:** inicio de sesión, alta y errores de autenticación.
- **Módulo de análisis:** envío de enlace, estados de procesamiento, veredicto, detalle y captura.
- **Módulo de historial:** consulta paginada por cursor, detalle y estados vacío/cargando.
- **Módulo de cuenta:** perfil, sesión expirada, salida y estados offline/cuota.
- **Cliente API tipado:** serialización, errores RFC 9457 conforme al contrato y envío del access token. El mecanismo concreto de almacenamiento seguro se escogerá en el plan según compatibilidad actual de React Native/iOS/Android; no usar almacenamiento plano para credenciales o refresh tokens.

**Ajuste de navegación basado en Figma 3.1 (2026-11-04):** las tabs fijas son **Inicio / Analizar / Historial**. Inicio conserva formulario, métricas y recientes; Analizar reutiliza ese formulario, enfoca el campo y no duplica estado/ruta; cuenta queda accesible desde el avatar del encabezado. Se muestra identidad de producto genérica en vez de inventar el nombre de una persona, ya que `/auth/me` solo expone email.

La estructura exacta de paquetes y librerías queda para el plan, evitando fijar dependencias sin inspeccionar el entorno disponible al iniciar la implementación.

## Inventario de pantallas y comportamiento

| Grupo Figma | Pantallas | Comportamiento previsto y respaldo |
|---|---|---|
| 0 Sistema de diseño | Tokens y componentes | Extraer de Figma antes de implementar componentes visuales. |
| 1 Bienvenida | 1.1 Splash, 1.2–1.4 Bienvenida 1–3 | Presentación local; continuar al acceso. Persistencia de “visto” solo si Figma/producto lo requiere. |
| 2 Acceso | 2.1 Iniciar sesión, 2.2 error, 2.3 demasiados intentos, 2.4 crear cuenta, 2.5 correo duplicado, 2.6 cuenta creada | Integrar `POST /auth/login` y `POST /auth/register`. Duplicado refleja el conflicto real de API. La pantalla de demasiados intentos solo se muestra ante respuesta `429`; el backend ahora implementa rate limit compartido en Mongo/HMAC (20 por IP/min, 10 por cuenta/15 min) y se validó con integración Mongo desechable, incluida concurrencia. |
| 3 Análisis | 3.1 Inicio, 3.2 Analizando, 3.3 Peligroso, 3.4 Sin amenazas detectadas, 3.5 Sospechoso, 3.6 Error, 3.7 Captura, 3.8 Sin captura, 3.9 Captura ampliada | Inicio acepta una URL o un mensaje de hasta 480 caracteres y refleja el campo, contador, acciones Pegar/Borrar, recientes y tarjetas de total/peligrosos/sospechosos de Figma. El cliente extrae localmente exactamente una URL HTTP(S); solo esa URL va a `POST /analyses`. El texto del mensaje nunca se persiste ni se transmite. Sin URL, con más de una, con credenciales URL o por encima del límite, se muestra error y no hay POST. Métricas: ventana móvil exacta `[now − 365×24 h, now)`; `total` cuenta intentos admitidos por `receivedAt`, incluidos estados no terminales y fallidos; `peligrosos` y `sospechosos` cuentan solo veredictos persistidos correspondientes. La API deriva owner del token (`GET /analyses/summary`) y no expone identificadores, URLs ni hashes. `daily_analyses` conserva historia por 366 días; cifras Figma son muestras. Consultar estado/detalle con `GET /analyses/{attemptId}`. Reflejar `received`/`processing`, `completed` con veredicto existente, `failed` e `inconclusive`. TLS es estricto; fallo del certificado del documento principal devuelve `inconclusive`, sin veredicto ni captura. Capturas dependen de la ruta autenticada y aislamiento de red.
| 4 Historial | 4.1 Historial, 4.2 vacío, 4.3 cargando | Integrar `GET /analyses` con cursor; representar carga, vacío, error y páginas sin inventar entradas. Abrir detalle con la ruta existente. |
| 5 Cuenta y avisos | 5.1 Mi cuenta, 5.2 sesión expirada, 5.3 cerrar sesión, 5.4 sin conexión, 5.5 demasiados análisis | Leer perfil/cuota desde `GET /auth/me`; cerrar sesión mediante `POST /auth/logout`; renovar con `/auth/refresh` según expiración. Offline es un estado de cliente. Cuota agotada debe reflejar respuesta real del backend, no contador local. Preferencias/push de notificaciones no tienen contrato observado y no se deben simular como persistidas. |

## Contratos y flujo de datos

1. El cliente registra/inicia sesión contra la API, conserva el refresh token en almacenamiento seguro que se decidirá en el plan y mantiene access token solo en memoria cuando sea práctico. El cliente rota mediante `/auth/refresh` y elimina credenciales al cerrar sesión o al fallar la renovación.
2. Inicio obtiene cuenta/cuota desde `/auth/me` y representa carga, cuota disponible real, o error temporal con reintento local; ante fallo no muestra cuota antigua ni mensajes internos del servidor. Acepta URL o texto de mensaje hasta 480 caracteres; extrae en memoria solo una URL HTTP(S) válida y nunca envía el texto que la rodea. Sin URL o con múltiples candidatos no se llama a la API. Al admitir URL, muestra el identificador/estado de `POST /analyses`; consulta `GET /analyses/{attemptId}` con el `localDate` necesario. Polling tiene timeout acotado y reintento/cancelación de UI, sin enviar otro análisis automáticamente.
3. Historial utiliza cursor opaco del API y mantiene la clave de página devuelta por backend. No sustituir paginación por `skip` ni inferir orden en el móvil.
4. La app solo representa los campos y veredictos que vienen de la API. Los `sourceResults` actuales no prueban que VirusTotal, Safe Browsing, URLhaus ni otro proveedor externo haya sido consultado: son señales del sandbox/guard estático y deben etiquetarse conforme a su origen real.

### Brecha requerida para capturas

Agregar al diseño de API `GET /analyses/{attemptId}/capture` (ruta nueva): requerir usuario autenticado, validar pertenencia del análisis al usuario, recuperar la captura desde Sandbox por canal privado servidor-a-servidor y devolver bytes `image/webp` con `Cache-Control: private, no-store`. Responder errores consistentes para ausencia de captura y de análisis sin revelar referencias internas ni rutas del almacenamiento. El móvil nunca contacta directamente `GET /captures/:attemptId` del Sandbox ni recibe el `local://` como URL navegable.

La ruta se considera un requisito de diseño, no funcionalidad ya implementada. Antes de habilitar capturas se debe verificar en configuración/despliegue que el Sandbox no sea accesible desde redes públicas y que solo la API pueda alcanzarlo. La UI debe tener degradación segura: sin captura disponible, conservar el resumen y mostrar estado vacío/error correspondiente.

## Errores, privacidad y límites de producto

- Convertir fallos de red, timeout, HTTP y Problem Details en estados de UI comprensibles, preservando reintentos idempotentes solo donde el contrato lo permita.
- `401`: intentar una renovación controlada una vez; si falla, borrar sesión y mostrar sesión expirada. Evitar bucles de refresh.
- `409` de registro: presentar correo duplicado. `429` de login: estado de demasiados intentos solo cuando la API realmente lo responda. `429`/límite diario de análisis: mostrar cuota agotada solo a partir de respuesta autoritativa.
- No almacenar historial o capturas en caché persistente fuera del comportamiento requerido por el diseño; datos de cuenta y sesiones deben minimizar exposición. Evitar URL, contraseña y tokens en telemetría/logs.
- “Sin amenazas detectadas” no equivale a seguridad garantizada. No atribuir análisis a proveedores externos no conectados.
- La UI no debe afirmar protección completa del Sandbox: aunque el proceso Chromium ahora usa `chromiumSandbox: true`, el aislamiento externo/egress sigue sin comprobarse. **Actualización posterior a esta spec:** TLS es estricto (`ignoreHTTPSErrors: false`); si falla el certificado del documento principal, API retorna `inconclusive` sin veredicto ni captura (ADR-0005). Pool arranca con sandbox habilitado localmente, pero el contenedor/runtime productivo aún no se ha validado.

## Pruebas y criterios de aceptación

- **Contrato/API:** cubrir respuestas exitosas y RFC 9457, renovación fallida/exitosa, `409`, `429`, cuota, paginación cursor y detalle.
- **Autorización de captura:** prueba de propietario autorizado, usuario ajeno, sesión ausente, captura inexistente y respuesta binaria WebP sin fuga de ruta/ref interna.
- **Cliente:** pruebas unitarias de mapeo de estados/veredictos y errores; pruebas de navegación de sesión; pruebas de carga/vacío/error/offline; polling limitado sin doble envío accidental.
- **Visual:** comparar cada grupo y sus estados principales con Figma en iOS y Android, verificando safe areas, escalado de texto, contraste, foco/lectores de pantalla y consistencia del design system.
- **Estados dinámicos accesibles:** durante el polling, anunciar a VoiceOver/TalkBack transiciones de estado/veredicto una vez por intento; no anunciar el primer render ni cada respuesta repetida del polling y no incluir URL. La implementación usa la API `AccessibilityInfo` de React Native y requiere QA nativa posterior.
- **Aceptación funcional:** todos los grupos de pantallas existen; los respaldados usan API real; estados no respaldados se identifican como no disponibles/pendientes; no hay proveedores ficticios ni llamadas móviles directas al Sandbox; capturas permanecen deshabilitadas hasta completar ruta y verificación de aislamiento.

## Riesgos y pendientes expresos

1. Rate limiting de login implementado después de aprobar la especificación; se debe mantener la pantalla de bloqueo dependiente de la respuesta real 429 y no hardcodear una cuenta regresiva que la API no envíe.
2. Al redactar la spec, el procesamiento usaba `setImmediate`. Después se sustituyó localmente por jobs Mongo durables con polling/lease/fencing; staging, recuperación multiproceso y operación todavía no están certificados. El cliente debe manejar polling acotado y estados de error según contrato.
3. Proveedores externos no están implementados; el estado runtime `inconclusive` ya existe para certificados inválidos del documento principal, sin veredicto.
4. El endpoint de captura y la verificación de red privada del Sandbox son trabajo futuro requerido para mostrar captura real.
5. Notificaciones/push no tienen contrato de backend.
6. Detalles de navegación, librerías, almacenamiento seguro y comandos de build/testing quedan para el plan luego de aprobación de esta especificación.

## Revisión de consistencia

- **Placeholders:** no se dejan decisiones presentadas como hechos; el mecanismo de almacenamiento seguro, paquetes y red de captura quedan señalados como decisiones de planificación/validación futuras.
- **Consistencia:** todas las pantallas de Figma entran en el alcance, pero sus estados se respaldan en API solo donde existe contrato/implementación. La captura queda bloqueada hasta nueva ruta y verificación de aislamiento.
- **Alcance:** corresponde a una especificación de cliente móvil y las dependencias mínimas de API; no abarca panel admin, integraciones de reputación, push ni despliegue.
- **Ambigüedad:** las rutas se expresan sin prefijo porque el contrato declara el prefijo global de API; el plan debe usar las rutas efectivas del OpenAPI vigente.


**Actualización de accesibilidad de color (2026-11-04):** una revisión detectó bajo contraste en texto muted y CTA. Se conserva `#2F7BF5` como ancla de marca, iconos y progreso; textos de acción usan la variante derivada `#8BB6FF`, copias secundarias `#94A2B8`, y el botón principal usa `#2A6FD8` con texto blanco para llegar a 4.81:1. Esas variantes derivadas no se presentan como tokens exactos extraídos de Figma. `frontend/mobile/src/theme/__tests__/tokens.test.ts` comprueba contraste estático; no reemplaza QA en iOS/Android. Ver ADR-0009.
