// =============================================================================
// terrainWorker.js — builds terrain tiles off the main thread so the frame
// rate holds while the ground streams in at full detail.
// =============================================================================
import { createHeightfield } from './heightfield.js';
import { buildChunk } from './chunkBuilder.js';

const bodies = new Map();

self.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'body') {
    bodies.set(m.id, { hf: createHeightfield(m.params), axes: m.axes });
    return;
  }
  if (m.type === 'drop') {
    bodies.delete(m.id);
    return;
  }
  if (m.type === 'chunk') {
    const b = bodies.get(m.bodyId);
    if (!b) { self.postMessage({ type: 'chunk', key: m.key, bodyId: m.bodyId, failed: true }); return; }
    const out = buildChunk(b.hf, b.axes, m.face, m.level, m.x, m.y, m.splitK);
    self.postMessage(
      { type: 'chunk', key: m.key, bodyId: m.bodyId, ...out },
      [out.position.buffer, out.normal.buffer, out.dir.buffer, out.detail.buffer, out.morph.buffer],
    );
  }
};
