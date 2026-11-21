# Guion preliminar del video — EnlaceSeguro

**Duración objetivo:** entre 3 y 5 minutos. Grabar en horizontal a 1080p, con audio claro. Subir a Drive y comprobar que el profesor tenga acceso. El video aún no está grabado.

## 0:00–0:40 — Presentación

- Mostrar a Arturo Yion Jaime y Carlos Rafael Ruiz Ruiz. Cada integrante dice su nombre y explica su participación real.
- Presentar EnlaceSeguro y el problema: enlaces sospechosos recibidos por mensajes y dificultad para evaluar su destino antes de abrirlos.

## 0:40–1:35 — Arquitectura y seguridad

- Mostrar el diagrama actualizado: app móvil, API y worker, MongoDB, Sandbox con Chromium y consulta opcional a VirusTotal.
- Mencionar React Native/Expo, TypeScript, Fastify, MongoDB, Playwright y Docker.
- Explicar autenticación, hash bcrypt, protección de rutas y validación de destinos. Aclarar que las consultas externas se limitan a URLs de prueba autorizadas.
- Aclarar que la demo local usa HTTP y no demuestra aislamiento productivo.

## 1:35–3:15 — Demostración en tiempo real

- Mostrar entorno y conexión de los componentes, sin enseñar archivos de configuración ni secretos.
- Con una cuenta exclusiva de prueba, iniciar sesión, analizar `https://example.com/`, mostrar resultado, cobertura de VirusTotal e historial. **Realizar solo cuando el flujo esté verificado.**
- Mostrar en terminal o herramienta API una petición sin token a `/api/v1/analyses` y su respuesta HTTP 401. No mostrar tokens de una sesión autenticada.
- Explicar que un 401 demuestra el rechazo de esa solicitud, no la ausencia de otras vulnerabilidades.

## 3:15–4:00 — Conclusión

- Resumir lo logrado y los cambios frente a la propuesta original.
- Explicar que «sin amenazas detectadas» no garantiza seguridad. Mencionar Android, HTTPS y aislamiento de red como pendientes cuando corresponda.
- Presentar como trabajo futuro las mejoras que no hayan sido completadas y verificadas.

## Antes de compartir

- Confirmar que ambos integrantes aparezcan en cámara y que su rol sea correcto.
- Revisar que ninguna captura contenga correo personal, contraseña, token, API key, URL privada o IP innecesaria.
- Comprobar video, audio, duración y permisos del enlace de Drive.
