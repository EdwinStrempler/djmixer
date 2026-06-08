import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const SEEK_STEP = 5;
const TUTORIAL_STORAGE_KEY = 'dj-mixer-tutorial-seen';

function createToneUrl() {
  const sampleRate = 44100;
  const duration = 0.35;
  const samples = Math.floor(sampleRate * duration);
  const buffer = new ArrayBuffer(44 + samples * 2);
  const view = new DataView(buffer);

  function writeString(offset, value) {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  }

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + samples * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, samples * 2, true);

  for (let index = 0; index < samples; index += 1) {
    const fade = Math.min(index / 800, (samples - index) / 1200, 1);
    const sample = Math.sin((2 * Math.PI * 880 * index) / sampleRate) * fade * 0.35;
    view.setInt16(44 + index * 2, sample * 32767, true);
  }

  return URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }));
}

function getCrossGain(side, crossfader) {
  if (side === 'A') return crossfader <= 0 ? 1 : 1 - crossfader / 100;
  return crossfader >= 0 ? 1 : 1 + crossfader / 100;
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return '0:00';
  const safe = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(safe / 60);
  const secs = String(safe % 60).padStart(2, '0');
  return `${mins}:${secs}`;
}

function DevicePicker({ devices, value, onChange, onRefresh, onTest, disabled }) {
  return (
    <div className="device-row">
      <select value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled}>
        <option value="">Salida predeterminada</option>
        {devices.map((device) => (
          <option value={device.deviceId} key={device.deviceId}>
            {device.label || `Dispositivo ${device.deviceId.slice(0, 6)}`}
          </option>
        ))}
      </select>
      <button type="button" onClick={onRefresh} disabled={disabled} title="Actualizar dispositivos">
        Actualizar
      </button>
      <button type="button" onClick={onTest} disabled={disabled} title="Probar salida seleccionada">
        Probar
      </button>
    </div>
  );
}

function JogWheel({ side, onSeek }) {
  const startX = useRef(null);
  const flashTimer = useRef(null);
  const [direction, setDirection] = useState('');

  useEffect(() => {
    return () => window.clearTimeout(flashTimer.current);
  }, []);

  function triggerSeek(seconds) {
    window.clearTimeout(flashTimer.current);
    setDirection(seconds > 0 ? 'forward' : 'backward');
    onSeek(seconds);
    flashTimer.current = window.setTimeout(() => setDirection(''), 420);
  }

  function beginDrag(event) {
    startX.current = event.clientX;
  }

  function endDrag(event) {
    if (startX.current === null) return;
    const delta = event.clientX - startX.current;
    startX.current = null;
    if (Math.abs(delta) < 12) return;
    triggerSeek(delta > 0 ? SEEK_STEP : -SEEK_STEP);
  }

  return (
    <div
      className="jog"
      onPointerDown={beginDrag}
      onPointerUp={endDrag}
      onPointerCancel={() => {
        startX.current = null;
      }}
    >
      <button type="button" className="jog-button left" onClick={() => triggerSeek(-SEEK_STEP)} title="Retroceder 5s">
        -5
      </button>
      <div className={`disc ${direction}`} aria-label={`Jog wheel canal ${side}`}>
        <span>{side}</span>
        <strong aria-live="polite">{direction === 'forward' ? '+5s' : direction === 'backward' ? '-5s' : ''}</strong>
      </div>
      <button type="button" className="jog-button right" onClick={() => triggerSeek(SEEK_STEP)} title="Avanzar 5s">
        +5
      </button>
    </div>
  );
}

