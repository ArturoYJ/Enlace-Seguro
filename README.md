# EnlaceSeguro

EnlaceSeguro es un proyecto académico para explorar el análisis de enlaces sospechosos. Su objetivo es que cualquier persona pueda clonar el código, ejecutar los servicios en su propia computadora y probar la aplicación desde un teléfono conectado a la misma red. No es un servicio comercial ni está preparado para producción.

La app móvil se comunica con una API y su worker; estos usan MongoDB y un Sandbox con navegador para procesar los análisis. La consola administrativa es opcional para recorrer la app. Un resultado sin amenazas detectadas **no garantiza que un enlace sea seguro**.

## Antes de empezar

- Una computadora con Git, Node.js 22.13 o superior, npm y Docker con el complemento Docker Compose. Docker Desktop debe estar iniciado.
- Google Chrome instalado en macOS en `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`, ruta configurada en el ejemplo del Sandbox. Si tu instalación es distinta, revisa `CHROME_EXECUTABLE_PATH` en `sandbox/.env.local` antes de arrancar.
- Un teléfono y la computadora en la misma red privada de confianza. Para el recorrido iPhone documentado, instala Expo Go compatible con Expo SDK 58.
- Terminales disponibles para los servicios. La computadora debe permanecer encendida mientras uses la app.
- `lsof` disponible en la terminal. `migrate` y `reset` lo usan para comprobar si la API escucha en el puerto 3000; si no está instalado, esa comprobación no es fiable. Compruébalo con `command -v lsof` y, si no aparece una ruta, detente antes de ejecutar esos scripts.

El procedimiento se documentó y probó previamente en macOS. Windows con Git Bash tiene ajustes en los scripts (ver abajo) pero falta el recorrido completo en un equipo; Linux **no está verificado**. `configure` detecta automáticamente la IP Wi-Fi con un comando de macOS, pero también acepta una IPv4 LAN proporcionada manualmente. La ruta de Chrome del ejemplo es específica de macOS y los scripts usan Bash, `lsof` y herramientas Unix; proporcionar una IP manual no demuestra compatibilidad con otro sistema. La compatibilidad de Chrome, Bash y demás requisitos en otros sistemas requiere validación.

### En Windows

Usa **Git Bash** (viene con Git for Windows), no PowerShell ni CMD: los scripts de `scripts/local` son de Bash. Al clonar, desactiva la conversión de saltos de línea para que los scripts no se rompan:

```sh
git clone -c core.autocrlf=false https://github.com/ArturoYJ/Enlace-Seguro.git
```

Diferencias con macOS:

- `configure` busca la IP de la red local entre las interfaces y descarta las virtuales (Docker, WSL, Hyper-V). Si encuentra varias o ninguna, pásala a mano: `scripts/local/configure 192.168.1.50`. La puedes ver con `ipconfig` en el adaptador Wi-Fi.
- El Sandbox usa Google Chrome si está instalado en la ruta normal. Si no lo encuentra, `configure` lo avisa; en ese caso corre `cd sandbox && npx playwright install chromium`.
- `migrate` y `reset` comprueban que la API esté detenida con una conexión al puerto 3000 hecha con Node, porque Git Bash no trae `lsof`.
- La primera vez que arranques la API, Windows preguntará si permite a Node.js en la red. Permite solo **redes privadas**; sin eso el teléfono no llega al puerto 3000.

> **Seguridad:** la API usa HTTP en la red local: contraseñas y URLs viajan sin cifrar. Usa solo una red de confianza y cuentas y contraseñas exclusivas para pruebas. No introduzcas datos personales, tokens ni enlaces secretos. El Sandbox local no tiene aislamiento de red productivo verificado; analiza solo páginas públicas conocidas y no lo expongas a otros equipos.

## 1. Clonar e instalar

La demo descrita aquí está en la rama `feature/local-demo-delivery`. Desde la terminal:

```sh
git clone --branch feature/local-demo-delivery https://github.com/ArturoYJ/Enlace-Seguro.git
cd Enlace-Seguro
npm ci --prefix api
npm ci --prefix sandbox
npm ci --prefix frontend/mobile
npm ci --prefix frontend/admin-console
```

La consola admin es opcional para usar el teléfono, pero sus dependencias se incluyen para seguir la guía completa. La instalación requiere acceso a Internet y descarga dependencias. La rama predeterminada puede no contener esta demo; no se verificó el estado remoto durante la última revisión documental.

## 2. Preparar la configuración y la base de datos

