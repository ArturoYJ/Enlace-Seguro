# ADR-0004: Rate limit de intentos de inicio de sesión

- **Estado:** aceptado por el usuario; implementación y suite MongoDB desechable validadas; configuración de despliegue aún pendiente
- **Fecha:** 2026-11-03
- **Decisión:** aplicar límites compartidos y fail-closed usando MongoDB

## Contexto

Un límite en memoria se pierde al reiniciar y diverge entre instancias API. El control debe ser común a réplicas sin almacenar correos o IP en claro ni permitir que un error de persistencia desactive silenciosamente la protección.

## Decisión

- Máximo **20 intentos por IP en una ventana móvil de 1 minuto**.
- Máximo **10 fallos por cuenta normalizada en 15 minutos**; el login exitoso elimina ese bucket de fallos de cuenta. La aplicación reserva atómicamente un slot compartido antes de comprobar la contraseña, de modo que solicitudes simultáneas no puedan superar el umbral durante la ventana de validación; las credenciales correctas limpian el bucket tras autenticarse.
- Buckets compartidos en MongoDB; las claves son HMAC-SHA-256 con prefijo de versión y secreto de entorno independiente (`LOGIN_RATE_LIMIT_HMAC_KEY`, mínimo 32 bytes UTF-8, sin espacios). No almacenar los identificadores fuente ni emitirlos en logs.
- Si MongoDB no responde, login devuelve `503` genérico (fail-closed). Al exceder límite, devuelve `429` Problem Details y `Retry-After`.
- Se aceptan IP cliente desde `request.ip`, pero los encabezados forward solo se confían al configurar rangos exactos de balanceadores (`TRUST_PROXY_CIDRS`). Valor vacío = no confiar en proxy.
- La colección estricta y su TTL se crean mediante migración incremental 002, después del bootstrap 001. API valida esquema/índice al iniciar; no crea estructura automáticamente.

## Consecuencias y riesgos

- Requiere secreto HMAC consistente en todas las réplicas; rotarlo invalida la continuidad de buckets. Guardarlo en el gestor de secretos y definir rotación operativa antes de producción.
- MongoDB pasa a ser dependencia obligatoria del endpoint de login y ataques distribuidos pueden provocar `429`; los límites deberán reevaluarse con telemetría no identificable y pruebas de carga.
- El límite por cuenta puede ser usado para denegación de servicio dirigida; el límite por IP, la respuesta genérica y la ventana acotada reducen, pero no eliminan, ese riesgo.
- La política se aplica a todos los intentos que alcanzan el caso de uso de login, incluidos usuario no existente o deshabilitado. Ninguna IP/correo bruto se guarda en la colección de rate limit.

## Verificación requerida

Pruebas de límite concurrente con varias instancias/repositorios, limpieza, TTL y validador en MongoDB 8 desechable; pruebas API para encabezado 429, respuesta 503, IP de origen/proxy, logs sin IP y despliegue con migración previa. La existencia de código/pruebas unitarias no acredita esas verificaciones.
