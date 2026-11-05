# Infraestructura local de EnlaceSeguro

La demo se ejecuta en la máquina del desarrollador. Docker hospeda únicamente MongoDB 8 como replica set local; API, worker, Sandbox, consola admin y Metro/Expo corren como procesos del host.

## Inicio y operación

- `scripts/local/up` — inicia MongoDB local.
- `scripts/local/configure` — prepara los `.env.local` ignorados por Git.
- `scripts/local/migrate` — aplica las migraciones de la base local.
- `scripts/local/api`, `scripts/local/sandbox`, `scripts/local/admin` — inicia cada servicio.
- `scripts/local/status` — muestra el estado del contenedor MongoDB local.
- `scripts/local/smoke` — ejecuta verificaciones integradas con fixtures y MongoDB desechable.
- `scripts/local/down` — detiene el contenedor de desarrollo.

Expo Go se inicia desde `frontend/mobile/` y se conecta a la API por la IP LAN del Mac. Consola admin y API usan los puertos locales indicados en [runbook](../docs/operations/local-demo-runbook.md).

Este stack no es un despliegue público ni prueba aislamiento de red productivo. La demo usa URLs públicas solo durante ensayo manual y no debe recibir secretos ni datos personales en enlaces.