Con Docker iniciado, comprueba primero si ya tienes otra instalación local de EnlaceSeguro o un servicio usando el puerto 27017. **Un clon o worktree separado no aísla automáticamente Docker:** los scripts usan por defecto el proyecto Compose `enlaceseguro-local` y su volumen persistente; `up` puede reutilizarlos y `down` puede detener sus contenedores. No ejecutes la preparación sobre una instalación ajena o con datos que deban preservarse. El nombre de proyecto y el volumen no aíslan el puerto 27017; solo una instalación puede ocuparlo a la vez.

Para una instalación nueva, desde la raíz del repositorio:

```sh
scripts/local/up
scripts/local/configure
scripts/local/migrate
scripts/local/seed-admin
```

Si no se detecta la IP Wi-Fi en macOS, ejecuta `scripts/local/configure TU_IPV4_LAN` con la dirección de tu computadora, no la del teléfono. El comando crea cuatro archivos `.env.local` con secretos y **rechaza ejecutarse si ya existe cualquiera de ellos**; no los sobrescribas ni los compartas.

`migrate` está destinado a la primera preparación: requiere API detenida y una base `enlaceseguro_dev` vacía. Si indica que la base no está vacía o existe un estado parcial, detente y revisa el [procedimiento local](docs/operations/local-demo-runbook.md); no borres datos para continuar. `seed-admin` crea o verifica la cuenta administrativa; sus credenciales quedan en `api/.env.admin.local`. La cuenta para el teléfono se registra desde la app.

## 3. Iniciar servicios

Desde la raíz, abre una terminal por comando y mantenlas abiertas:

```sh
scripts/local/sandbox
```

```sh
scripts/local/api
```

```sh
scripts/local/admin
```

La API inicia también el worker. La consola opcional se abre en `http://localhost:5173/` en la computadora; usa `localhost`, no `127.0.0.1`, por la configuración CORS. Las credenciales admin están en `api/.env.admin.local`: consúltalas solo localmente y no las compartas.

En otra terminal inicia la aplicación:

```sh
cd frontend/mobile
npm run start -- --lan --port 8082
```

En iPhone, abre Expo Go y escanea el QR con ambos equipos en la misma Wi-Fi. El procedimiento previo requirió iniciar sesión con la misma cuenta Expo en Expo Go y Expo CLI. Registra una cuenta de prueba, inicia sesión, analiza una página pública conocida y consulta el historial. El resultado refleja las señales observadas, no una garantía de seguridad.

**Android:** existe evidencia histórica de compilación APK, pero no de instalación o prueba en dispositivo. La apertura y el recorrido en Android, incluido Expo Go, requieren validación; no se presenta un APK actual como verificado.

## 4. Si cambia la red o falla la conexión

`frontend/mobile/.env.local` contiene `EXPO_PUBLIC_API_URL=http://IP-DE-LA-COMPUTADORA:3000/api/v1`. Si cambia la IP, actualiza solo esa línea y reinicia Metro. No uses `localhost` para llegar a la computadora desde el teléfono. Comprueba que ambos equipos estén en la misma red y revisa firewall y puertos; una respuesta desde la computadora no demuestra acceso desde el teléfono. Consulta el [runbook](docs/operations/local-demo-runbook.md) para diagnóstico y límites adicionales.

## 5. Detener sin borrar datos

Detén con `Ctrl+C` las terminales de Metro, consola, API/worker y Sandbox que hayas iniciado. Después, desde la raíz:

```sh
scripts/local/down
```

Esto detiene MongoDB del proyecto y conserva su volumen. **No ejecutes `scripts/local/reset --confirm` salvo que quieras borrar sus cuentas y análisis.** La preparación inicial y las migraciones no deben repetirse automáticamente en una base existente.

## Estado y pendientes

La evidencia incluye un recorrido confirmado por el usuario en iPhone y una prueba de expiración inducida del token; no sustituye una prueba desde un clon limpio ni una espera de expiración natural. Siguen pendientes la validación Android en dispositivo, QA visual y accesibilidad restante, y portabilidad fuera de macOS.

## Licencia

El código propio de EnlaceSeguro se distribuye bajo la [licencia MIT](LICENSE). Los componentes de terceros conservan sus respectivas licencias y avisos, incluido el [aviso de Expo](frontend/mobile/LICENSE).

Consulta [demo académica](docs/roadmap/academic-demo.md), [runbook local](docs/operations/local-demo-runbook.md), [frontend](frontend/README.md), [API](api/README.md), [base de datos](database/README.md) y [pruebas](tests/README.md). La guía de trabajo del proyecto está en [Agents/README.md](Agents/README.md).
