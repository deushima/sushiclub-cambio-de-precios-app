# SUSHICLUB cambio de precios app

Web local para tomar una planilla mensual de precios, leer SVG exportados desde Figma con placeholders editables y generar un ZIP con versiones por local.

## Flujo

1. Subir el Excel mensual de precios.
2. Elegir producto o menu de la accion.
3. Subir una carpeta con archivos SVG.
4. Revisar locales y placeholders detectados.
5. Exportar ZIP.

## Placeholders SVG

- `$$$$` se reemplaza por el precio normal.
- `@@@@` se reemplaza por el precio Eminent.

La app modifica solo nodos `<text>` o `<tspan>` que sean placeholders completos.
