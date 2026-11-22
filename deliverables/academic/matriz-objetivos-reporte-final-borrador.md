# EnlaceSeguro — matriz preliminar de objetivos

**Estado:** borrador para el reporte final. Comparación con la propuesta U2; los estados deben revisarse con el equipo y actualizarse tras el ensayo final. Las referencias técnicas no sustituyen capturas ni una demostración.

| Objetivo original | Estado preliminar | Alcance y evidencia |
| --- | --- | --- |
| **General:** prototipo móvil con API, fuentes de reputación y vista previa en sandboxes aislados. | Parcial | Existe una demo local móvil/API/Sandbox. VirusTotal se conectó y una consulta directa a `example.com` devolvió cero detecciones, sin garantizar seguridad. El recorrido completo móvil con VirusTotal está pendiente de confirmación; el aislamiento productivo no está acreditado. |
| **1.** Requisitos, flujo, modelo de datos y amenazas, incluido SSRF. | Parcial | Hay modelo, documentación de flujo y análisis de amenazas. Falta consolidar su correspondencia con la configuración final y evidencias de seguridad. |
| **2.** API con registro, bcrypt, JWT, validación e historial en PostgreSQL. | Parcial, con cambio tecnológico | API Fastify con bcrypt y JWT; el proyecto usa **MongoDB**, no PostgreSQL. Documentar pruebas y la justificación del cambio. |
| **3.** Tres servicios sandbox Docker con Playwright/Chromium, emulación móvil, límites y bloqueo de destinos internos/descargas. | Parcial, con cambio de arquitectura | La demo local inicia un servicio Node con un navegador compartido y contextos por análisis; no son tres contenedores. El viewport configurado es de escritorio. Hay límites y validación de destinos; el aislamiento local no está demostrado de forma integral. |
| **4.** VirusTotal, Google Safe Browsing, URLhaus y señales de dominio/comportamiento. | Parcial | VirusTotal es opcional, restringido a URLs de prueba autorizadas y se probó directamente con una URL. No se deben afirmar integraciones de Google Safe Browsing, URLhaus ni consultas RDAP/WHOIS. El resultado completo móvil está pendiente de confirmación. |
| **5.** App Flutter con registro, análisis, resultado e historial. | Parcial, con cambio tecnológico | La app usa **React Native y Expo**, no Flutter. Hay recorrido previo reportado en iPhone; el ensayo actual debe confirmarse. Android en dispositivo sigue pendiente. |
| **6.** Pruebas funcionales y de seguridad: autenticación, entradas, límites, aislamiento y bloqueo de destinos internos y descargas. | Parcial | Hay unitarias y pruebas sintéticas Chromium/egress; se comprobó HTTP 401 sin credenciales en API y Sandbox. Esas pruebas no acreditan aislamiento productivo ni una auditoría completa. Ver [evidencia local](../evidence/2026-11-20-controles-y-pruebas-locales.md). |

## Aspectos que deben constar en el reporte

- Un resultado sin amenazas detectadas no garantiza que la URL sea segura.
- HTTP local transmite credenciales y URLs sin cifrar; utilizar solo una red y cuentas de prueba.
- La Public API de VirusTotal tiene límites y restricciones. La consulta puede compartir el indicador con el proveedor; confirmar aplicabilidad de sus términos y tratamiento de la caché antes de ampliar su uso.
- El usuario confirmó la licencia MIT para el código propio. La licencia de Expo y otras licencias de terceros se conservan.
- No atribuir pruebas, capturas, plataformas o proveedores no verificados.
