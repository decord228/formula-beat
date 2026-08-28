"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type SignalMode = "bytebeat" | "signed" | "floatbeat";
type Track = { name: string; author: string; bpm: number; color: string; formula: string; blurb: string; mode: SignalMode; hz: number; n: number; volume: number };
type Note = { id: number; lane: number; born: number; hitAt: number; kind: "tap" | "hold"; duration: number; pressed?: boolean; hit?: boolean; missed?: boolean };
type Particle = { x: number; y: number; vx: number; vy: number; life: number; size: number };
type RhythmEvent = { hitAt: number; lane: number; strength: number; hold: boolean; duration: number };
type Modifiers = { auto: boolean; noFail: boolean; hidden: boolean };

const TRACKS: Track[] = [
  {
    name: "NEON REVERB", author: "formula 01", bpm: 138, color: "#dfff00",
    blurb: "Glass arpeggio / elastic echoes", mode: "floatbeat", hz: 48000, n: 1, volume: 74,
    formula: "tanh(sin(t*2*PI*(110*n*2**([0,3,7,10][floor(t*4/sr)%4]/12))/sr)*(.34+.18*pow(1-t%(sr/4)/(sr/4),3)) + sin(2*PI*55*n*t/sr)*pow(1-t%(sr/2)/(sr/2),5)*.85 + (random()-.5)*pow(1-t%(sr/8)/(sr/8),9)*.16)",
  },
  {
    name: "BASE 36", author: "formula 02", bpm: 112, color: "#ff4fd8",
    blurb: "Bitcrushed melody / slow pulse", mode: "bytebeat", hz: 8000, n: 1, volume: 58,
    formula: "(t*n*2**([0,3,7,10,7,3,12,10][(t>>12)&7]/12) + (t>>4) + (t*(t>>9|t>>13)&63)) & 255",
  },
  {
    name: "CHROME KICK", author: "formula 03", bpm: 150, color: "#61e7ff",
    blurb: "Sub pressure / fractured hats", mode: "floatbeat", hz: 48000, n: 1, volume: 68,
    formula: "tanh(sin((t*n*2**('03202222222222270320222222233330'[(t>>13)&31]/12))/75)*.35 + cos(sqrt(t%8192))*pow(1-(t%8192)/8192,3)*1.4 + (random()-.5)*pow(1-(t%4096)/4096,7)*.25)",
  },
  {
    name: "LOG CHOIR", author: "formula 04", bpm: 120, color: "#ffb000",
    blurb: "Logarithmic stereo swarm", mode: "bytebeat", hz: 8000, n: 1, volume: 56,
    formula: "H=i=128,s=t/5e3,o=[H,H],F=i=>((57454323>>4*i&31)-(s>>3&4))/12,(e=>{while(i--)o[i%2]+=sin(40*log(s%4)+9*s)/3+s%4*(exp(-s%1*2)*((t*2**[F(7)-2,5+i/90,F(~~s-4*(i<48))+i%4/H][i%3]+s%1*i/5&H)-64)+(t*2**(F(i%7)-(i/2&1))+1e4*sin(i+s/H))%H-64)/H})(),o",
  },
];

const LANES = ["D", "F", "J", "K"];
const TIMING_WINDOWS = [
  { perfect: .07, great: .135, hit: .22, missDamage: 4 },
  { perfect: .05, great: .1, hit: .17, missDamage: 7 },
  { perfect: .04, great: .08, hit: .14, missDamage: 9 },
];
const JUDGE_POSITION = 88;
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));

function compileFormula(source: string) {
  const cleaned = source.replaceAll("\\*", "*").replaceAll("\\_", "_");
  return new Function("t", "sr", "n", `
    const {abs,acos,acosh,asin,asinh,atan,atan2,atanh,cbrt,ceil,cos,cosh,exp,expm1,floor,fround,hypot,imul,log,log10,log1p,log2,max,min,pow,random,round,sign,sin,sinh,sqrt,tan,tanh,trunc,PI,E,LN2,LN10,LOG2E,LOG10E,SQRT1_2,SQRT2}=Math;
    const int=x=>x|0, ln=log;
    const v=(${cleaned}); return Array.isArray(v) ? v : [v,v];
  `) as (t: number, sr: number, n: number) => number[];
}

