# Diseño propuesto: resultados honestos y reputación VirusTotal

## Alcance y estado

La entrega sigue siendo local, académica, gratuita y no comercial. El usuario aprobó el diseño general: VirusTotal desactivado por defecto, consulta de URL inicial, pruebas simuladas y ninguna consulta real en esta etapa. Este documento detalla la propuesta técnica para revisión antes de implementar. La integración no convierte el prototipo en un servicio listo para producción.

## Privacidad y autorización

- La clave permanece en el servidor, fuera del repositorio, respuestas, cliente, capturas y logs.
- No se envían URLs a VirusTotal en las pruebas automatizadas. En las futuras pruebas reales solo se admitirán URLs públicas de prueba expresamente autorizadas, sin credenciales, datos personales, secretos, query ni fragmento. No se consultan redirecciones ni se envían URLs automáticamente mediante el endpoint de escaneo.
- Para imponer esa decisión, el modo de red requerirá activación explícita y una lista exacta de URLs autorizadas en el servidor; fuera de ella no se consultará. La habilitación real requiere autorización adicional y revisión de términos. La lista no debe contener información sensible.
- Se usará exclusivamente `GET /api/v3/urls/{id}` para informes existentes. El identificador base64url de una URL es reversible y su consulta revela el indicador al proveedor; no representa anonimización. Un 404 no autoriza un envío POST ni implica seguridad.
- Según el proveedor, indicadores consultados o enviados pueden incorporarse a su conjunto de datos comunitario. Fuente: https://docs.virustotal.com/reference/scan-url .

## Corregir el Sandbox primero

1. Diferenciar rechazo de destino privado de fallo o ausencia de DNS. Ambos bloquean la navegación; un fallo DNS debe ser inconcluso o fallido, no `peligroso`.
2. Si falla la inspección DOM, no devolver `sin_amenazas_detectadas`. Registrar un resultado inconcluso sin veredicto ni captura expuesta. Mantener resultados TLS inválido y límites de recursos sin veredicto.
3. Construir la evidencia de redirección desde la navegación principal, no desde recursos secundarios. Conservar orden y repeticiones relevantes y respetar el límite existente; ninguna petición a IP interna debe permitirse.
4. Adaptar la unión de resultados y validación estricta de API/Sandbox, persistencia, OpenAPI y presentación cuando corresponda. Los fallos no deben convertirse en éxitos por incompatibilidad entre capas.
5. Mantener explícita la limitación: las validaciones de aplicación y DNS no demuestran aislamiento de egreso ni protección completa contra DNS rebinding. No exponer el Sandbox ni introducir un supuesto de seguridad de producción.

Las pruebas deben cubrir DNS sin registros y error de resolución, destino privado, error DOM, TLS, límite de recursos, redirecciones del documento frente a subrecursos y resultados de extremo a extremo por capas. Usar fixtures sintéticos sin red externa; las pruebas de navegador o servicios requieren autorización según ADR-0013.

## Arquitectura de reputación

El worker usa una interfaz de reputación independiente del adaptador VirusTotal. El Sandbox sigue siendo una fuente separada. La integración está deshabilitada por defecto y no necesita clave ni acceso a Internet en ese estado. Los componentes aceptan transporte, reloj y almacenamiento sustituibles para pruebas deterministas. La API, el worker y el cliente muestran cobertura de fuentes de manera explícita; no presentan un no-match o una fuente omitida como garantía.

### Reglas de combinación propuestas

- Un veredicto `peligroso` del Sandbox nunca se rebaja por reputación.
- Un informe VirusTotal válido con una o más detecciones `malicious` eleva al menos a `sospechoso`; conservar el número y la fecha del informe sin divulgar resultados crudos o información sensible. Una detección no es prueba definitiva de amenaza.
- Un informe con cero detecciones, un informe desconocido, error, cuota agotada o fuente desactivada nunca reduce el riesgo del Sandbox ni significa que el enlace sea seguro.
- Si el Sandbox no termina de forma concluyente, mantener el estado inconcluso o fallido; un resultado externo no transforma una inspección incompleta en `sin_amenazas_detectadas`.
- El detalle del análisis debe distinguir estado VirusTotal `match`, `no_match`, `not_found`, `not_queried`, `rate_limited` y `error`. Se debe mostrar si la cobertura es parcial. No inventar una fecha de consulta o datos de proveedor cuando no existen.

Se revisará el contrato existente de `sourceResults`, `sourceFailures`, límites de cuatro fuentes y validadores de Mongo. Si estos no permiten expresar todos los estados, se extenderán de forma compatible y se actualizarán API, OpenAPI, persistencia, móvil y pruebas; no se descartará silenciosamente un resultado.

## Cuota, caché y errores

VirusTotal publica como límites de Public API 4 solicitudes por minuto y 500 por día y prohíbe el uso comercial: https://docs.virustotal.com/reference/public-vs-premium-api . No se usarán varias cuentas para eludirlos.

El diseño exige reserva atómica y persistente de cuota compartida entre workers que usan la misma clave y almacenamiento, con límites configurables iguales o inferiores a los permitidos. No garantiza controlar consumo de otros proyectos que usen la misma clave. Sin reserva disponible o ante incertidumbre del almacenamiento no se hará la consulta. `429` detiene consultas conforme a la política de espera; no se reintenta de forma descontrolada. Timeout, respuestas inválidas, 401/403 y 5xx se expresan como cobertura no disponible; la aplicación no muestra secretos ni respuestas crudas. Un 404 se representa como desconocido.

La caché se limita a datos mínimos y un vencimiento explícito compatible con términos del proveedor; no se compartirán ni registrarán URLs completas por conveniencia. No se reutilizarán resultados vencidos como actuales. La configuración inicial y los tiempos concretos se validarán al elaborar el plan de implementación.

## Validación y criterios de aceptación

- Sin configuración explícita, ninguna petición sale a VirusTotal y la aplicación explica que la fuente no fue consultada.
- Transporte simulado cubre 200 con detección, 200 sin detección, 404, 429, 401/403, 5xx, timeout y JSON inválido, sin acceso externo.
- Pruebas de concurrencia y reinicio verifican reservas y ausencia de exceso de cuota entre los procesos controlados; comprobar aislamiento por clave sin registrar la clave.
- Verificar que URL fuera de la lista, con query, fragmento, credenciales o no autorizada jamás llegue al transporte; la aprobación del propietario no reemplaza la validación técnica.
- Verificar que una detección no rebaja el veredicto y que ninguna falla o ausencia de datos se presenta como seguridad. Verificar persistencia y presentación móvil de cobertura parcial.
- Documentar comandos, resultados y pruebas omitidas. La consulta real queda fuera de esta fase; no realizar instalaciones, pruebas en dispositivo, escaneos, publicación, commit ni push sin autorización específica.
