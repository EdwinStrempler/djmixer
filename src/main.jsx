import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const SEEK_STEP = 5;

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

function parseYouTubeId(value) {
  if (!value.trim()) return '';

  try {
    const url = new URL(value.trim());
    if (url.hostname.includes('youtu.be')) return url.pathname.slice(1);
    if (url.searchParams.get('v')) return url.searchParams.get('v');
    const embedMatch = url.pathname.match(/\/(embed|shorts)\/([^/?]+)/);
    if (embedMatch) return embedMatch[2];
  } catch {
    return value.trim();
  }

  return value.trim();
}

function loadYouTubeApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT);

  return new Promise((resolve) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      resolve(window.YT);
    };

    if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
      const script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(script);
    }
  });
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
  const ytHostRef = useRef(null);
  const ytPlayerRef = useRef(null);
  const objectUrlRef = useRef('');
  const [sourceType, setSourceType] = useState('local');
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [loadedTitle, setLoadedTitle] = useState('Sin pista');
  const [status, setStatus] = useState('Carga un archivo o link');
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [sinkId, setSinkId] = useState('');
  const [preCue, setPreCue] = useState(false);

  const mixVolume = useMemo(
    () => Math.round(channelVolume * getCrossGain(side, crossfader)),
    [channelVolume, crossfader, side],
  );
  const cueVolume = preCue && sourceType === 'local' ? channelVolume : 0;

  useEffect(() => {
    const audio = audioRef.current;
    const cueAudio = cueAudioRef.current;

    if (sourceType === 'local' && audio) {
      audio.volume = mixVolume / 100;
    }

    if (sourceType === 'local' && cueAudio) {
      cueAudio.volume = cueVolume / 100;
    }

    if (sourceType === 'youtube' && ytPlayerRef.current?.setVolume) {
      ytPlayerRef.current.setVolume(mixVolume);
    }
  }, [cueVolume, mixVolume, sourceType]);

  useEffect(() => {
    const audio = audioRef.current;
    const cueAudio = cueAudioRef.current;
    if (!audio || !cueAudio || sourceType !== 'local') return;

    cueAudio.currentTime = audio.currentTime || 0;
    if (preCue && !audio.paused) {
      cueAudio.play().catch(() => {
        setStatus('No se pudo iniciar pre-cue automaticamente');
      });
    }

    if (!preCue) {
      cueAudio.pause();
    }
  }, [preCue, sourceType]);

  useEffect(() => {
    registerDeck(side, {
      play: () => handlePlay(),
      pause: () => handlePause(),
      seek: (seconds) => seekBy(seconds),
    });
  });

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (sourceType === 'youtube' && ytPlayerRef.current?.getCurrentTime) {
        setCurrentTime(ytPlayerRef.current.getCurrentTime() || 0);
        setDuration(ytPlayerRef.current.getDuration?.() || 0);
      }
    }, 500);
    return () => window.clearInterval(timer);
  }, [sourceType]);

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      ytPlayerRef.current?.destroy?.();
    };
  }, []);

  async function applySink(nextSinkId) {
    setSinkId(nextSinkId);
    const cueAudio = cueAudioRef.current;
    if (!cueAudio?.setSinkId || sourceType !== 'local') return;

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
    ytPlayerRef.current?.pauseVideo?.();
    setSourceType('local');
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

  async function loadYouTube() {
    const videoId = parseYouTubeId(youtubeUrl);
    if (!videoId) return;

    setSourceType('youtube');
    setLoadedTitle(`YouTube: ${videoId}`);
    setStatus('Cargando YouTube...');
    audioRef.current.pause();
    cueAudioRef.current.pause();
    setIsPlaying(false);

    const YT = await loadYouTubeApi();
    if (ytPlayerRef.current) {
      ytPlayerRef.current.cueVideoById(videoId);
      ytPlayerRef.current.pauseVideo();
      ytPlayerRef.current.setVolume(mixVolume);
      setStatus('YouTube listo');
      return;
    }

    ytPlayerRef.current = new YT.Player(ytHostRef.current, {
      width: '100%',
      height: '100%',
      playerVars: {
        playsinline: 1,
        controls: 1,
        rel: 0,
      },
      events: {
        onReady: (event) => {
          event.target.cueVideoById(videoId);
          event.target.setVolume(mixVolume);
          event.target.pauseVideo();
          setStatus('YouTube listo');
        },
        onStateChange: (event) => {
          setIsPlaying(event.data === YT.PlayerState.PLAYING);
        },
      },
    });
  }

  function handlePlay() {
    if (sourceType === 'youtube') {
      ytPlayerRef.current?.playVideo?.();
      return;
    }

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
    if (sourceType === 'youtube') {
      ytPlayerRef.current?.pauseVideo?.();
      return;
    }

    audioRef.current?.pause();
    cueAudioRef.current?.pause();
  }

  function seekBy(seconds) {
    if (sourceType === 'youtube') {
      const player = ytPlayerRef.current;
      if (!player?.seekTo) return;
      player.seekTo(Math.max(0, (player.getCurrentTime?.() || 0) + seconds), true);
      return;
    }

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
    if (sourceType === 'youtube') {
      ytPlayerRef.current?.seekTo?.(next, true);
    } else if (audioRef.current) {
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
        <label>
          Link de YouTube
          <div className="url-row">
            <input
              type="url"
              value={youtubeUrl}
              placeholder="https://youtube.com/watch?v=..."
              onChange={(event) => setYoutubeUrl(event.target.value)}
            />
            <button type="button" onClick={loadYouTube}>
              Cargar
            </button>
          </div>
        </label>
      </div>

      <div className="player-frame">
        <div className={sourceType === 'local' ? 'audio-placeholder visible-player' : 'hidden-player'}>
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
        <div ref={ytHostRef} className={sourceType === 'youtube' ? 'visible-player' : 'hidden-player'} />
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
        <strong>{mixVolume}% mix {preCue && sourceType === 'local' ? `/ ${cueVolume}% cue` : ''}</strong>
      </label>

      <div className="output-panel">
        <span>Salida pre-cue local</span>
        <label className="cue-toggle">
          <input
            type="checkbox"
            checked={preCue}
            onChange={(event) => setPreCue(event.target.checked)}
            disabled={sourceType !== 'local'}
          />
          Pre-cue: ignora el crossfader
        </label>
        <DevicePicker
          devices={devices}
          value={sinkId}
          onChange={applySink}
          onRefresh={refreshDevices}
          onTest={testSink}
          disabled={sourceType !== 'local' || !cueAudioRef.current?.setSinkId}
        />
      </div>

      <p className="status">{status}</p>
    </section>
  );
}

function App() {
  const [crossfader, setCrossfader] = useState(0);
  const [volumeA, setVolumeA] = useState(80);
  const [volumeB, setVolumeB] = useState(80);
  const [devices, setDevices] = useState([]);
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

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Practice mixer</p>
          <h1>DJ Mixer</h1>
        </div>
        <button type="button" onClick={refreshDevices}>
          Detectar salidas
        </button>
      </header>

      <div className="notice">
        YouTube funciona con el reproductor embebido, pero no permite usar Premium ni elegir dispositivo de salida.
        Para pre-cue usa archivos locales, elige audifonos como salida y activa Pre-cue en ese deck.
      </div>

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
