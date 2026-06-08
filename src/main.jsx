import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const SEEK_STEP = 5;
const TUTORIAL_STORAGE_KEY = 'dj-mixer-tutorial-seen';
const MIN_TEMPO = -16;
const MAX_TEMPO = 16;
const WAVEFORM_POINTS = 1200;
const WAVEFORM_WINDOW_SECONDS = 28;

function createAudioContext() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  return AudioContextClass ? new AudioContextClass() : null;
}

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

function formatRemaining(seconds) {
  return `-${formatTime(seconds)}`;
}

function formatBpm(value) {
  return Number.isFinite(value) ? value.toFixed(1) : '--.-';
}

function normalizeBpm(value) {
  let bpm = value;
  while (bpm < 80) bpm *= 2;
  while (bpm > 180) bpm /= 2;
  return bpm;
}

function estimateBpmFromBuffer(audioBuffer) {
  const channel = audioBuffer.getChannelData(0);
  const sampleRate = audioBuffer.sampleRate;
  const analysisDuration = Math.min(audioBuffer.duration, 150);
  const startSecond = audioBuffer.duration > 30 ? 10 : 0;
  const startSample = Math.floor(startSecond * sampleRate);
  const endSample = Math.min(channel.length, startSample + Math.floor(analysisDuration * sampleRate));
  const windowSize = 2048;
  const energies = [];

  for (let offset = startSample; offset + windowSize < endSample; offset += windowSize) {
    let sum = 0;
    for (let index = 0; index < windowSize; index += 1) {
      const sample = channel[offset + index];
      sum += sample * sample;
    }
    energies.push(Math.sqrt(sum / windowSize));
  }

  if (energies.length < 32) return null;

  const peaks = [];
  const localWindow = 18;
  for (let index = localWindow; index < energies.length - localWindow; index += 1) {
    const neighborhood = energies.slice(index - localWindow, index + localWindow + 1);
    const average = neighborhood.reduce((total, value) => total + value, 0) / neighborhood.length;
    const isLocalMax = energies[index] === Math.max(...neighborhood);

    if (isLocalMax && energies[index] > average * 1.35) {
      const time = startSecond + (index * windowSize) / sampleRate;
      if (!peaks.length || time - peaks[peaks.length - 1].time > 0.22) {
        peaks.push({ time, strength: energies[index] });
      }
    }
  }

  if (peaks.length < 8) return null;

  const buckets = new Map();
  for (let index = 0; index < peaks.length; index += 1) {
    for (let next = index + 1; next < Math.min(index + 12, peaks.length); next += 1) {
      const interval = peaks[next].time - peaks[index].time;
      if (interval < 0.28 || interval > 1.5) continue;
      const bpm = Math.round(normalizeBpm(60 / interval));
      const weight = peaks[index].strength + peaks[next].strength;
      buckets.set(bpm, (buckets.get(bpm) || 0) + weight);
    }
  }

  const best = [...buckets.entries()].sort((left, right) => right[1] - left[1])[0];
  return best ? best[0] : null;
}

function buildWaveformFromBuffer(audioBuffer, points = WAVEFORM_POINTS) {
  const channel = audioBuffer.getChannelData(0);
  const samplesPerPoint = Math.max(1, Math.floor(channel.length / points));
  const waveform = [];
  let maxPeak = 0;

  for (let point = 0; point < points; point += 1) {
    const start = point * samplesPerPoint;
    const end = Math.min(channel.length, start + samplesPerPoint);
    let peak = 0;

    for (let index = start; index < end; index += 1) {
      peak = Math.max(peak, Math.abs(channel[index]));
    }

    waveform.push(peak);
    maxPeak = Math.max(maxPeak, peak);
  }

  const normalized = waveform.map((peak) => (maxPeak ? peak / maxPeak : 0));
  return smoothWaveform(normalized, 4);
}

function smoothWaveform(values, radius = 3) {
  return values.map((_, index) => {
    let total = 0;
    let count = 0;

    for (let offset = -radius; offset <= radius; offset += 1) {
      const value = values[index + offset];
      if (value === undefined) continue;
      total += value;
      count += 1;
    }

    return count ? total / count : 0;
  });
}

