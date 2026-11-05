# Proxy de egreso HTTP del Sandbox (Envoy 1.40.2)

**Estado:** candidato G1-SEC, no aprobado para producción. Esta configuración no prueba aislamiento de red del host o la nube.

## Límite previsto

- Listener HTTP/1 en TCP `10000`, dentro de una red privada. No publiques este puerto en una interfaz pública ni expongas Envoy a Internet.
- Admin en `127.0.0.1:9901` dentro del contenedor. No publiques ese puerto.
- HTTP absoluto: permite solo esquema `http` y puerto 80 (explícito u omitido).
- HTTPS: permite HTTP/1 `CONNECT` al puerto 443. Envoy tuneliza bytes; no termina TLS ni inspecciona el contenido cifrado.
- Otros métodos, esquemas, autoridades y puertos se rechazan; no existe ruta de fallback hacia el destino.
- El filtro DFP elimina de las respuestas DNS las IP privadas/reservadas. Si una respuesta contiene direcciones mixtas, conserva las permitidas y elimina las bloqueadas; si todas son bloqueadas, falla. El preflight de la API rechaza respuestas mixtas completas.
- Upstream RBAC revisa la IP seleccionada antes de conectar. Mantén ambas capas.
- Los rangos configurados son conservadores y pueden bloquear algunas excepciones globales de asignaciones especiales. Revisa la lista contra registros IANA y rangos del proveedor antes de desplegar.

Envoy 1.40.2 es la versión fijada. La configuración usa el filtro DFP `resolved_address_filter` y upstream-IP RBAC como controles SSRF. Envoy advierte que los tipos CIDR usados están marcados WIP; por eso este artefacto sigue como candidato. También aparecen advertencias de campos obsoletos de access log que deben actualizarse antes de producción. Se bloquean formas IPv6 IPv4-compatible (`::/96`) que podrían codificar destinos IPv4 privados.

## Validar y probar

Validación de configuración con la imagen oficial fijada:

```sh
docker run --rm \
  -v "$PWD/sandbox/egress-proxy/envoy.yaml:/etc/envoy/envoy.yaml:ro" \
  envoyproxy/envoy:v1.40.2 \
  --mode validate -c /etc/envoy/envoy.yaml
```

El harness repetible de denegación privada corre desde la raíz del repo:

```sh
bash sandbox/egress-proxy/tests/smoke.sh
```

Crea una red Docker `--internal` única, no publica puertos, no contacta destinos públicos y limpia solo sus contenedores/red. Verifica IPv4 literal privado, alias DNS privado, puertos HTTP/CONNECT no permitidos, marcador local y cero solicitudes recibidas por el canary. En Envoy 1.40.2, CONNECT al puerto 444 devuelve 403. El harness no prueba DNS rebinding, aislamiento del host/cloud ni bypass de egress.

La topología de aislamiento local corre desde la raíz:

```sh
bash sandbox/egress-proxy/tests/topology-boundary.sh
```

Usa dos redes Docker `--internal`: cliente no confiable solo en red Sandbox, canary solo en red proxy y Envoy conectado a ambas. Confirma que el cliente no alcanza la IP sintética del canary directamente y que el intento por Envoy devuelve denegación marcada sin requests al canary. No publica puertos ni consulta destinos públicos. Esto prueba solo el aislamiento entre redes Docker locales; no acredita firewall del host, nube, metadata real ni secuestro DNS.

La integración real Chromium + Envoy corre desde `sandbox/`:

```sh
npm run test:egress-proxy
```

Usa una red de canary privada, un proxy Envoy y un puerto aleatorio publicado solo en `127.0.0.1`. El preflight del test simula un resultado DNS permitido; Envoy resuelve el alias Docker al canary privado. Chromium recibe `503` con el marcador local; `PlaywrightContextPool` aborta sin captura; el canary recibe cero requests. Docker limpia solo sus recursos etiquetados por nombre único.

La prueba DNS con respuestas cambiantes corre con:

```sh
npm run test:egress-rebinding
```

El DNS autoritativo sintético contesta dos veces con un IP de documentación permitido por el fixture; después devuelve el IP privado del canary. La app y Envoy consultan el mismo nombre. Envoy bloquea la segunda resolución, API Sandbox devuelve `502` reintentable, no hay captura y el canary recibe cero requests. No se consulta DNS público ni se contacta un destino público.

Caídas locales:

