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
  assert.match(source, /float stars\(vec2 uv/);
  assert.match(source, /float nebula=/);
  assert.match(source, /float shock=/);
  assert.doesNotMatch(source, /coreRadius|float shell=/);
  assert.match(styles, /translate3d\(0,calc\(var\(--note-y/);
});
