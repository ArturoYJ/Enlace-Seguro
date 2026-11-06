# Diseño — POC sintética EnlaceSeguro en OCI Always Free

**Fecha:** 2026-11-04  
**Estado:** propuesta escrita para revisión del propietario; no es selección cloud productiva, plan de IaC ni autorización de gasto/provisión.  
**Aprobación previa:** el propietario eligió priorizar esta POC y aprobó diseñar dos VM A1; no autorizó crear cuenta, cambiar a cuenta pagada, crear recursos ni publicar servicios.

## 1. Objetivo y decisión de diseño

Diseñar una POC efímera con datos sintéticos para comprobar (a) build/ejecución ARM64 de API, MongoDB, worker y Chromium/Playwright, (b) comunicación privada entre API y Sandbox, y (c) enforcement host-level de egreso fail-closed para el Sandbox.

Topología objetivo: dos VM OCI Ampere A1 de 1 OCPU/6 GiB cada una, solo si la tenancy puede usar una región home en México, existe capacidad gratuita y no hay cargos auxiliares no aprobados.

- **VM aplicación:** API, worker durable y MongoDB 8 como single-node replica set, sin IP pública de aplicación. Solo datos sintéticos.
- **VM Sandbox:** servicio Playwright separado, sin IP pública. Ingreso solo desde VM aplicación en el puerto de servicio configurado.
- **Red:** subred privada por VM y NSG con allow-list mínima. Sandbox no puede iniciar conexiones nuevas a API/MongoDB; se permiten respuestas stateful a conexiones iniciadas por la API. API y MongoDB co-residen en VM aplicación; MongoDB escucha solo en loopback. Sandbox recibe HTTPS privado de la API en el puerto configurado. Sin conexión de producto desde Internet a API, MongoDB o Sandbox. Acceso de operación por OCI Bastion o túnel SSH equivalente previamente validado, nunca por listener público de producto.
- **Egreso del Sandbox:** Chromium no puede salir directo. El contenedor/browser usa solo un proxy privado del host, en network namespace separado; Chromium no resuelve DNS ni abre sockets externos. El proxy resuelve A/AAAA, rechaza todo IP no global o especial y conecta a la misma IP validada, sin resolver de nuevo. `nftables` limita el contenedor al proxy y bloquea metadata/link-local, CIDRs VCN/peering, loopback, RFC1918, CGNAT, ULA IPv6, DNS alternativo y UDP de bypass. El proxy solo puede abrir TCP 80/443 a destinos globales y consultar el resolver controlado. Caída del proxy = sin salida, no fallback. Pruebas deben demostrar que Chromium no puede saltárselo.
- **Carga POC:** worker y Sandbox con concurrencia 1. Se medirá CPU/RAM/cold start antes de aumentar; los valores no son sizing de producción. Deadline Sandbox sigue 25 s; timeout API 30 s.

## 2. Alcance y no objetivos

Incluye builds ARM64, configuración privada, una ruta de análisis sintética, verificación de TLS/SSRF, límites de requests, captura WebP de fixture, `SIGTERM` básico y limpieza final de recursos. Construir imágenes con dependencias fijadas fuera de la VM Sandbox y transferirlas mediante mecanismo de operación privado validado; no permitir que Docker/Chromium descargue dependencias durante un análisis. El mecanismo de transferencia/update será gate antes de implementación.

No incluye usuarios reales, URLs arbitrarias públicas, datos personales, tiendas móviles, proveedores de reputación, disponibilidad productiva, DR, backups/PITR administrados, Atlas, firewall de egress administrado, SLA, balanceo, migración de usuarios ni aprobación de OCI para producción. Capturas y bases se destruyen al terminar la POC tras exportar solo evidencia sintética aprobada.

Una VM A1 de 2 OCPU/12 GiB queda como alternativa de smoke ARM64/packaging únicamente; no satisface el objetivo de aislamiento API↔Sandbox por compartir host. No se elige esa topología como POC de seguridad.

