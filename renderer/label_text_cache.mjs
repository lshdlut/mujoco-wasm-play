const MJ_LABEL_STRIDE = 100;
const MJ_LABEL_DECODER = (typeof TextDecoder !== 'undefined') ? new TextDecoder('utf-8') : null;

function decodeSceneLabels(labelBytes, scnNgeom) {
  if (!(scnNgeom > 0) || !labelBytes || !MJ_LABEL_DECODER) return null;
  if (labelBytes.length < scnNgeom * MJ_LABEL_STRIDE) return null;
  const decoded = new Array(scnNgeom);
  for (let si = 0; si < scnNgeom; si += 1) {
    const base = si * MJ_LABEL_STRIDE;
    if ((labelBytes[base] | 0) === 0) {
      decoded[si] = '';
      continue;
    }
    const bytes = labelBytes.subarray(base, base + MJ_LABEL_STRIDE);
    let end = bytes.indexOf(0);
    if (end < 0) end = MJ_LABEL_STRIDE;
    decoded[si] = MJ_LABEL_DECODER.decode(bytes.subarray(0, end)).trim();
  }
  return decoded;
}

function getDecodedSceneLabelsCached(cacheOwner, snapshot) {
  const scnNgeom = snapshot?.scn_ngeom | 0;
  const labelBytes = snapshot?.scn_label || null;
  if (!(scnNgeom > 0) || !labelBytes || !MJ_LABEL_DECODER) return null;
  if (labelBytes.length < scnNgeom * MJ_LABEL_STRIDE) return null;
  const owner = cacheOwner || {};
  if (
    owner._decodedLabelBytesRef === labelBytes &&
    owner._decodedLabelCount === scnNgeom &&
    Array.isArray(owner._decodedLabels)
  ) {
    return owner._decodedLabels;
  }
  const decoded = decodeSceneLabels(labelBytes, scnNgeom);
  owner._decodedLabelBytesRef = labelBytes;
  owner._decodedLabelCount = scnNgeom;
  owner._decodedLabels = decoded;
  return decoded;
}

export {
  MJ_LABEL_STRIDE,
  getDecodedSceneLabelsCached,
};
