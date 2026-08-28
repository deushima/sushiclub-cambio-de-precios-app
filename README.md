# SUSHICLUB cambio de precios app

Web local para tomar una planilla mensual de precios, leer SVG exportados desde Figma con placeholders editables y generar un ZIP con versiones por local.

## Flujo

1. Subir el Excel mensual de precios.
2. Elegir la accion en la solapa de acciones.
3. Subir una carpeta con archivos SVG. Puede ser la carpeta `Salon` completa o una accion puntual.
4. Revisar locales, plantillas, placeholders detectados y la mini preview de pildoras.
5. Elegir el formato de descarga y usar `Descargar contenido`.

## Plantillas por accion

- `GENERAL` se replica para todos los locales de la accion.
- `Menu Club Ejecutivo` usa `BAHIA BLANCA` como excepcion.
- `2 Tiempos` usa `PILAR` y `URQUIZA` como excepciones.
- `3 Tiempos` y `3 Tiempos Plant-Based` usan una sola plantilla general.

La app decide la accion por nombre de carpeta, por ejemplo `2 Tiempos`, `3 Tiempos`, `3 Tiempos Plant-Based` o `Menu Club Ejecutivo`. Nunca decide precios por nombres internos de mesa, frame o archivo como `Story 1`, `Feed 6` o similares: todo `.svg` dentro de la carpeta correcta se procesa.

## Placeholders SVG

- `$$$$` se reemplaza por el precio normal.
- `@@@@` se reemplaza por el precio Eminent.

La app modifica solo nodos `<text>` o `<tspan>` que sean placeholders completos.

## Descarga

- `Solo PNG` es el modo predeterminado y baja solo las imagenes convertidas desde los SVG.
- `Solo SVG` genera un ZIP editable sin imagenes convertidas.
- `PNG + SVG` incluye ambas versiones.
- Los assets fijos ya renderizados se copian solo si se activa `Incluir PNG ya existentes`.
