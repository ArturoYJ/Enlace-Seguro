# ADR-0009: Variantes de color móvil para contraste WCAG AA

- **Estado:** Implementada localmente; pendiente QA visual nativa y comparación en iOS/Android.
- **Fecha:** 2026-11-04
- **Contexto:** Revisión de M1/M5 encontró texto pequeño por debajo de contraste WCAG AA sobre superficies oscuras. `textMuted` (`#65758E`) variaba de 2.95:1 a 3.97:1; azul primario medido Figma (`#2F7BF5`) en usos como texto rendía 3.47:1–4.24:1 según la superficie, y el texto blanco sobre el CTA primario daba 3.98:1.
- **Alcance:** aplicación móvil React Native. Esto no modifica la paleta o consola admin.

## Decisión

1. Conservar `primary: #2F7BF5` como ancla Figma para iconografía, indicador/progreso y acentos no textuales.
2. Añadir `primaryText: #8BB6FF` para enlaces, acciones, etiquetas y texto de marca sobre superficies oscuras.
3. Cambiar `textMuted` a `#94A2B8`; jerarquía secundaria se conserva mediante tamaño/peso, no contraste insuficiente.
4. Usar `primaryAction: #2A6FD8` como fondo del botón primario con texto blanco; el estado presionado conserva `primaryPressed: #2467D4`.
5. Probar contraste de texto secundario, acciones, CTA y estados semánticos sobre background/surface/raised/input con umbral 4.5:1.

## Evidencia

Con cálculo WCAG de luminancia relativa, `textMuted` alcanza 7.19:1, 6.08:1, 5.34:1 y 6.53:1 en esos cuatro fondos; `primaryText`, 9.06:1, 7.66:1, 6.73:1 y 8.23:1. Texto blanco sobre `primaryAction` alcanza 4.81:1 y sobre `primaryPressed`, 5.30:1. Los colores de veredicto actuales (peligroso, sospechoso, sin amenazas detectadas) también superan 4.5:1 en esos fondos.

La suite `frontend/mobile/src/theme/__tests__/tokens.test.ts` recalcula estos ratios y falla ante regresión; `frontend/mobile/src/components/__tests__/NoticeDialog.test.tsx` verifica el color accesible en las acciones de diálogo info/warning. Suite móvil 51/51, lint, typecheck y export web/iOS/Android pasan localmente. Esto es QA estática de color; no prueba render de fuente, visión de color, dynamic type ni accesibilidad nativa. `primaryText`/`primaryAction` son variantes derivadas, no tokens exactos inspeccionados en Figma.
