// Runtime worker backend (manual source file).
// Note: `tools/generate_worker_protocol.mjs` only regenerates
// `worker/protocol.gen.mjs` and `worker/dispatch.gen.mjs`.
// This file is not generated.

import { buildWorkerUrl, isPerfEnabled, perfMarkOnce, perfNow, perfSample, logWarn, logError, logStatus, strictCatch, getStrictReport, withCacheBust } from '../core/viewer_runtime.mjs';
import { getRuntimeConfig } from '../core/runtime_config.mjs';
import { SCENE_FLAG_DEFAULTS_NUMERIC } from '../core/viewer_defaults.mjs';
import { cloneStruct, createDefaultHistoryState, createDefaultKeyframeState, createDefaultWatchState, normaliseGroupState } from '../core/viewer_shared.mjs';
import { dispatchEvent } from '../worker/dispatch.gen.mjs';
import { GEOM_VIEW_FIELDS_OPTIONAL, GEOM_VIEW_FIELDS_ALWAYS } from '../worker/protocol.gen.mjs';
import { parseMuJoCoDirectFileRefs, buildMuJoCoBundle } from '../core/xml_refs.mjs';
import { buildModelCandidates, resolveModelFileName, MODEL_POOL } from './model_candidates.mjs';
import { applyHistoryPayload, applyKeyframesPayload, applyWatchPayload, applyViewFields, createInitialSnapshot, resolveSnapshot } from './snapshot_utils.mjs';
import { createBackendRuntime } from './backend_runtime.mjs';
const ASSET_BASE_URL = new URL('../', import.meta.url);
const WORKER_URL = new URL('worker/physics.worker.mjs', ASSET_BASE_URL);
export async function createBackend(options = {}) {
  const perfEnabled = isPerfEnabled();
  const runtimeConfig = getRuntimeConfig();
  const snapshotDebug = !!runtimeConfig.snapshotDebug;
  const modelToken = typeof options.model === 'string' ? options.model.trim() : '';
  const modelFile = resolveModelFileName(modelToken);
  const modelCandidates = buildModelCandidates(modelToken, modelFile);
  const initialCandidate = modelCandidates[0] || null;
  const initialModelInfo = {
    token: modelToken || '',
    file: initialCandidate ? initialCandidate.file : null,
    label: initialCandidate ? initialCandidate.label : (modelToken || ''),
  };
  const listeners = new Set();
  const sampleIfFinite = (bucket, value, detail = null) => {
    if (!perfEnabled) return null;
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    return perfSample(bucket, value, detail);
  };
  let client = null;
  const kind = 'worker';
  let lastSnapshot = createInitialSnapshot();
  let publishedSnapshot = resolveSnapshot(lastSnapshot);
  let publishedSnapshotDirty = false;
  let lastFrameId = -1;
  let lastSnapshotRecvWallMs = 0;
  let lastSnapshotSentWallMs = null;
  let lastLatencyProbeRecvWallMs = 0;
  let lastSnapshotTransferMs = null;
  let lastSnapshotTransferFrameId = null;
  let messageHandler = null;
  let lastXmlText = null;
  let strictRequestSeq = 0;
  const strictRequests = new Map();
  const SNAPSHOT_ADAPT_MAX_HZ = runtimeConfig.timing?.snapshotHzMax ?? 120;
  const SNAPSHOT_ADAPT_DEFAULT_HZ = SNAPSHOT_ADAPT_MAX_HZ;
  const SNAPSHOT_ADAPT_ALPHA = 0.2;
  const SNAPSHOT_ADAPT_UPGRADE_HOLD_MS = 180;
  const SNAPSHOT_ADAPT_MIN_CHANGE_MS = 200;
  let adaptiveSnapshotHz = SNAPSHOT_ADAPT_DEFAULT_HZ;
  let adaptiveSnapshotEwmaMs = null;
  let adaptiveTransferEwmaMs = null;
  let adaptiveGoodSinceWallMs = null;
  let adaptiveBadStreak = 0;
  let adaptiveLastChangeWallMs = 0;

  function readPublishedSnapshot(markDirty = false) {
    if (markDirty) {
      publishedSnapshotDirty = true;
    }
    if (publishedSnapshotDirty) {
      publishedSnapshot = resolveSnapshot(lastSnapshot);
      publishedSnapshotDirty = false;
    }
    return publishedSnapshot;
  }

  function publishMutation(options = false) {
    const notify =
      typeof options === 'object' && options !== null
        ? !!options.notify
        : !!options;
    if (notify) {
      return notifyListeners();
    }
    return readPublishedSnapshot(true);
  }

  function resetAdaptiveSnapshotState() {
    adaptiveSnapshotHz = SNAPSHOT_ADAPT_DEFAULT_HZ;
    adaptiveSnapshotEwmaMs = null;
    adaptiveTransferEwmaMs = null;
    adaptiveGoodSinceWallMs = null;
    adaptiveBadStreak = 0;
    adaptiveLastChangeWallMs = Date.now();
  }

  function ewma(prev, value, alpha) {
    if (!Number.isFinite(value)) return prev;
    if (!Number.isFinite(prev)) return value;
    return prev * (1 - alpha) + value * alpha;
  }

  function postSnapshotHzIfChanged(nextHz) {
    if (!client || typeof client.postMessage !== 'function') return false;
    const hz = Number(nextHz);
    if (!Number.isFinite(hz) || hz <= 0) return false;
    if (hz === adaptiveSnapshotHz) return false;
    adaptiveSnapshotHz = hz;
    adaptiveLastChangeWallMs = Date.now();
    adaptiveGoodSinceWallMs = null;
    adaptiveBadStreak = 0;
    try {
      client.postMessage({ cmd: 'setSnapshotHz', hz });
    } catch (err) {
      strictCatch(err, 'backend:setSnapshotHz');
    }
    return true;
  }

  function maybeUpdateAdaptiveSnapshotHz(snapshotMsRaw, transferMsRaw) {
    const snapshotMs = Number(snapshotMsRaw);
    const transferMs = Number(transferMsRaw);
    if (!Number.isFinite(snapshotMs) || snapshotMs < 0) return;
    if (!Number.isFinite(transferMs) || transferMs < 0) return;
    const now = Date.now();
    adaptiveSnapshotEwmaMs = ewma(adaptiveSnapshotEwmaMs, snapshotMs, SNAPSHOT_ADAPT_ALPHA);
    adaptiveTransferEwmaMs = ewma(adaptiveTransferEwmaMs, transferMs, SNAPSHOT_ADAPT_ALPHA);
    const currentHz = adaptiveSnapshotHz;
    const currentIntervalMs = 1000 / Math.max(1, currentHz);
    const sinceChangeMs = now - adaptiveLastChangeWallMs;
    const canChange = sinceChangeMs >= SNAPSHOT_ADAPT_MIN_CHANGE_MS;
    const tiers = SNAPSHOT_ADAPT_MAX_HZ >= 120 ? [30, 60, 120] : [30, 60];
    const tierIndex = tiers.indexOf(currentHz);
    const lowerHz = tierIndex > 0 ? tiers[tierIndex - 1] : null;
    const higherHz = tierIndex >= 0 && tierIndex < (tiers.length - 1) ? tiers[tierIndex + 1] : null;
    const ewmaSnap = Number(adaptiveSnapshotEwmaMs);
    const ewmaXfer = Number(adaptiveTransferEwmaMs);

    // Downgrade aggressively to avoid backlog.
    const hardBad =
      transferMs > 4.0 * currentIntervalMs
      || snapshotMs > 0.9 * currentIntervalMs;
    const softBad =
      ewmaXfer > 2.0 * currentIntervalMs
      || ewmaSnap > 0.6 * currentIntervalMs;
    if (lowerHz && canChange) {
      if (hardBad) {
        postSnapshotHzIfChanged(lowerHz);
        return;
      }
      if (softBad) {
        adaptiveBadStreak += 1;
        if (adaptiveBadStreak >= 2) {
          postSnapshotHzIfChanged(lowerHz);
          return;
        }
      } else {
        adaptiveBadStreak = 0;
      }
    }

    // Upgrade quickly when both worker cost and delivery latency are comfortably below
    // the next tier's interval.
    if (higherHz && canChange) {
      const nextIntervalMs = 1000 / higherHz;
      const good =
        ewmaXfer < 0.8 * nextIntervalMs
        && ewmaSnap < 0.25 * nextIntervalMs;
      if (good) {
        if (!Number.isFinite(adaptiveGoodSinceWallMs)) adaptiveGoodSinceWallMs = now;
        if ((now - adaptiveGoodSinceWallMs) >= SNAPSHOT_ADAPT_UPGRADE_HOLD_MS) {
          postSnapshotHzIfChanged(higherHz);
          return;
        }
      } else {
        adaptiveGoodSinceWallMs = null;
      }
    }
  }

  const clientRef = {
    get current() {
      return client;
    },
    set current(value) {
      client = value;
    },
  };
  const lastSnapshotRef = {
    get current() {
      return lastSnapshot;
    },
    set current(value) {
      lastSnapshot = value;
    },
  };
  const lastXmlTextRef = {
    get current() {
      return lastXmlText;
    },
    set current(value) {
      lastXmlText = value;
    },
  };
  function spawnWorkerBackend() {
    const workerUrl = buildWorkerUrl(WORKER_URL);
    return new Worker(workerUrl, { type: 'module' });
  }

  function collectLoadTransfers(files) {
    if (!Array.isArray(files) || !files.length) return [];
    const transfers = [];
    for (const entry of files) {
      const buf = entry && entry.data;
      if (buf instanceof ArrayBuffer) {
        transfers.push(buf);
      } else if (ArrayBuffer.isView(buf)) {
        transfers.push(buf.buffer);
      }
    }
    return transfers;
  }

  async function requestWorkerStrictReport() {
    if (!client || typeof client.postMessage !== 'function') return null;
    const id = (strictRequestSeq += 1);
    const promise = new Promise((resolve, reject) => {
      strictRequests.set(id, { resolve, reject });
    });
    try {
      client.postMessage({ cmd: 'strictReport', id });
    } catch (err) {
      strictRequests.delete(id);
      strictCatch(err, 'backend:strict_report_request');
      throw err;
    }
    return promise;
  }

  async function loadDefaultXml() {
    const errors = [];
    if (!modelCandidates.length) {
      throw new Error('No model loaded. No model candidates available.');
    }
    for (const candidate of modelCandidates) {
      const file = candidate.file;
      if (!file) continue;
    try {
      const url = new URL(file, ASSET_BASE_URL);
      const res = await fetch(withCacheBust(url.href));
      if (!res.ok) {
        errors.push(`fetch ${file} status ${res.status}`);
        logWarn(`[backend] fetch ${file} failed with status ${res.status}`);
        continue;
      }
      const text = await res.text();
      if (!text || text.trim().length === 0) {
        errors.push(`empty content for ${file}`);
        continue;
      }
      try {
        const parsed = parseMuJoCoDirectFileRefs(text);
        const localRefs = (parsed.refs ?? []).filter((r) => r && r.path && !r.remote && !r.absolute);
        const unsupported = (parsed.refs ?? []).filter((r) => r && r.path && (r.remote || r.absolute));
        if (unsupported.length) {
          const items = unsupported.map((r) => r.path).filter(Boolean).slice(0, 3);
          const suffix = unsupported.length > 3 ? ` (+${unsupported.length - 3} more)` : '';
          throw new Error(`Unsupported file reference(s): ${items.join(', ')}${suffix}`);
        }
        if (localRefs.length) {
          const bundle = await buildMuJoCoBundle(
            file,
            text,
            async (relPath) => {
              const refUrl = new URL(relPath, ASSET_BASE_URL);
              const r = await fetch(withCacheBust(refUrl.href));
              if (!r.ok) throw new Error(`fetch ${relPath} status ${r.status}`);
              return r.arrayBuffer();
            },
          );
          return { xmlText: text, xmlPath: `/mem/${bundle.xmlRel}`, files: bundle.files };
        }
      } catch (err) {
        errors.push(`bundle ${file} error ${String(err)}`);
        logWarn('[backend] failed to build xml bundle', { file, err });
        strictCatch(err, 'backend:bundle_xml');
        continue;
      }
      return { xmlText: text };
    } catch (err) {
      errors.push(`fetch ${file} error ${String(err)}`);
      logWarn('[backend] failed to fetch xml', { file, err });
      strictCatch(err, 'backend:fetch_xml');
    }
  }
    throw new Error(
      `No model loaded. Tried: ${modelCandidates.map((c) => c.file).join(', ')}. Errors: ${errors.join('; ')}`,
    );
  }

  function notifyListeners() {
    const perfEnabled = isPerfEnabled();
    if (!Number.isFinite(lastSnapshot.rate)) {
      lastSnapshot.rate = 1;
    }
    if (typeof lastSnapshot.paused !== 'boolean') {
      lastSnapshot.paused = false;
    }
    if (!lastSnapshot.rateSource) lastSnapshot.rateSource = 'backend';
    if (!lastSnapshot.pausedSource) lastSnapshot.pausedSource = 'backend';
    if (perfEnabled) {
      perfSample('backend:listeners_count', listeners.size || 0);
    }
    const snapshot = readPublishedSnapshot(true);
    let listenerIndex = 0;
    for (const fn of listeners) {
      const tListenerStart = perfEnabled ? perfNow() : 0;
      try {
        fn(snapshot);
      } catch (err) {
        logError(err);
        strictCatch(err, 'backend:listener');
      } finally {
        if (perfEnabled) {
          perfSample('backend:listener_ms', perfNow() - tListenerStart, { index: listenerIndex });
        }
        listenerIndex += 1;
      }
    }
    return snapshot;
  }

  function detachClient() {
    if (messageHandler) {
      try { client?.removeEventListener?.('message', messageHandler); } catch (err) { strictCatch(err, 'backend:detach_listener'); }
      try { if (client && 'onmessage' in client) client.onmessage = null; } catch (err) { strictCatch(err, 'backend:detach_onmessage'); }
    }
  }

  async function restartWorkerWithLoadPayload(loadPayload) {
    const xmlText = typeof loadPayload?.xmlText === 'string' ? loadPayload.xmlText : String(loadPayload?.xmlText ?? '');
    if (!xmlText || xmlText.trim().length === 0) {
      return readPublishedSnapshot(false);
    }
    // Tear down old worker (if any).
    try { detachClient(); } catch (err) { strictCatch(err, 'backend:detach_client'); }
    try { client?.terminate?.(); } catch (err) { strictCatch(err, 'backend:terminate'); }
    client = null;
    // Spawn a fresh worker (new wasm instance).
    try {
      client = await spawnWorkerBackend();
    } catch (err) {
      logError('[backend] worker init failed', err);
      strictCatch(err, 'backend:worker_init');
      throw err;
    }
    // Attach message handler to the new worker.
    if (typeof client.addEventListener === 'function') {
      messageHandler = (evt) => handleMessage(evt);
      client.addEventListener('message', messageHandler);
    } else if ('onmessage' in client) {
      messageHandler = (evt) => handleMessage(evt);
      client.onmessage = messageHandler;
    }
    const loadRate = Number.isFinite(lastSnapshot.rate) ? lastSnapshot.rate : 1;
    // Reset local snapshot state and kick off load on the fresh worker.
    lastSnapshot = createInitialSnapshot();
    publishedSnapshot = resolveSnapshot(lastSnapshot);
    publishedSnapshotDirty = false;
    lastFrameId = -1;
    lastSnapshot.visualDefaults = null;
    resetAdaptiveSnapshotState();
    notifyListeners();
    try {
      const msg = { cmd: 'load', rate: loadRate, xmlText };
      if (typeof loadPayload?.xmlPath === 'string' && loadPayload.xmlPath.trim().length) {
        msg.xmlPath = loadPayload.xmlPath;
      }
      if (Array.isArray(loadPayload?.files) && loadPayload.files.length) {
        msg.files = loadPayload.files;
      }
      const transfers = collectLoadTransfers(loadPayload?.files);
      client.postMessage(msg, transfers);
      client.postMessage({ cmd: 'setSnapshotHz', hz: SNAPSHOT_ADAPT_DEFAULT_HZ });
      client.postMessage({ cmd: 'snapshot' });
    } catch (err) {
      logError('[backend load] failed', err);
      strictCatch(err, 'backend:load');
      throw err;
    }
    return publishMutation();
  }

  async function restartWorkerWithXml(xmlText) {
    const payload = typeof xmlText === 'string' ? xmlText : String(xmlText ?? '');
    return restartWorkerWithLoadPayload({ xmlText: payload });
  }

  function formatCopyNumber(value, precision) {
    const num = Number(value);
    if (!Number.isFinite(num)) return '0';
    if (precision === 'full') {
      return num.toPrecision(16);
    }
    return num.toPrecision(6);
  }

  function buildCopyKeyXmlFromPayload(data) {
    if (!data || typeof data !== 'object') return null;
    const precision = data.precision === 'full' ? 'full' : 'standard';
    const nq = Number(data.nq) || 0;
    const nv = Number(data.nv) || 0;
    const nu = Number(data.nu) || 0;
    const na = Number(data.na) || 0;
    const nmocap = Number(data.nmocap) || 0;
    const tSim = typeof data.tSim === 'number' ? data.tSim : 0;
    const hasFullQpos = Array.isArray(data.qpos) && data.qpos.length >= nq && nq > 0;
    const hasFullQvel = Array.isArray(data.qvel) && data.qvel.length >= nv && nv > 0;
    const hasFullCtrl = Array.isArray(data.ctrl) && data.ctrl.length >= nu && nu > 0;
    const hasFullAct = Array.isArray(data.act) && data.act.length >= na && na > 0;
    const hasFullMpos = Array.isArray(data.mpos) && data.mpos.length >= nmocap * 3 && nmocap > 0;
    const hasFullMquat = Array.isArray(data.mquat) && data.mquat.length >= nmocap * 4 && nmocap > 0;
    const qpos = hasFullQpos
      ? data.qpos
      : (Array.isArray(data.qposPreview) ? data.qposPreview : []);
    const qvel = hasFullQvel
      ? data.qvel
      : (Array.isArray(data.qvelPreview) ? data.qvelPreview : []);
    const ctrl = hasFullCtrl
      ? data.ctrl
      : (Array.isArray(data.ctrlPreview) ? data.ctrlPreview : []);
    const act = hasFullAct ? data.act : [];
    const mpos = hasFullMpos ? data.mpos : [];
    const mquat = hasFullMquat ? data.mquat : [];
    const format = (v) => formatCopyNumber(v, precision);
    let xml = '<key\n';
    xml += `  time=\"${format(tSim)}\"\n`;
    if (qpos.length) {
      xml += `  qpos=\"${qpos.map(format).join(' ')}\"\n`;
    }
    if (qvel.length) {
      xml += `  qvel=\"${qvel.map(format).join(' ')}\"\n`;
    }
    if (act.length) {
      xml += `  act=\"${act.map(format).join(' ')}\"\n`;
    }
    if (ctrl.length) {
      xml += `  ctrl=\"${ctrl.map(format).join(' ')}\"\n`;
    }
    if (mpos.length) {
      xml += `  mpos=\"${mpos.map(format).join(' ')}\"\n`;
    }
    if (mquat.length) {
      xml += `  mquat=\"${mquat.map(format).join(' ')}\"\n`;
    }
    xml += '/>';
    return xml;
  }

  async function writeCopyKeyToClipboard(xml) {
    if (!xml) return;
    if (typeof navigator === 'undefined' || !navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
      logWarn('[backend copyState] clipboard API unavailable');
      return;
    }
    try {
      await navigator.clipboard.writeText(xml);
    } catch (err) {
      logError('[backend copyState] clipboard write failed', err);
      strictCatch(err, 'backend:clipboard_write');
      throw err;
    }
  }

  function applyOptionSnapshot(data) {
    if (!data || typeof data !== 'object') return;
    if (Array.isArray(data.voptFlags)) {
      lastSnapshot.voptFlags = data.voptFlags.map((flag) => (flag ? 1 : 0));
    }
    if (Array.isArray(data.sceneFlags)) {
      const flags = [];
      for (let i = 0; i < SCENE_FLAG_DEFAULTS_NUMERIC.length; i += 1) {
        if (i < data.sceneFlags.length && data.sceneFlags[i] != null) {
          flags[i] = data.sceneFlags[i] ? 1 : 0;
        } else {
          flags[i] = SCENE_FLAG_DEFAULTS_NUMERIC[i];
        }
      }
      lastSnapshot.sceneFlags = flags;
    }
    if (typeof data.labelMode === 'number' && Number.isFinite(data.labelMode)) {
      lastSnapshot.labelMode = data.labelMode | 0;
    }
    if (typeof data.frameMode === 'number' && Number.isFinite(data.frameMode)) {
      lastSnapshot.frameMode = data.frameMode | 0;
    }
    if (typeof data.cameraMode === 'number' && Number.isFinite(data.cameraMode)) {
      lastSnapshot.cameraMode = data.cameraMode | 0;
    }
    if (data.groups && typeof data.groups === 'object') {
      lastSnapshot.groups = normaliseGroupState(data.groups);
    }
    if (data.options) {
      lastSnapshot.options = data.options;
    }
    publishedSnapshotDirty = true;
  }

  function setRunState(run, source = 'ui', notifyBackend = true) {
    const nextPaused = !run;
    lastSnapshot.paused = nextPaused;
    lastSnapshot.pausedSource = source || 'backend';
    if (notifyBackend) {
      try {
        client.postMessage?.({ cmd: 'setPaused', paused: nextPaused, source });
      } catch (err) {
        logWarn('[backend] setPaused post failed', err);
        strictCatch(err, 'backend:setPaused');
      }
    }
    return publishMutation(true);
  }

  function setRate(nextRate, source = 'ui') {
    const raw = Number(nextRate);
    const clamped = Number.isFinite(raw) ? Math.max(0.0625, Math.min(16, raw)) : 1;
    lastSnapshot.rate = clamped;
    lastSnapshot.rateSource = source || 'backend';
    try {
      client.postMessage?.({ cmd: 'setRate', rate: clamped, source });
    } catch (err) {
      logWarn('[backend] setRate post failed', err);
      strictCatch(err, 'backend:setRate');
    }
    return publishMutation(true);
  }

  async function loadXmlText(xmlText) {
    const payload = typeof xmlText === 'string' ? xmlText : String(xmlText ?? '');
    lastXmlText = payload;
    return restartWorkerWithXml(payload);
  }

  async function loadXmlBundle(loadPayload) {
    if (!loadPayload || typeof loadPayload !== 'object') {
      return readPublishedSnapshot(false);
    }
    const xmlText = typeof loadPayload.xmlText === 'string' ? loadPayload.xmlText : String(loadPayload.xmlText ?? '');
    lastXmlText = xmlText;
    return restartWorkerWithLoadPayload(loadPayload);
  }

  function updateGeometryCaches(data = {}) {
    const makeView = (value, fallback, Ctor) => {
      if (ArrayBuffer.isView(value)) {
        return value;
      }
      if (Array.isArray(value) && Ctor) {
        try {
          return new Ctor(value);
        } catch (err) {
          strictCatch(err, 'backend:makeView');
          return fallback;
        }
      }
      return fallback;
    };
    const makeViewOrNull = (value, Ctor) => makeView(value, null, Ctor);
    lastSnapshot.xpos = makeView(data.xpos, new Float64Array(0), Float64Array);
    lastSnapshot.xmat = makeView(data.xmat, new Float64Array(0), Float64Array);
    if (typeof data.scn_ngeom === 'number' && Number.isFinite(data.scn_ngeom)) {
      lastSnapshot.scn_ngeom = data.scn_ngeom | 0;
    }
    applyViewFields(lastSnapshot, data, GEOM_VIEW_FIELDS_OPTIONAL, makeViewOrNull, { skipMissing: true });
    if (typeof data.nisland === 'number' && Number.isFinite(data.nisland)) lastSnapshot.nisland = data.nisland | 0;
    if (Array.isArray(data.eq_names)) lastSnapshot.eq_names = data.eq_names.slice();
    applyViewFields(lastSnapshot, data, GEOM_VIEW_FIELDS_ALWAYS, makeViewOrNull, { skipMissing: true });
    lastSnapshot.contacts = data.contacts && typeof data.contacts === 'object' ? data.contacts : null;
  }

  const workerEventHandlers = {
    strict_report: (payload) => {
      const id = Number(payload.id) || 0;
      const pending = strictRequests.get(id);
      if (pending) {
        strictRequests.delete(id);
        pending.resolve(payload.report || null);
      }
    },
    run_state: (payload) => {
      if (typeof payload.running === 'boolean') {
        lastSnapshot.paused = !payload.running;
        lastSnapshot.pausedSource = payload.source || 'backend';
        notifyListeners();
      }
    },
    ready: (payload) => {
      perfMarkOnce('play:backend:worker_ready', {
        sentWallMs: (typeof payload?.perf?.sentWallMs === 'number') ? payload.perf.sentWallMs : null,
        transferMs: (typeof payload?.perf?.sentWallMs === 'number') ? (Date.now() - payload.perf.sentWallMs) : null,
        worker: payload?.perf && typeof payload.perf === 'object' ? payload.perf : null,
        ngeom: typeof payload.ngeom === 'number' ? (payload.ngeom | 0) : null,
      });
      lastFrameId = -1;
      lastSnapshotRecvWallMs = 0;
      lastSnapshotSentWallMs = null;
      lastLatencyProbeRecvWallMs = 0;
      lastSnapshotTransferMs = null;
      lastSnapshotTransferFrameId = null;
      lastSnapshot.history = createDefaultHistoryState();
      lastSnapshot.keyframes = createDefaultKeyframeState();
      lastSnapshot.watch = createDefaultWatchState();
      lastSnapshot.keyIndex = -1;
      if (typeof payload.ngeom === 'number') lastSnapshot.ngeom = payload.ngeom;
      if (typeof payload.nq === 'number') lastSnapshot.nq = payload.nq;
      if (typeof payload.nv === 'number') lastSnapshot.nv = payload.nv;
      if (payload.optionSupport) {
        lastSnapshot.optionSupport = payload.optionSupport;
      }
      if (payload.visual) {
        lastSnapshot.visual = cloneStruct(payload.visual);
        lastSnapshot.visualDefaults = cloneStruct(payload.visual);
        lastSnapshot.visualVersion = (lastSnapshot.visualVersion | 0) + 1;
        lastSnapshot.visualDefaultsVersion = (lastSnapshot.visualDefaultsVersion | 0) + 1;
      }
      if (payload.statistic) {
        lastSnapshot.statistic = cloneStruct(payload.statistic);
        lastSnapshot.statisticVersion = (lastSnapshot.statisticVersion | 0) + 1;
      }
      lastSnapshot.scn_ngeom = 0;
      lastSnapshot.gsize = null;
      lastSnapshot.gtype = null;
      lastSnapshot.bxpos = null;
      lastSnapshot.bxmat = null;
      lastSnapshot.qpos = null;
      lastSnapshot.scn_type = null;
      lastSnapshot.scn_pos = null;
      lastSnapshot.scn_mat = null;
      lastSnapshot.scn_size = null;
      lastSnapshot.scn_rgba = null;
      lastSnapshot.scn_matid = null;
      lastSnapshot.scn_dataid = null;
      lastSnapshot.scn_objtype = null;
      lastSnapshot.scn_objid = null;
      lastSnapshot.scn_category = null;
      lastSnapshot.scn_geomorder = null;
      lastSnapshot.scn_label = null;
      lastSnapshot.flexvert_xpos = null;
      lastSnapshot.eq_type = null;
      lastSnapshot.eq_obj1id = null;
      lastSnapshot.eq_obj2id = null;
      lastSnapshot.eq_objtype = null;
      lastSnapshot.eq_active = null;
      lastSnapshot.eq_names = [];
      lastSnapshot.light_xpos = null;
      lastSnapshot.light_xdir = null;
      updateGeometryCaches(payload);
      if (payload.gesture) {
        lastSnapshot.gesture = {
          ...(lastSnapshot.gesture || {}),
          ...payload.gesture,
        };
      }
      if (payload.drag) {
        lastSnapshot.drag = {
          ...(lastSnapshot.drag || {}),
          ...payload.drag,
        };
      }
      if (payload.ctrl) {
        try {
          lastSnapshot.ctrl = Array.isArray(payload.ctrl)
            ? payload.ctrl.slice()
            : Array.from(payload.ctrl);
        } catch (err) {
          logWarn('[backend] ctrl decode failed', err);
          strictCatch(err, 'backend:ctrl_decode');
          lastSnapshot.ctrl = [];
        }
      }
      if (payload.options) {
        lastSnapshot.options = payload.options;
      }
      applyOptionSnapshot(payload);
      notifyListeners();
    },
    latency_probe: (payload) => {
      if (!perfEnabled) return;
      const recvWallMs = Date.now();
      if (lastLatencyProbeRecvWallMs > 0) {
        sampleIfFinite('worker_to_main:probe_recv_interval_ms', recvWallMs - lastLatencyProbeRecvWallMs);
      }
      lastLatencyProbeRecvWallMs = recvWallMs;
      const sentWallMs = typeof payload?.sentWallMs === 'number' ? payload.sentWallMs : null;
      if (sentWallMs != null) {
        perfSample('worker_to_main:probe_transfer_ms', recvWallMs - sentWallMs);
      }
    },
    struct_state: (payload) => {
      if (payload.scope === 'mjVisual') {
        lastSnapshot.visual = payload.value || null;
        lastSnapshot.visualVersion = (lastSnapshot.visualVersion | 0) + 1;
      } else if (payload.scope === 'mjStatistic') {
        lastSnapshot.statistic = payload.value || null;
        lastSnapshot.statisticVersion = (lastSnapshot.statisticVersion | 0) + 1;
      }
      notifyListeners();
    },
    meta_cameras: (payload) => {
      lastSnapshot.cameras = Array.isArray(payload.cameras) ? payload.cameras : [];
      const totalModes = Math.max(1, 2 + (lastSnapshot.cameras?.length || 0));
      const mode = lastSnapshot.cameraMode | 0;
      if (mode >= totalModes) {
        lastSnapshot.cameraMode = 0;
        try { client.postMessage?.({ cmd: 'setCameraMode', mode: 0 }); } catch (err) { strictCatch(err, 'backend:setCameraMode'); }
      }
      notifyListeners();
    },
    meta_geoms: (payload) => {
      lastSnapshot.geoms = Array.isArray(payload.geoms) ? payload.geoms : [];
      notifyListeners();
    },
    selection: (payload) => {
      lastSnapshot.selection = {
        seq: Number(payload.seq) || 0,
        bodyId: Number(payload.bodyId) | 0,
        geomId: Number(payload.geomId) | 0,
        flexId: Number(payload.flexId) | 0,
        skinId: Number(payload.skinId) | 0,
        point: Array.isArray(payload.point)
          ? [Number(payload.point[0]) || 0, Number(payload.point[1]) || 0, Number(payload.point[2]) || 0]
          : [0, 0, 0],
        localpos: Array.isArray(payload.localpos)
          ? [Number(payload.localpos[0]) || 0, Number(payload.localpos[1]) || 0, Number(payload.localpos[2]) || 0]
          : [0, 0, 0],
        timestamp: Number(payload.timestamp) || 0,
      };
      notifyListeners();
    },
    meta_joints: (payload) => {
      const toI32 = (value) => {
        if (!value) return null;
        if (ArrayBuffer.isView(value)) {
          try { return new Int32Array(value); } catch (err) { strictCatch(err, 'backend:meta_joints_view'); return null; }
        }
        if (value instanceof ArrayBuffer) {
          try { return new Int32Array(value); } catch (err) { strictCatch(err, 'backend:meta_joints_buffer'); return null; }
        }
        if (Array.isArray(value)) {
          try { return Int32Array.from(value); } catch (err) { strictCatch(err, 'backend:meta_joints_array'); return null; }
        }
        return null;
      };
      const geomBody = toI32(payload.geom_bodyid);
      if (geomBody) lastSnapshot.geom_bodyid = geomBody;
      const bodyAdr = toI32(payload.body_jntadr);
      if (bodyAdr) lastSnapshot.body_jntadr = bodyAdr;
      const bodyNum = toI32(payload.body_jntnum);
      if (bodyNum) lastSnapshot.body_jntnum = bodyNum;
      const bodyParent = toI32(payload.body_parentid);
      if (bodyParent) lastSnapshot.body_parentid = bodyParent;
      const jtype = toI32(payload.jtype);
      if (jtype) lastSnapshot.jtype = jtype;
      if (typeof payload.nbody === 'number') lastSnapshot.nbody = payload.nbody | 0;
      if (typeof payload.njnt === 'number') lastSnapshot.njnt = payload.njnt | 0;
      const jqposadr = toI32(payload.jnt_qposadr);
      if (jqposadr) lastSnapshot.jnt_qposadr = jqposadr;
      const jrange = (() => {
        const source = payload.jnt_range;
        if (!source) return null;
        try {
          if (ArrayBuffer.isView(source)) return new Float64Array(source);
          if (Array.isArray(source)) return Float64Array.from(source);
          if (source instanceof ArrayBuffer) return new Float64Array(source);
        } catch (err) {
          strictCatch(err, 'backend:meta_joints_range');
        }
        return null;
      })();
      if (jrange) lastSnapshot.jnt_range = jrange;
      if (Array.isArray(payload.jnt_names)) {
        lastSnapshot.jnt_names = payload.jnt_names.map((name, idx) => String(name ?? `jnt ${idx}`));
      }
      notifyListeners();
    },
    meta: (payload) => {
      try {
        // Actuator metadata for dynamic control UI
        if (Array.isArray(payload.actuators)) {
          lastSnapshot.actuators = payload.actuators.map((a) => ({
            index: Number(a.index) | 0,
            name: String(a.name ?? `act ${a.index|0}`),
            min: Number(a.min),
            max: Number(a.max),
            step: Number.isFinite(+a.step) && +a.step > 0 ? +a.step : 0.001,
            value: Number(a.value) || 0,
          }));
          notifyListeners();
        }
      } catch (err) {
        strictCatch(err, 'backend:meta_actuators');
      }
    },
    snapshot: (payload) => {
      const tDecodeStart = perfEnabled ? perfNow() : 0;
      const recvWallMs = Date.now();
      if (perfEnabled) {
        if (lastSnapshotRecvWallMs > 0) {
          sampleIfFinite('worker_to_main:snapshot_recv_interval_ms', recvWallMs - lastSnapshotRecvWallMs);
        }
        lastSnapshotRecvWallMs = recvWallMs;
        perfMarkOnce('play:backend:first_snapshot', {
          sentWallMs: (typeof payload?.perf?.sentWallMs === 'number') ? payload.perf.sentWallMs : null,
          transferMs: (typeof payload?.perf?.sentWallMs === 'number') ? (recvWallMs - payload.perf.sentWallMs) : null,
          worker: payload?.perf && typeof payload.perf === 'object' ? payload.perf : null,
        });
      }
      const frameId = Number.isFinite(payload.frameId) ? (payload.frameId | 0) : null;
      if (frameId !== null) {
        if (frameId <= lastFrameId) {
          return;
        }
        lastFrameId = frameId;
        lastSnapshot.frameId = frameId;
      }
      if (typeof payload.tSim === 'number') lastSnapshot.t = payload.tSim;
      if (typeof payload.ngeom === 'number') lastSnapshot.ngeom = payload.ngeom;
      if (typeof payload.nq === 'number') lastSnapshot.nq = payload.nq;
      if (typeof payload.nv === 'number') lastSnapshot.nv = payload.nv;
      if (typeof payload.rate === 'number' && Number.isFinite(payload.rate)) {
        lastSnapshot.rate = payload.rate;
      }
      if (typeof payload.measuredSlowdown === 'number' && Number.isFinite(payload.measuredSlowdown)) {
        lastSnapshot.measuredSlowdown = payload.measuredSlowdown;
      }
      if (typeof payload.paused === 'boolean') {
        lastSnapshot.paused = payload.paused;
      }
      if (typeof payload.pausedSource === 'string') {
        lastSnapshot.pausedSource = payload.pausedSource;
      }
      if (typeof payload.rateSource === 'string') {
        lastSnapshot.rateSource = payload.rateSource;
      }
      if (payload.info && typeof payload.info === 'object') {
        lastSnapshot.info = { ...payload.info };
      }
      updateGeometryCaches(payload);
      if (payload.ctrl) {
        try {
          lastSnapshot.ctrl = Array.isArray(payload.ctrl)
            ? payload.ctrl.slice()
            : Array.from(payload.ctrl);
        } catch (err) {
          strictCatch(err, 'backend:ctrl_convert');
          lastSnapshot.ctrl = [];
        }
      }
      if (payload.optionSupport) {
        lastSnapshot.optionSupport = payload.optionSupport;
      }
      if (payload.history) {
        applyHistoryPayload(lastSnapshot, payload.history);
      }
      const keyIndexValue = Number.isFinite(payload.keyIndex) ? payload.keyIndex : null;
      if (payload.keyframes) {
        applyKeyframesPayload(lastSnapshot, payload.keyframes, keyIndexValue);
      } else if (keyIndexValue != null) {
        lastSnapshot.keyIndex = keyIndexValue | 0;
      }
      if (payload.watch) {
        applyWatchPayload(lastSnapshot, payload.watch, {
          clampSamples: false,
          computeSummary: false,
          requireFiniteIndex: false,
        });
      }
      if (payload.gesture) {
        lastSnapshot.gesture = {
          ...(lastSnapshot.gesture || {}),
          ...payload.gesture,
        };
      }
      if (payload.drag) {
        lastSnapshot.drag = {
          ...(lastSnapshot.drag || {}),
          ...payload.drag,
        };
      }
      if (payload.viewerCamera && typeof payload.viewerCamera === 'object') {
        lastSnapshot.viewerCamera = {
          type: Number.isFinite(payload.viewerCamera.type) ? (payload.viewerCamera.type | 0) : 0,
          lookat: Array.isArray(payload.viewerCamera.lookat)
            ? payload.viewerCamera.lookat.slice(0, 3).map((n) => Number(n) || 0)
            : [0, 0, 0],
          distance: Number(payload.viewerCamera.distance) || 0,
          azimuth: Number(payload.viewerCamera.azimuth) || 0,
          elevation: Number(payload.viewerCamera.elevation) || 0,
          orthographic: !!payload.viewerCamera.orthographic,
        };
      }
      if (Number.isFinite(payload.viewerCameraSyncSeq)) {
        lastSnapshot.viewerCameraSyncSeq = Math.max(0, Math.trunc(payload.viewerCameraSyncSeq));
      }
      if (payload.options) {
        lastSnapshot.options = payload.options;
      }
      applyOptionSnapshot(payload);
      if (perfEnabled) {
        const workerPerf = payload?.perf && typeof payload.perf === 'object' ? payload.perf : null;
        const ngeomValue = typeof payload.ngeom === 'number' ? (payload.ngeom | 0) : null;
        const scnNgeomValue = typeof payload.scn_ngeom === 'number' ? (payload.scn_ngeom | 0) : null;
        const perfDetail = {
          frameId,
          ngeom: ngeomValue,
          scn_ngeom: scnNgeomValue,
        };
        const decodeMs = perfNow() - tDecodeStart;
        perfSample('backend:snapshot_decode_ms', decodeMs, perfDetail);
        const cpuStepMs = payload?.info && typeof payload.info.cpuStepMs === 'number' ? payload.info.cpuStepMs : null;
        if (cpuStepMs != null && Number.isFinite(cpuStepMs)) {
          perfSample('worker:cpu_step_ms', cpuStepMs, perfDetail);
        }
        const cpuForwardMs =
          payload?.info && typeof payload.info.cpuForwardMs === 'number' ? payload.info.cpuForwardMs : null;
        if (cpuForwardMs != null && Number.isFinite(cpuForwardMs)) {
          perfSample('worker:cpu_forward_ms', cpuForwardMs, perfDetail);
        }
        const ncon = payload?.info && typeof payload.info.ncon === 'number' ? payload.info.ncon : null;
        if (ncon != null && Number.isFinite(ncon)) {
          perfSample('worker:ncon', ncon, perfDetail);
        }
        const nefc = payload?.info && typeof payload.info.nefc === 'number' ? payload.info.nefc : null;
        if (nefc != null && Number.isFinite(nefc)) {
          perfSample('worker:nefc', nefc, perfDetail);
        }
        const nisland = payload?.info && typeof payload.info.nisland === 'number' ? payload.info.nisland : null;
        if (nisland != null && Number.isFinite(nisland)) {
          perfSample('worker:nisland', nisland, perfDetail);
        }
        if (workerPerf) {
          sampleIfFinite('worker:snapshot_ms', workerPerf.snapshotMs, perfDetail);
          sampleIfFinite('worker:snapshot_sync_vopt_ms', workerPerf.snapshotSyncVoptMs, perfDetail);
          sampleIfFinite('worker:snapshot_scene_pack_ms', workerPerf.snapshotScenePackMs, perfDetail);
          sampleIfFinite('worker:snapshot_copy_geom_ms', workerPerf.snapshotCopyGeomMs, perfDetail);
          sampleIfFinite('worker:snapshot_copy_body_ms', workerPerf.snapshotCopyBodyMs, perfDetail);
          sampleIfFinite('worker:snapshot_copy_ctrl_ms', workerPerf.snapshotCopyCtrlMs, perfDetail);
          sampleIfFinite('worker:snapshot_copy_qpos_ms', workerPerf.snapshotCopyQposMs, perfDetail);
          sampleIfFinite('worker:snapshot_copy_gsize_ms', workerPerf.snapshotCopyGsizeMs, perfDetail);
          sampleIfFinite('worker:snapshot_copy_gtype_ms', workerPerf.snapshotCopyGtypeMs, perfDetail);
          if ((scnNgeomValue | 0) > 0) {
            sampleIfFinite('worker:snapshot_copy_scene_ms', workerPerf.snapshotCopySceneMs, perfDetail);
            sampleIfFinite('worker:snapshot_scene_bytes', workerPerf.sceneBytes, perfDetail);
          }
          if (typeof workerPerf.flexBytes === 'number' && workerPerf.flexBytes > 0) {
            sampleIfFinite('worker:snapshot_copy_flex_ms', workerPerf.snapshotCopyFlexMs, perfDetail);
            sampleIfFinite('worker:snapshot_flex_bytes', workerPerf.flexBytes, perfDetail);
          }
          if (typeof workerPerf.snapshotCopyEqMs === 'number' && workerPerf.snapshotCopyEqMs > 0) {
            sampleIfFinite('worker:snapshot_copy_eq_ms', workerPerf.snapshotCopyEqMs, perfDetail);
          }
          if (typeof workerPerf.snapshotCopyLightMs === 'number' && workerPerf.snapshotCopyLightMs > 0) {
            sampleIfFinite('worker:snapshot_copy_light_ms', workerPerf.snapshotCopyLightMs, perfDetail);
          }
          sampleIfFinite('worker:snapshot_meta_ms', workerPerf.snapshotMetaMs, perfDetail);
          sampleIfFinite('worker:snapshot_collect_transfers_ms', workerPerf.snapshotCollectTransfersMs, perfDetail);
          if (typeof workerPerf.snapshotPostMessageMsPrev === 'number' && workerPerf.snapshotPostMessageMsPrev > 0) {
            sampleIfFinite('worker:snapshot_post_message_prev_ms', workerPerf.snapshotPostMessageMsPrev, perfDetail);
          }
          sampleIfFinite('worker:snapshot_transfer_bytes', workerPerf.transferBytes, perfDetail);
          sampleIfFinite('worker:snapshot_transfer_buffers', workerPerf.transferBuffers, perfDetail);
          sampleIfFinite('worker:step_tick_ms', workerPerf.stepTickMs, perfDetail);
          sampleIfFinite('worker:step_tick_steps', workerPerf.stepSteps, perfDetail);
          sampleIfFinite('worker:step_sim_ms_per_step', workerPerf.stepSimMsPerStep, perfDetail);
          sampleIfFinite('worker:step_history_ms_per_step', workerPerf.stepHistoryMsPerStep, perfDetail);
          sampleIfFinite('worker:step_perturb_ms_per_step', workerPerf.stepPerturbMsPerStep, perfDetail);
          sampleIfFinite('worker:step_other_ms_per_step', workerPerf.stepOtherMsPerStep, perfDetail);
        }
        const sentWallMs = typeof payload?.perf?.sentWallMs === 'number' ? payload.perf.sentWallMs : null;
        if (sentWallMs != null) {
          if (typeof lastSnapshotSentWallMs === 'number' && lastSnapshotSentWallMs > 0) {
            sampleIfFinite('worker:snapshot_sent_interval_ms', sentWallMs - lastSnapshotSentWallMs);
          }
          lastSnapshotSentWallMs = sentWallMs;
          const transferMs = recvWallMs - sentWallMs;
          perfSample('worker_to_main:snapshot_transfer_ms', transferMs);
          const postMessageMsPrev =
            workerPerf && typeof workerPerf.snapshotPostMessageMsPrev === 'number'
              ? workerPerf.snapshotPostMessageMsPrev
              : null;
          if (
            frameId != null
            && typeof postMessageMsPrev === 'number'
            && typeof lastSnapshotTransferMs === 'number'
            && lastSnapshotTransferFrameId === frameId - 1
          ) {
            sampleIfFinite('worker_to_main:snapshot_queue_after_post_ms', lastSnapshotTransferMs - postMessageMsPrev, {
              frameId: frameId - 1,
            });
          }
          if (frameId != null) {
            lastSnapshotTransferMs = transferMs;
            lastSnapshotTransferFrameId = frameId;
          }
        }
        if ((payload?.scn_ngeom | 0) > 0) {
          perfMarkOnce('play:backend:first_scene_snapshot', {
            frameId,
            scn_ngeom: payload?.scn_ngeom | 0,
          });
        }
      }
      const snapshotMs = (typeof payload.snapshotMs === 'number' && Number.isFinite(payload.snapshotMs))
        ? payload.snapshotMs
        : (typeof payload?.perf?.snapshotMs === 'number' && Number.isFinite(payload.perf.snapshotMs))
          ? payload.perf.snapshotMs
          : null;
      const sentWallMs = (typeof payload.sentWallMs === 'number' && Number.isFinite(payload.sentWallMs))
        ? payload.sentWallMs
        : (typeof payload?.perf?.sentWallMs === 'number' && Number.isFinite(payload.perf.sentWallMs))
          ? payload.perf.sentWallMs
          : null;
      if (snapshotMs != null && sentWallMs != null) {
        maybeUpdateAdaptiveSnapshotHz(snapshotMs, recvWallMs - sentWallMs);
      }
      if (perfEnabled) {
        perfSample('backend:adaptive_snapshot_hz', adaptiveSnapshotHz);
      }
      const tNotifyStart = perfEnabled ? perfNow() : 0;
      notifyListeners();
      if (perfEnabled) {
        perfSample('backend:notifyListeners_ms', perfNow() - tNotifyStart, {
          frameId,
          ngeom: typeof payload.ngeom === 'number' ? (payload.ngeom | 0) : null,
          scn_ngeom: typeof payload.scn_ngeom === 'number' ? (payload.scn_ngeom | 0) : null,
        });
      }
    },
    keyframes: (payload) => {
      applyKeyframesPayload(lastSnapshot, payload);
      notifyListeners();
    },
    history: (payload) => {
      applyHistoryPayload(lastSnapshot, payload);
      notifyListeners();
    },
    watch: (payload) => {
      applyWatchPayload(lastSnapshot, payload, {
        clampSamples: true,
        computeSummary: true,
        requireFiniteIndex: true,
      });
      notifyListeners();
    },
    render_assets: (payload) => {
      if (payload.assets) {
        lastSnapshot.renderAssets = payload.assets;
        notifyListeners();
        if (perfEnabled) {
          const recvWallMs = Date.now();
          const sentWallMs = typeof payload?.perf?.sentWallMs === 'number' ? payload.perf.sentWallMs : null;
          if (sentWallMs != null) {
            perfSample('worker_to_main:render_assets_transfer_ms', recvWallMs - sentWallMs);
          }
          if (typeof payload?.perf?.collectRenderAssetsMs === 'number' && Number.isFinite(payload.perf.collectRenderAssetsMs)) {
            perfSample('worker:collectRenderAssets_ms', payload.perf.collectRenderAssetsMs);
          }
          perfMarkOnce('play:backend:render_assets', {
            sentWallMs,
            transferMs: sentWallMs != null ? (recvWallMs - sentWallMs) : null,
            worker: payload?.perf && typeof payload.perf === 'object' ? payload.perf : null,
          });
        } else {
          perfMarkOnce('play:backend:render_assets');
        }
      }
    },
    gesture: (payload) => {
      if (payload.gesture) {
        lastSnapshot.gesture = {
          ...(lastSnapshot.gesture || {}),
          ...payload.gesture,
        };
      }
      if (payload.drag) {
        lastSnapshot.drag = {
          ...(lastSnapshot.drag || {}),
          ...payload.drag,
        };
      }
      applyOptionSnapshot(payload);
      notifyListeners();
    },
    align: (payload) => {
      const seq = Number(payload.seq) || ((lastSnapshot.align?.seq ?? 0) + 1);
      const center = Array.isArray(payload.center)
        ? payload.center.slice(0, 3).map((n) => Number(n) || 0)
        : lastSnapshot.align?.center ?? [0, 0, 0];
      const radius = Number(payload.radius) || lastSnapshot.align?.radius || 0;
      const cam = payload && typeof payload.camera === 'object' ? payload.camera : null;
      const lookatSource = cam && Array.isArray(cam.lookat) ? cam.lookat : null;
      const camera = lookatSource && lookatSource.length >= 3
        ? {
            type: Number.isFinite(cam.type) ? (cam.type | 0) : 0,
            lookat: lookatSource.slice(0, 3).map((n) => Number(n) || 0),
            distance: Number(cam.distance) || 0,
            azimuth: Number(cam.azimuth) || 0,
            elevation: Number(cam.elevation) || 0,
            orthographic: !!cam.orthographic,
          }
        : null;
      lastSnapshot.align = {
        seq,
        center,
        radius,
        camera,
        source: payload.source || 'backend',
        timestamp: Number(payload.timestamp) || Date.now(),
      };
      notifyListeners();
    },
    copyState: (payload) => {
      const seq = Number(payload.seq) || ((lastSnapshot.copyState?.seq ?? 0) + 1);
      const precision = payload.precision || lastSnapshot.copyState?.precision || 'standard';
      const qposPreview = Array.isArray(payload.qposPreview)
        ? payload.qposPreview.map((n) => Number(n) || 0)
        : lastSnapshot.copyState?.qposPreview ?? [];
      const qvelPreview = Array.isArray(payload.qvelPreview)
        ? payload.qvelPreview.map((n) => Number(n) || 0)
        : lastSnapshot.copyState?.qvelPreview ?? [];
      const keyXml = buildCopyKeyXmlFromPayload(payload);
      lastSnapshot.copyState = {
        seq,
        precision,
        nq: Number(payload.nq) || 0,
        nv: Number(payload.nv) || 0,
        timestamp: Number(payload.timestamp) || Date.now(),
        complete: !!payload.complete,
        qposPreview,
        qvelPreview,
        keyXml: keyXml || null,
      };
      if (keyXml) {
        // Fire-and-forget clipboard write; errors are logged inside helper.
        void writeCopyKeyToClipboard(keyXml);
      }
      notifyListeners();
    },
    options: (payload) => {
      applyOptionSnapshot(payload);
      notifyListeners();
    },
    log: (payload) => {
      logStatus(`[backend] ${payload.message ?? ''}`, payload.extra ?? null);
    },
    error: (payload) => {
      const message =
        typeof payload.message === 'string' && payload.message.length
          ? payload.message
          : `Backend error: ${JSON.stringify(payload)}`;
      lastSnapshot.toast = { message, ts: Date.now() };
      lastSnapshot.backendError = message;
      logError('[backend error]', payload);
      notifyListeners();
    },
  };

  function handleMessage(event) {
    const data = event?.data ?? event;
    if (!data || typeof data !== 'object') return;
    try {
      dispatchEvent(workerEventHandlers, data);
    } catch (err) {
      strictCatch(err, `backend:worker_event:${String(data?.kind ?? 'unknown')}`);
    }
  }

  const initialLoad = await loadDefaultXml();
  lastXmlText = typeof initialLoad?.xmlText === 'string' ? initialLoad.xmlText : String(initialLoad?.xmlText ?? '');
  await restartWorkerWithLoadPayload(initialLoad);

  const backendRuntime = createBackendRuntime({
    clientRef,
    lastSnapshotRef,
    lastXmlTextRef,
    prepareBindingUpdate: options.prepareBindingUpdate,
    readPublishedSnapshot,
    publishMutation,
    loadDefaultXml,
    restartWorkerWithXml,
    restartWorkerWithLoadPayload,
    setRunState,
    setRate,
  });
  function snapshot() {
    return readPublishedSnapshot(false);
  }

  function subscribe(fn) {
    listeners.add(fn);
    fn(readPublishedSnapshot(false));
    return () => listeners.delete(fn);
  }

  function dispose() {
    if (messageHandler) {
      try { client?.removeEventListener?.('message', messageHandler); } catch (err) { strictCatch(err, 'backend:dispose_listener'); }
    }
    client?.terminate?.();
  }

  return {
    kind,
    apply: backendRuntime.apply,
    snapshot,
    subscribe,
    step: backendRuntime.step,
    setCameraIndex: async () => readPublishedSnapshot(false),
    setRunState,
    setRate,
    applyPerturb: backendRuntime.applyPerturb,
    setSelection: backendRuntime.setSelection,
    selectAt: backendRuntime.selectAt,
    setVisualState: backendRuntime.setVisualState,
    loadXmlText,
    loadXmlBundle,
    getStrictReport: async () => ({
      main: getStrictReport(),
      worker: await requestWorkerStrictReport(),
    }),
    getInitialModelInfo: () => initialModelInfo,
    getBuiltinModels: () => MODEL_POOL.map((file) => ({
      file,
      label: String(file).replace(/^model\//, '').replace(/\.xml$/i, ''),
    })),
    dispose,
  };
}
