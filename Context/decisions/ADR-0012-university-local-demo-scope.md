# ADR-0012: Alcance de demostración universitaria local

- **Estado:** Aprobado
- **Fecha:** 2026-11-04
- **Contexto:** El alcance cloud y de resiliencia previsto para producción excede las necesidades del proyecto universitario y el plazo disponible de cinco días.
- **Decisión:** Para la entrega académica se ejecutará EnlaceSeguro localmente, sin PaaS ni gasto mensual. Se conserva React Native/Expo, Fastify, MongoDB y Playwright. La demo incluye consola admin en navegador local, iOS en un iPhone físico con Expo Go y un APK Android compilado localmente; el APK no se probará en dispositivo. El flujo usa cuentas y URLs pegadas manualmente, sin compartir desde otras apps ni proveedores externos de reputación.
- **Residencia y alcance de datos:** La API, MongoDB, Sandbox y consola corren en la computadora local en México. El Sandbox realiza solicitudes salientes a los sitios públicos analizados; no se envían URLs a servicios de reputación. Usar solo URLs públicas y cuenta(s) de demostración, sin credenciales reutilizadas ni enlaces con secretos.
- **Consecuencias:** No son criterios de entrega la escala de 50 cuentas/250 análisis diarios, SLO, RPO/RTO, despliegue público, tienda móvil, infraestructura cloud, alta disponibilidad, E2E Android instalado ni pruebas de carga. Se mantienen pruebas locales de flujos principales, autenticación, propiedad de datos y SSRF; se completa una prueba real de iOS y se registra que Android queda sin validar en dispositivo.
- **Relación con ADR previos:** Este alcance reemplaza ADR-0011 para la entrega universitaria. ADR-0011 conserva valor como hipótesis futura, solo si el proyecto vuelve a buscar producción.
- **Límite de la decisión:** La app y el APK son de demostración local, no una publicación productiva. El build Android usa firma debug; la URL de API se debe configurar para la red local antes de usar los flujos que consultan el backend.

## Evidencia

- [Plan de demo local en cinco días](../../docs/roadmap/academic-demo.md)
- [Hoja de ruta de preparación productiva, diferida](../../docs/roadmap/production-readiness.md)
