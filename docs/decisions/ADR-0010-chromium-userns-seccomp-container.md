# ADR-0010: Chromium user namespaces bajo seccomp en el contenedor Sandbox

- **Estado:** Implementado y smoke local validado; runtime Linux/cloud aún pendiente.
- **Fecha:** 2026-11-04
- **Contexto:** La imagen no-root arrancaba con `chromiumSandbox: true`, pero el contenedor endurecido bajo seccomp predeterminado fallaba con `No usable sandbox`. El diagnóstico aislado mostró que `unshare --user` devolvía `Operation not permitted`; tras habilitar el perfil oficial de Playwright, Chromium requirió además `SYS_CHROOT` para su sandbox de proceso.
- **Alcance:** Permisos/seccomp del contenedor Sandbox. No elige proveedor de nube ni configura su firewall o red.

## Decisión

1. Mantener `chromiumSandbox: true` y ejecutar como usuario no-root.
2. Fijar el perfil seccomp oficial Playwright 1.64.1 en `sandbox/seccomp_profile.json`, comprobando SHA-256 en el smoke para forzar revisión al actualizarlo.
3. Mantener `--cap-drop=ALL` y añadir únicamente `SYS_CHROOT`; no habilitar `SYS_ADMIN`, `--no-sandbox`, perfiles LSM `unconfined` ni `--privileged`.
4. Verificar imagen read-only, `no-new-privileges`, tmpfs, sin red y endpoint health mediante `npm run test:container-hardening`.
5. Tratar este resultado como evidencia local. Repetir en staging con perfil seccomp/AppArmor, red y política de egress reales antes de certificar aislamiento.

## Evidencia y límites

Con seccomp predeterminado, el probe sintético `unshare --user --map-root-user` falló. Con perfil fijado y solo `SYS_CHROOT`, el contenedor inicia Chromium, alcanza `/health` 200 y el probe userns pasa; la suite completa conserva el sandbox. `tests/container-hardening-smoke.sh` reconstruye la imagen y asegura las opciones de runtime. Docker Desktop es ARM64; este smoke no demuestra comportamiento del runner Linux x86_64 ni del proveedor cloud, acceso de red controlado, restore o almacenamiento persistente.

Fuente del perfil: [Playwright v1.64.1 seccomp profile](https://github.com/microsoft/playwright/blob/v1.64.1/utils/docker/seccomp_profile.json), SHA-256 `cc3e61cabda6bbc1e53e54d27ba4d55a9d3be829b6dd1a596f4a7b31b1cc7849`.
