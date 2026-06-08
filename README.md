# DJ Mixer Practice

Interfaz sencilla de DJ hecha con Vite + React para practicar con archivos locales de audio.

## Correr

```bash
npm install
npm run dev
```

En PowerShell, si `npm` falla por execution policy, usa:

```bash
npm.cmd install
npm.cmd run dev
```

## Tutorial rapido

La app muestra el tutorial la primera vez y guarda en `localStorage` que ya lo viste. Puedes abrirlo otra vez con el boton `Tutorial`.

1. Abre la app en Chrome o Edge desde `localhost`.
2. Carga una cancion local en el canal A y otra en el canal B.
3. Deja el crossfader hacia A para que la mezcla principal escuche el canal A.
4. Haz click en `Detectar salidas`. El navegador puede pedir permiso de microfono para mostrar nombres de dispositivos.
5. En el canal B, elige tus audifonos o interfaz en `Salida pre-cue local`.
6. Pulsa `Probar`. Si escuchas el tono en audifonos, la salida esta bien asignada.
7. Activa `Pre-cue` en el canal B.
8. Dale `Play B` y prepara la entrada con el circulo, los botones `Retro` / `Avanza`, o la barra de tiempo.
9. Cuando estes listo, mueve el crossfader hacia B.

## Controles

- `Archivo local de audio`: carga MP3, WAV, AIFF, FLAC, M4A u OGG segun soporte del navegador.
- `Volumen canal`: volumen base del deck.
- `Crossfader`: mezcla entre A y B para la salida principal.
- `Pre-cue`: manda una copia del deck al dispositivo seleccionado, sin depender del crossfader.
- `Probar`: manda un tono corto al dispositivo de pre-cue seleccionado.
- `Tutorial`: vuelve a abrir el tutorial aunque ya lo hayas visto.
- Circulo del deck: click en `-5` / `+5` o arrastra izquierda/derecha para retroceder/avanzar.

## Notas

- La mezcla principal sale por la salida predeterminada del navegador/sistema.
- El pre-cue necesita que tus audifonos/interfaz aparezcan como una salida de audio separada en Windows.
- Si `Probar` no suena en audifonos, revisa el dispositivo elegido, la salida de Windows, el volumen del dispositivo y usa Chrome o Edge.
- YouTube fue retirado para mantener el mixer enfocado en archivos locales y pre-cue.