function readFileAsArrayBuffer(file, onProgress) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress?.(Math.round((event.loaded / event.total) * 70));
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(reader.result);
    reader.readAsArrayBuffer(file);
  });
}

async function analyzeAudio(file, onProgress) {
  const context = createAudioContext();
  if (!context) return { bpm: null, waveform: [] };

  try {
    const arrayBuffer = await readFileAsArrayBuffer(file, onProgress);
    onProgress?.(82);
    const audioBuffer = await context.decodeAudioData(arrayBuffer);
    onProgress?.(94);
    return {
      bpm: estimateBpmFromBuffer(audioBuffer),
      waveform: buildWaveformFromBuffer(audioBuffer),
    };
  } finally {
    await context.close?.();
  }
}

function applyPlaybackRate(media, rate) {
  if (!media) return;
  media.playbackRate = rate;
  media.preservesPitch = false;
  media.mozPreservesPitch = false;
  media.webkitPreservesPitch = false;
}

function createFlangerGraph(media) {
  const context = createAudioContext();
  if (!context) return null;

  const source = context.createMediaElementSource(media);
  const dryGain = context.createGain();
  const wetGain = context.createGain();
  const delay = context.createDelay(0.03);
  const feedback = context.createGain();
  const lfo = context.createOscillator();
  const lfoDepth = context.createGain();

  dryGain.gain.value = 1;
  wetGain.gain.value = 0;
  delay.delayTime.value = 0.004;
  feedback.gain.value = 0.18;
  lfo.frequency.value = 0.28;
  lfoDepth.gain.value = 0.0028;

  source.connect(dryGain);
  source.connect(delay);
  delay.connect(wetGain);
  delay.connect(feedback);
  feedback.connect(delay);
  dryGain.connect(context.destination);
  wetGain.connect(context.destination);
  lfo.connect(lfoDepth);
  lfoDepth.connect(delay.delayTime);
  lfo.start();

  return { context, wetGain, feedback, lfoDepth };
}

function applyFlangerAmount(graph, amount) {
  if (!graph) return;
  const normalized = amount / 100;
  const now = graph.context.currentTime;
  graph.wetGain.gain.setTargetAtTime(normalized * 0.75, now, 0.02);
  graph.feedback.gain.setTargetAtTime(0.12 + normalized * 0.46, now, 0.02);
  graph.lfoDepth.gain.setTargetAtTime(0.001 + normalized * 0.0045, now, 0.02);
}

function getFaderPercent(value, min, max) {
  if (max === min) return 0;
  return ((value - min) / (max - min)) * 100;
}

function HorizontalSvgFader({ value, min, max, step = 1, onChange, ariaLabel }) {
  const faderRef = useRef(null);
  const svgRef = useRef(null);
  const percent = Math.max(0, Math.min(100, getFaderPercent(value, min, max)));
  const railStart = 12;
  const railWidth = 196;

  function snapValue(nextValue) {
    const snapped = Math.round(nextValue / step) * step;
    const bounded = Math.max(min, Math.min(max, snapped));
    return Number(bounded.toFixed(3));
  }

  function setFromClientX(clientX) {
    const svg = svgRef.current;
    if (!svg) return;
    const matrix = svg.getScreenCTM();
    if (!matrix) return;

    const point = svg.createSVGPoint();
    point.x = clientX;
    point.y = svg.getBoundingClientRect().top + svg.getBoundingClientRect().height / 2;
    const svgPoint = point.matrixTransform(matrix.inverse());
    const nextPercent = Math.max(0, Math.min(1, (svgPoint.x - railStart) / railWidth));
    onChange(snapValue(min + (max - min) * nextPercent));
  }

  function handlePointer(event) {
    event.preventDefault();
    faderRef.current?.setPointerCapture?.(event.pointerId);
    setFromClientX(event.clientX);
  }

  function handleKeyDown(event) {
    const increment = event.shiftKey ? step * 10 : step;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
      event.preventDefault();
      onChange(snapValue(value - increment));
    }
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
      event.preventDefault();
      onChange(snapValue(value + increment));
    }
    if (event.key === 'Home') {
      event.preventDefault();
      onChange(min);
    }
    if (event.key === 'End') {
      event.preventDefault();
      onChange(max);
    }
  }

  return (
    <div
      className="svg-fader horizontal-svg-fader"
      ref={faderRef}
      role="slider"
      tabIndex="0"
      aria-label={ariaLabel}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      onPointerDown={handlePointer}
      onPointerMove={(event) => {
        if (event.buttons === 1) setFromClientX(event.clientX);
      }}
      onKeyDown={handleKeyDown}
    >
      <svg ref={svgRef} viewBox="0 0 220 42" aria-hidden="true">
        <rect x="12" y="18" width="196" height="6" rx="3" className="pot-rail" />
        <rect x="12" y="18" width={(196 * percent) / 100} height="6" rx="3" className="pot-fill" />
        <g transform={`translate(${12 + (196 * percent) / 100} 21)`}>
          <rect x="-9" y="-16" width="18" height="32" rx="4" className="pot-knob" />
          <line x1="0" y1="-9" x2="0" y2="9" className="pot-mark" />
        </g>
      </svg>
    </div>
  );
}