function normalizeSample(value: number, mode: SignalMode) {
  if (!Number.isFinite(value)) return 0;
  if (mode === "floatbeat") return clamp(value, -1, 1);
  const integer = Math.floor(value);
  if (mode === "bytebeat") return ((integer & 255) - 128) / 128;
  return (((integer + 128) & 255) - 128) / 128;
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
  const [game, setGame] = useState<"setup" | "running" | "failing" | "results">("setup");
  const [modifiers, setModifiers] = useState<Modifiers>({auto:false,noFail:false,hidden:false});
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [health, setHealth] = useState(100);
  const [status, setStatus] = useState("FORMULA READY");
  const [audioOn, setAudioOn] = useState(false);
  const [notes, setNotes] = useState<Note[]>([]);
  const [lastJudgement, setLastJudgement] = useState("");
  const [timingMs, setTimingMs] = useState<number | null>(null);
  const [pressedLanes, setPressedLanes] = useState<boolean[]>([false,false,false,false]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<{ ctx: AudioContext; processor: ScriptProcessorNode; filter: BiquadFilterNode; gain: GainNode; kind: "preview" | "game" } | null>(null);
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notesRef = useRef<Note[]>([]);
  const startRef = useRef(0);
  const idRef = useRef(1);
  const nextBeatRef = useRef(0);
  const rafRef = useRef(0);
  const spectrumRef = useRef({ energy: 0, peak: 0, wave: new Float32Array(128) });
  const particlesRef = useRef<Particle[]>([]);
  const rhythmEventsRef = useRef<RhythmEvent[]>([]);
  const gameActiveRef = useRef(false);
  const laneBusyUntilRef = useRef([0,0,0,0]);
  const lastDetectedHitRef = useRef(-10);
  const playbackSpeedRef = useRef(1);
  const freezeTimeRef = useRef(0);
  const track = TRACKS[trackIndex];

  const stopAudio = useCallback(() => {
    gameActiveRef.current = false;
    const audio = audioRef.current;
    if (audio) { audio.processor.disconnect(); audio.filter.disconnect(); audio.gain.disconnect(); void audio.ctx.close(); }
    audioRef.current = null;
    setAudioOn(false);
  }, []);

  const damageSync = useCallback((amount: number) => {
    setHealth(value => modifiers.noFail ? Math.max(1,value-amount) : clamp(value-amount,0,100));
  }, [modifiers.noFail]);

  const startAudio = useCallback(async (kind: "preview" | "game" = "game", override?: Partial<{ formula: string; mode: SignalMode; hz: number; n: number; volume: number }>) => {
    stopAudio();
    const source = override?.formula ?? formula;
    const mode = override?.mode ?? signalMode;
    const hz = override?.hz ?? formulaHz;
    const n = override?.n ?? nValue;
    const outputVolume = override?.volume ?? volume;
    let fn: ReturnType<typeof compileFormula>;
    try { fn = compileFormula(source); for (let i = 0; i < 32; i++) fn(i * 257, hz, n); }
    catch { setStatus("FORMULA ERROR"); return false; }
    const ctx = new AudioContext({ latencyHint: "interactive" });
    try { await ctx.resume(); } catch { setStatus("CLICK PREVIEW TO ENABLE AUDIO"); return false; }
    const processor = ctx.createScriptProcessor(1024, 0, 2);
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter(); filter.type="lowpass"; filter.frequency.value=20000; filter.Q.value=.4;
    const delay = ctx.createDelay(3);
    delay.delayTime.value = kind === "game" ? 1.6 : 0;
    gain.gain.value = clamp(outputVolume / 100, 0, 1.5) * (kind === "preview" ? .22 : 1);
    playbackSpeedRef.current=1;
    let tick = 0; let lastFormulaTick = -1; let cachedResult: number[] = [0,0]; let runtimeFailed = false;
    let previousMono = 0; let previousEnergy = 0; let adaptiveFlux = .025; let lastOnsetAt = -10; let eventIndex = 0;
    processor.onaudioprocess = (event) => {
      const left = event.outputBuffer.getChannelData(0);
      const right = event.outputBuffer.getChannelData(1);
      let energy = 0; let peak = 0; let flux = 0;
      try {
        for (let i = 0; i < left.length; i++) {
          const formulaTick = Math.floor(tick);
          if (formulaTick !== lastFormulaTick) { cachedResult = fn(formulaTick, hz, n); lastFormulaTick = formulaTick; }
          tick += hz / ctx.sampleRate * playbackSpeedRef.current;
          const l = normalizeSample(Number(cachedResult?.[0] ?? 0), mode);
          const r = normalizeSample(Number(cachedResult?.[1] ?? l), mode);
          left[i] = l; right[i] = r;
          const mono = (l + r) / 2; flux += Math.abs(mono - previousMono); previousMono = mono;
          const amp = (Math.abs(l) + Math.abs(r)) / 2;
          energy += amp; peak = Math.max(peak, amp);
          if (i % 8 === 0) spectrumRef.current.wave[(i / 8) % 128] = (l + r) / 2;
        }
      } catch (error) {
        left.fill(0); right.fill(0);
        if (!runtimeFailed) { runtimeFailed = true; const message = error instanceof Error ? error.message : "unknown error"; setStatus(`RUNTIME ERROR: ${message.toUpperCase().slice(0,48)}`); }
      }
      spectrumRef.current.energy = energy / left.length;
      spectrumRef.current.peak = peak;
      const blockEnergy = energy / left.length; const blockFlux = flux / left.length;
      adaptiveFlux = adaptiveFlux * .965 + blockFlux * .035;
      const onsetScore = Math.max(0, blockEnergy - previousEnergy * .9) + Math.max(0, blockFlux - adaptiveFlux) * .85;
      const onsetCooldown = difficulty === 1 ? 60 / track.bpm * .72 : difficulty === 2 ? .17 : .115;
      if (kind === "game" && gameActiveRef.current && ctx.currentTime - lastOnsetAt > onsetCooldown && onsetScore > .028 + adaptiveFlux * .52) {
        const relativeNow = (performance.now() - startRef.current) / 1000;
        const strength = clamp(onsetScore * 5 + peak * .35, 0, 1);
        const lane = Math.abs((lastFormulaTick ^ Math.floor(blockFlux * 10000) ^ eventIndex * 17)) % 4;
        const stableTone = blockEnergy > .27 && blockFlux < Math.max(.22, adaptiveFlux * 1.45);
        const hold = difficulty > 1 && stableTone && eventIndex > 0 && eventIndex % (difficulty === 3 ? 7 : 11) === 0;
        rhythmEventsRef.current.push({ hitAt: relativeNow + 1.6, lane, strength, hold, duration: hold ? 60 / track.bpm * (difficulty === 3 ? 2.5 : 2) : 0 });
        if (rhythmEventsRef.current.length > 32) rhythmEventsRef.current.shift();
        lastOnsetAt = ctx.currentTime; eventIndex++;
      }
      previousEnergy = blockEnergy;
    };
    processor.connect(delay); delay.connect(filter); filter.connect(gain); gain.connect(ctx.destination);
    audioRef.current = { ctx, processor, filter, gain, kind };
    setAudioOn(true); setStatus(kind === "preview" ? "QUIET PREVIEW" : "SIGNAL LOCKED");
    return true;
  }, [difficulty, formula, formulaHz, nValue, signalMode, track.bpm, volume, stopAudio]);

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
    notesRef.current = []; particlesRef.current = []; rhythmEventsRef.current = []; laneBusyUntilRef.current = [0,0,0,0]; lastDetectedHitRef.current = -10;
    setNotes([]); setScore(0); setCombo(0); setHealth(100); setPressedLanes([false,false,false,false]); setTimingMs(null);
    startRef.current = performance.now(); freezeTimeRef.current=0; nextBeatRef.current = 1.6; idRef.current = 1; playbackSpeedRef.current=1; gameActiveRef.current = true;
    setGame("running"); setLastJudgement("SYNC");
  };

  const burst = useCallback((lane: number, amount = 16) => {
    const w = window.innerWidth; const h = window.innerHeight - 70;
    const road = Math.min(620, w * .75); const x = w / 2 - road / 2 + road * (lane + .5) / 4;
    for (let i=0;i<amount;i++) particlesRef.current.push({x,y:h*(JUDGE_POSITION/100),vx:(Math.random()-.5)*7,vy:-2-Math.random()*7,life:1,size:2+Math.random()*6});
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
    setTimingMs(Math.round(offset*1000)); setCombo(v => v + 1); setScore(v => v + pts); setHealth(v => clamp(v + 1.2, 0, 100));
    burst(lane, best.kind === "hold" ? 10 : 18);
    setNotes([...notesRef.current]);
  }, [burst, difficulty, game, modifiers.auto]);

  const releaseLane = useCallback((lane: number) => {
    setPressedLanes(v => v.map((pressed,i)=>i===lane?false:pressed));
    if (game !== "running" || modifiers.auto) return;
    const now = (performance.now() - startRef.current) / 1000;
    const hold = notesRef.current.find(note => note.lane===lane && note.kind==="hold" && note.pressed && !note.hit && !note.missed);
    if (!hold) return;
    hold.pressed = false;
    if (now >= hold.hitAt + hold.duration - .16) {
      hold.hit = true; setTimingMs(Math.round((now-(hold.hitAt+hold.duration))*1000)); setScore(v=>v+Math.round(1200+hold.duration*900)); setCombo(v=>v+1); setLastJudgement("RELEASE"); setHealth(v=>clamp(v+3,0,100)); burst(lane,28);
    } else {
      hold.missed = true; setTimingMs(Math.round((now-(hold.hitAt+hold.duration))*1000)); setCombo(0); setLastJudgement("EARLY"); damageSync(10);
    }
    setNotes([...notesRef.current]);
  }, [burst, damageSync, game, modifiers.auto]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => { const i = LANES.indexOf(e.key.toUpperCase()); if (i >= 0 && !e.repeat) pressLane(i); if (e.key === "Escape" && game === "running") { stopAudio(); setGame("setup"); } };
    const up = (e: KeyboardEvent) => { const i = LANES.indexOf(e.key.toUpperCase()); if (i >= 0) releaseLane(i); };
    window.addEventListener("keydown", down); window.addEventListener("keyup", up); return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, [pressLane, releaseLane, game, stopAudio]);

  useEffect(() => {
    if (game !== "running") return;
    const beat = 60 / track.bpm;
    const loop = () => {
      const now = (performance.now() - startRef.current) / 1000;
      const addNote = (hitAt: number, desiredLane: number, hold: boolean, duration: number) => {
        if (notesRef.current.some(note=>Math.abs(note.hitAt-hitAt)<.085 && note.lane===desiredLane)) return;
        let lane = desiredLane; let found = false;
        for(let offset=0;offset<4;offset++){const candidate=(desiredLane+offset)%4;if(laneBusyUntilRef.current[candidate] < hitAt-.08){lane=candidate;found=true;break}}
        if(!found) return;
        notesRef.current.push({id:idRef.current++,lane,born:now,hitAt,kind:hold?"hold":"tap",duration:hold?duration:0});
        laneBusyUntilRef.current[lane]=hitAt+(hold?duration:.1)+.08;
      };

      const detected = rhythmEventsRef.current.splice(0);
      for(const event of detected){
        let hitAt=event.hitAt;
        if(difficulty===1) hitAt=1.6+Math.round((hitAt-1.6)/beat)*beat;
        const minimumSpacing=difficulty===1?beat*.9:difficulty===2?beat*.34:.115;
        if(hitAt<now+.28 || hitAt-lastDetectedHitRef.current<minimumSpacing) continue;
        addNote(hitAt,event.lane,difficulty===1?false:event.hold,event.duration);
        lastDetectedHitRef.current=Math.max(lastDetectedHitRef.current,hitAt);
      }

      const density = difficulty === 1 ? 1 : .5;
      while (now + 1.6 > nextBeatRef.current) {
        const pulse = spectrumRef.current.energy + spectrumRef.current.peak * .32;
        const threshold = (100 - sensitivity) / 175;
        const subdivision = beat * density;
        const step = Math.round(nextBeatRef.current / subdivision);
        const noNearbyDetection = Math.abs(nextBeatRef.current-lastDetectedHitRef.current) > subdivision*.62;
        const structuralBeat = difficulty===1 || step%2===0 || pulse>threshold;
        if(noNearbyDetection && structuralBeat){
          const lane=Math.abs(Math.floor(Math.sin(step*12.9898+trackIndex*7)*43758.5453))%4;
          const stableSignal=spectrumRef.current.energy>.2 && spectrumRef.current.peak<spectrumRef.current.energy*2.8;
          const isHold=difficulty>1 && step>4 && step%(difficulty===3?16:12)===0 && stableSignal;
          addNote(nextBeatRef.current,lane,isHold,isHold?beat*2:0);
        }
        nextBeatRef.current += subdivision;
      }
      if(modifiers.auto){
        for(const note of notesRef.current){
          if(note.hit||note.missed||now<note.hitAt) continue;
          if(note.kind==="hold"&&!note.pressed){note.pressed=true;setPressedLanes(v=>v.map((pressed,i)=>i===note.lane?true:pressed));setLastJudgement("AUTO HOLD");setTimingMs(0);setScore(v=>v+1000);setCombo(v=>v+1);burst(note.lane,10)}
          else if(note.kind==="tap"){note.hit=true;setLastJudgement("AUTO");setTimingMs(0);setScore(v=>v+1000);setCombo(v=>v+1);burst(note.lane,16)}
        }
      }
      for (const note of notesRef.current) {
        if (note.kind === "hold" && note.pressed && !note.hit && !note.missed && now >= note.hitAt + note.duration) {
          note.pressed = false; note.hit = true; setPressedLanes(v=>v.map((pressed,i)=>i===note.lane?false:pressed)); setTimingMs(0); setScore(v=>v+Math.round(1200+note.duration*900)); setCombo(v=>v+1); setLastJudgement(modifiers.auto?"AUTO RELEASE":"HELD"); setHealth(v=>clamp(v+3,0,100)); burst(note.lane,28);
        } else if (!note.hit && !note.missed && !note.pressed && now - note.hitAt > TIMING_WINDOWS[difficulty-1].hit) {
          note.missed = true; setTimingMs(null); setCombo(0); damageSync(TIMING_WINDOWS[difficulty-1].missDamage); setLastJudgement("MISS");
        }
      }
      notesRef.current = notesRef.current.filter(n => now - (n.hitAt + n.duration) < .75);
      setNotes([...notesRef.current]);
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop); return () => cancelAnimationFrame(rafRef.current);
  }, [game, difficulty, sensitivity, track.bpm, trackIndex, burst, damageSync, modifiers.auto]);

  useEffect(()=>{
    if(game==="running"&&health<=0&&!modifiers.noFail){
      freezeTimeRef.current=(performance.now()-startRef.current)/1000;gameActiveRef.current=false;setLastJudgement("DESYNC");setTimingMs(null);setStatus("SIGNAL COLLAPSE");setGame("failing");
    }
  },[game,health,modifiers.noFail]);

  useEffect(()=>{
    if(game!=="failing")return;
    const started=performance.now();let animationId=0;
    const collapse=()=>{const progress=clamp((performance.now()-started)/2500,0,1);playbackSpeedRef.current=Math.pow(1-progress,2);const audio=audioRef.current;if(audio){audio.filter.frequency.setTargetAtTime(90+Math.pow(1-progress,2)*19910,audio.ctx.currentTime,.06);audio.gain.gain.setTargetAtTime(Math.max(.015,(1-progress)*volume/100),audio.ctx.currentTime,.08)}if(progress<1)animationId=requestAnimationFrame(collapse);else{stopAudio();setStatus("SIGNAL LOST");setGame("results")}};
    animationId=requestAnimationFrame(collapse);return()=>cancelAnimationFrame(animationId);
  },[game,stopAudio,volume]);

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext("2d"); if (!ctx) return;
    let frame = 0; let animationId = 0;
    const draw = () => {
      const rect = canvas.getBoundingClientRect(); const dpr = Math.min(devicePixelRatio, 2);
      if (canvas.width !== rect.width * dpr || canvas.height !== rect.height * dpr) { canvas.width = rect.width * dpr; canvas.height = rect.height * dpr; }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); const w = rect.width, h = rect.height;
      ctx.fillStyle = "#050605"; ctx.fillRect(0, 0, w, h);
      const signal = spectrumRef.current; const wave = signal.wave; const energy = signal.energy;
      const inGame=game!=="setup";const grad = ctx.createRadialGradient(w*.5,h*(inGame?.68:.55),0,w*.5,h*.55,w*.72); grad.addColorStop(0,track.color+(inGame?"35":"20")); grad.addColorStop(.46,track.color+"0d"); grad.addColorStop(1,"transparent"); ctx.fillStyle=grad; ctx.fillRect(0,0,w,h);
      if(inGame){
        ctx.save(); ctx.strokeStyle=track.color; ctx.globalAlpha=.08+energy*.12; ctx.lineWidth=1;
        for(let i=-9;i<=9;i++){ctx.beginPath();ctx.moveTo(w/2,h*.35);ctx.lineTo(w/2+i*w*.085,h);ctx.stroke()}
        for(let i=0;i<8;i++){const y=h*.38+Math.pow(i/7,1.7)*h*.62;ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke()} ctx.restore();
      }
      ctx.save(); ctx.globalCompositeOperation="lighter";
      const bars=48; for(let i=0;i<bars;i++){const amp=Math.abs(wave[(i*2)%wave.length]);const bh=(.015+amp*.75+energy*.18)*h*(inGame?.34:.22);const x=i/(bars-1)*w;ctx.globalAlpha=.1+amp*.55;ctx.fillStyle=track.color;ctx.fillRect(x-w/bars*.28,h*.54-bh/2,w/bars*.56,bh)}
      for(let layer=0;layer<3;layer++){ctx.beginPath();for(let i=0;i<wave.length;i++){const x=i/(wave.length-1)*w;const y=h*.54+wave[i]*h*(.10+layer*.055);i?ctx.lineTo(x,y):ctx.moveTo(x,y)}ctx.globalAlpha=.55-layer*.15;ctx.strokeStyle=track.color;ctx.lineWidth=layer===0?2:1;ctx.shadowBlur=20;ctx.shadowColor=track.color;ctx.stroke()}
      ctx.shadowBlur=0; for(let ring=0;ring<6;ring++){const limit=Math.min(w,h)*.7;const r=(frame*(1.1+energy*3)+ring*limit/6)%limit;ctx.beginPath();ctx.arc(w/2,h*.54,r,0,Math.PI*2);ctx.globalAlpha=(1-r/limit)*(.22+energy*.28);ctx.strokeStyle=track.color;ctx.lineWidth=1+energy*2;ctx.stroke()}
      if(inGame){
        particlesRef.current=particlesRef.current.filter(p=>p.life>0);
        for(const p of particlesRef.current){p.x+=p.vx;p.y+=p.vy;p.vy+=.14;p.life-=.025;ctx.globalAlpha=p.life;ctx.fillStyle=track.color;ctx.shadowBlur=12;ctx.shadowColor=track.color;ctx.fillRect(p.x,p.y,p.size,p.size)}
      }
      ctx.restore(); frame++; animationId=requestAnimationFrame(draw);
    }; animationId=requestAnimationFrame(draw); return()=>cancelAnimationFrame(animationId);
  }, [game, track.color]);

  useEffect(() => () => stopAudio(), [stopAudio]);

  const timeline = useMemo(() => game === "running" ? (performance.now() - startRef.current) / 1000 : freezeTimeRef.current, [game, notes]);

  return (
    <main style={{ "--accent": track.color } as React.CSSProperties}>
      <header className="topbar"><div className="brand"><span>F//B</span><b>FORMULA BEAT</b></div><div className="signal"><i className={audioOn ? "live" : ""}/>{status}</div><div className="edition">EXPERIMENTAL BUILD · 001</div></header>

      {game === "setup" && <section className="setup-shell">
        <div className="intro"><p className="eyebrow">BYTEBEAT RHYTHM SYSTEM</p><h1>TURN CODE<br/><em>INTO RHYTHM.</em></h1><p className="lead">Каждая формула — одновременно музыка, визуальная система и новая игровая карта.</p></div>
        <div className="track-panel">
          <div className="panel-title"><span>01</span><div><b>SELECT SIGNAL</b><small>{TRACKS.length} FORMULAS LOADED</small></div></div>
          <div className="track-list">{TRACKS.map((item,i)=><button key={item.name} onClick={()=>chooseTrack(i)} className={i===trackIndex?"selected":""}><span className="num">0{i+1}</span><div><b>{item.name}</b><small>{item.blurb} · {item.mode}</small></div><span className="bpm">{item.bpm}<small>BPM</small></span></button>)}</div>
        </div>
        <div className="visual-card"><canvas ref={canvasRef}/><div className="visual-label"><span>LIVE SIGNAL</span><b>{track.name}</b></div><div className="reticle">+</div></div>
        <div className="config-panel">
          <div className="panel-title"><span>02</span><div><b>CALIBRATE</b><small>GAMEPLAY RESPONSE</small></div></div>
          <label>SIGNAL MODE <span>{signalMode.toUpperCase()}</span></label><div className="mode-tabs">{(["bytebeat","signed","floatbeat"] as SignalMode[]).map(mode=><button key={mode} onClick={()=>{setSignalMode(mode);schedulePreview(formula,{mode})}} className={signalMode===mode?"on":""}>{mode === "signed" ? "SIGNED 8-BIT" : mode.toUpperCase()}</button>)}</div>
          <div className="parameter-grid">
            <label><span>FORMULA Hz</span><input aria-label="Formula sample rate in hertz" type="number" min="1000" max="96000" step="100" value={formulaHz} onChange={e=>{const hz=clamp(+e.target.value||1000,1000,96000);setFormulaHz(hz);schedulePreview(formula,{hz})}}/></label>
            <label><span>n VALUE</span><input aria-label="Formula n value" type="number" min="-16" max="16" step="0.05" value={nValue} onChange={e=>{const n=clamp(+e.target.value||0,-16,16);setNValue(n);schedulePreview(formula,{n})}}/></label>
            <label><span>VOLUME %</span><input aria-label="Volume percent" type="number" min="0" max="150" step="1" value={volume} onChange={e=>{const nextVolume=clamp(+e.target.value||0,0,150);setVolume(nextVolume);schedulePreview(formula,{volume:nextVolume})}}/></label>
          </div>
          <label>DIFFICULTY <span>{["FLOW","PULSE","OVERDRIVE"][difficulty-1]}</span></label><div className="segments">{[1,2,3].map(n=><button aria-label={`Difficulty ${n}`} onClick={()=>setDifficulty(n)} className={difficulty===n?"on":""} key={n}/>)}</div>
          <p className="difficulty-copy">{difficulty===1?"1 TILE / BEAT · NO HOLDS · ±220 ms":difficulty===2?"REACTIVE 1/2 BEATS · HOLDS · ±170 ms":"FULL TRANSIENT MAP · LONG HOLDS · ±140 ms"}</p>
          <label>MODIFIERS <span>{Object.values(modifiers).filter(Boolean).length || "OFF"}</span></label>
          <div className="modifier-grid">
            <button className={modifiers.auto?"on":""} onClick={()=>setModifiers(m=>({...m,auto:!m.auto}))}><b>AUTO</b><span>AUTOBOT</span><small>UNRANKED</small></button>
            <button className={modifiers.noFail?"on":""} onClick={()=>setModifiers(m=>({...m,noFail:!m.noFail}))}><b>NF</b><span>NO FAIL</span><small>SYNC ≥ 1%</small></button>
            <button className={modifiers.hidden?"on":""} onClick={()=>setModifiers(m=>({...m,hidden:!m.hidden}))}><b>HD</b><span>HIDDEN</span><small>FADE NOTES</small></button>
          </div>
          <label>SIGNAL SENSITIVITY <span>{sensitivity}%</span></label><input type="range" min="30" max="90" value={sensitivity} onChange={e=>setSensitivity(+e.target.value)}/>
          <button className="preview-button" onClick={()=>audioRef.current?.kind === "preview" ? stopAudio() : void startAudio("preview")}>{audioRef.current?.kind === "preview" ? "■ STOP PREVIEW" : "▶ QUIET PREVIEW"}</button>
          <button className="launch" onClick={launch}><span>INITIALIZE RUN</span><b>↗</b></button><p className="hint">KEYS&nbsp; D · F · J · K &nbsp;/&nbsp; TOUCH</p>
        </div>
        <details className="formula-panel"><summary><span>03</span><b>FORMULA SOURCE</b><small>EDIT / PASTE BYTEBEAT</small></summary><textarea spellCheck={false} value={formula} onChange={e=>{const value=e.target.value;setFormula(value);setStatus("COMPILING PREVIEW");schedulePreview(value)}}/><div className="mode-help"><b>{signalMode.toUpperCase()}</b><span>{signalMode === "bytebeat" ? "0…255 → преобразуется в −1…1" : signalMode === "signed" ? "−128…127 → преобразуется в −1…1" : "готовый сигнал −1…1 без 8-битного преобразования"}</span></div><div className="editor-foot"><span>JS EXPRESSION · t, sr, n AVAILABLE</span><button onClick={()=>{try{const test=compileFormula(formula);for(let i=0;i<32;i++)test(i*257,formulaHz,nValue);setStatus("FORMULA READY");void startAudio("preview")}catch{setStatus("FORMULA ERROR")}}}>CHECK + PREVIEW</button></div></details>
      </section>}

      {game !== "setup" && <section className={`game-shell ${game} ${modifiers.hidden?"hidden-mod":""}`}>
        <canvas ref={canvasRef} className="game-bg"/>
        <div className="game-hud"><div><small>SCORE</small><b>{score.toString().padStart(7,"0")}</b></div><div className="now-playing"><i/><span>{track.name}<small>{track.bpm} BPM · {signalMode.toUpperCase()} · {formulaHz} Hz · n {nValue}{modifiers.auto?" · AUTOBOT":""}</small></span></div><div className="hp"><small>SYNC</small><span><i style={{width:`${health}%`}}/></span></div></div>
        <div className="highway"><div className="hit-guide"><span>HIT ZONE</span><small>PERFECT ±{Math.round(TIMING_WINDOWS[difficulty-1].perfect*1000)} ms</small></div>{LANES.map((key,lane)=><button key={key} onPointerDown={e=>{e.currentTarget.setPointerCapture(e.pointerId);pressLane(lane)}} onPointerUp={()=>releaseLane(lane)} onPointerCancel={()=>releaseLane(lane)} className={`lane ${pressedLanes[lane]?"pressed":""}`}><span className="rail"/><b>{key}</b>{notes.filter(n=>n.lane===lane).map(n=>{const travel=1-(n.hitAt-timeline)/1.6;const p=clamp(travel,-.15,1+n.duration/1.6+.2);const hiddenOpacity=modifiers.hidden?clamp((.78-travel)/.3,0,1):undefined;return <i key={n.id} className={`note ${n.kind} ${n.pressed?"holding":""} ${n.hit?"hit":""} ${n.missed?"missed":""}`} style={{top:`${p*JUDGE_POSITION}%`,height:n.kind==="hold"?`${Math.max(10,n.duration/1.6*JUDGE_POSITION)}%`:undefined,opacity:hiddenOpacity}}/>})}</button>)}</div>
        <div className={`judgement ${lastJudgement.toLowerCase()}`}>{lastJudgement}<small>{timingMs!==null?`${timingMs>0?"+":""}${timingMs} ms`:combo>1?`${combo}× COMBO`:""}</small></div>
        <button className="exit" onClick={()=>{stopAudio();setGame("setup")}}>ESC · ABORT</button>
        {game === "results" && <div className="retry-overlay"><div className="failure-mark"><i/><i/><i/></div><p>SIGNAL TERMINATED</p><h2>DESYNCHRONIZED</h2><div className="result-readout"><span><small>FINAL SCORE</small><b>{score.toString().padStart(7,"0")}</b></span><span><small>DIFFICULTY</small><b>{["FLOW","PULSE","OVERDRIVE"][difficulty-1]}</b></span><span><small>RUN STATUS</small><b>{modifiers.auto?"AUTOBOT · UNRANKED":"FAILED"}</b></span></div><button className="retry-primary" onClick={launch}>RETRY SIGNAL <b>↻</b></button><button className="retry-secondary" onClick={()=>{setHealth(100);setNotes([]);setGame("setup")}}>RETURN TO SETUP</button></div>}
      </section>}
    </main>
  );
}
