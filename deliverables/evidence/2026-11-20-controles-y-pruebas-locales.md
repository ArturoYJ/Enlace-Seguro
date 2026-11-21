# Evidencia técnica local — 20 de noviembre de 2026

## Alcance

Ensayo en macOS y red local, con cuenta y datos de prueba. Este registro contiene resultados observados; no sustituye capturas, una auditoría de seguridad ni la revisión del profesor. Las conexiones de la app en esta demo usan HTTP, sin cifrado de tránsito en la LAN.

## Control de acceso sin credenciales

Alrededor de las 19:00, hora de Ciudad de México, se enviaron dos solicitudes locales sin encabezado `Authorization`:

| Prueba | Resultado observado | Alcance |
| --- | --- | --- |
| `GET http://127.0.0.1:3000/api/v1/analyses` | HTTP 401; respuesta indica que se requiere Bearer. | La ruta consultada rechazó una solicitud sin token; no demuestra seguridad de todas las rutas. |
| `POST http://127.0.0.1:3001/analyze` con URL pública de prueba | HTTP 401; respuesta indica que se requiere autenticación de servicio. | El Sandbox rechazó esta solicitud sin credencial; no demuestra aislamiento de red completo. |

Ambas pruebas se realizaron contra los procesos de la demo. No se registraron contraseñas ni tokens en este documento.

## Pruebas sintéticas del Sandbox

- `npm run test:browser`: 11 aprobadas y 3 omitidas. Chromium usó fixtures locales; las pruebas omitidas no se consideran aprobadas.
- `npm run test:egress-proxy`: el canario privado sintético recibió cero solicitudes; no se produjo captura.
- `npm run test:egress-rebinding`: un cambio DNS sintético a la IP privada fue rechazado; el canario recibió cero solicitudes.
- `npm run test:dns-resolver-outage`: el fallo DNS sintético cerró el flujo sin captura ni acceso al canario.
- `npm run test:proxy-outage`: la prueba sintética terminó correctamente.

Estas pruebas no acreditan reglas de firewall del host, aislamiento de la demo local, controles de nube o preparación para producción. Los detalles de ejecución temporal se guardaron en `/tmp/enlaceseguro-vt-browser-20261120.log` y `/tmp/enlaceseguro-test-egress-*.log` o `/tmp/enlaceseguro-test-dns-*.log`; esos archivos temporales pueden desaparecer.

## Integración con MongoDB desechable

`bash database/tests/run-mongodb-suite.sh` terminó con código 0 usando un contenedor MongoDB 8.0.34 sin volumen persistente. La suite incluyó la prueba integrada API, worker, MongoDB, Sandbox HTTP y Chromium con fixtures locales; también ejecutó pruebas de esquema, TTL y respaldo/restauración desechables. El contenedor temporal fue eliminado por el propio script. No equivale al recorrido móvil con VirusTotal real.

## Pendiente para el entregable

- Capturar visualmente el HTTP 401 y la ejecución de la app, ocultando correos, contraseñas y tokens.
- Registrar el recorrido de iPhone con resultado y cobertura de VirusTotal solo después de la confirmación del usuario.
- Adjuntar o conservar un resumen reproducible y verificar la accesibilidad del video final.
