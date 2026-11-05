# ADR-0006: Transporte seguro API–Sandbox

- **Estado:** Aprobada por el usuario e implementada localmente
- **Fecha:** 2026-11-03
- **Contexto:** G1-SEC

## Contexto

La API envía un token Bearer al servicio Sandbox. Enviar ese secreto por HTTP fuera de loopback permitiría observarlo o modificar la respuesta; además, seguir una redirección podría reenviar la solicitud autenticada a otro destino. El esquema local por defecto es útil para desarrollo, pero no es aceptable como configuración implícita de producción.

## Decisión

- La API valida `SANDBOX_SERVICE_URL` al construir el adaptador. Acepta solo URL absoluta HTTP(S), sin credenciales, query ni fragmento.
- En `production` se requiere la variable explícitamente y el esquema debe ser HTTPS, incluso si el destino es loopback.
- Fuera de producción, HTTP solo se permite para `localhost`, `127.0.0.0/8` y `::1`; otros hosts requieren HTTPS. El fallback `http://localhost:3001` solo existe en entornos no productivos.
- Se mantiene la validación TLS normal de Node; no se habilitan `rejectUnauthorized: false`, trust-all ni opciones de ignorar errores de certificado.
- Las solicitudes de análisis y salud usan `redirect: error`; no se sigue una redirección HTTP.

## Alternativas

1. **Conservar HTTP en cualquier entorno y confiar en token/red interna:** rechazada; el token no proporciona confidencialidad ni integridad del transporte.
2. **Permitir HTTP configurable mediante una bandera en producción:** rechazada; facilita una degradación silenciosa de seguridad.
3. **HTTPS requerido en producción, loopback HTTP solo para desarrollo, redirecciones rechazadas:** elegida; separa conveniencia local de configuración productiva y evita reenvío del Bearer.

## Validación y límites

- Las pruebas cubren selección del fallback, requisito HTTPS de producción, loopback HTTP local, rechazo de URL ambigua y opciones anti-redirección en `/analyze` y `/health`. Un HTTPS loopback autofirmado real verifica que Node no desactiva TLS y que el handler no recibe datos bajo certificado no confiable.
- `npm test`, `npm run typecheck` y `npm run build` de API pasan en el checkout actual.
- Esto verifica política de configuración y comportamiento del cliente HTTP, no la existencia de un certificado válido, terminación TLS en un proxy, red privada, reglas egress, identidad del workload, aislamiento API↔Sandbox ni seguridad del host. Esos controles requieren configuración y pruebas en staging después de seleccionar proveedor.