## 3. Límite de seguridad explícito

La POC de dos VM demuestra reglas VCN entre workloads más firewall/proxy del host. **No demuestra** la frontera de un firewall administrado OCI. Las reglas VCN no se aplican a `169.254.0.0/16`, el NAT Gateway permite conexiones de salida pero no filtra destinos, y OCI Network Firewall requiere cuenta pagada y cuesta US$2.75 por instancia-hora. Se detiene la POC si el objetivo requiere enforcement cloud administrado sin presupuesto aprobado.

Código Sandbox actual valida DNS antes de `route.continue()`, pero Chromium vuelve a resolver al conectar: hay riesgo TOCTOU/DNS rebinding. Por tanto, la prueba cloud no puede empezar como “segura” hasta que el diseño e implementación del enforcement pinnen IP o deleguen la conexión a un proxy que resuelva, valide y conecte a la misma IP. La aplicación por sí sola no cierra esta brecha.

## 4. Datos sintéticos y secretos

- Crear cuentas de fixture sin datos personales y usar dominios reservados de prueba (`.test`) o un servidor-fixture controlado; no navegar URLs reales aportadas por usuarios.
- No copiar secretos personales ni tokens de producción. Token API→Sandbox y clave de cifrado serán aleatorios, de alcance y vida limitados, con eliminación posterior.
- No asignar identidad OCI dinámica/permisos IAM a la VM Sandbox. Desactivar IMDSv1 si la imagen lo soporta y bloquear metadata en el firewall del host/contenedor; comprobar el bloqueo con una fixture de red segura, sin consultar el endpoint metadata real.
- Sin persistencia de datos reales. Cifrado TLS para servicios privados; Mongo replica set de un nodo permite validar transacciones, no disponibilidad/HA.
- Guardar solo logs allowlist redactados, métricas agregadas y capturas sintéticas; ejecutar purga/cierre de almacenamiento antes de terminar.

## 5. Plan de prueba y gates

1. **Preflight sin aprovisionar:** confirmar tenancy/eligibilidad, región home exacta, capacidad A1, compatibilidad ARM64, costo y alcance de NAT/Bastion/IP/almacenamiento, método de apagado/eliminación y límite total de gasto. No continuar ante costo desconocido o ruta de cuenta pagada.
2. **Imagen:** construir imágenes Linux ARM64 reproducibles; arrancar Chromium headless con sandbox habilitado y usuario no-root. Fallo de `userns`/seccomp o degradación a `--no-sandbox` cancela el gate.
3. **Red privada:** validar NSG desde hosts de prueba: API alcanza Sandbox; API conecta a MongoDB en loopback; Sandbox no puede iniciar conexiones nuevas a API/MongoDB, otras subredes ni destinos canario de metadata/loopback/link-local. Permitir solo respuestas stateful a solicitudes API→Sandbox; servicios no tienen ingreso público.
4. **Egreso y DNS:** resolver A/AAAA controlado; rechazar mezclas público/privado; verificar que el proxy conecta a la misma IP que validó; comprobar que Chromium solo accede al proxy; bloquear conexión directa, DNS alternativo, IPv6, UDP/QUIC/WebRTC y acceso a metadata; tumbar proxy y comprobar que no hay fallback.
5. **Flujo del producto:** registro sintético, análisis, estado terminal, historial, límite 256 HTTP/WebSocket, TLS inválido y `inconclusive` sin veredicto/captura cuando aplica. API→Sandbox usa TLS válido en la red privada; no habilitar el proxy API de capturas al cliente.
6. **Recursos/resiliencia:** medir RAM/CPU/cold-start y deadline 25/30 s con concurrencia 1; probar shutdown/recovery de job; restaurar dump lógico en DB de prueba y comprobar las colecciones/índices requeridos. No inferir RPO/RTO productivos.
7. **Operación:** no abrir SSH ni puerto de aplicación a Internet. Probar túnel de operador privado, transferencia de imágenes y actualización bajo ventana de mantenimiento con Sandbox detenido; estas rutas no amplían el egress del namespace de análisis.
8. **Cierre:** confirmar ausencia de servicios públicos, pausar workloads, borrar manualmente solo recursos de la POC tras autorización, verificar que no quedan recursos facturables ni capturas/datos sintéticos.