function Deck({
  side,
  crossfader,
  devices,
  refreshDevices,
  channelVolume,
  setChannelVolume,
  registerDeck,
}) {
  const audioRef = useRef(null);
  const cueAudioRef = useRef(null);
  const objectUrlRef = useRef('');
  const [loadedTitle, setLoadedTitle] = useState('Sin pista');
  const [status, setStatus] = useState('Carga un archivo de audio');
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [sinkId, setSinkId] = useState('');
  const [preCue, setPreCue] = useState(false);

  const mixVolume = useMemo(
    () => Math.round(channelVolume * getCrossGain(side, crossfader)),
    [channelVolume, crossfader, side],
  );
  const cueVolume = preCue ? channelVolume : 0;

  useEffect(() => {
    const audio = audioRef.current;
    const cueAudio = cueAudioRef.current;

    if (audio) {
      audio.volume = mixVolume / 100;
    }

    if (cueAudio) {
      cueAudio.volume = cueVolume / 100;
    }
  }, [cueVolume, mixVolume]);

  useEffect(() => {
    const audio = audioRef.current;
    const cueAudio = cueAudioRef.current;
    if (!audio || !cueAudio) return;

    cueAudio.currentTime = audio.currentTime || 0;
    if (preCue && !audio.paused) {
      cueAudio.play().catch(() => {
        setStatus('No se pudo iniciar pre-cue automaticamente');
      });
    }

    if (!preCue) {
      cueAudio.pause();
    }
  }, [preCue]);

  useEffect(() => {
    registerDeck(side, {
      play: () => handlePlay(),
      pause: () => handlePause(),
      seek: (seconds) => seekBy(seconds),
    });
  });

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, []);

  async function applySink(nextSinkId) {
    setSinkId(nextSinkId);
    const cueAudio = cueAudioRef.current;
    if (!cueAudio?.setSinkId) return;

    try {
      await cueAudio.setSinkId(nextSinkId);
      setStatus(nextSinkId ? 'Salida pre-cue asignada' : 'Pre-cue en salida predeterminada');
    } catch (error) {
      setStatus(`No se pudo cambiar salida: ${error.message}`);
    }
  }

  async function testSink() {
    const toneUrl = createToneUrl();
    const testAudio = new Audio(toneUrl);
    testAudio.volume = 0.7;

    try {
      if (testAudio.setSinkId) {
        await testAudio.setSinkId(sinkId);
      }

      await testAudio.play();
      setStatus(sinkId ? 'Prueba enviada a la salida seleccionada' : 'Prueba enviada a salida predeterminada');
      testAudio.onended = () => URL.revokeObjectURL(toneUrl);
    } catch (error) {
      URL.revokeObjectURL(toneUrl);
      setStatus(`No se pudo probar salida: ${error.message}`);
    }
  }

  function handleLocalFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    objectUrlRef.current = URL.createObjectURL(file);
    setLoadedTitle(file.name);
    setStatus('Archivo local listo');
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    audioRef.current.src = objectUrlRef.current;
    cueAudioRef.current.src = objectUrlRef.current;
    audioRef.current.load();
    cueAudioRef.current.load();
  }

  function handlePlay() {
    const audio = audioRef.current;
    const cueAudio = cueAudioRef.current;
    audio?.play();

    if (preCue && cueAudio && audio) {
      cueAudio.currentTime = audio.currentTime || 0;
      cueAudio.play().catch(() => {
        setStatus('No se pudo iniciar pre-cue automaticamente');
      });
    }
  }

  function handlePause() {
    audioRef.current?.pause();
    cueAudioRef.current?.pause();
  }

  function seekBy(seconds) {
    const audio = audioRef.current;
    if (!audio) return;
    const nextTime = Math.max(0, Math.min(audio.duration || 0, audio.currentTime + seconds));
    audio.currentTime = nextTime;
    if (cueAudioRef.current) {
      cueAudioRef.current.currentTime = nextTime;
    }
  }

  function onTimelineChange(event) {
    const next = Number(event.target.value);
    if (audioRef.current) {
      audioRef.current.currentTime = next;
      if (cueAudioRef.current) {
        cueAudioRef.current.currentTime = next;
      }
    }
    setCurrentTime(next);
  }

  return (
    <section className="deck">
      <div className="deck-header">
        <div>
          <p className="eyebrow">Canal {side}</p>
          <h2>{loadedTitle}</h2>
        </div>
        <span className={isPlaying ? 'badge active' : 'badge'}>{isPlaying ? 'PLAY' : 'PAUSA'}</span>
      </div>

      <div className="source-controls">
        <label>
          Archivo local de audio
          <input type="file" accept="audio/*,.mp3,.wav,.aiff,.aif,.flac,.m4a,.ogg" onChange={handleLocalFile} />
        </label>
      </div>

      <div className="player-frame">
        <div className="audio-placeholder visible-player">
          <div className="audio-bars" aria-hidden="true">
            <span />
            <span />
            <span />
            <span />
            <span />
            <span />
            <span />
            <span />
          </div>
          <p>Audio local</p>
        </div>
        <audio
          ref={audioRef}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
          onLoadedMetadata={(event) => setDuration(event.currentTarget.duration || 0)}
        />
        <audio ref={cueAudioRef} />
      </div>

      <div className="transport">
        <button type="button" onClick={isPlaying ? handlePause : handlePlay}>
          {isPlaying ? 'Pausa' : 'Play'}
        </button>
        <button type="button" onClick={() => seekBy(-SEEK_STEP)}>
          Retro
        </button>
        <button type="button" onClick={() => seekBy(SEEK_STEP)}>
          Avanza
        </button>
      </div>

      <JogWheel side={side} onSeek={seekBy} />

      <div className="timeline">
        <span>{formatTime(currentTime)}</span>
        <input
          type="range"
          min="0"
          max={Math.max(0, Math.floor(duration))}
          value={Math.min(Math.floor(currentTime), Math.max(0, Math.floor(duration)))}
          onChange={onTimelineChange}
        />
        <span>{formatTime(duration)}</span>
      </div>

      <label className="vertical-fader">
        <span>Volumen canal</span>
        <input
          type="range"
          min="0"
          max="100"
          value={channelVolume}
          onChange={(event) => setChannelVolume(Number(event.target.value))}
        />
        <strong>{mixVolume}% mix {preCue ? `/ ${cueVolume}% cue` : ''}</strong>
      </label>

      <div className="output-panel">
        <span>Salida pre-cue local</span>
        <label className="cue-toggle">
          <input
            type="checkbox"
            checked={preCue}
            onChange={(event) => setPreCue(event.target.checked)}
          />
          Pre-cue: ignora el crossfader
        </label>
        <DevicePicker
          devices={devices}
          value={sinkId}
          onChange={applySink}
          onRefresh={refreshDevices}
          onTest={testSink}
          disabled={!cueAudioRef.current?.setSinkId}
        />
      </div>

      <p className="status">{status}</p>
    </section>
  );
}

