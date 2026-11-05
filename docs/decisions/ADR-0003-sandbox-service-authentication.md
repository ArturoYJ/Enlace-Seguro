# ADR-0003: Autenticación de servicio entre API y Sandbox

- **Estado:** Aceptada para defensa en profundidad local y de aplicación
- **Fecha:** 2026-11-03
- **Contexto:** G1-SEC / G2-BASE

## Contexto

El Sandbox ofrece endpoints internos que procesan URLs arbitrarias y entregan capturas. La autenticación de usuario de la API no protege directamente esos endpoints, y CORS permisivo no es una frontera de seguridad para comunicación servidor-servidor.

## Decisión

- API envía `Authorization: Bearer <SANDBOX_SERVICE_TOKEN>` en `POST /analyze`.
- Sandbox exige token válido en `POST /analyze` y `GET /captures/:attemptId`; `/health` queda abierto para probes.
- API y Sandbox fallan al iniciar si falta el token o contiene menos de 32 bytes UTF-8. Se compara con `timingSafeEqual`; respuestas de rechazo no revelan ni registran el token.
- Se elimina CORS del Sandbox porque no hay consumidor de navegador documentado.
- Usar un secreto aleatorio compartido, almacenarlo fuera del repositorio y rotarlo coordinadamente.

## Alternativas

1. **Token Bearer compartido — elegida:** portable y no requiere seleccionar proveedor; la longitud mínima evita claves triviales. Requiere gestión/rotación segura de secreto.
2. **Identidad de workload/mTLS:** preferible como siguiente defensa en una plataforma administrada, pero depende de la elección de nube e infraestructura.
3. **Solo red privada:** insuficiente como único control de autorización para rutas sensibles.

## Consecuencias y límites

- La credencial compartida no cifra el tráfico. En producción se requiere TLS y redes privadas/identidad de workload; no es sustituto de la política de egress ni del sandboxing del navegador.
- El servicio de salud permanece disponible sin credenciales y no expone contenido de análisis.
- Los valores de ejemplo en `.env.example` son placeholders, nunca secretos válidos.

## Verificación

Pruebas de servidor deben confirmar `/health` público, rechazo de token ausente/incorrecto en ambas rutas internas, aceptación de token correcto, ausencia de CORS y falta de filtración de credenciales en respuestas/logs. Debe probarse además que el cliente API envía la credencial solo a la ruta de análisis, no al health check.
