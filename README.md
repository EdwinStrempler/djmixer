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

La app muestra un tutorial por pasos la primera vez y guarda en `localStorage` que ya lo viste. Puedes abrirlo otra vez con el boton `Tutorial`.

1. Abre la app en Chrome o Edge desde `localhost`.
2. Carga una cancion local en el canal A y otra en el canal B.
3. Deja el crossfader hacia A para que la mezcla principal escuche el canal A.
4. Haz click en `Detectar salidas`. El navegador puede pedir permiso de microfono para mostrar nombres de dispositivos.
5. En el canal B, elige tus audifonos o interfaz en `Salida pre-cue local`.
6. Pulsa `Probar`. Si escuchas el tono en audifonos, la salida esta bien asignada.
7. Usa la pantalla central para ver ambas ondas moviendose hacia la linea central.
8. Revisa la pantalla del deck para ver el BPM detectado.
9. Usa `Set Cue` para guardar un punto y `Cue` para saltar a el.
10. Ajusta los faders verticales del cuadro central `Tempo / BPM` si quieres acelerar o bajar una pista.
11. Activa `Pre-cue` en el canal B.
12. Dale `Play` en el deck B y prepara la entrada con el circulo, los botones `Retro` / `Avanza`, o la barra de tiempo.
13. Cuando estes listo, mueve el crossfader hacia B o usa `Automix`.

## Controles

- `Archivo local de audio`: carga MP3, WAV, AIFF, FLAC, M4A u OGG segun soporte del navegador.
- `Volumen canal`: volumen base del deck.
- `Flanger`: efecto por canal para la salida principal. El pre-cue se mantiene seco.
- Pantalla del deck: muestra estado, BPM original, BPM actual y ajuste de tempo.
- Pantalla central de ondas: muestra ambas canciones con una linea fija al centro para comparar entradas.
- `Tempo / BPM`: cuadro central con fader vertical para canal A y canal B.
- `Reset`: vuelve el tempo del canal a `0.0%`.
- `Automix`: reproduce el otro canal, mueve el crossfader automaticamente y pausa el canal que salio de la mezcla.
- `Crossfader`: mezcla entre A y B para la salida principal.
- `Pre-cue`: manda una copia del deck al dispositivo seleccionado, sin depender del crossfader.
- `Probar`: manda un tono corto al dispositivo de pre-cue seleccionado.
- `Tutorial`: vuelve a abrir el tutorial aunque ya lo hayas visto.
- `Set Cue`: guarda el punto cue en la posicion actual. Al cargar una cancion, el cue inicia en `0:00`.
- `Cue`: salta al punto cue guardado sin importar si el deck esta pausado o reproduciendo.
- Circulo del deck: click en `-5` / `+5` o arrastra izquierda/derecha para mover la pista de forma continua. El ajuste de tempo afecta cuanto avanza o retrocede.
- Al cargar una cancion aparece una barra de precarga/analisis antes de mostrar BPM y onda.

## Notas

- La mezcla principal sale por la salida predeterminada del navegador/sistema.
- La deteccion de BPM es aproximada y se calcula en el navegador al cargar la cancion.
- Cambiar `Tempo / BPM` usa `playbackRate`, asi que tambien cambia el tono de la pista como en un pitch clasico.
- Las ondas se actualizan con `requestAnimationFrame` mientras reproduce para verse mas fluidas.
- El pre-cue necesita que tus audifonos/interfaz aparezcan como una salida de audio separada en Windows.
- Si `Probar` no suena en audifonos, revisa el dispositivo elegido, la salida de Windows, el volumen del dispositivo y usa Chrome o Edge.
- YouTube fue retirado para mantener el mixer enfocado en archivos locales y pre-cue.
- `public/robots.txt` bloquea crawlers de IA/SEO seleccionados y se publica como `https://strempler.com.mx/robots.txt`.