function Tutorial({ onClose }) {
  return (
    <div className="tutorial-overlay" role="dialog" aria-modal="true" aria-labelledby="tutorial-title">
      <section className="tutorial">
        <div className="tutorial-header">
          <h2 id="tutorial-title">Tutorial rapido</h2>
          <button type="button" onClick={onClose}>
            Entendido
          </button>
        </div>
        <ol>
          <li>Carga una cancion local en el canal A y otra en el canal B.</li>
          <li>Deja el crossfader hacia A para que la mezcla principal escuche el canal A.</li>
          <li>Haz click en Detectar salidas y acepta el permiso si el navegador lo pide.</li>
          <li>En el canal B elige tus audifonos en Salida pre-cue local y pulsa Probar.</li>
          <li>Activa Pre-cue en B, dale Play B y prepara la entrada con el circulo o la barra de tiempo.</li>
          <li>Cuando estes listo, mueve el crossfader hacia B para hacer la mezcla.</li>
        </ol>
        <p>
          La mezcla principal sale por el audio predeterminado de Windows. El pre-cue usa una segunda copia del deck
          local y la manda al dispositivo que elijas.
        </p>
      </section>
    </div>
  );
}

function App() {
  const [crossfader, setCrossfader] = useState(0);
  const [volumeA, setVolumeA] = useState(80);
  const [volumeB, setVolumeB] = useState(80);
  const [devices, setDevices] = useState([]);
  const [showTutorial, setShowTutorial] = useState(() => {
    return window.localStorage.getItem(TUTORIAL_STORAGE_KEY) !== 'true';
  });
  const deckApi = useRef({});

  async function refreshDevices() {
    try {
      if (!navigator.mediaDevices?.enumerateDevices) return;
      await navigator.mediaDevices.getUserMedia({ audio: true });
      const listed = await navigator.mediaDevices.enumerateDevices();
      setDevices(listed.filter((device) => device.kind === 'audiooutput'));
    } catch {
      const listed = await navigator.mediaDevices?.enumerateDevices?.();
      setDevices((listed || []).filter((device) => device.kind === 'audiooutput'));
    }
  }

  function registerDeck(side, api) {
    deckApi.current[side] = api;
  }

  function closeTutorial() {
    window.localStorage.setItem(TUTORIAL_STORAGE_KEY, 'true');
    setShowTutorial(false);
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Practice mixer</p>
          <h1>DJ Mixer</h1>
        </div>
        <div className="topbar-actions">
          <button type="button" onClick={() => setShowTutorial(true)}>
            Tutorial
          </button>
          <button type="button" onClick={refreshDevices}>
            Detectar salidas
          </button>
        </div>
      </header>

      <div className="notice">
        Solo archivos locales de audio. Para pre-cue usa Chrome o Edge, elige tus audifonos como salida y activa
        Pre-cue en el deck que quieres preparar.
      </div>

      {showTutorial && <Tutorial onClose={closeTutorial} />}

      <div className="mixer-layout">
        <Deck
          side="A"
          crossfader={crossfader}
          devices={devices}
          refreshDevices={refreshDevices}
          channelVolume={volumeA}
          setChannelVolume={setVolumeA}
          registerDeck={registerDeck}
        />

        <section className="center-mixer">
          <h2>Mezcla</h2>
          <label className="crossfader">
            <span>A</span>
            <input
              type="range"
              min="-100"
              max="100"
              value={crossfader}
              onChange={(event) => setCrossfader(Number(event.target.value))}
            />
            <span>B</span>
          </label>
          <div className="meter-row">
            <div>
              <span>A</span>
              <meter min="0" max="100" value={Math.round(volumeA * getCrossGain('A', crossfader))} />
            </div>
            <div>
              <span>B</span>
              <meter min="0" max="100" value={Math.round(volumeB * getCrossGain('B', crossfader))} />
            </div>
          </div>
          <div className="global-buttons">
            <button type="button" onClick={() => deckApi.current.A?.play?.()}>
              Play A
            </button>
            <button type="button" onClick={() => deckApi.current.B?.play?.()}>
              Play B
            </button>
            <button
              type="button"
              onClick={() => {
                deckApi.current.A?.pause?.();
                deckApi.current.B?.pause?.();
              }}
            >
              Pausar todo
            </button>
          </div>
        </section>

        <Deck
          side="B"
          crossfader={crossfader}
          devices={devices}
          refreshDevices={refreshDevices}
          channelVolume={volumeB}
          setChannelVolume={setVolumeB}
          registerDeck={registerDeck}
        />
      </div>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
