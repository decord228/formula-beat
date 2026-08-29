const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
let renderer = null;
let mode = "floatbeat";
let formulaRate = 48000;
let outputRate = 48000;
let nValue = 1;
let chunkSize = 1024;
let tick = 0;
let lastFormulaTick = -1;
let cachedResult = 0;
let runtimeErrorSent = false;

function compileFormula(source, signalMode) {
  const cleaned = source.replaceAll("\\*", "*").replaceAll("\\_", "_");
  const prelude = `
    const {abs,acos,acosh,asin,asinh,atan,atan2,atanh,cbrt,ceil,cos,cosh,exp,expm1,floor,fround,hypot,imul,log,log10,log1p,log2,max,min,pow,random,round,sign,sin,sinh,sqrt,tan,tanh,trunc,PI,E,LN2,LN10,LOG2E,LOG10E,SQRT1_2,SQRT2}=M;
    const int=x=>x|0, ln=log;
  `;
  const compileProgram = () => {
    const program = new Function("M", `${prelude}${cleaned}`)(Math);
    if (typeof program !== "function") throw new Error("FUNCBEAT MUST RETURN FUNCTION(TIME, SAMPLERATE, N)");
    return (t, sr, n) => program(t / sr, sr, n);
  };
  if (signalMode === "funcbeat") return compileProgram();
  try { return new Function("M", `${prelude}return function(t,sr,n){ return (${cleaned}); };`)(Math); }
  catch { return compileProgram(); }
}

function normalizeSample(value) {
  if (!Number.isFinite(value)) return 0;
  if (mode === "floatbeat" || mode === "funcbeat") return clamp(value, -1, 1);
  const integer = Math.floor(value);
  if (mode === "bytebeat") return ((integer & 255) - 128) / 128;
  return (((integer + 128) & 255) - 128) / 128;
}

function renderChunk(speed) {
  if (!renderer) return;
  const left = new Float32Array(chunkSize);
  const right = new Float32Array(chunkSize);
  for (let i = 0; i < chunkSize; i++) {
    const formulaTick = Math.floor(tick);
    if (formulaTick !== lastFormulaTick) {
      lastFormulaTick = formulaTick;
      try { cachedResult = renderer(formulaTick, formulaRate, nValue); }
      catch (error) {
        if (typeof error !== "string" && !runtimeErrorSent) {
          runtimeErrorSent = true;
          self.postMessage({ type: "runtime-error", message: error instanceof Error ? error.message : "unknown error" });
        }
      }
    }
    tick += formulaRate / outputRate * speed;
    const stereo = Array.isArray(cachedResult);
    const rawLeft = stereo ? cachedResult[0] : cachedResult;
    const rawRight = stereo ? cachedResult[1] ?? rawLeft : rawLeft;
    left[i] = normalizeSample(Number(rawLeft ?? 0));
    right[i] = normalizeSample(Number(rawRight ?? rawLeft ?? 0));
  }
  self.postMessage({ type: "chunk", left, right }, [left.buffer, right.buffer]);
}

self.onmessage = event => {
  const message = event.data;
  if (message.type === "init") {
    try {
      mode = message.mode;
      formulaRate = message.formulaRate;
      outputRate = message.outputRate;
      nValue = message.n;
      chunkSize = message.chunkSize;
      tick = 0;
      lastFormulaTick = -1;
      cachedResult = 0;
      runtimeErrorSent = false;
      renderer = compileFormula(message.source, message.mode);
      self.postMessage({ type: "ready" });
    } catch (error) {
      self.postMessage({ type: "compile-error", message: error instanceof Error ? error.message : "unknown error" });
    }
    return;
  }
  renderChunk(message.speed);
};
