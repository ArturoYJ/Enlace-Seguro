# Registro de fuentes

Este registro distingue las fuentes originales de las decisiones actuales y de la evidencia de implementación. No publicar los archivos académicos locales ni datos personales incluidos en ellos.

## proposal-local

- **Descripción:** propuesta académica original de EnlaceSeguro.
- **Disponibilidad:** solo en el workspace local; excluida de Git.
- **Uso:** propósito, problema y requisitos propuestos. El stack descrito allí (Flutter/Dart, PostgreSQL 16, tres servicios sandbox) es antecedente y no prueba la implementación ni reemplaza decisiones posteriores.

## context-local

- **Descripción:** notas históricas y traspaso de contexto del proyecto.
- **Disponibilidad:** `Context/context.md` en el repositorio.
- **Uso:** referencia histórica únicamente. Contiene estados, rutas y tecnologías que ya no describen el checkout actual; consultar primero `overview.md`, `requirements.md`, `architecture/system.json` y `architecture/auth-design.md`.

## access-patterns

- **Descripción:** tabla del ejercicio sobre patrones de acceso.
- **Disponibilidad:** [`../../database/modeling/access-patterns.csv`](../../database/modeling/access-patterns.csv).
- **Uso:** patrones P1–P7 y objetivo MongoDB del ejercicio. La elección vigente del stack local MongoDB se registra en `architecture/auth-design.md` y las decisiones asociadas.

## implementation-local

- **Descripción:** fuentes y pruebas versionadas en este checkout (`api/`, `sandbox/`, `database/`).
- **Disponibilidad:** rama local `develop`, conectada al remoto configurado como `origin`.
- **Uso:** fuente primaria para afirmar qué código existe. No equivale a despliegue productivo; las pruebas API y sandbox deben reportarse por separado y con sus resultados actuales.

## figma-reference

- **Descripción:** archivo de diseño Enlace-Seguro, compartido por el usuario.
- **Disponibilidad:** [Figma](https://www.figma.com/design/ekFR5DJ6fDbGUjO2OkcGHs/Enlace-Seguro?node-id=0-1).
- **Uso:** referencia de dirección visual, grupos de pantallas y estados. No acredita funciones ya implementadas. El usuario eligió replicar todos los grupos para la primera fase móvil.

## companion-frontend-reference

- **Descripción:** repositorio público de frontend del compañero.
- **Disponibilidad:** [Chafael/Enlace-Seguro_Frontend](https://github.com/Chafael/Enlace-Seguro_Frontend).
- **Uso:** comparación de decisiones y estructura. A fecha de revisión el repo usa Flutter/Dart y `lib/main.dart` aún contiene la pantalla contador de ejemplo; no es la fuente de la UI funcional. La dirección visual se toma del Figma, no se fusiona ese historial con `origin`.
