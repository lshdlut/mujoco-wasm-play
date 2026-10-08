// Keep replayable model inputs outside the Worker-owned, transferred buffers.
// Copying at this boundary preserves the existing bundle format and filesystem paths.
export function cloneLoadPayload(payload) {
  const xmlText = typeof payload?.xmlText === 'string' ? payload.xmlText : '';
  if (!xmlText.trim()) throw new Error('Model XML is empty');
  const copy = { xmlText };
  if (payload.xmlPath) copy.xmlPath = payload.xmlPath;
  if (payload.files) {
    copy.files = payload.files.map((entry) => {
      const data = entry.data;
      const bytes = data instanceof ArrayBuffer
        ? new Uint8Array(data)
        : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      return { path: entry.path, data: bytes.slice().buffer };
    });
  }
  return copy;
}
