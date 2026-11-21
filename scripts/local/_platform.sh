# Funciones comunes de los scripts locales. Se carga con `source` después de definir `root`.
# En macOS y Linux no cambia nada; los ajustes solo se activan en Git Bash de Windows.

# Git Bash (MSYS) convierte por su cuenta argumentos que parecen rutas Unix, como /tmp/...,
# en rutas de Windows antes de pasarlos a docker.exe. Eso rompe los comandos que se ejecutan
# dentro del contenedor. Se desactiva esa conversión y la raíz se expresa como C:/... para que
# Docker y Node la entiendan.
if command -v cygpath >/dev/null 2>&1; then
  root="$(cygpath -m "$root")"
  export MSYS_NO_PATHCONV=1
fi

# Variables que Node necesita en Windows aunque se lance con `env -i`.
platform_env=()
for var in SYSTEMROOT WINDIR TEMP TMP USERPROFILE; do
  if [[ -n "${!var:-}" ]]; then platform_env+=("$var=${!var}"); fi
done

# Estado del puerto 3000 de la API: 0 = alguien escucha, 1 = libre, 2 = no se pudo comprobar.
# Usa lsof si existe (macOS, Linux). Si no existe, como en Git Bash de Windows, intenta conectarse
# con Node: solo "conexión rechazada" cuenta como libre; cualquier otro error cuenta como no comprobado.
api_port_status() {
  if command -v lsof >/dev/null 2>&1; then
    local lsof_error status=0
    lsof_error="$(lsof -nP -iTCP:3000 -sTCP:LISTEN 2>&1 >/dev/null)" || status=$?
    if [[ $status -eq 0 ]]; then return 0; fi
    if [[ $status -eq 1 && -z "$lsof_error" ]]; then return 1; fi
    return 2
  fi
  local status=0
  node -e '
    const socket = require("node:net").connect({ host: "127.0.0.1", port: 3000 });
    socket.setTimeout(2000);
    socket.on("connect", () => { socket.destroy(); process.exit(0); });
    socket.on("timeout", () => { socket.destroy(); process.exit(2); });
    socket.on("error", (error) => process.exit(error.code === "ECONNREFUSED" ? 1 : 2));
  ' || status=$?
  return "$status"
}

# Detiene el script si la API sigue corriendo o si no se puede comprobar.
require_api_stopped() {
  local action="$1" status=0
  api_port_status || status=$?
  if [[ $status -eq 0 ]]; then
    echo "Stop the local API and worker before $action." >&2
    exit 1
  fi
  if [[ $status -ne 1 ]]; then
    echo 'Cannot verify whether the API is running: lsof failed or is unavailable.' >&2
    exit 1
  fi
}
