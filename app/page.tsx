"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import sixthWaveFormula from "../public/6th-wave.txt?raw";
import longWarmthFormula from "../public/long-warmth.txt?raw";
import trinitraneFormula from "../public/trinitrane.txt?raw";
import phaseArrayFormula from "../public/phase-array.txt?raw";

type SignalMode = "bytebeat" | "signed" | "floatbeat" | "funcbeat";
type Grade = "perfect" | "great" | "good";
type Track = { name: string; author: string; bpm: number; color: string; formula: string; blurb: string; mode: SignalMode; hz: number; n: number; volume: number; duration: number };
type Note = { id: number; lane: number; born: number; hitAt: number; kind: "tap" | "hold"; duration: number; grade?: Grade; pressed?: boolean; hit?: boolean; missed?: boolean };
type Particle = { x: number; y: number; vx: number; vy: number; life: number; size: number };
type RhythmEvent = { hitAt: number; lane: number; strength: number; hold: boolean; duration: number; source: "transient" | "melody" };
type Modifiers = { auto: boolean; noFail: boolean; hidden: boolean };
type PcmBlock = { left: Float32Array; right: Float32Array };
type RunStats = { perfect: number; great: number; good: number; miss: number; holds: number; total: number; maxCombo: number };

const EMPTY_STATS: RunStats = { perfect:0, great:0, good:0, miss:0, holds:0, total:0, maxCombo:0 };
const SIXTH_WAVE_DURATION = 1.6 + 14 * 2 ** 20 / .9 / 48000;

const TRACKS: Track[] = [
  {
    name: "6TH WAVE", author: "feeshbread", bpm: 79, color: "#61e7ff",
    blurb: "ByteBattle S3 · full stereo journey · 05:41", mode: "funcbeat", hz: 48000, n: 1, volume: 78,
    formula: sixthWaveFormula, duration: SIXTH_WAVE_DURATION,
  },
  {
    name: "LONG WARMTH", author: "Decent-Manager-6169", bpm: 96, color: "#ff9a62",
    blurb: "ByteBattle S4 · evolving stereo warmth · 04:04", mode: "funcbeat", hz: 44100, n: 1, volume: 86,
    formula: longWarmthFormula, duration: 244,
  },
  {
    name: "TRINITRANE", author: "N3", bpm: 160, color: "#ff4fd8",
    blurb: "ByteBattle S6 · high-energy stereo suite · 03:27", mode: "funcbeat", hz: 48000, n: 1, volume: 76,
    formula: trinitraneFormula, duration: 207,
  },
  {
    name: "PHASE ARRAY", author: "UNKNOWN", bpm: 88, color: "#a8ff5f",
    blurb: "stateful stereo synth journey · 03:17", mode: "funcbeat", hz: 48000, n: 1, volume: 82,
    formula: phaseArrayFormula, duration: 197,
  },
];

const LANES = ["D", "F", "J", "K"];
const TIMING_WINDOWS = [
  { perfect: .07, great: .135, hit: .22, missDamage: 4 },
  { perfect: .06, great: .12, hit: .19, missDamage: 5 },
  { perfect: .04, great: .08, hit: .14, missDamage: 9 },
];
const JUDGE_POSITION = 88;
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
const colorChannels = (hex: string) => [0,2,4].map(offset=>parseInt(hex.replace("#","").slice(offset,offset+2),16)/255) as [number,number,number];
const formatTime = (seconds: number) => `${Math.floor(Math.max(0,seconds)/60)}:${Math.floor(Math.max(0,seconds)%60).toString().padStart(2,"0")}`;
const accuracyOf = (stats: RunStats) => stats.total ? (stats.perfect + stats.great * .7 + stats.good * .4) / stats.total * 100 : 0;
const rankOf = (stats: RunStats, auto: boolean) => {
  if (auto) return "AUTO";
  const accuracy = accuracyOf(stats);
  if (stats.miss === 0 && accuracy >= 99.5) return "SS";
  if (accuracy >= 95) return "S";
  if (accuracy >= 90) return "A";
  if (accuracy >= 80) return "B";
  if (accuracy >= 70) return "C";
  return "D";
};

function detectPitch(samples: Float32Array, sampleRate: number) {
  const stride = 8;
  let rms = 0;
  for (let i = 0; i < samples.length; i += stride) rms += samples[i] * samples[i];
  rms = Math.sqrt(rms / Math.ceil(samples.length / stride));
  if (rms < .035) return { midi: 0, confidence: 0 };
  const minLag = Math.max(2, Math.floor(sampleRate / 1000 / stride));
  const maxLag = Math.min(Math.floor(samples.length / stride) - 2, Math.floor(sampleRate / 70 / stride));
  let bestLag = 0; let best = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let correlation = 0; let leftPower = 0; let rightPower = 0;
    for (let i = 0; i + lag * stride < samples.length; i += stride) {
      const a = samples[i]; const b = samples[i + lag * stride];
      correlation += a * b; leftPower += a * a; rightPower += b * b;
    }
    const normalized = correlation / Math.sqrt(leftPower * rightPower + 1e-9);
    if (normalized > best) { best = normalized; bestLag = lag; }
  }
  const frequency = bestLag ? sampleRate / (bestLag * stride) : 0;
  return { midi: frequency ? 69 + 12 * Math.log2(frequency / 440) : 0, confidence: best };
}