function VerticalSvgFader({ value, min, max, step = 1, onChange, ariaLabel }) {
  const percent = Math.max(0, Math.min(100, getFaderPercent(value, min, max)));
  const y = 144 - (134 * percent) / 100;

  return (
    <div className="svg-fader vertical-svg-fader">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        aria-label={ariaLabel}
      />
      <svg viewBox="0 0 54 154" aria-hidden="true">
        <rect x="24" y="10" width="6" height="134" rx="3" className="pot-rail" />
        <rect x="24" y={y} width="6" height={144 - y} rx="3" className="pot-fill" />
        <g transform={`translate(27 ${y})`}>
          <rect x="-18" y="-9" width="36" height="18" rx="4" className="pot-knob" />
          <line x1="-10" y1="0" x2="10" y2="0" className="pot-mark" />
        </g>
      </svg>
    </div>
  );
}

function TempoFader({ value, onChange, detectedBpm, label }) {
  const rate = 1 + value / 100;
  const adjustedBpm = detectedBpm ? detectedBpm * rate : null;

  return (
    <label className="tempo-fader">
      <span>Canal {label}</span>
      <button type="button" className="tempo-reset" onClick={() => onChange(0)}>
        Reset
      </button>
      <VerticalSvgFader
        value={value}
        min={MIN_TEMPO}
        max={MAX_TEMPO}
        step="0.1"
        onChange={onChange}
        ariaLabel={`Ajuste de tempo canal ${label}`}
      />
      <strong>{value > 0 ? '+' : ''}{value.toFixed(1)}%</strong>
      <small>{formatBpm(adjustedBpm)} BPM</small>
    </label>
  );
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

function sampleWaveform(track, x) {
  const { waveform, currentTime, duration } = track;
  if (!waveform?.length || !duration) return 0;

  const relative = (x / 100 - 0.5) * WAVEFORM_WINDOW_SECONDS;
  const time = currentTime + relative;
  if (time < 0 || time > duration) return 0;

  const preciseIndex = (time / duration) * (waveform.length - 1);
  const leftIndex = Math.floor(preciseIndex);
  const rightIndex = Math.min(waveform.length - 1, leftIndex + 1);
  const mix = preciseIndex - leftIndex;
  return (waveform[leftIndex] || 0) * (1 - mix) + (waveform[rightIndex] || 0) * mix;
}

function pointsToSmoothPath(points) {
  if (!points.length) return '';
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;

  let path = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
  for (let index = 0; index < points.length - 1; index += 1) {
    const current = points[index];
    const next = points[index + 1];
    const midX = (current.x + next.x) / 2;
    const midY = (current.y + next.y) / 2;
    path += ` Q ${current.x.toFixed(2)} ${current.y.toFixed(2)} ${midX.toFixed(2)} ${midY.toFixed(2)}`;
  }

  const last = points[points.length - 1];
  return `${path} T ${last.x.toFixed(2)} ${last.y.toFixed(2)}`;
}

function buildWavePath(track, yCenter, height, steps = 220) {
  if (!track.waveform?.length || !track.duration) {
    return `M 0 ${yCenter} L 100 ${yCenter}`;
  }

  const top = [];
  const bottom = [];

  for (let step = 0; step <= steps; step += 1) {
    const x = (step / steps) * 100;
    const amp = sampleWaveform(track, x);
    top.push({ x, y: yCenter - amp * height });
    bottom.unshift({ x, y: yCenter + amp * height });
  }

  const bottomPath = pointsToSmoothPath(bottom).replace(/^M /, 'L ');
  return `${pointsToSmoothPath(top)} ${bottomPath} Z`;
}

function DeckWaveDisplay({ track, colorClass }) {
  return (
    <svg className="deck-wave-display" viewBox="0 0 100 42" preserveAspectRatio="none" aria-hidden="true">
      <rect width="100" height="42" className="wave-bg" />
      <path d={buildWavePath(track, 21, 16, 180)} className={`wave-path ${colorClass}`} />
      <line x1="50" y1="0" x2="50" y2="42" className="wave-center-line" />
    </svg>
  );
}

function WaveMatchScreen({ trackA, trackB }) {
  return (
    <section className="wave-match-screen" aria-label="Pantalla de emparejamiento de ondas">
      <div className="wave-head">
        <div>
          <span>A</span>
          <strong>{trackA.title}</strong>
        </div>
        <div>
          <span>B</span>
          <strong>{trackB.title}</strong>
        </div>
      </div>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="Ondas moviendose hacia la linea central">
        <defs>
          <pattern id="wave-grid" width="8" height="20" patternUnits="userSpaceOnUse">
            <path d="M 8 0 L 0 0 0 20" className="wave-grid-line" />
          </pattern>
        </defs>
        <rect width="100" height="100" className="wave-bg" />
        <rect width="100" height="100" fill="url(#wave-grid)" opacity="0.55" />
        <path d={buildWavePath(trackA, 30, 18)} className="wave-path wave-a" />
        <path d={buildWavePath(trackB, 70, 18)} className="wave-path wave-b" />
        <line x1="0" y1="50" x2="100" y2="50" className="wave-divider" />
        <line x1="50" y1="0" x2="50" y2="100" className="wave-center-line" />
      </svg>
      <div className="wave-times">
        <span>{formatTime(trackA.currentTime)} / {formatTime(trackA.duration)}</span>
        <span>{formatTime(trackB.currentTime)} / {formatTime(trackB.duration)}</span>
      </div>
    </section>
  );
}

function JogWheel({ side, onSeek, playbackRate }) {
  const lastX = useRef(null);
  const flashTimer = useRef(null);
  const dragDistance = useRef(0);
  const [direction, setDirection] = useState('');

  useEffect(() => {
    return () => window.clearTimeout(flashTimer.current);
  }, []);

  function triggerSeek(seconds) {
    window.clearTimeout(flashTimer.current);
    setDirection(seconds > 0 ? 'forward' : 'backward');
    onSeek(seconds * playbackRate);
    flashTimer.current = window.setTimeout(() => setDirection(''), 420);
  }

  function beginDrag(event) {
    lastX.current = event.clientX;
    dragDistance.current = 0;
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function moveDrag(event) {
    if (lastX.current === null) return;
    const delta = event.clientX - lastX.current;
    if (Math.abs(delta) < 1) return;
    lastX.current = event.clientX;
    dragDistance.current += Math.abs(delta);
    window.clearTimeout(flashTimer.current);
    setDirection(delta > 0 ? 'forward' : 'backward');
    onSeek(delta * 0.045 * playbackRate);
  }

  function endDrag(event) {
    if (lastX.current === null) return;
    lastX.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    flashTimer.current = window.setTimeout(() => setDirection(''), 220);
  }

  return (
    <div
      className="jog"
      onPointerDown={beginDrag}
      onPointerMove={moveDrag}
      onPointerUp={endDrag}
      onPointerCancel={() => {
        lastX.current = null;
        window.clearTimeout(flashTimer.current);
        setDirection('');
      }}
    >
      <button
        type="button"
        className="jog-button left"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={() => triggerSeek(-SEEK_STEP)}
        title="Retroceder 5s"
      >
        -5
      </button>
      <div className={`disc ${direction}`} aria-label={`Jog wheel canal ${side}`}>
        <span>{side}</span>
        <strong aria-live="polite">{direction === 'forward' ? '+5s' : direction === 'backward' ? '-5s' : ''}</strong>
      </div>
      <button
        type="button"
        className="jog-button right"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={() => triggerSeek(SEEK_STEP)}
        title="Avanzar 5s"
      >
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
  tempoPercent,
  onBpmChange,
  onTrackChange,
  onDeckReady,
}) {
  const audioRef = useRef(null);
  const cueAudioRef = useRef(null);
  const flangerRef = useRef(null);
  const objectUrlRef = useRef('');
  const loadIdRef = useRef(0);
  const animationFrameRef = useRef(null);
  const [loadedTitle, setLoadedTitle] = useState('Sin pista');
  const [status, setStatus] = useState('Carga un archivo de audio');
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [showRemaining, setShowRemaining] = useState(false);
  const [cuePoint, setCuePoint] = useState(0);
  const [hasCue, setHasCue] = useState(false);
  const [sinkId, setSinkId] = useState('');
  const [preCue, setPreCue] = useState(false);
  const [flangerAmount, setFlangerAmount] = useState(0);
  const [detectedBpm, setDetectedBpm] = useState(null);
  const [bpmStatus, setBpmStatus] = useState('Sin analisis');
  const [loadProgress, setLoadProgress] = useState(0);
  const [deckTrack, setDeckTrack] = useState({
    title: 'Sin pista',
    currentTime: 0,
    duration: 0,
    waveform: [],
  });

  const mixVolume = useMemo(
    () => Math.round(channelVolume * getCrossGain(side, crossfader)),
    [channelVolume, crossfader, side],
  );
  const cueVolume = preCue ? channelVolume : 0;
  const playbackRate = 1 + tempoPercent / 100;
  const adjustedBpm = detectedBpm ? detectedBpm * playbackRate : null;

  function reportTrack(partial) {
    setDeckTrack((current) => ({ ...current, ...partial }));
    onTrackChange(partial);
  }

  function syncCurrentTime(nextTime) {
    setCurrentTime(nextTime);
    reportTrack({ currentTime: nextTime });
  }

  useEffect(() => {
    onDeckReady(side, {
      play: () => handlePlay(),
      pause: () => handlePause(),
      isLoaded: () => Boolean(audioRef.current?.src),
    });
  });

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
    applyPlaybackRate(audioRef.current, playbackRate);
    applyPlaybackRate(cueAudioRef.current, playbackRate);
  }, [playbackRate]);

  useEffect(() => {
    applyFlangerAmount(flangerRef.current, flangerAmount);
  }, [flangerAmount]);

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
    return () => {
      window.cancelAnimationFrame(animationFrameRef.current);
      flangerRef.current?.context?.close?.();
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, []);

  useEffect(() => {
    if (!isPlaying) {
      window.cancelAnimationFrame(animationFrameRef.current);
      return undefined;
    }

    function tick() {
      const audio = audioRef.current;
      if (audio) {
        syncCurrentTime(audio.currentTime || 0);
      }
      animationFrameRef.current = window.requestAnimationFrame(tick);
    }

    animationFrameRef.current = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(animationFrameRef.current);
  }, [isPlaying]);

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

  async function handleLocalFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const currentLoadId = loadIdRef.current + 1;
    loadIdRef.current = currentLoadId;

    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    objectUrlRef.current = URL.createObjectURL(file);
    setLoadedTitle(file.name);
    setStatus('Archivo local listo');
    setBpmStatus('Precargando archivo...');
    setLoadProgress(1);
    setDetectedBpm(null);
    onBpmChange(null);
    reportTrack({
      title: file.name,
      currentTime: 0,
      duration: 0,
      bpm: null,
      waveform: [],
    });
    setIsPlaying(false);
    syncCurrentTime(0);
    setCuePoint(0);
    setHasCue(true);
    setDuration(0);
    audioRef.current.src = objectUrlRef.current;
    cueAudioRef.current.src = objectUrlRef.current;
    audioRef.current.load();
    cueAudioRef.current.load();

    try {
      const analysis = await analyzeAudio(file, setLoadProgress);
      if (loadIdRef.current !== currentLoadId) return;
      reportTrack({ bpm: analysis.bpm, waveform: analysis.waveform });
      setLoadProgress(100);

      if (analysis.bpm) {
        setDetectedBpm(analysis.bpm);
        onBpmChange(analysis.bpm);
        setBpmStatus('BPM detectado');
      } else {
        onBpmChange(null);
        setBpmStatus('No se pudo detectar BPM');
      }
    } catch (error) {
      if (loadIdRef.current === currentLoadId) {
        setLoadProgress(0);
        onBpmChange(null);
        setBpmStatus(`BPM no disponible: ${error.message}`);
      }
    }
  }

  function handlePlay() {
    const audio = audioRef.current;
    const cueAudio = cueAudioRef.current;
    if (audio && !flangerRef.current) {
      flangerRef.current = createFlangerGraph(audio);
      applyFlangerAmount(flangerRef.current, flangerAmount);
    }
    flangerRef.current?.context?.resume?.();
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

  function jumpToTime(nextTime) {
    const audio = audioRef.current;
    const cueAudio = cueAudioRef.current;
    if (!audio) return;
    const boundedTime = Math.max(0, Math.min(audio.duration || 0, nextTime));
    audio.currentTime = boundedTime;
    if (cueAudio) {
      cueAudio.currentTime = boundedTime;
    }
    syncCurrentTime(boundedTime);
  }

  function setCue() {
    const audio = audioRef.current;
    if (!audio) return;
    const nextCue = audio.currentTime || 0;
    setCuePoint(nextCue);
    setHasCue(true);
    setStatus(`Cue guardado en ${formatTime(nextCue)}`);
  }

  function jumpToCue() {
    if (!hasCue) {
      setStatus('No hay cue guardado');
      return;
    }
    jumpToTime(cuePoint);
    setStatus(`Saltando a cue ${formatTime(cuePoint)}`);
  }

  function seekBy(seconds) {
    const audio = audioRef.current;
    if (!audio) return;
    jumpToTime((audio.currentTime || 0) + seconds);
  }

  function onTimelineChange(event) {
    const next = Number(event.target.value);
    if (audioRef.current) {
      jumpToTime(next);
    }
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
        <div className="deck-screen visible-player">
          <div className="screen-topline">
            <span>Canal {side}</span>
            <span>{isPlaying ? 'RUN' : 'STOP'}</span>
          </div>
          <DeckWaveDisplay track={deckTrack} colorClass={side === 'A' ? 'wave-a' : 'wave-b'} />
          <button
            type="button"
            className="deck-time-toggle"
            onClick={() => setShowRemaining((value) => !value)}
            title="Alternar tiempo transcurrido/restante"
          >
            {showRemaining
              ? formatRemaining(Math.max(0, duration - currentTime))
              : `${formatTime(currentTime)} / ${formatTime(duration)}`}
          </button>
          <div className="screen-readouts">
            <div>
              <small>BPM original</small>
              <strong>{formatBpm(detectedBpm)}</strong>
            </div>
            <div>
              <small>BPM actual</small>
              <strong>{formatBpm(adjustedBpm)}</strong>
            </div>
            <div>
              <small>Tempo</small>
              <strong>{tempoPercent > 0 ? '+' : ''}{tempoPercent.toFixed(1)}%</strong>
            </div>
          </div>
          <p>{bpmStatus}</p>
          <p className="cue-readout">Cue {hasCue ? formatTime(cuePoint) : '--:--'}</p>
          {loadProgress > 0 && loadProgress < 100 && (
            <div className="load-progress" aria-label="Progreso de precarga">
              <span style={{ width: `${loadProgress}%` }} />
            </div>
          )}
        </div>
        <audio
          ref={audioRef}
          preload="auto"
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onTimeUpdate={(event) => syncCurrentTime(event.currentTarget.currentTime)}
          onLoadedMetadata={(event) => {
            const nextDuration = event.currentTarget.duration || 0;
            setDuration(nextDuration);
            reportTrack({ duration: nextDuration });
          }}
        />
        <audio ref={cueAudioRef} preload="auto" />
      </div>

      <div className="transport">
        <button type="button" onClick={isPlaying ? handlePause : handlePlay}>
          {isPlaying ? 'Pausa' : 'Play'}
        </button>
        <button type="button" onClick={setCue}>
          Set Cue
        </button>
        <button type="button" onClick={jumpToCue}>
          Cue
        </button>
        <button type="button" onClick={() => seekBy(-SEEK_STEP)}>
          Retro
        </button>
        <button type="button" onClick={() => seekBy(SEEK_STEP)}>
          Avanza
        </button>
      </div>

      <JogWheel side={side} onSeek={seekBy} playbackRate={playbackRate} />

      <div className="timeline">
        <span>{formatTime(currentTime)}</span>
        <input
          type="range"
          min="0"
          max={Math.max(0, Math.floor(duration))}
          step="0.1"
          value={Math.min(Math.floor(currentTime), Math.max(0, Math.floor(duration)))}
          onChange={onTimelineChange}
          aria-label={`Linea de tiempo canal ${side}`}
        />
        <span>{formatTime(duration)}</span>
      </div>

      <div className="channel-volume">
        <span>Volumen canal</span>
        <HorizontalSvgFader
          min={0}
          max={100}
          value={channelVolume}
          onChange={setChannelVolume}
          ariaLabel={`Volumen canal ${side}`}
        />
        <strong>{mixVolume}% mix {preCue ? `/ ${cueVolume}% cue` : ''}</strong>
      </div>

      <div className="channel-effect">
        <span>Flanger</span>
        <HorizontalSvgFader
          min={0}
          max={100}
          value={flangerAmount}
          onChange={setFlangerAmount}
          ariaLabel={`Flanger canal ${side}`}
        />
        <strong>{flangerAmount}%</strong>
      </div>

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
  const steps = [
    {
      title: '1. Carga tus canciones',
      body: 'Carga un archivo local de audio en el canal A y otro en el canal B. Cuando termina la precarga, cada deck muestra BPM, forma de onda y duracion.',
    },
    {
      title: '2. Lee las pantallas',
      body: 'La pantalla grande de cada deck muestra BPM original, BPM actual, tempo y cue. La pantalla central muestra ambas ondas moviendose hacia la linea central para ayudarte a empatar entradas.',
    },
    {
      title: '3. Prepara con cue',
      body: 'Al cargar una cancion, el cue inicia en 0:00. Usa Set Cue para guardar otro punto. Usa Cue para saltar a ese punto aunque el deck este sonando o pausado. El circulo permite mover la pista de forma continua; -5 y +5 hacen saltos rapidos.',
    },
    {
      title: '4. Ajusta tempo y volumen',
      body: 'Los faders Tempo / BPM del centro aceleran o bajan cada canal. Reset vuelve el tempo a 0.0%. El volumen de cada deck controla su nivel base antes del crossfader.',
    },
    {
      title: '5. Usa pre-cue',
      body: 'Haz click en Detectar salidas, elige tus audifonos en Salida pre-cue local, pulsa Probar y activa Pre-cue en el deck que quieras preparar. La mezcla principal sigue saliendo por la salida predeterminada.',
    },
    {
      title: '6. Mezcla y efectos',
      body: 'Mueve el crossfader para pasar de A a B. Automix reproduce el otro canal, mueve el crossfader y pausa el canal que sale. El fader Flanger agrega efecto a la salida principal del deck; el pre-cue queda seco.',
    },
  ];
  const [step, setStep] = useState(0);
  const current = steps[step];

  return (
    <div className="tutorial-overlay" role="dialog" aria-modal="true" aria-labelledby="tutorial-title">
      <section className="tutorial">
        <div className="tutorial-header">
          <div>
            <p className="eyebrow">Paso {step + 1} de {steps.length}</p>
            <h2 id="tutorial-title">{current.title}</h2>
          </div>
          <button type="button" onClick={onClose}>
            Cerrar
          </button>
        </div>
        <p>{current.body}</p>
        <div className="tutorial-progress" aria-hidden="true">
          {steps.map((item, index) => (
            <span className={index === step ? 'active' : ''} key={item.title} />
          ))}
        </div>
        <div className="tutorial-actions">
          <button type="button" onClick={() => setStep((value) => Math.max(0, value - 1))} disabled={step === 0}>
            Atras
          </button>
          {step === steps.length - 1 ? (
            <button type="button" onClick={onClose}>
              Entendido
            </button>
          ) : (
            <button type="button" onClick={() => setStep((value) => Math.min(steps.length - 1, value + 1))}>
              Siguiente
            </button>
          )}
        </div>
      </section>
    </div>
  );
}

function App() {
  const emptyTrack = {
    title: 'Sin pista',
    currentTime: 0,
    duration: 0,
    bpm: null,
    waveform: [],
  };
  const [crossfader, setCrossfader] = useState(0);
  const [volumeA, setVolumeA] = useState(100);
  const [volumeB, setVolumeB] = useState(100);
  const [tempoA, setTempoA] = useState(0);
  const [tempoB, setTempoB] = useState(0);
  const [bpmA, setBpmA] = useState(null);
  const [bpmB, setBpmB] = useState(null);
  const [trackA, setTrackA] = useState(emptyTrack);
  const [trackB, setTrackB] = useState(emptyTrack);
  const [devices, setDevices] = useState([]);
  const [isAutomixing, setIsAutomixing] = useState(false);
  const [showTutorial, setShowTutorial] = useState(() => {
    return window.localStorage.getItem(TUTORIAL_STORAGE_KEY) !== 'true';
  });
  const deckApi = useRef({});
  const automixFrame = useRef(null);

  useEffect(() => {
    return () => window.cancelAnimationFrame(automixFrame.current);
  }, []);

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

  function closeTutorial() {
    window.localStorage.setItem(TUTORIAL_STORAGE_KEY, 'true');
    setShowTutorial(false);
  }

  function registerDeck(side, api) {
    deckApi.current[side] = api;
  }

  function startAutomix() {
    if (isAutomixing) return;

    const targetSide = crossfader <= 0 ? 'B' : 'A';
    const sourceSide = targetSide === 'A' ? 'B' : 'A';
    const targetValue = targetSide === 'A' ? -100 : 100;
    const sourceApi = deckApi.current[sourceSide];
    const targetApi = deckApi.current[targetSide];

    if (!targetApi?.isLoaded?.()) return;

    window.cancelAnimationFrame(automixFrame.current);
    targetApi.play?.();
    setIsAutomixing(true);

    const startValue = crossfader;
    const startTime = performance.now();
    const duration = 8500;

    function tick(now) {
      const progress = Math.min(1, (now - startTime) / duration);
      const eased = progress < 0.5 ? 2 * progress * progress : 1 - ((-2 * progress + 2) ** 2) / 2;
      setCrossfader(Math.round(startValue + (targetValue - startValue) * eased));

      if (progress < 1) {
        automixFrame.current = window.requestAnimationFrame(tick);
        return;
      }

      setCrossfader(targetValue);
      sourceApi?.pause?.();
      setIsAutomixing(false);
    }

    automixFrame.current = window.requestAnimationFrame(tick);
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Practice mixer</p>
          <h1>Mixer</h1>
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
          tempoPercent={tempoA}
          onBpmChange={setBpmA}
          onTrackChange={(partial) => setTrackA((current) => ({ ...current, ...partial }))}
          onDeckReady={registerDeck}
        />

        <section className="center-mixer">
          <h2>Mezcla</h2>
          <WaveMatchScreen trackA={trackA} trackB={trackB} />
          <label className="crossfader">
            <span>A</span>
            <HorizontalSvgFader
              min={-100}
              max={100}
              value={crossfader}
              onChange={setCrossfader}
              ariaLabel="Crossfader"
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
          <button type="button" className="automix-button" onClick={startAutomix} disabled={isAutomixing}>
            {isAutomixing ? 'Automix...' : 'Automix'}
          </button>
          <div className="tempo-panel">
            <h3>Tempo / BPM</h3>
            <div className="tempo-bank">
              <TempoFader value={tempoA} onChange={setTempoA} detectedBpm={bpmA} label="A" />
              <TempoFader value={tempoB} onChange={setTempoB} detectedBpm={bpmB} label="B" />
            </div>
          </div>
        </section>

        <Deck
          side="B"
          crossfader={crossfader}
          devices={devices}
          refreshDevices={refreshDevices}
          channelVolume={volumeB}
          setChannelVolume={setVolumeB}
          tempoPercent={tempoB}
          onBpmChange={setBpmB}
          onTrackChange={(partial) => setTrackB((current) => ({ ...current, ...partial }))}
          onDeckReady={registerDeck}
        />
      </div>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
