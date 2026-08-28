"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Track = { name: string; author: string; bpm: number; color: string; formula: string; blurb: string };
type Note = { id: number; lane: number; born: number; hitAt: number; hit?: boolean; missed?: boolean };

const TRACKS: Track[] = [
  {
    name: "NEON REVERB", author: "formula 01", bpm: 138, color: "#dfff00",
    blurb: "Glass arpeggio / elastic echoes",
    formula: "tanh((((t*1.7*2**(([2,-2,0,5,4][(t>>13)%5])/12))&255)/127-1)*.72 + sin(t/31)*.12 + sin(t/997)*.18) * (1.1+.5*sin(t/16384)))",
  },
  {
    name: "BASE 36", author: "formula 02", bpm: 112, color: "#ff4fd8",
    blurb: "Bitcrushed melody / slow pulse",
    formula: "((((t*2**(parseInt('C7C5C32A23AFEA5A23AFHEACEA5C73A2'[(t>>13)%32],36)/12)*1.7)&255)-128)/128)*(1-t%8192/12000) + ((((t*2**(parseInt('KMJOKMOOO'[(t>>15)&7],36)/12))>>4)&64)-32)/96)",
  },
  {
    name: "CHROME KICK", author: "formula 03", bpm: 150, color: "#61e7ff",
    blurb: "Sub pressure / fractured hats",
    formula: "tanh(sin((t*2**('03202222222222270320222222233330'[(t>>13)&31]/12))/75)*.35 + cos(sqrt(t%8192))*pow(1-(t%8192)/8192,3)*1.4 + (random()-.5)*pow(1-(t%4096)/4096,7)*.25)",
  },
];

const LANES = ["D", "F", "J", "K"];
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));

function compileFormula(source: string) {
  const cleaned = source.replaceAll("\\*", "*").replaceAll("\\_", "_");
  return new Function("t", "sr", `
    const {sin,cos,tan,tanh,asin,sqrt,pow,min,max,abs,round,floor,PI,random}=Math;
    try { const v=(${cleaned}); return Array.isArray(v) ? v : [v,v]; } catch(e) { return [0,0]; }
  `) as (t: number, sr: number) => number[];
}