export default function Home() {
  const [trackIndex, setTrackIndex] = useState(0);
  const [formula, setFormula] = useState(TRACKS[0].formula);
  const [difficulty, setDifficulty] = useState(2);
  const [sensitivity, setSensitivity] = useState(62);
  const [signalMode, setSignalMode] = useState<SignalMode>(TRACKS[0].mode);
  const [formulaHz, setFormulaHz] = useState(TRACKS[0].hz);
  const [nValue, setNValue] = useState(TRACKS[0].n);
  const [volume, setVolume] = useState(TRACKS[0].volume);
  const [game, setGame] = useState<"setup" | "countdown" | "running" | "paused" | "failing" | "results">("setup");
  const [countdown, setCountdown] = useState(3);
  const [modifiers, setModifiers] = useState<Modifiers>({auto:false,noFail:false,hidden:false});
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [health, setHealth] = useState(100);
  const [timeline, setTimeline] = useState(0);
  const [finalStats, setFinalStats] = useState<RunStats>({...EMPTY_STATS});
  const [runOutcome, setRunOutcome] = useState<"complete" | "failed">("failed");
  const [status, setStatus] = useState("FORMULA READY");
  const [audioOn, setAudioOn] = useState(false);
  const [audioKind, setAudioKind] = useState<"preview" | "game" | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [lastJudgement, setLastJudgement] = useState("");
  const [timingMs, setTimingMs] = useState<number | null>(null);
  const [pressedLanes, setPressedLanes] = useState<boolean[]>([false,false,false,false]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particleCanvasRef = useRef<HTMLCanvasElement>(null);
  const highwayRef = useRef<HTMLDivElement>(null);
  const noteElementsRef = useRef(new Map<number,HTMLElement>());
  const audioRef = useRef<{ ctx: AudioContext; processor: ScriptProcessorNode; filter: BiquadFilterNode; gain: GainNode; worker: Worker; kind: "preview" | "game" } | null>(null);
  const pendingWorkerRef = useRef<Worker | null>(null);
  const audioRequestRef = useRef(0);
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const notesRef = useRef<Note[]>([]);
  const startRef = useRef(0);
  const idRef = useRef(1);
  const nextBeatRef = useRef(0);
  const rafRef = useRef(0);
  const spectrumRef = useRef({ energy: 0, peak: 0, flux: 0, onset: 0, intensity: 0, beatPulse: 0, silence: true, pitch: 0, pitchConfidence: 0, wave: new Float32Array(128) });
  const particlesRef = useRef<Particle[]>([]);
  const rhythmEventsRef = useRef<RhythmEvent[]>([]);
  const gameActiveRef = useRef(false);
  const laneBusyUntilRef = useRef([0,0,0,0]);
  const lastDetectedHitRef = useRef(-10);
  const playbackSpeedRef = useRef(1);
  const freezeTimeRef = useRef(0);
  const statsRef = useRef<RunStats>({...EMPTY_STATS});
  const track = TRACKS[trackIndex];
  const trackColorRef = useRef(track.color);
  const stageMode = game === "setup" ? "setup" : "game";
  const activeDuration = formula === track.formula ? track.duration : 0;

  useEffect(()=>{trackColorRef.current=track.color},[track.color]);

  const stopAudio = useCallback(() => {
    audioRequestRef.current+=1;
    gameActiveRef.current = false;
    if (countdownTimerRef.current) { clearInterval(countdownTimerRef.current); countdownTimerRef.current = null; }
    pendingWorkerRef.current?.terminate();pendingWorkerRef.current=null;
    const audio = audioRef.current;
    if (audio) { audio.worker.terminate(); audio.processor.disconnect(); audio.filter.disconnect(); audio.gain.disconnect(); void audio.ctx.close(); }
    audioRef.current = null;
    setAudioOn(false);setAudioKind(null);
  }, []);

  const damageSync = useCallback((amount: number) => {
    setHealth(value => modifiers.noFail ? Math.max(1,value-amount) : clamp(value-amount,0,100));
  }, [modifiers.noFail]);

  const incrementCombo = useCallback(() => {
    setCombo(value => {
      const next = value + 1;
      statsRef.current.maxCombo = Math.max(statsRef.current.maxCombo, next);
      return next;
    });
  }, []);

  const recordGrade = useCallback((note: Note, grade: Grade) => {
    if (note.grade) return;
    note.grade = grade;
    statsRef.current[grade] += 1;
    statsRef.current.total += 1;
  }, []);

  const recordMiss = useCallback((note: Note) => {
    if (note.grade) statsRef.current[note.grade] = Math.max(0, statsRef.current[note.grade] - 1);
    else statsRef.current.total += 1;
    note.grade = undefined;
    statsRef.current.miss += 1;
  }, []);

  const finishRun = useCallback((outcome: "complete" | "failed") => {
    freezeTimeRef.current=(performance.now()-startRef.current)/1000;
    gameActiveRef.current=false;
    setRunOutcome(outcome);
    setFinalStats({...statsRef.current});
    stopAudio();
    setStatus(outcome === "complete" ? "WAVE COMPLETE" : "SIGNAL LOST");
    setGame("results");
  }, [stopAudio]);

  const startAudio = useCallback(async (kind: "preview" | "game" = "game", override?: Partial<{ formula: string; mode: SignalMode; hz: number; n: number; volume: number }>) => {
    stopAudio();
    const requestId=audioRequestRef.current;
    const source = override?.formula ?? formula;
    const mode = override?.mode ?? signalMode;
    const hz = override?.hz ?? formulaHz;
    const n = override?.n ?? nValue;
    const outputVolume = override?.volume ?? volume;
    const contextOptions: AudioContextOptions = { latencyHint: "interactive" };
    if(mode==="funcbeat")contextOptions.sampleRate=clamp(Math.round(hz),8000,96000);
    const ctx = new AudioContext(contextOptions);
    try { await ctx.resume(); } catch { setStatus("CLICK PREVIEW TO ENABLE AUDIO"); return false; }
    const processor = ctx.createScriptProcessor(1024, 0, 2);
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter(); filter.type="lowpass"; filter.frequency.value=Math.min(22000,ctx.sampleRate*.49); filter.Q.value=Math.SQRT1_2;
    const delay = ctx.createDelay(3);
    delay.delayTime.value = kind === "game" ? 1.6 : 0;
    gain.gain.value = clamp(outputVolume / 100, 0, 1.5) * (kind === "preview" ? .22 : 1);
    playbackSpeedRef.current=1;
    const renderWorker=new Worker(new URL("formula-worker.js",document.baseURI),{type:"module"});pendingWorkerRef.current=renderWorker;
    const sampleQueue:PcmBlock[]=[];let pendingBlocks=0;let workerRuntimeError="";let resolveReady:()=>void=()=>{};let rejectReady:(error:Error)=>void=()=>{};let resolveFirst:()=>void=()=>{};
    const readyPromise=new Promise<void>((resolve,reject)=>{resolveReady=resolve;rejectReady=reject});
    const firstBlockPromise=new Promise<void>(resolve=>{resolveFirst=resolve});
    const targetBlocks=kind==="game"?12:8;
    const requestBlocks=()=>{while(sampleQueue.length+pendingBlocks<targetBlocks){pendingBlocks+=1;renderWorker.postMessage({type:"render",speed:playbackSpeedRef.current})}};
    renderWorker.onmessage=(event:MessageEvent<{type:string;left?:Float32Array;right?:Float32Array;message?:string}>)=>{const message=event.data;if(message.type==="ready"){resolveReady();return}if(message.type==="compile-error"){rejectReady(new Error(message.message||"formula worker error"));return}if(message.type==="runtime-error"){workerRuntimeError=message.message||"UNKNOWN ERROR";setStatus(`RUNTIME ERROR: ${workerRuntimeError.toUpperCase().slice(0,48)}`);return}if(message.type==="chunk"&&message.left&&message.right){pendingBlocks=Math.max(0,pendingBlocks-1);sampleQueue.push({left:message.left,right:message.right});resolveFirst()}};
    renderWorker.onerror=()=>rejectReady(new Error("formula worker failed"));
    renderWorker.postMessage({type:"init",source,mode,formulaRate:hz,outputRate:ctx.sampleRate,n,chunkSize:processor.bufferSize});
    try{await Promise.race([readyPromise,new Promise<void>((_,reject)=>setTimeout(()=>reject(new Error("formula worker timeout")),8000))]);requestBlocks();await Promise.race([firstBlockPromise,new Promise<void>((_,reject)=>setTimeout(()=>reject(new Error("audio buffer timeout")),8000))]);if(workerRuntimeError)throw new Error(workerRuntimeError)}
    catch{renderWorker.terminate();pendingWorkerRef.current=null;void ctx.close();if(audioRequestRef.current===requestId)setStatus(workerRuntimeError?`RUNTIME ERROR: ${workerRuntimeError.toUpperCase().slice(0,48)}`:"FORMULA WORKER ERROR");return false}
    if(audioRequestRef.current!==requestId){renderWorker.terminate();pendingWorkerRef.current=null;void ctx.close();return false}
    let previousMono = 0; let previousEnergy = 0; let previousPeak = 0; let adaptiveFlux = .025; let adaptiveEnergy = 0; let lastOnsetAt = -10; let lastMelodyAt = -10; let eventIndex = 0;let pitchFrame=0;let pitch={midi:0,confidence:0};
    let smoothedPitch = 60; let lastStablePitch = 60;
    const analysisMono = new Float32Array(processor.bufferSize);
    processor.onaudioprocess = (event) => {
      const left = event.outputBuffer.getChannelData(0);
      const right = event.outputBuffer.getChannelData(1);
      let energy = 0; let peak = 0; let flux = 0;
      const block=sampleQueue.shift();if(block){left.set(block.left);right.set(block.right)}else{left.fill(0);right.fill(0)}requestBlocks();
      for (let i = 0; i < left.length; i++) {
          const l=left[i],r=right[i];
          const mono = (l + r) / 2; analysisMono[i] = mono; flux += Math.abs(mono - previousMono); previousMono = mono;
          const amp = (Math.abs(l) + Math.abs(r)) / 2;
          energy += amp; peak = Math.max(peak, amp);
          if (i % 8 === 0) spectrumRef.current.wave[(i / 8) % 128] = (l + r) / 2;
      }
      const blockEnergy = energy / left.length; const blockFlux = flux / left.length;
      adaptiveFlux = adaptiveFlux * .965 + blockFlux * .035;
      adaptiveEnergy = adaptiveEnergy ? adaptiveEnergy * .998 + blockEnergy * .002 : Math.max(.025, blockEnergy);
      const onsetScore = Math.max(0, blockEnergy - previousEnergy) * 1.65 + Math.max(0, peak - previousPeak) * .22 + Math.max(0, blockFlux - adaptiveFlux) * .85;
      const relativeEnergy = blockEnergy / Math.max(.025, adaptiveEnergy);
      const rawIntensity = clamp((relativeEnergy - .55) * .62 + onsetScore * 3.2 + peak * .14, 0, 1);
      if(kind==="game"&&pitchFrame++%6===0)pitch=detectPitch(analysisMono,ctx.sampleRate);
      spectrumRef.current.energy = blockEnergy;
      spectrumRef.current.peak = peak;
      spectrumRef.current.flux = blockFlux;
      spectrumRef.current.onset = Math.max(onsetScore, spectrumRef.current.onset * .72);
      spectrumRef.current.intensity = spectrumRef.current.intensity * .86 + rawIntensity * .14;
      spectrumRef.current.silence = blockEnergy < .025 && peak < .075;
      spectrumRef.current.pitch = pitch.midi;
      spectrumRef.current.pitchConfidence = pitch.confidence;
      const beat = 60 / track.bpm;
      const sectionIntensity = spectrumRef.current.intensity;
      const relaxedCooldown = difficulty === 1 ? .9 : difficulty === 2 ? .58 : .34;
      const intenseCooldown = difficulty === 1 ? .46 : difficulty === 2 ? .24 : .11;
      const onsetCooldown = beat * (relaxedCooldown - (relaxedCooldown-intenseCooldown) * sectionIntensity);
      const sensitivityScale = clamp((115-sensitivity)/55,.45,1.55);
      const onsetThreshold = (.018 + adaptiveFlux * .42) * sensitivityScale;
      const pitchGate = mode === "bytebeat" || mode === "signed" ? .72 : mode === "funcbeat" ? .64 : .58;
      if(blockEnergy>.025&&onsetScore>onsetThreshold*1.05)spectrumRef.current.beatPulse=Math.max(spectrumRef.current.beatPulse,clamp(onsetScore/(onsetThreshold*3),.35,1));
      if (kind === "game" && gameActiveRef.current && ctx.currentTime - lastOnsetAt > onsetCooldown && onsetScore > onsetThreshold) {
        const relativeNow = (performance.now() - startRef.current) / 1000;
        const strength = clamp(onsetScore * 5 + peak * .35, 0, 1);
        const patterns = difficulty === 1 ? [0,0,2,1,1,3,2,2] : difficulty === 2 ? [0,0,1,3,3,2,2,1,0,2] : [0,0,3,1,1,2,2,3,0,3,3,1];
        const tonalLane = clamp(Math.round(1.5 + (pitch.midi - smoothedPitch) / 2.5), 0, 3);
        const lane = pitch.confidence > pitchGate ? tonalLane : patterns[eventIndex % patterns.length];
        const stableTone = blockEnergy > .27 && blockFlux < Math.max(.22, adaptiveFlux * 1.45);
        const holdEvery = difficulty === 1 ? 12 : difficulty === 2 ? 10 : 7;
        const hold = stableTone && eventIndex > 0 && eventIndex % holdEvery === 0;
        rhythmEventsRef.current.push({ hitAt: relativeNow + 1.6, lane, strength, hold, duration: hold ? beat * (difficulty === 3 ? 2.25 : difficulty === 2 ? 1.5 : 1.25) : 0, source: "transient" });
        if (rhythmEventsRef.current.length > 32) rhythmEventsRef.current.shift();
        lastOnsetAt = ctx.currentTime; eventIndex++;
      }
      if (kind === "game" && gameActiveRef.current && pitch.confidence > pitchGate && blockEnergy > .055) {
        smoothedPitch = smoothedPitch * .92 + pitch.midi * .08;
        const pitchChange = Math.abs(pitch.midi - lastStablePitch);
        const melodyCooldown = beat * (difficulty === 1 ? .46 : difficulty === 2 ? .28 : .12);
        if (pitchChange > .72 && ctx.currentTime - lastMelodyAt > melodyCooldown && ctx.currentTime - lastOnsetAt > .045) {
          const relativeNow = (performance.now() - startRef.current) / 1000;
          const lane = clamp(Math.round(1.5 + (pitch.midi - smoothedPitch) / 2.5), 0, 3);
          rhythmEventsRef.current.push({ hitAt: relativeNow + 1.6, lane, strength: clamp(pitch.confidence * .7 + pitchChange * .08, 0, 1), hold: false, duration: 0, source: "melody" });
          if (rhythmEventsRef.current.length > 32) rhythmEventsRef.current.shift();
          lastStablePitch = pitch.midi; lastMelodyAt = ctx.currentTime;
        }
      }
      previousEnergy = blockEnergy; previousPeak = peak;
    };
    processor.connect(delay); delay.connect(filter); filter.connect(gain); gain.connect(ctx.destination);
    pendingWorkerRef.current=null;audioRef.current = { ctx, processor, filter, gain, worker:renderWorker,kind };
    setAudioOn(true);setAudioKind(kind); setStatus(kind === "preview" ? "QUIET PREVIEW" : "SIGNAL LOCKED");
    return true;
  }, [difficulty, formula, formulaHz, nValue, sensitivity, signalMode, track.bpm, volume, stopAudio]);

  const chooseTrack = (i: number) => {
    const selected = TRACKS[i];
    setTrackIndex(i); setFormula(selected.formula); setSignalMode(selected.mode); setFormulaHz(selected.hz); setNValue(selected.n); setVolume(selected.volume);
    void startAudio("preview", selected);
  };

  const schedulePreview = (nextFormula = formula, override?: Partial<{ mode: SignalMode; hz: number; n: number; volume: number }>) => {
    if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
    previewTimerRef.current = setTimeout(() => void startAudio("preview", { ...override, formula: nextFormula }), 420);
  };

  const launch = async () => {
    const ok = await startAudio("game"); if (!ok) return;
    if (audioRef.current) await audioRef.current.ctx.suspend();
    notesRef.current = []; particlesRef.current = []; rhythmEventsRef.current = []; laneBusyUntilRef.current = [0,0,0,0]; lastDetectedHitRef.current = -10;
    statsRef.current={...EMPTY_STATS};setFinalStats({...EMPTY_STATS});setRunOutcome("failed");
    setNotes([]); setScore(0); setCombo(0); setHealth(100); setTimeline(0); setPressedLanes([false,false,false,false]); setTimingMs(null);
    freezeTimeRef.current=0; nextBeatRef.current = 1.6; idRef.current = 1; playbackSpeedRef.current=1; gameActiveRef.current = false;
    setCountdown(3); setGame("countdown"); setLastJudgement(""); setStatus("GET READY");
    let remaining=3;
    countdownTimerRef.current=setInterval(()=>{
      remaining-=1;
      if(remaining>0){setCountdown(remaining);return}
      if(countdownTimerRef.current)clearInterval(countdownTimerRef.current);countdownTimerRef.current=null;
      startRef.current=performance.now();gameActiveRef.current=true;void audioRef.current?.ctx.resume();setGame("running");setLastJudgement("SYNC");setStatus("SIGNAL LOCKED");
    },1000);
  };

  const togglePause = useCallback(() => {
    const audio=audioRef.current;
    if(game==="running"){
      freezeTimeRef.current=(performance.now()-startRef.current)/1000;gameActiveRef.current=false;void audio?.ctx.suspend();setGame("paused");setStatus("PAUSED");
    }else if(game==="paused"){
      startRef.current=performance.now()-freezeTimeRef.current*1000;gameActiveRef.current=true;void audio?.ctx.resume();setGame("running");setStatus("SIGNAL LOCKED");
    }
  },[game]);

  const burst = useCallback((lane: number, amount = 16) => {
    const w = window.innerWidth; const h = window.innerHeight - 70;
    const road = Math.min(620, w * .75); const x = w / 2 - road / 2 + road * (lane + .5) / 4;
    for (let i=0;i<amount;i++) particlesRef.current.push({x,y:h*(JUDGE_POSITION/100),vx:(Math.random()-.5)*7,vy:-2-Math.random()*7,life:1,size:2+Math.random()*6});
  }, []);

  const playHitSound = useCallback((lane: number, release = false) => {
    const ctx = audioRef.current?.ctx;
    if (!ctx || ctx.state === "closed") return;
    const oscillator = ctx.createOscillator(); const hitGain = ctx.createGain();
    const frequencies = [440, 523.25, 659.25, 783.99];
    oscillator.type = release ? "sine" : "triangle";
    oscillator.frequency.setValueAtTime(frequencies[lane] * (release ? .75 : 1), ctx.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(frequencies[lane] * (release ? .7 : .92), ctx.currentTime + .07);
    hitGain.gain.setValueAtTime(.0001, ctx.currentTime);
    hitGain.gain.exponentialRampToValueAtTime(release ? .05 : .095, ctx.currentTime + .004);
    hitGain.gain.exponentialRampToValueAtTime(.0001, ctx.currentTime + (release ? .13 : .105));
    oscillator.connect(hitGain); hitGain.connect(ctx.destination); oscillator.start(); oscillator.stop(ctx.currentTime + .14);
  }, []);

  const pressLane = useCallback((lane: number) => {
    if (game !== "running" || modifiers.auto) return;
    setPressedLanes(v => v.map((pressed,i)=>i===lane?true:pressed));
    const timing = TIMING_WINDOWS[difficulty-1];
    const now = (performance.now() - startRef.current) / 1000;
    let best: Note | undefined; let delta = Infinity;
    for (const note of notesRef.current) {
      if (note.lane !== lane || note.hit || note.missed || note.pressed) continue;
      const d = Math.abs(note.hitAt - now); if (d < delta) { delta = d; best = note; }
    }
    if (!best || delta > timing.hit) {
      const upcoming = notesRef.current.find(note => note.lane===lane && !note.hit && !note.missed && note.hitAt > now);
      setTimingMs(null); setLastJudgement(upcoming && upcoming.hitAt-now < .7 ? "WAIT" : "EMPTY"); return;
    }
    const offset = now - best.hitAt; const absoluteOffset = Math.abs(offset);
    const label = absoluteOffset <= timing.perfect ? "PERFECT" : absoluteOffset <= timing.great ? "GREAT" : "GOOD";
    const pts = label === "PERFECT" ? 1000 : label === "GREAT" ? 650 : 350;
    if (best.kind === "hold") { best.pressed = true; setLastJudgement("HOLD"); }
    else { best.hit = true; setLastJudgement(label); }
    recordGrade(best,label.toLowerCase() as Grade);
    setTimingMs(Math.round(offset*1000)); incrementCombo(); setScore(v => v + pts); setHealth(v => clamp(v + 1.2, 0, 100));
    playHitSound(lane);
    burst(lane, best.kind === "hold" ? 10 : 18);
    setNotes([...notesRef.current]);
  }, [burst, difficulty, game, incrementCombo, modifiers.auto, playHitSound, recordGrade]);

  const releaseLane = useCallback((lane: number) => {
    setPressedLanes(v => v.map((pressed,i)=>i===lane?false:pressed));
    if (game !== "running" || modifiers.auto) return;
    const now = (performance.now() - startRef.current) / 1000;
    const hold = notesRef.current.find(note => note.lane===lane && note.kind==="hold" && note.pressed && !note.hit && !note.missed);
    if (!hold) return;
    hold.pressed = false;
    if (now >= hold.hitAt + hold.duration - .16) {
      hold.hit = true; statsRef.current.holds+=1; setTimingMs(Math.round((now-(hold.hitAt+hold.duration))*1000)); setScore(v=>v+Math.round(1200+hold.duration*900)); incrementCombo(); setLastJudgement("RELEASE"); setHealth(v=>clamp(v+3,0,100)); burst(lane,28);
      playHitSound(lane, true);
    } else {
      recordMiss(hold);hold.missed = true; setTimingMs(Math.round((now-(hold.hitAt+hold.duration))*1000)); setCombo(0); setLastJudgement("EARLY"); damageSync(10);
    }
    setNotes([...notesRef.current]);
  }, [burst, damageSync, game, incrementCombo, modifiers.auto, playHitSound, recordMiss]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => { const i = LANES.indexOf(e.key.toUpperCase()); if (i >= 0 && !e.repeat) pressLane(i); if (e.key === "Escape" && !e.repeat) { e.preventDefault(); if(game==="running"||game==="paused")togglePause();else if(game==="countdown"){stopAudio();setGame("setup");setStatus("FORMULA READY")} } };
    const up = (e: KeyboardEvent) => { const i = LANES.indexOf(e.key.toUpperCase()); if (i >= 0) releaseLane(i); };
    window.addEventListener("keydown", down); window.addEventListener("keyup", up); return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, [pressLane, releaseLane, game, stopAudio, togglePause]);

  useEffect(() => {
    if (game !== "running") return;
    const beat = 60 / track.bpm;
    let lastTimelineSync = -1;
    const loop = () => {
      const now = (performance.now() - startRef.current) / 1000;
      let uiDirty = false;
      if (now - lastTimelineSync >= .1) { lastTimelineSync = now; setTimeline(now); }
      if(activeDuration>0&&now>=activeDuration){finishRun("complete");return}
      const gridStep = difficulty === 1 ? beat / 4 : difficulty === 2 ? beat / 4 : beat / 8;
      const addNote = (hitAt: number, desiredLane: number, hold: boolean, duration: number) => {
        if(activeDuration>0&&hitAt>activeDuration-.18)return;
        if(activeDuration>0&&hold){duration=Math.min(duration,activeDuration-hitAt-.12);if(duration<.3)hold=false}
        const cluster = notesRef.current.find(note=>Math.abs(note.hitAt-hitAt)<gridStep*.24);
        if(cluster) hitAt=cluster.hitAt;
        if (notesRef.current.some(note=>Math.abs(note.hitAt-hitAt)<.085 && note.lane===desiredLane)) return;
        let lane = desiredLane; let found = false;
        const laneOffsets=[0,2,1,3];
        for(const offset of laneOffsets){const candidate=(desiredLane+offset)%4;if(laneBusyUntilRef.current[candidate] < hitAt-.025){lane=candidate;found=true;break}}
        if(!found) return;
        notesRef.current.push({id:idRef.current++,lane,born:now,hitAt,kind:hold?"hold":"tap",duration:hold?duration:0});
        laneBusyUntilRef.current[lane]=hitAt+(hold?duration:.045)+.025;
        uiDirty = true;
      };

      const detected = rhythmEventsRef.current.splice(0);
      for(const event of detected){
        const hitAt=1.6+Math.round((event.hitAt-1.6)/gridStep)*gridStep;
        const baseSpacing=difficulty===1?beat*.46:difficulty===2?beat*.28:beat*.11;
        const minimumSpacing=event.strength>.7?baseSpacing*.72:baseSpacing;
        const sameCluster=Math.abs(hitAt-lastDetectedHitRef.current)<gridStep*.12;
        if(hitAt<now+.28 || (!sameCluster && hitAt-lastDetectedHitRef.current<minimumSpacing)) continue;
        if(sameCluster && (difficulty===1 || event.strength<.62)) continue;
        const allowHold=event.hold && (difficulty>1 || Math.round((hitAt-1.6)/beat)%12===0);
        addNote(hitAt,event.lane,allowHold,event.duration || beat*1.25);
        lastDetectedHitRef.current=Math.max(lastDetectedHitRef.current,hitAt);
      }

      while (now + 1.6 > nextBeatRef.current) {
        const signal=spectrumRef.current;
        const threshold = (100 - sensitivity) / 175;
        const subdivision = gridStep;
        const step = Math.round((nextBeatRef.current-1.6) / subdivision);
        const noNearbyDetection = Math.abs(nextBeatRef.current-lastDetectedHitRef.current) > subdivision*.62;
        const activity=clamp(signal.intensity+signal.energy*.34+signal.flux*.7,0,1);
        const gapSinceEvent=nextBeatRef.current-lastDetectedHitRef.current;
        const rescueGap=beat*(difficulty===1?2.5:difficulty===2?1.75:1.25);
        const clearAttack=signal.onset>(.018+threshold*.035) && activity>(difficulty===1?.3:difficulty===2?.24:.18);
        const rescueEvent=gapSinceEvent>rescueGap && clearAttack;
        if(noNearbyDetection && !signal.silence && rescueEvent){
          const patterns=difficulty===1?[0,0,2,1,1,3]:difficulty===2?[0,0,1,3,3,2,2,1]:[0,0,3,1,1,2,2,3];
          const lane=patterns[(step+trackIndex*2)%patterns.length];
          const stableSignal=signal.pitchConfidence>.48 || (signal.energy>.18 && signal.peak<signal.energy*2.8);
          const holdCycle=difficulty===1?24:difficulty===2?28:32;
          const isHold=step>8 && step%holdCycle===0 && stableSignal;
          const holdDuration=beat*(difficulty===1?1.25:difficulty===2?1.5:2.25);
          addNote(nextBeatRef.current,lane,isHold,isHold?holdDuration:0);
          lastDetectedHitRef.current=nextBeatRef.current;
        }
        nextBeatRef.current += subdivision;
      }
      if(modifiers.auto){
        for(const note of notesRef.current){
          if(note.hit||note.missed||now<note.hitAt) continue;
          if(note.kind==="hold"&&!note.pressed){recordGrade(note,"perfect");note.pressed=true;uiDirty=true;setPressedLanes(v=>v.map((pressed,i)=>i===note.lane?true:pressed));setLastJudgement("AUTO HOLD");setTimingMs(0);setScore(v=>v+1000);incrementCombo();burst(note.lane,10)}
          else if(note.kind==="tap"){recordGrade(note,"perfect");note.hit=true;uiDirty=true;setLastJudgement("AUTO");setTimingMs(0);setScore(v=>v+1000);incrementCombo();burst(note.lane,16)}
        }
      }
      for (const note of notesRef.current) {
        if (note.kind === "hold" && note.pressed && !note.hit && !note.missed && now >= note.hitAt + note.duration) {
          note.pressed = false; note.hit = true; uiDirty = true; statsRef.current.holds+=1; setPressedLanes(v=>v.map((pressed,i)=>i===note.lane?false:pressed)); setTimingMs(0); setScore(v=>v+Math.round(1200+note.duration*900)); incrementCombo(); setLastJudgement(modifiers.auto?"AUTO RELEASE":"HELD"); setHealth(v=>clamp(v+3,0,100)); burst(note.lane,28);
        } else if (!note.hit && !note.missed && !note.pressed && now - note.hitAt > TIMING_WINDOWS[difficulty-1].hit) {
          recordMiss(note);note.missed = true; uiDirty = true; setTimingMs(null); setCombo(0); damageSync(TIMING_WINDOWS[difficulty-1].missDamage); setLastJudgement("MISS");
        }
      }
      const previousLength = notesRef.current.length;
      notesRef.current = notesRef.current.filter(n => now - (n.hitAt + n.duration) < .75);
      if (notesRef.current.length !== previousLength) uiDirty = true;

      // Note motion bypasses React and stays on the compositor at the display refresh rate.
      const laneHeight=highwayRef.current?.clientHeight||window.innerHeight*.89;
      for(const note of notesRef.current){
        const element=noteElementsRef.current.get(note.id);if(!element)continue;
        const travel=1-(note.hitAt-now)/1.6;
        const progress=clamp(travel,-.15,1+note.duration/1.6+.2);
        element.style.setProperty("--note-y",`${progress*JUDGE_POSITION/100*laneHeight}px`);
        if(modifiers.hidden&&!note.hit&&!note.missed)element.style.opacity=String(clamp((.78-travel)/.3,0,1));else element.style.removeProperty("opacity");
      }
      if(uiDirty)setNotes([...notesRef.current]);
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop); return () => cancelAnimationFrame(rafRef.current);
  }, [game, difficulty, sensitivity, track.bpm, trackIndex, burst, damageSync, modifiers.auto, modifiers.hidden, activeDuration, finishRun, incrementCombo, recordGrade, recordMiss]);

  useEffect(()=>{
    if(game!=="running"||health>0||modifiers.noFail)return;
    const animationId=requestAnimationFrame(()=>{freezeTimeRef.current=(performance.now()-startRef.current)/1000;gameActiveRef.current=false;setRunOutcome("failed");setFinalStats({...statsRef.current});setLastJudgement("DESYNC");setTimingMs(null);setStatus("SIGNAL COLLAPSE");setGame("failing")});
    return()=>cancelAnimationFrame(animationId);
  },[game,health,modifiers.noFail]);

  useEffect(()=>{
    if(game!=="failing")return;
    const started=performance.now();let animationId=0;
    const collapse=()=>{const progress=clamp((performance.now()-started)/2500,0,1);playbackSpeedRef.current=Math.pow(1-progress,2);const audio=audioRef.current;if(audio){audio.filter.frequency.setTargetAtTime(90+Math.pow(1-progress,2)*19910,audio.ctx.currentTime,.06);audio.gain.gain.setTargetAtTime(Math.max(.015,(1-progress)*volume/100),audio.ctx.currentTime,.08)}if(progress<1)animationId=requestAnimationFrame(collapse);else finishRun("failed")};
    animationId=requestAnimationFrame(collapse);return()=>cancelAnimationFrame(animationId);
  },[game,finishRun,volume]);

  useEffect(() => {
    const canvas=canvasRef.current;if(!canvas)return;
    const ctx=canvas.getContext("2d",{alpha:false,desynchronized:true});if(!ctx)return;
    const visualWave=new Float32Array(16);let animationId=0,lastFrame=0,lastPaint=0,sampleTime=0,sampleFrames=0,quality=stageMode==="setup"?.92:.64,travel=0,visualEnergy=0,visualBeat=0,visualIntensity=0,visualTransient=0,visualPitch=.5;
    const rgba=(hex:string,alpha:number)=>{const [r,g,b]=colorChannels(hex).map(value=>Math.round(value*255));return `rgba(${r},${g},${b},${alpha})`};
    const rotatePoint=(point:[number,number,number],yaw:number,pitchAngle:number)=>{const [x,y,z]=point,cy=Math.cos(yaw),sy=Math.sin(yaw),cx=Math.cos(pitchAngle),sx=Math.sin(pitchAngle),rx=x*cy-z*sy,rz=x*sy+z*cy;return [rx,y*cx-rz*sx,y*sx+rz*cx] as [number,number,number]};
    const cubePoints:[number,number,number][]=Array.from({length:8},(_,i)=>[i&1?1:-1,i&2?1:-1,i&4?1:-1]);
    const cubeEdges=[[0,1],[0,2],[0,4],[1,3],[1,5],[2,3],[2,6],[3,7],[4,5],[4,6],[5,7],[6,7]];
    const octaPoints:[number,number,number][]=[[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
    const octaEdges=[[0,2],[0,3],[0,4],[0,5],[1,2],[1,3],[1,4],[1,5],[2,4],[2,5],[3,4],[3,5]];
    const drawShape=(cx:number,cy:number,size:number,yaw:number,pitchAngle:number,octa:boolean,color:string,alpha:number)=>{const points=octa?octaPoints:cubePoints,edges=octa?octaEdges:cubeEdges,projected=points.map(point=>{const [x,y,z]=rotatePoint(point,yaw,pitchAngle),perspective=3/(3.4+z);return [cx+x*size*perspective,cy+y*size*perspective]});ctx.beginPath();for(const [a,b] of edges){ctx.moveTo(projected[a][0],projected[a][1]);ctx.lineTo(projected[b][0],projected[b][1])}ctx.strokeStyle=rgba(color,alpha);if(stageMode==="setup"){ctx.shadowColor=color;ctx.shadowBlur=Math.min(20,size*.2)}ctx.stroke();ctx.shadowBlur=0};
    const draw=(now:number)=>{const frameInterval=stageMode==="game"?1000/90:0;if(now-lastPaint<frameInterval){animationId=requestAnimationFrame(draw);return}lastPaint=now;const rect=canvas.getBoundingClientRect(),delta=lastFrame?Math.min(50,now-lastFrame):0;lastFrame=now;if(delta>0){sampleTime+=delta;sampleFrames++}if(sampleFrames>=120){const average=sampleTime/sampleFrames,maxQuality=stageMode==="setup"?.92:.64,minQuality=stageMode==="setup"?.58:.46;quality=average>20?Math.max(minQuality,quality-.08):average<11?Math.min(maxQuality,quality+.04):quality;sampleTime=0;sampleFrames=0}const ratio=Math.min(devicePixelRatio,1.25)*quality,width=Math.max(2,Math.round(rect.width*ratio)),height=Math.max(2,Math.round(rect.height*ratio));if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height}ctx.setTransform(ratio,0,0,ratio,0,0);const w=rect.width,h=rect.height,horizon=h*.36,signal=spectrumRef.current,active=stageMode==="setup"||gameActiveRef.current;signal.beatPulse*=active?.88:.72;const targetEnergy=active?clamp(signal.energy*2.3+signal.peak*.28,0,1):0,targetIntensity=active?clamp(signal.intensity,0,1):0,targetTransient=active?clamp(signal.onset*4.2+signal.flux*1.4,0,1):0,targetPitch=active&&signal.pitchConfidence>.35?((signal.pitch%12)+12)%12/12:.5;visualEnergy+=(targetEnergy-visualEnergy)*.08;visualIntensity+=(targetIntensity-visualIntensity)*.055;visualTransient+=(targetTransient-visualTransient)*(targetTransient>visualTransient?.28:.075);visualBeat+=(signal.beatPulse-visualBeat)*(signal.beatPulse>visualBeat?.34:.1);visualPitch+=(targetPitch-visualPitch)*.025;for(let i=0;i<16;i++){const sample=Math.abs(signal.wave[(i*7+3)%signal.wave.length]);visualWave[i]+=(clamp(sample*1.7,0,1)-visualWave[i])*(sample>visualWave[i]?.32:.12)}travel=(travel+delta*.001*(.16+visualIntensity*.34+visualBeat*.13))%100;const accent=trackColorRef.current,drive=clamp(.16+visualEnergy*.62+visualIntensity*.54,0,1),hit=clamp(visualBeat*.9+visualTransient*.72,0,1),vanishX=w*(.5+(visualPitch-.5)*.04);
      ctx.globalCompositeOperation="source-over";ctx.fillStyle="#030706";ctx.fillRect(0,0,w,h);const sky=ctx.createRadialGradient(vanishX,horizon,0,vanishX,horizon,Math.max(w,h)*.72);sky.addColorStop(0,rgba(accent,.12+drive*.06));sky.addColorStop(.42,"rgba(4,13,14,.78)");sky.addColorStop(1,"#020403");ctx.fillStyle=sky;ctx.fillRect(0,0,w,h);
      ctx.globalCompositeOperation="lighter";ctx.lineWidth=1;ctx.strokeStyle=rgba(accent,.12+drive*.16);ctx.shadowColor=accent;ctx.shadowBlur=stageMode==="setup"?6+drive*7:0;for(let i=-8;i<=8;i++){ctx.beginPath();ctx.moveTo(vanishX,horizon);ctx.lineTo(vanishX+i*w*.1,h);ctx.stroke()}const gridRows=stageMode==="setup"?18:12;for(let i=0;i<gridRows;i++){const phase=(i/gridRows+travel*.24)%1,y=horizon+phase*phase*(h-horizon)*1.12;ctx.beginPath();for(let j=0;j<=10;j++){const x=j/10*w,wave=Math.sin(j*.72+travel*3.2+phase*5.)*(3+visualEnergy*11)*phase;if(j===0)ctx.moveTo(x,y+wave);else ctx.lineTo(x,y+wave)}ctx.globalAlpha=.18+phase*.5;ctx.stroke()}ctx.globalAlpha=1;ctx.shadowBlur=0;
      const scanPhase=(travel*.58)%1,scanY=horizon+scanPhase*scanPhase*(h-horizon);ctx.strokeStyle=rgba("#ff4fd8",.12+hit*.58);ctx.shadowColor="#ff4fd8";ctx.shadowBlur=stageMode==="setup"?12+hit*18:0;ctx.lineWidth=1+hit*2;ctx.beginPath();ctx.moveTo(0,scanY);ctx.lineTo(w,scanY);ctx.stroke();ctx.shadowBlur=0;
      const barWidth=Math.max(3,w*.018),barGap=w*.006,total=16*barWidth+15*barGap,startX=(w-total)/2;for(let i=0;i<16;i++){const amp=10+visualWave[i]*(h*.16+visualEnergy*h*.12)+visualIntensity*h*.035,x=startX+i*(barWidth+barGap),barColor=i<8?accent:"#ff4fd8";ctx.fillStyle=rgba(barColor,.28+drive*.42);if(stageMode==="setup"){ctx.shadowColor=barColor;ctx.shadowBlur=5+drive*7}ctx.fillRect(x,horizon-amp,barWidth,amp)}ctx.shadowBlur=0;
      const shapeCount=stageMode==="setup"?6:4;for(let i=0;i<shapeCount;i++){const phase=(i/shapeCount+travel*.2)%1,side=i%2?-1:1,size=(18+phase*phase*95)*(1+hit*.28),cx=vanishX+side*(w*.12+phase*w*.39),cy=horizon+Math.pow(phase,1.7)*h*.54+Math.sin(now*.00045+i*1.9)*8,fade=Math.sin(Math.PI*phase),shapeColor=i%3===0?"#ff4fd8":accent;ctx.lineWidth=1+phase*1.6;drawShape(cx,cy,size,now*.00028*(1+i*.08)+i+visualPitch*2.4,now*.00019+i*.43,i%2===0,shapeColor,(.28+drive*.52+hit*.38)*fade)}
      ctx.globalCompositeOperation="source-over";const vignette=ctx.createRadialGradient(w*.5,h*.5,Math.min(w,h)*.18,w*.5,h*.5,Math.max(w,h)*.72);vignette.addColorStop(.45,"rgba(0,0,0,0)");vignette.addColorStop(1,"rgba(0,0,0,.7)");ctx.fillStyle=vignette;ctx.fillRect(0,0,w,h);animationId=requestAnimationFrame(draw)};
    animationId=requestAnimationFrame(draw);return()=>cancelAnimationFrame(animationId);
  }, [stageMode]);

  useEffect(()=>{if(game==="setup")return;const canvas=particleCanvasRef.current;if(!canvas)return;const ctx=canvas.getContext("2d",{alpha:true});if(!ctx)return;let animationId=0,lastPaint=0;const draw=(now:number)=>{if(now-lastPaint<1000/90){animationId=requestAnimationFrame(draw);return}lastPaint=now;const rect=canvas.getBoundingClientRect();if(canvas.width!==Math.round(rect.width)||canvas.height!==Math.round(rect.height)){canvas.width=Math.round(rect.width);canvas.height=Math.round(rect.height)}ctx.clearRect(0,0,canvas.width,canvas.height);ctx.globalCompositeOperation="lighter";particlesRef.current=particlesRef.current.filter(p=>p.life>0);for(const p of particlesRef.current){p.x+=p.vx;p.y+=p.vy;p.vy+=.14;p.life-=.025;ctx.globalAlpha=p.life;ctx.fillStyle=track.color;ctx.fillRect(p.x,p.y,p.size,p.size)}ctx.globalAlpha=1;animationId=requestAnimationFrame(draw)};animationId=requestAnimationFrame(draw);return()=>cancelAnimationFrame(animationId)},[game,track.color]);

  useEffect(() => () => stopAudio(), [stopAudio]);

  const finalAccuracy = accuracyOf(finalStats);
  const finalRank = rankOf(finalStats,modifiers.auto);

  return (
    <main style={{ "--accent": track.color } as React.CSSProperties}>
      <header className="topbar"><div className="brand"><span>F//B</span><b>FORMULA BEAT</b></div><div className="signal"><i className={audioOn&&game!=="paused"&&game!=="countdown" ? "live" : ""}/>{status}</div><div className="edition">EXPERIMENTAL BUILD · 001</div></header>

      {game === "setup" && <section className="setup-shell">
        <div className="intro"><p className="eyebrow">FUNCBEAT RHYTHM SYSTEM</p><h1>TURN CODE<br/><em>INTO RHYTHM.</em></h1><p className="lead">Каждая формула — одновременно музыка, визуальная система и новая игровая карта.</p></div>
        <div className="track-panel">
          <div className="panel-title"><span>01</span><div><b>SELECT SIGNAL</b><small>{TRACKS.length} FORMULAS LOADED</small></div></div>
          <div className="track-list">{TRACKS.map((item,i)=><button key={item.name} onClick={()=>chooseTrack(i)} className={i===trackIndex?"selected":""}><span className="num">0{i+1}</span><div><b>{item.name}</b><small>{item.blurb} · {item.mode}</small></div><span className="bpm">{item.bpm}<small>BPM</small></span></button>)}</div>
        </div>
        <div className="visual-card"><canvas ref={canvasRef}/><div className="visual-label"><span>LIVE SIGNAL</span><b>{track.name}</b></div><div className="reticle">+</div></div>
        <div className="config-panel">
          <div className="panel-title"><span>02</span><div><b>CALIBRATE</b><small>GAMEPLAY RESPONSE</small></div></div>
          <label>SIGNAL MODE <span>{signalMode.toUpperCase()}</span></label><div className="mode-tabs">{(["funcbeat","floatbeat","bytebeat","signed"] as SignalMode[]).map(mode=><button key={mode} onClick={()=>{setSignalMode(mode);schedulePreview(formula,{mode})}} className={signalMode===mode?"on":""}>{mode === "signed" ? "SIGNED 8-BIT" : mode.toUpperCase()}</button>)}</div>
          <div className="parameter-grid">
            <label><span>FORMULA Hz</span><input aria-label="Formula sample rate in hertz" type="number" min="1000" max="96000" step="100" value={formulaHz} onChange={e=>{const hz=clamp(+e.target.value||1000,1000,96000);setFormulaHz(hz);schedulePreview(formula,{hz})}}/></label>
            <label><span>n VALUE</span><input aria-label="Formula n value" type="number" min="-16" max="16" step="0.05" value={nValue} onChange={e=>{const n=clamp(+e.target.value||0,-16,16);setNValue(n);schedulePreview(formula,{n})}}/></label>
            <label><span>VOLUME %</span><input aria-label="Volume percent" type="number" min="0" max="150" step="1" value={volume} onChange={e=>{const nextVolume=clamp(+e.target.value||0,0,150);setVolume(nextVolume);schedulePreview(formula,{volume:nextVolume})}}/></label>
          </div>
          <label>DIFFICULTY <span>{["FLOW","PULSE","OVERDRIVE"][difficulty-1]}</span></label><div className="segments">{[1,2,3].map(n=><button aria-label={`Difficulty ${n}`} onClick={()=>setDifficulty(n)} className={difficulty===n?"on":""} key={n}/>)}</div>
          <p className="difficulty-copy">{difficulty===1?"ADAPTIVE BEATS · SHORT HOLDS · ±220 ms":difficulty===2?"GROOVED 1/2 BEATS · LIGHT HOLDS · ±190 ms":"DYNAMIC TRANSIENT MAP · LONG HOLDS · ±140 ms"}</p>
          <label>MODIFIERS <span>{Object.values(modifiers).filter(Boolean).length || "OFF"}</span></label>
          <div className="modifier-grid">
            <button className={modifiers.auto?"on":""} onClick={()=>setModifiers(m=>({...m,auto:!m.auto}))}><b>AUTO</b><span>AUTOBOT</span><small>UNRANKED</small></button>
            <button className={modifiers.noFail?"on":""} onClick={()=>setModifiers(m=>({...m,noFail:!m.noFail}))}><b>NF</b><span>NO FAIL</span><small>SYNC ≥ 1%</small></button>
            <button className={modifiers.hidden?"on":""} onClick={()=>setModifiers(m=>({...m,hidden:!m.hidden}))}><b>HD</b><span>HIDDEN</span><small>FADE NOTES</small></button>
          </div>
          <label>SIGNAL SENSITIVITY <span>{sensitivity}%</span></label><input type="range" min="30" max="90" value={sensitivity} onChange={e=>setSensitivity(+e.target.value)}/>
          <button className="preview-button" onClick={()=>audioKind === "preview" ? stopAudio() : void startAudio("preview")}>{audioKind === "preview" ? "■ STOP PREVIEW" : "▶ QUIET PREVIEW"}</button>
          <button className="launch" onClick={launch}><span>INITIALIZE RUN</span><b>↗</b></button><p className="hint">KEYS&nbsp; D · F · J · K &nbsp;/&nbsp; TOUCH</p>
        </div>
        <section className="formula-panel" aria-labelledby="formula-source-title">
          <div className="panel-title formula-panel-title"><span>03</span><div><b id="formula-source-title">FORMULA SOURCE</b><small>EDIT / PASTE BYTEBEAT</small></div></div>
          <textarea aria-label="Formula source" spellCheck={false} value={formula} onChange={e=>{const value=e.target.value;setFormula(value);setStatus("COMPILING PREVIEW");schedulePreview(value)}}/>
          <div className="mode-help"><b>{signalMode.toUpperCase()}</b><span>{signalMode === "bytebeat" ? "0…255 → преобразуется в −1…1" : signalMode === "signed" ? "−128…127 → преобразуется в −1…1" : signalMode === "funcbeat" ? "function(time, sampleRate, n) или stateful-выражение; формат определяется автоматически" : "готовый сигнал −1…1 без 8-битного преобразования"}</span></div>
          <div className="editor-foot"><span>{signalMode==="funcbeat"?"AUTO PROGRAM / EXPRESSION · NATIVE RATE · STEREO":"JS EXPRESSION · t, sr, n AVAILABLE · DEBUG THROW SAFE"}</span><button onClick={()=>void startAudio("preview")}>CHECK + PREVIEW</button></div>
        </section>
      </section>}

      {game !== "setup" && <section className={`game-shell ${game} ${modifiers.hidden?"hidden-mod":""}`}>
        <canvas ref={canvasRef} className="game-bg"/>
        <canvas ref={particleCanvasRef} className="game-particles"/>
        <div className="game-hud"><div><small>SCORE</small><b>{score.toString().padStart(7,"0")}</b></div><div className="now-playing"><i/><span>{track.name}<small>{track.bpm} BPM · {signalMode.toUpperCase()} · {formulaHz} Hz · {activeDuration?`${formatTime(timeline)} / ${formatTime(activeDuration)}`:"ENDLESS"}{modifiers.auto?" · AUTOBOT":""}</small></span></div><div className="hp"><small>SYNC</small><span><i style={{width:`${health}%`}}/></span></div></div>
        <div className="highway" ref={highwayRef}><div className="hit-guide"><span>HIT ZONE</span><small>PERFECT ±{Math.round(TIMING_WINDOWS[difficulty-1].perfect*1000)} ms</small></div>{LANES.map((key,lane)=><button key={key} onPointerDown={e=>{e.currentTarget.setPointerCapture(e.pointerId);pressLane(lane)}} onPointerUp={()=>releaseLane(lane)} onPointerCancel={()=>releaseLane(lane)} className={`lane ${pressedLanes[lane]?"pressed":""}`}><span className="rail"/><b>{key}</b>{notes.filter(n=>n.lane===lane).map(n=><i key={n.id} ref={element=>{if(element)noteElementsRef.current.set(n.id,element);else noteElementsRef.current.delete(n.id)}} className={`note ${n.kind} ${n.pressed?"holding":""} ${n.hit?"hit":""} ${n.missed?"missed":""}`} style={{height:n.kind==="hold"?`${Math.max(10,n.duration/1.6*JUDGE_POSITION)}%`:undefined}}/>)}</button>)}</div>
        <div className={`judgement ${lastJudgement.toLowerCase()}`}>{lastJudgement}<small>{timingMs!==null?`${timingMs>0?"+":""}${timingMs} ms`:combo>1?`${combo}× COMBO`:""}</small></div>
        <button className="exit" onClick={()=>{if(game==="running"||game==="paused")togglePause();else{stopAudio();setGame("setup");setStatus("FORMULA READY")}}}>{game==="paused"?"ESC · RESUME":game==="running"?"ESC · PAUSE":"ESC · ABORT"}</button>
        {game === "countdown" && <div className="countdown-overlay"><small>CALIBRATING PLAYFIELD</small><b key={countdown}>{countdown}</b><span>GET READY</span></div>}
        {game === "paused" && <div className="pause-overlay"><p>SIGNAL FROZEN</p><h2>PAUSED</h2><small>THE AUDIO AND NOTE TIMELINE ARE LOCKED</small><button className="retry-primary" onClick={togglePause}>RESUME SIGNAL <b>▶</b></button><button className="retry-secondary" onClick={()=>{stopAudio();setGame("setup");setStatus("FORMULA READY")}}>RETURN TO SETUP</button></div>}
        {game === "results" && <div className={`retry-overlay ${runOutcome}`}><div className="failure-mark"><i/><i/><i/></div><p>{runOutcome==="complete"?"FULL WAVE SYNCHRONIZED":"SIGNAL TERMINATED"}</p><h2>{runOutcome==="complete"?"WAVE CLEARED":"DESYNCHRONIZED"}</h2><div className={`rank-letter rank-${finalRank.toLowerCase()}`}>{finalRank}</div><div className="result-readout"><span><small>FINAL SCORE</small><b>{score.toString().padStart(7,"0")}</b></span><span><small>ACCURACY</small><b>{finalAccuracy.toFixed(2)}%</b></span><span><small>MAX COMBO</small><b>{finalStats.maxCombo}×</b></span><span><small>PERFECT</small><b>{finalStats.perfect}</b></span><span><small>GREAT</small><b>{finalStats.great}</b></span><span><small>GOOD</small><b>{finalStats.good}</b></span><span><small>MISS</small><b>{finalStats.miss}</b></span><span><small>HOLDS CLEARED</small><b>{finalStats.holds}</b></span><span><small>TOTAL NOTES</small><b>{finalStats.total}</b></span></div><button className="retry-primary" onClick={launch}>{runOutcome==="complete"?"PLAY AGAIN":"RETRY SIGNAL"} <b>↻</b></button><button className="retry-secondary" onClick={()=>{setHealth(100);setNotes([]);setGame("setup");setStatus("FORMULA READY")}}>RETURN TO SETUP</button></div>}
      </section>}
    </main>
  );
}