Los pasos 1 y 7 exigen autorización separada antes de crear o eliminar recursos cloud. Este documento no ejecuta los pasos.

## 6. Criterios de aceptación

- Dos VM ARM64, si capacidad gratuita existe; sin recursos de pago ni cobro no aprobado.
- API, Mongo y Sandbox no aceptan ingreso público; la matriz de tráfico privado coincide con el mínimo descrito.
- No hay camino de egress directo desde Chromium, ni bypass al proxy/DNS controlado; el proxy falla cerrado.
- NSG stateful permite respuestas a solicitudes API→Sandbox y deniega conexiones nuevas iniciadas desde Sandbox hacia API/MongoDB.
- Prueba DNS rebinding usa un resolver y servidores-fixture sintéticos y demuestra que el socket conecta exclusivamente a la IP validada; ningún destino privado/link-local llega al servicio canario.
- Chromium con sandbox activo pasa smoke ARM64; ninguna mitigación de seguridad se relaja para conseguir un build.
- Flujo sintético respeta contratos API, request budget, TLS, deadline, captura WebP y logs redactados.
- Evidencia incluye commit/branch de origen (si se aprueba commit aparte), imágenes/digests, configuración de reglas, comandos, logs redactados, métricas, costos observados y cleanup. Ninguna evidencia se etiqueta “producción”.

Si cualquier gate de red, DNS, firewall, disponibilidad de capacidad o costo no se puede demostrar, registrar el resultado como **fallo/no verificado**, detener el flujo correspondiente y continuar localmente. No degradar el modelo de seguridad.

## 7. Decisiones abiertas antes de implementación

- Región home de la cuenta y disponibilidad real de dos A1 en `mx-queretaro-1` u otra región de México.
- Precio/eligibilidad real de NAT, Bastion, IPs y otros servicios auxiliares; “Always Free” de cómputo no prueba costo cero del conjunto.
- Implementación seleccionada para proxy/IP pinning, aislamiento de network namespace y reglas `nftables`; revisar amenazas de proxy y resolver antes de código.
- `ANALYSIS_JOB_MAX_PENDING` de la POC y mecanismo seguro para acceso de operador.
- Presupuesto total aprobado, vencimiento de POC, ventana de ejecución y autorización explícita de creación/eliminación de recursos.
- Si el propietario acepta que el objetivo solo es host-level enforcement sintético y no cloud-managed egress.

## 8. Fuentes y evidencia

Fuentes oficiales verificadas el 2026-11-04; confirmar otra vez en la cuenta antes de planear costos:

- [OCI Always Free: A1, 200 GB volumen, home region y reclamación por bajo uso](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)
- [OCI Security Rules: 169.254.0.0/16 no pasa por security rules](https://docs.oracle.com/en-us/iaas/Content/Network/Concepts/securityrules.htm)
- [OCI NAT Gateway: acceso saliente privado, no ingress desde Internet](https://docs.oracle.com/en-us/iaas/Content/Network/Tasks/NATgateway.htm)
- [OCI Network Firewall: US$2.75/h, requiere cuenta pagada](https://www.oracle.com/cloud/networking/network-firewall/cost-estimator/)
- [Playwright: plataformas soportadas](https://playwright.dev/docs/intro)
- Contratos y estado del proyecto: `docs/security/network-boundary-contract.md`, `docs/security/production-threat-model.md`, `docs/roadmap/production-readiness.md` y `docs/architecture/free-cloud-poc-options.md`.
