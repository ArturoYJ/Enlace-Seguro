# Glosario

- **Patrón de acceso:** operación de lectura o escritura que guía el diseño de datos; las frecuencias anotadas deben tratarse como estimaciones del ejercicio, no como mediciones en producción.
- **Sandbox:** entorno aislado donde la propuesta ejecuta la visita automatizada para no abrir el enlace en el dispositivo del usuario.
- **SSRF:** riesgo de que una URL o redirección intente usar el servicio para acceder a recursos internos.
- **Veredicto:** categoría explicada del análisis (peligroso, sospechoso o sin amenazas detectadas, según la propuesta); no es una garantía absoluta.
- **Cliente móvil:** app React Native/Expo en `frontend/mobile/`; incluye onboarding, auth, análisis manual, historial, detalle y cuenta básicos. No equivale a todos los flujos Figma ni a una release nativa validada.
- **`processingStatus`:** estado de un intento (`received`, `processing`, `completed`, `failed`, entre otros del contrato). Que exista un estado en el enum/OpenAPI no significa que todas sus transiciones estén implementadas.
- **`sourceResults`:** resultados de señales o fuentes comunicados por un análisis. En el código actual provienen del sandbox/guardas; no equivalen a proveedores externos de reputación.
- **`screenshotRef`:** referencia opaca de una captura. En la implementación actual es `local://captures/...`; no es una URL pública ni una ruta autenticada de la API.
- **Cuota diaria:** máximo de cinco análisis admitidos por usuario y fecha local en `America/Mexico_City`; no es un limitador de tasa de login.
