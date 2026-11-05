# Diseño propuesto: purga independiente de capturas

**Estado:** retención inicial de 30 días y frecuencia diaria aprobadas por el propietario para el baseline, sujetas a revisión especializada de privacidad antes de producción. Existe comando local de purga; no hay scheduler ni almacenamiento cloud desplegado.

## Problema

Las capturas son archivos privados `captures/{attemptId}.webp` fuera de MongoDB. El TTL de `daily_analyses` no elimina estos archivos. Por ello, un historial expirado puede dejar capturas huérfanas indefinidamente. La referencia `local://` tampoco constituye una ruta pública para el móvil.

## Alternativas

1. **Barrido local con cutoff explícito (recomendado para el entorno actual).** Comando separado del servicio, con modo simulación por defecto. Solo considera archivos regulares cuyo nombre sea UUID canónico más `.webp`; ignora enlaces simbólicos y otros nombres. Selecciona por `mtime` anterior a un cutoff explícito y muestra conteos, no nombres/URLs. La ejecución destructiva requiere un flag específico y una ventana sin escrituras para evitar carreras con reintentos.
2. **Ciclo de vida de object storage administrado.** Mejor destino productivo tras elegir nube, identidad de servicio y bucket privado. Exige configurar reglas y probar borrado/restore en staging; todavía no hay proveedor ni infraestructura aprobados.
3. **Usar solo TTL de Mongo.** Rechazado: el monitor TTL no ve archivos del Sandbox.

## Contrato y gates de la alternativa 1

- El cutoff local es un plazo móvil de 30 × 24 horas medido desde `mtime`, separado del TTL de 366 días del historial. El propietario aprobó 30 días y frecuencia diaria como baseline; revisión de privacidad pendiente antes de datos reales.
- Antes del barrido destructivo: detener escrituras del Sandbox, hacer una corrida simulada, verificar base/cantidad esperada y respaldos según el entorno. No ejecutar sobre rutas arbitrarias ni seguir symlinks.
- Pruebas con directorio temporal: archivo vencido, reciente, UUID inválido, subdirectorio, symlink, error de permiso y corrida repetida. Comprobar que el barrido no toca otros archivos ni se conecta a Mongo.
- Después de elegir proveedor cloud, reemplazar o complementar con lifecycle del almacenamiento privado; demostrar el borrado efectivo y el tratamiento de referencias expiradas. El acceso a capturas desde el cliente sigue bloqueado hasta contar con API autenticada, comprobación de propiedad y aislamiento de red.

## Decisión pendiente

`sandbox/src/infrastructure/CapturePurge.ts` implementa el barrido de archivos locales. `npm run purge:captures` muestra conteos sin borrar; `npm run purge:captures -- --execute --writes-paused` borra tras la confirmación operativa explícita de que no hay escrituras. Los tests usan un directorio temporal y cubren simulación, borrado selectivo, symlinks, nombres inválidos, fecha reciente y repetición.

Falta integrar un scheduler diario en el entorno elegido, verificar ventana sin escrituras y probar la purga en staging. La revisión especializada de privacidad para México puede exigir otro plazo; este baseline no constituye dictamen legal ni habilita datos reales.
