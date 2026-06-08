# DJ Mixer Practice

Interfaz sencilla de DJ hecha con Vite + React para practicar con dos canales.

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

## Qué tiene

- Dos decks: canal A y canal B.
- Carga de archivos locales de audio: MP3, WAV, AIFF, FLAC, M4A u OGG según soporte del navegador.
- Carga de links de YouTube con el IFrame Player.
- Fader de volumen por canal.
- Crossfader A/B.
- Play, pausa, retroceso y avance.
- Jog wheel por deck con indicador visual: click en `-5` / `+5` o arrastra el disco hacia izquierda/derecha.
- Selector de salida `Pre-cue` para archivos locales cuando el navegador soporta `HTMLMediaElement.setSinkId`.
- Modo `Pre-cue` por deck local: duplica internamente el audio para que puedas escuchar en audifonos mientras la mezcla principal sigue obedeciendo al crossfader.
- Boton `Probar` para mandar un tono corto al dispositivo de salida seleccionado.

## Limitaciones importantes

- YouTube no permite usar tu cuenta Premium desde un reproductor embebido de una app local.
- YouTube tampoco permite elegir un dispositivo de salida por deck desde el iframe.
- La salida de audio separada funciona mejor con archivos locales de audio en Chrome o Edge usando `localhost`.
- Para preescuchar: elige tus audifonos/interfaz en `Salida pre-cue local`, pulsa `Probar`, activa `Pre-cue` y luego dale play al deck.
- La mezcla principal siempre sale por la salida predeterminada del navegador/sistema.
- Para que el navegador muestre nombres de dispositivos, puede pedir permiso de micrófono.
