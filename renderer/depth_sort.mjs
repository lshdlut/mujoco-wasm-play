// Depth-sorting helpers shared by the renderer pipeline and overlay3d.

function depthFromSoAPos(posView, posBase, rootElements, camX, camY, camZ, dirX, dirY, dirZ) {
  const lx = posView[posBase + 0] || 0;
  const ly = posView[posBase + 1] || 0;
  const lz = posView[posBase + 2] || 0;
  let wx = lx;
  let wy = ly;
  let wz = lz;
  if (rootElements) {
    wx = rootElements[0] * lx + rootElements[4] * ly + rootElements[8] * lz + rootElements[12];
    wy = rootElements[1] * lx + rootElements[5] * ly + rootElements[9] * lz + rootElements[13];
    wz = rootElements[2] * lx + rootElements[6] * ly + rootElements[10] * lz + rootElements[14];
  }
  const dx = wx - camX;
  const dy = wy - camY;
  const dz = wz - camZ;
  return dx * dirX + dy * dirY + dz * dirZ;
}

function transparentDepthNorm01(depth, depthMin, depthInvSpan) {
  const depthNorm = depthInvSpan > 1e-12 ? ((depth - depthMin) * depthInvSpan) : 0;
  return Math.max(0, Math.min(1, depthNorm));
}

function transparentBinFromDepthNorm(depthNorm, transparentBins) {
  const bins = transparentBins | 0;
  if (bins <= 1) return 0;
  const k = Math.floor(depthNorm * transparentBins);
  return Math.max(0, Math.min(bins - 1, k | 0));
}

export {
  depthFromSoAPos,
  transparentBinFromDepthNorm,
  transparentDepthNorm01,
};