export default function Home() {
  const [trackIndex, setTrackIndex] = useState(0);
  const [formula, setFormula] = useState(TRACKS[0].formula);
  const [difficulty, setDifficulty] = useState(2);
  const [sensitivity, setSensitivity] = useState(62);
  const [game, setGame] = useState<"setup" | "running" | "results">("setup");
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [health, setHealth] = useState(100);
  const [status, setStatus] = useState("FORMULA READY");
  const [audioOn, setAudioOn] = useState(false);
  const [notes, setNotes] = useState<Note[]>([]);
  const [lastJudgement, setLastJudgement] = useState("");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<{ ctx: AudioContext; processor: ScriptProcessorNode; gain: GainNode } | null>(null);
  const notesRef = useRef<Note[]>([]);
  const startRef = useRef(0);
  const idRef = useRef(1);
  const nextBeatRef = useRef(0);
  const rafRef = useRef(0);
  const spectrumRef = useRef({ energy: 0, peak: 0, wave: new Float32Array(128) });
  const track = TRACKS[trackIndex];

  const stopAudio = useCallback(() => {
    const audio = audioRef.current;
    if (audio) { audio.processor.disconnect(); audio.gain.disconnect(); void audio.ctx.close(); }
    audioRef.current = null;
    setAudioOn(false);
  }, []);

  const startAudio = useCallback(async () => {
    stopAudio();
    let fn: ReturnType<typeof compileFormula>;
    try { fn = compileFormula(formula); fn(1, 48000); }
    catch { setStatus("FORMULA ERROR"); return false; }
    const ctx = new AudioContext({ latencyHint: "interactive" });
    await ctx.resume();
    const processor = ctx.createScriptProcessor(1024, 0, 2);
    const gain = ctx.createGain();
    const delay = ctx.createDelay(3);
    delay.delayTime.value = 1.6;
    gain.gain.value = .72;
    let tick = 0;
    processor.onaudioprocess = (event) => {
      const left = event.outputBuffer.getChannelData(0);
      const right = event.outputBuffer.getChannelData(1);
      let energy = 0; let peak = 0;
      for (let i = 0; i < left.length; i++, tick++) {
        const result = fn(tick, ctx.sampleRate);
        let l = Number(result?.[0] ?? 0); let r = Number(result?.[1] ?? l);
        if (Math.abs(l) > 2) l = (l - 128) / 128;
        if (Math.abs(r) > 2) r = (r - 128) / 128;
        l = clamp(Number.isFinite(l) ? l : 0, -1, 1);
        r = clamp(Number.isFinite(r) ? r : 0, -1, 1);
        left[i] = l; right[i] = r;
        const amp = (Math.abs(l) + Math.abs(r)) / 2;
        energy += amp; peak = Math.max(peak, amp);
        if (i % 8 === 0) spectrumRef.current.wave[(i / 8) % 128] = (l + r) / 2;
      }
      spectrumRef.current.energy = energy / left.length;
      spectrumRef.current.peak = peak;
    };
    processor.connect(delay); delay.connect(gain); gain.connect(ctx.destination);
    audioRef.current = { ctx, processor, gain };
    setAudioOn(true); setStatus("SIGNAL LOCKED");
    return true;
  }, [formula, stopAudio]);

  const chooseTrack = (i: number) => {
    setTrackIndex(i); setFormula(TRACKS[i].formula); setStatus("FORMULA READY");
    if (audioOn) stopAudio();
  };

  const launch = async () => {
    const ok = await startAudio(); if (!ok) return;
    notesRef.current = []; setNotes([]); setScore(0); setCombo(0); setHealth(100);
    startRef.current = performance.now(); nextBeatRef.current = 1.6; idRef.current = 1;
    setGame("running"); setLastJudgement("SYNC");
  };

  const judge = useCallback((lane: number) => {
    if (game !== "running") return;
    const now = (performance.now() - startRef.current) / 1000;
    let best: Note | undefined; let delta = Infinity;
    for (const note of notesRef.current) {
      if (note.lane !== lane || note.hit || note.missed) continue;
      const d = Math.abs(note.hitAt - now); if (d < delta) { delta = d; best = note; }
    }
    if (!best || delta > .22) { setCombo(0); setLastJudgement("MISS"); setHealth(v => clamp(v - 4, 0, 100)); return; }
    best.hit = true;
    const label = delta < .065 ? "PERFECT" : delta < .13 ? "GREAT" : "GOOD";
    const pts = label === "PERFECT" ? 1000 : label === "GREAT" ? 650 : 350;
    setCombo(v => v + 1); setScore(v => v + pts); setHealth(v => clamp(v + 1.2, 0, 100)); setLastJudgement(label);
    setNotes([...notesRef.current]);
  }, [game]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => { const i = LANES.indexOf(e.key.toUpperCase()); if (i >= 0) judge(i); if (e.key === "Escape" && game === "running") { stopAudio(); setGame("setup"); } };
    window.addEventListener("keydown", key); return () => window.removeEventListener("keydown", key);
  }, [judge, game, stopAudio]);

  useEffect(() => {
    if (game !== "running") return;
    const beat = 60 / track.bpm;
    const loop = () => {
      const now = (performance.now() - startRef.current) / 1000;
      const density = [1.45, 1, .72][difficulty - 1];
      while (now + 1.6 > nextBeatRef.current) {
        const pulse = spectrumRef.current.energy + spectrumRef.current.peak * .32;
        const threshold = (100 - sensitivity) / 175;
        const subdivision = beat * density;
        const step = Math.round(nextBeatRef.current / subdivision);
        if (pulse > threshold || step % Math.max(1, 4 - difficulty) === 0) {
          const lane = Math.abs(Math.floor((Math.sin(step * 12.9898 + trackIndex * 7) * 43758.5453))) % 4;
          notesRef.current.push({ id: idRef.current++, lane, born: now, hitAt: nextBeatRef.current });
          if (difficulty === 3 && step % 7 === 0) notesRef.current.push({ id: idRef.current++, lane: (lane + 2) % 4, born: now, hitAt: nextBeatRef.current });
        }
        nextBeatRef.current += subdivision;
      }
      for (const note of notesRef.current) {
        if (!note.hit && !note.missed && now - note.hitAt > .24) {
          note.missed = true; setCombo(0); setHealth(v => clamp(v - 7, 0, 100)); setLastJudgement("MISS");
        }
      }
      notesRef.current = notesRef.current.filter(n => now - n.hitAt < .65);
      setNotes([...notesRef.current]);
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop); return () => cancelAnimationFrame(rafRef.current);
  }, [game, difficulty, sensitivity, track.bpm, trackIndex]);

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext("2d"); if (!ctx) return;
    let frame = 0;
    const draw = () => {
      const rect = canvas.getBoundingClientRect(); const dpr = Math.min(devicePixelRatio, 2);
      if (canvas.width !== rect.width * dpr || canvas.height !== rect.height * dpr) { canvas.width = rect.width * dpr; canvas.height = rect.height * dpr; }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); const w = rect.width, h = rect.height;
      ctx.fillStyle = "#080808"; ctx.fillRect(0, 0, w, h);
      const grad = ctx.createRadialGradient(w*.5,h*.55,0,w*.5,h*.55,w*.65); grad.addColorStop(0, track.color+"24"); grad.addColorStop(1,"transparent"); ctx.fillStyle=grad; ctx.fillRect(0,0,w,h);
      const wave = spectrumRef.current.wave; ctx.beginPath();
      for (let i=0;i<wave.length;i++){ const x=i/(wave.length-1)*w; const y=h*.5+wave[i]*h*.23; i?ctx.lineTo(x,y):ctx.moveTo(x,y); }
      ctx.strokeStyle=track.color; ctx.lineWidth=2; ctx.shadowBlur=18; ctx.shadowColor=track.color; ctx.stroke(); ctx.shadowBlur=0;
      for(let ring=0;ring<4;ring++){ const r=((frame*1.4+ring*80)%(Math.min(w,h)*.55)); ctx.beginPath(); ctx.arc(w/2,h/2,r,0,Math.PI*2); ctx.strokeStyle=track.color+Math.floor(90*(1-r/(Math.min(w,h)*.55))).toString(16).padStart(2,"0"); ctx.lineWidth=1; ctx.stroke(); }
      frame++; requestAnimationFrame(draw);
    }; const id=requestAnimationFrame(draw); return()=>cancelAnimationFrame(id);
  }, [track.color]);

  useEffect(() => () => stopAudio(), [stopAudio]);

  const timeline = useMemo(() => game === "running" ? (performance.now() - startRef.current) / 1000 : 0, [game, notes]);

  return (
    <main style={{ "--accent": track.color } as React.CSSProperties}>
      <header className="topbar"><div className="brand"><span>F//B</span><b>FORMULA BEAT</b></div><div className="signal"><i className={audioOn ? "live" : ""}/>{status}</div><div className="edition">EXPERIMENTAL BUILD · 001</div></header>

      {game === "setup" && <section className="setup-shell">
        <div className="intro"><p className="eyebrow">BYTEBEAT RHYTHM SYSTEM</p><h1>TURN CODE<br/><em>INTO RHYTHM.</em></h1><p className="lead">Каждая формула — одновременно музыка, визуальная система и новая игровая карта.</p></div>
        <div className="track-panel">
          <div className="panel-title"><span>01</span><div><b>SELECT SIGNAL</b><small>3 FORMULAS LOADED</small></div></div>
          <div className="track-list">{TRACKS.map((item,i)=><button key={item.name} onClick={()=>chooseTrack(i)} className={i===trackIndex?"selected":""}><span className="num">0{i+1}</span><div><b>{item.name}</b><small>{item.blurb}</small></div><span className="bpm">{item.bpm}<small>BPM</small></span></button>)}</div>
        </div>
        <div className="visual-card"><canvas ref={canvasRef}/><div className="visual-label"><span>LIVE SIGNAL</span><b>{track.name}</b></div><div className="reticle">+</div></div>
        <div className="config-panel">
          <div className="panel-title"><span>02</span><div><b>CALIBRATE</b><small>GAMEPLAY RESPONSE</small></div></div>
          <label>DIFFICULTY <span>{["FLOW","PULSE","OVERDRIVE"][difficulty-1]}</span></label><div className="segments">{[1,2,3].map(n=><button aria-label={`Difficulty ${n}`} onClick={()=>setDifficulty(n)} className={difficulty===n?"on":""} key={n}/>)}</div>
          <label>SIGNAL SENSITIVITY <span>{sensitivity}%</span></label><input type="range" min="30" max="90" value={sensitivity} onChange={e=>setSensitivity(+e.target.value)}/>
          <button className="launch" onClick={launch}><span>INITIALIZE RUN</span><b>↗</b></button><p className="hint">KEYS&nbsp; D · F · J · K &nbsp;/&nbsp; TOUCH</p>
        </div>
        <details className="formula-panel"><summary><span>03</span><b>FORMULA SOURCE</b><small>EDIT / PASTE BYTEBEAT</small></summary><textarea spellCheck={false} value={formula} onChange={e=>{setFormula(e.target.value);setStatus("UNCOMPILED CHANGES")}}/><div className="editor-foot"><span>JS EXPRESSION · t + sr AVAILABLE</span><button onClick={()=>{try{compileFormula(formula)(1,48000);setStatus("FORMULA READY")}catch{setStatus("FORMULA ERROR")}}}>CHECK CODE</button></div></details>
      </section>}

      {game === "running" && <section className="game-shell">
        <canvas ref={canvasRef} className="game-bg"/>
        <div className="game-hud"><div><small>SCORE</small><b>{score.toString().padStart(7,"0")}</b></div><div className="now-playing"><i/><span>{track.name}<small>{track.bpm} BPM · LIVE CHART</small></span></div><div className="hp"><small>SYNC</small><span><i style={{width:`${health}%`}}/></span></div></div>
        <div className="highway">{LANES.map((key,lane)=><button key={key} onPointerDown={()=>judge(lane)} className="lane"><span className="rail"/><b>{key}</b>{notes.filter(n=>n.lane===lane).map(n=>{const p=clamp(1-(n.hitAt-timeline)/1.6,0,1);return <i key={n.id} className={`note ${n.hit?"hit":""} ${n.missed?"missed":""}`} style={{top:`${p*82}%`}}/>})}</button>)}</div>
        <div className={`judgement ${lastJudgement.toLowerCase()}`}>{lastJudgement}<small>{combo>1?`${combo}× COMBO`:""}</small></div>
        <button className="exit" onClick={()=>{stopAudio();setGame("setup")}}>ESC · ABORT</button>
      </section>}
    </main>
  );
}