```sh
npm run test:proxy-outage
npm run test:dns-resolver-outage
```

La primera deja el puerto de proxy cerrado y confirma ausencia de fallback directo. La segunda deja de responder el DNS fixture después de las dos consultas de preflight. Ambas verifican `502` reintentable, sin captura ni acceso al destino. Son fallos simulados localmente, no disponibilidad en producción.

**Evidencia local adicional, solo con destinos sintéticos:**

- `--mode validate` acepta el YAML.
- Pruebas aisladas comprobaron HTTP y HTTPS CONNECT en una configuración de prueba que permitía loopback. Curl rechazó un certificado autofirmado (`exit 60`) salvo que se desactivara su validación; no se interceptó TLS.
- Upstream RBAC denegó HTTP y CONNECT a loopback cuando se quitó el filtro DNS en una configuración temporal; el contador `rbac.denied` subió.
- El YAML del candidato devolvió 503 para loopback, alias DNS privado, respuesta mixta privado/TEST-NET, `::7f00:1` y `::ffff:127.0.0.1`.
- Envoy agregó `x-enlaceseguro-egress-error: true` a respuestas locales por denegación, fallo DNS y fallo de conexión. Quitó el mismo header de una respuesta upstream sintética `418` que intentó falsificarlo.
- Una prueba mixta temporal devolvió loopback + canary en `10.250.0.3`; Envoy filtró loopback y solo alcanzó el canary al permitir `10/8` en el config de prueba. Esto no permite `10/8` en el YAML candidato.

No se contactó ningún destino público. Estas pruebas no demuestran ACL de host/cloud ni una política de red productiva.

## Ejecución local limitada

Solo para una fixture local, publica el proxy en loopback:

```sh
docker run --rm --name enlaceseguro-egress-proxy \
  -p 127.0.0.1:10000:10000 \
  -v "$PWD/sandbox/egress-proxy/envoy.yaml:/etc/envoy/envoy.yaml:ro" \
  envoyproxy/envoy:v1.40.2 \
  -c /etc/envoy/envoy.yaml
```

No uses ese ejemplo en redes compartidas o productivas. En producción, mantén Sandbox y proxy en red privada. El Sandbox solo debe alcanzar al proxy; el proxy no debe tener rutas a API, MongoDB, metadata, peering ni servicios internos. Limita su salida a TCP 80/443 y al resolver designado. Deniega DNS alterno, UDP/QUIC, STUN/WebRTC, IPv6 de bypass y otros caminos en el límite de red. Si falla Envoy o DNS, no debe existir fallback directo.

## Integración y gates restantes

- **Hecho local:** `SANDBOX_EGRESS_PROXY_URL` se configura en cada `BrowserContext`; en producción falta de variable detiene el arranque. Sin `bypass`, TLS estricto.
- Se conserva en Playwright el límite conjunto exacto de 256 requests HTTP/WebSocket; Envoy no cuenta las requests cifradas dentro de CONNECT.
- Respuestas locales del proxy se marcan y Sandbox las traduce a 502 retryable, antes de producir veredicto o captura. Un sitio externo no puede falsificar el marcador en la ruta probada; respuestas normales 403/503 siguen analizables.
- **Hecho local nuevo:** `npm run test:egress-rebinding`, `npm run test:proxy-outage` y `npm run test:dns-resolver-outage` pasan. DNS cambiante, fallo proxy y timeout DNS terminan en error retryable, sin captura ni fallback; el canary no recibe requests.
- **Faltan:** redirects/subrecursos a través de proxy, egress directo denegado desde el runtime Sandbox real, firewall/kernel independiente y validación cloud/staging. Las APIs CIDR Envoy son WIP; no usarlas como frontera de seguridad productiva. El límite de IP necesita controles kernel/cloud independientes.
- El despliegue no está configurado. La variable de proxy puede omitirse fuera de producción, así que ejecución local no implica protección.
- No se ha comprobado por separado el marcador para denegación upstream-RBAC.
- No hay presupuesto de conexiones/bytes por análisis ni logs estructurados sanitizados.

El contrato lógico requiere una ACL/firewall externa que deniegue egress directo de Sandbox y limite el propio proxy. Ni el listener privado ni una red Docker `--internal` demuestran esa ACL. Mapear controles a la nube solo después de elegir proveedor; sin staging/ACL comprobada G1-SEC permanece abierto.
