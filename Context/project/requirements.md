# Requisitos descritos en la propuesta

**Estado de todos los puntos:** propuestos; no verificados como implementados.

## Funcionales

1. Registrar e iniciar sesión para asociar análisis e historial con una cuenta.
2. Recibir un enlace o mensaje que contenga un enlace y enviarlo a la API.
3. Validar el enlace, aceptar solo HTTP/HTTPS y rechazar destinos locales/privados; volver a validar redirecciones.
4. Enviar el destino a un sandbox aislado para carga automatizada, observación de señales y captura.
5. Consultar fuentes de reputación externas cuando credenciales y cuotas estén disponibles.
6. Guardar el análisis y mostrar categoría, razones, destino final, fuentes consultadas y captura.
7. Consultar historial personal paginado y detalle de un análisis.

## Seguridad y límites

- El navegador de análisis debe usar contexto limpio, privilegios mínimos, permisos restringidos, bloqueo de descargas y límites de tiempo/recursos.
- Los sandboxes no deben tener acceso a la API, la base de datos ni otros sandboxes.
- Las llaves externas deben permanecer del lado del servidor.
- Un fallo de proveedor debe quedar visible como resultado parcial/no concluyente.
- “Sin amenazas detectadas” no debe presentarse como “seguro garantizado”.

## Preguntas abiertas

- ¿El motor final de la práctica de modelado es MongoDB o el almacenamiento del proyecto continúa siendo PostgreSQL?
- ¿Cuáles son los endpoints, política de cuota y esquema final? No se fijan aquí porque las fuentes no los definen de forma suficiente.
- ¿Qué funciones de la propuesta están realmente implementadas? Requiere inspección del código y pruebas.

**Fuente principal:** propuesta académica local (véase el [registro de fuentes](sources.md)); no está publicada en el repositorio. El alcance MongoDB procede de `database/modeling/access-patterns.csv` y se mantiene diferenciado.
