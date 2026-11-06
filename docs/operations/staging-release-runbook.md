# Runbook base: despliegue y rollback en staging

**Estado:** plantilla cloud-neutral; no se ha desplegado ni ensayado en staging. Completar procedimientos y comandos específicos al aprobar proveedor/región.

## Antes de desplegar

- Confirmar G0: capacidad/SLO/RPO/RTO, presupuesto, egress y localización aprobados. Verificar que el despliegue es staging y solo usa cuentas, URLs y datos sintéticos.
- Validar CI y artefactos reproducibles de API, worker, Sandbox, consola admin y cliente móvil; registrar commit y versiones de imágenes/dependencias.
- Confirmar red privada API↔Mongo↔Sandbox. Sandbox no debe ser público ni tener una ruta de salida directa; egress debe pasar por control fail-closed independiente. Sin esa evidencia, no habilitar capturas.
- Verificar TLS, secretos administrados, identidad/roles mínimos, CORS de staging, logging redactado, health checks, retención y política de purga.
- Crear backup/restore point de prueba y verificar que puede restaurarse a un entorno separado antes de migrar.

## Secuencia de despliegue

1. Preparar base staging desechable/aislada y confirmar host, nombre de DB y réplica writable; nunca apuntar runners a una base persistente.
2. Aplicar migraciones aprobadas en orden, registrar resultado y verificar validadores, índices, `analysis_queue_capacity`, retención y readiness del API. Las migraciones son forward-only: no editar ni revertir las ya aplicadas.
3. Desplegar proxy/controles de egress y Sandbox. Ejecutar pruebas sintéticas de DNS privado/rebinding, proxy/DNS fuera de servicio, TLS y recursos secundarios; confirmar denegación, cero llegada al canary y ausencia de captura/veredicto ante fallo.
4. Desplegar API y worker; validar autenticación, rate limit, cuota, admisión, health, logs sin URL/token, cola y recuperación tras reinicio. Mantener desactivado el proxy de capturas hasta aceptar la red privada.
5. Desplegar consola y cliente de staging solo con orígenes aprobados; ejecutar flujos E2E de auth, análisis completo/inconcluso/fallido, historial, cuota, logout, métricas y auditoría.
6. Ejecutar carga y degradación según el perfil G0 aprobado; probar backup/restore, purga de capturas, alertas, runbooks y rollback. Registrar resultados y fallos abiertos.

## Rollback seguro

1. Detener admisiones de staging; drenar jobs activos o esperar lease/recovery documentados. No borrar ni editar jobs/contadores directamente.
2. Volver a la imagen anterior solo si es compatible con el esquema ya migrado; conservar base y capturas para análisis.
3. Si existe incompatibilidad, aplicar corrección forward-only. Restaurar snapshot a una base aislada únicamente como prueba; no reemplazar la base original ni perder writes sin autorización explícita.
4. Verificar readiness, auth, cola, análisis sintético, logs y controles de egress antes de reabrir el entorno.

## Evidencia para aceptar staging

Registrar commit/imágenes, configuración no secreta, versión de migración, resultados E2E y de seguridad, carga/latencia, restore, purga, métricas/alertas, prueba de rollback, responsables y defectos restantes. Las pruebas locales, mocks o redes Docker no sustituyen esta evidencia.

**Límite:** este runbook guía preparación; no autoriza infraestructura, gasto, datos reales ni lanzamiento productivo. La secuencia y rollback deben adaptarse al proveedor elegido y revisarse antes de operar.
