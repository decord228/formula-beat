import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("gameplay motion is refresh-rate driven without per-frame React renders", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(source, /noteElementsRef\.current\.get\(note\.id\)/);
  assert.match(source, /requestAnimationFrame\(loop\)/);
  assert.match(source, /now - lastTimelineSync >= \.1/);
  assert.match(source, /if\(uiDirty\)setNotes\(\[\.\.\.notesRef\.current\]\)/);
});

test("reactive background uses an adaptive high-performance GPU path", async () => {
  const [source, styles] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  assert.match(source, /getContext\("webgl"/);
  assert.match(source, /powerPreference:"high-performance"/);
  assert.match(source, /quality=average>20/);
  assert.match(source, /for\(int i=0;i<7;i\+\+\)/);
  assert.match(source, /float nebula=/);
  assert.match(source, /float pulseRing=/);
  assert.match(source, /signal\.onset\*4\.2\+signal\.flux\*1\.4/);
  assert.match(source, /signal\.pitchConfidence/);
  assert.doesNotMatch(source, /coreRadius|float shell=/);
  assert.match(styles, /translate3d\(0,calc\(var\(--note-y/);
});

test("formula editor stays open beside the calibration panel", async () => {
  const [source, styles] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  assert.match(source, /<section className="formula-panel"/);
  assert.match(source, /<textarea aria-label="Formula source"/);
  assert.doesNotMatch(source, /<details className="formula-panel"/);
  assert.match(styles, /\.config-panel\{grid-column:2;grid-row:2\}/);
  assert.match(styles, /\.formula-panel\{grid-column:3;grid-row:2;/);
  assert.match(styles, /\.formula-panel textarea\{flex:1 1 auto;/);
});
