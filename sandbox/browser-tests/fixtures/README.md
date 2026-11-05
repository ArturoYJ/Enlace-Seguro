# Certificado de prueba

`localhost.cert.pem` y su clave privada son un fixture de test deliberadamente autofirmado, generado para `127.0.0.1`/`localhost`. Solo deben usarse en pruebas locales: `sandbox/browser-tests/tls.browser.ts` demuestra que Chromium rechaza certificados no confiables y `api/tests/unit/infrastructure/HttpSandboxService.test.ts` comprueba que el cliente Node falla cerrado sin llegar al handler HTTPS. No instalar ni reutilizar esta clave en ningún servicio o despliegue.
