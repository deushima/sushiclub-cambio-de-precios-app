# SUSHICLUB cambio de precios app

Web local para tomar una planilla mensual de precios, leer SVG exportados desde Figma con placeholders editables y generar un ZIP con versiones por local.

## Flujo

1. Subir el Excel mensual de precios.
2. Elegir la accion en la solapa de acciones.
3. Subir una carpeta con archivos SVG. Puede ser la carpeta `Salon` completa o una accion puntual.
4. Revisar locales, plantillas y placeholders detectados.
5. Exportar ZIP.

## Plantillas por accion

- `GENERAL` se replica para todos los locales de la accion.
- `Menu Club Ejecutivo` usa `BAHIA BLANCA` como excepcion.
- `2 Tiempos` usa `PILAR` y `URQUIZA` como excepciones.
- `3 Tiempos` y `3 Tiempos Plant-Based` usan una sola plantilla general.

## Placeholders SVG

- `$$$$` se reemplaza por el precio normal.
- `@@@@` se reemplaza por el precio Eminent.

La app modifica solo nodos `<text>` o `<tspan>` que sean placeholders completos.
