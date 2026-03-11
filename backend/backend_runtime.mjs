import { logWarn, logError, strictCatch } from '../core/viewer_runtime.mjs';
import { MJ_GROUP_COUNT, SCENE_FLAG_DEFAULTS_NUMERIC } from '../core/viewer_defaults.mjs';
import { VISUAL_FIELD_DESCRIPTORS } from '../core/viewer_structs.mjs';
import { bool, cloneStruct, createDefaultHistoryState, normaliseGroupState, resolveStructPath, toNumber } from '../core/viewer_shared.mjs';

export function createBackendRuntime({
  clientRef,
  lastSnapshotRef,
  lastXmlTextRef,
  prepareBindingUpdate,
  readPublishedSnapshot,
  publishMutation,
  loadDefaultXml,
  restartWorkerWithXml,
  restartWorkerWithLoadPayload,
  setRunState,
  setRate,
}) {
  const client = new Proxy({}, {
    get(_target, prop) {
      const current = clientRef.current;
      const value = current?.[prop];
      return typeof value === 'function' ? value.bind(current) : value;
    },
  });
  const lastSnapshot = new Proxy({}, {
    get(_target, prop) {
      return lastSnapshotRef.current?.[prop];
    },
    set(_target, prop, value) {
      if (lastSnapshotRef.current) {
        lastSnapshotRef.current[prop] = value;
      }
      return true;
    },
  });
  const normaliseInt = (value, fallback = 0) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? (numeric | 0) : fallback;
  };
  function applySimulateMaskBinding(binding, value, prefix, field, invert, warnLabel) {
    if (!binding || !binding.startsWith(`${prefix}[`)) return false;
    const start = prefix.length + 1;
    const end = binding.indexOf(']', start);
    const bitIndex = end > start ? normaliseInt(binding.slice(start, end), -1) : -1;
    if (bitIndex >= 0 && bitIndex < 32) {
      const active = bool(value);
      const bit = 1 << bitIndex;
      const currentMask =
        typeof lastSnapshot.options?.[field] === 'number'
          ? (lastSnapshot.options[field] | 0)
          : 0;
      const nextMask = invert
        ? (active ? (currentMask & ~bit) : (currentMask | bit))
        : (active ? (currentMask | bit) : (currentMask & ~bit));
      if (!lastSnapshot.options || typeof lastSnapshot.options !== 'object') {
        lastSnapshot.options = {};
      }
      lastSnapshot.options[field] = nextMask;
      try {
        client.postMessage?.({
          cmd: 'setField',
          target: 'mjOption',
          path: [field],
          kind: 'int',
          size: 1,
          value: [nextMask],
        });
      } catch (err) {
        logWarn(`[backend ${warnLabel}] post failed`, err);
        strictCatch(err, `backend:setField:${warnLabel}`);
        throw err;
      }
    }
    return true;
  }

  function applyVisualStatePayload(payload) {
    if (!payload || typeof client?.postMessage !== 'function') {
      return readPublishedSnapshot(false);
    }
    if (payload.visual && typeof payload.visual === 'object') {
      lastSnapshot.visual = cloneStruct(payload.visual);
      lastSnapshot.visualVersion = (lastSnapshot.visualVersion | 0) + 1;
      for (const descriptor of VISUAL_FIELD_DESCRIPTORS) {
        const value = resolveStructPath(payload.visual, descriptor.path);
        if (value == null) continue;
        try {
          client.postMessage({
            cmd: 'setField',
            target: 'mjVisual',
            path: descriptor.path,
            kind: descriptor.kind,
            size: descriptor.size,
            value,
          });
        } catch (err) {
          logWarn('[backend setField] failed', descriptor.path, err);
          strictCatch(err, 'backend:setField_descriptor');
        }
      }
    }
    if (Array.isArray(payload.sceneFlags)) {
      const nextSceneFlags = [];
      for (let i = 0; i < SCENE_FLAG_DEFAULTS_NUMERIC.length; i += 1) {
        nextSceneFlags[i] = payload.sceneFlags[i] != null
          ? (payload.sceneFlags[i] ? 1 : 0)
          : SCENE_FLAG_DEFAULTS_NUMERIC[i];
      }
      lastSnapshot.sceneFlags = nextSceneFlags;
      for (let i = 0; i < payload.sceneFlags.length; i += 1) {
        const enabled = !!payload.sceneFlags[i];
        try {
          client.postMessage?.({ cmd: 'setSceneFlag', index: i, enabled });
        } catch (err) {
          logWarn('[backend setSceneFlag] failed', { index: i, enabled }, err);
          strictCatch(err, 'backend:setSceneFlag');
        }
      }
    }
    return publishMutation(true);
  }

  const uiHandlers = new Map([
    ['simulation.history_scrubber', (value) => {
      const offset = Math.min(0, normaliseInt(value, 0));
      try { client.postMessage?.({ cmd: 'historyScrub', offset }); } catch (err) {
        logWarn('[backend history] post failed', err);
        strictCatch(err, 'backend:history_scrub');
        throw err;
      }
      return true;
    }],
    ['simulation.key_slider', (value) => {
      const index = Math.max(-1, normaliseInt(value, -1));
      try {
        client.postMessage?.({ cmd: 'keyframeSelect', index });
      } catch (err) {
        logWarn('[backend keyframe select] failed', err);
        strictCatch(err, 'backend:keyframe_select');
        throw err;
      }
      return true;
    }],
    ['simulation.save_key', () => {
      const index = normaliseInt(lastSnapshot.keyIndex ?? -1, -1);
      try { client.postMessage?.({ cmd: 'keyframeSave', index }); } catch (err) {
        logWarn('[backend keyframe save] failed', err);
        strictCatch(err, 'backend:keyframe_save');
        throw err;
      }
      return true;
    }],
    ['simulation.load_key', () => {
      const index = Math.max(0, normaliseInt(lastSnapshot.keyIndex ?? 0, 0));
      try { client.postMessage?.({ cmd: 'keyframeLoad', index }); } catch (err) {
        logWarn('[backend keyframe load] failed', err);
        strictCatch(err, 'backend:keyframe_load');
        throw err;
      }
      return true;
    }],
    ['watch.field', (value) => {
      const field = typeof value === 'string' ? value.trim() : '';
      const nextField = field.length > 0 ? field : (lastSnapshot.watch?.field || '');
      if (!nextField) return true;
      try {
        client.postMessage?.({
          cmd: 'setWatch',
          field: nextField,
          index: Number.isFinite(lastSnapshot.watch?.index) ? (lastSnapshot.watch.index | 0) : 0,
        });
      } catch (err) {
        logWarn('[backend watch field] failed', err);
        strictCatch(err, 'backend:watch_field');
        throw err;
      }
      return true;
    }],
    ['watch.index', (value) => {
      const target = Math.max(0, normaliseInt(value, 0));
      try {
        client.postMessage?.({
          cmd: 'setWatch',
          field: lastSnapshot.watch?.field,
          index: target,
        });
      } catch (err) {
        logWarn('[backend watch index] failed', err);
        strictCatch(err, 'backend:watch_index');
        throw err;
      }
      return true;
    }],
    ['control.actuator', (value) => {
      try {
        const idx = Number(value?.index ?? value?.i ?? value?.id);
        const v = Number(value?.value ?? value?.v ?? 0);
        if (Number.isFinite(idx) && idx >= 0) {
          client.postMessage?.({ cmd: 'setCtrl', index: idx | 0, value: v });
        }
      } catch (err) {
        logWarn('[backend control.actuator] failed', err);
        strictCatch(err, 'backend:control_actuator');
        throw err;
      }
      return true;
    }],
    ['joint.slider', (value) => {
      try {
        const idx = Number(value?.index ?? value?.qposIndex ?? value?.i);
        const v = Number(value?.value ?? value?.v);
        if (Number.isFinite(idx) && idx >= 0 && Number.isFinite(v)) {
          const min = Number.isFinite(value?.min) ? Number(value.min) : null;
          const max = Number.isFinite(value?.max) ? Number(value.max) : null;
          client.postMessage?.({ cmd: 'setQpos', index: idx | 0, value: v, min, max });
        }
      } catch (err) {
        logWarn('[backend joint.slider] failed', err);
        strictCatch(err, 'backend:joint_slider');
        throw err;
      }
      return true;
    }],
    ['equality.toggle', (value) => {
      try {
        const idx = Number(value?.index ?? value?.i);
        const active = !!(value?.active ?? value?.value ?? value?.v);
        if (Number.isFinite(idx) && idx >= 0) {
          client.postMessage?.({ cmd: 'setEqualityActive', index: idx | 0, active });
        }
      } catch (err) {
        logWarn('[backend equality.toggle] failed', err);
        strictCatch(err, 'backend:equality_toggle');
        throw err;
      }
      return true;
    }],
    ['control.clear', () => {
      try {
        const acts = Array.isArray(lastSnapshot.actuators) ? lastSnapshot.actuators : [];
        for (let i = 0; i < acts.length; i += 1) {
          client.postMessage?.({ cmd: 'setCtrl', index: i, value: 0 });
        }
      } catch (err) {
        logWarn('[backend control.clear] failed', err);
        strictCatch(err, 'backend:control_clear');
        throw err;
      }
      return true;
    }],
  ]);

  const bindingExactHandlers = new Map([
    ['Simulate::camera', (value) => {
      const totalModes = Math.max(1, 2 + (lastSnapshot.cameras?.length || 0));
      const modeValue = Math.max(0, Math.min(totalModes - 1, Math.trunc(toNumber(value))));
      lastSnapshot.cameraMode = modeValue;
      try {
        client.postMessage?.({ cmd: 'setCameraMode', mode: modeValue });
      } catch (err) {
        logWarn('[backend camera] post failed', err);
        strictCatch(err, 'backend:camera');
        throw err;
      }
      return true;
    }],
    ['Simulate::tracking_geom', () => true],
    ['mjvOption::label', (value) => {
      const mode = Math.max(0, Math.trunc(toNumber(value)));
      lastSnapshot.labelMode = mode;
      try {
        client.postMessage?.({ cmd: 'setLabelMode', mode });
      } catch (err) {
        logWarn('[backend label mode] post failed', err);
        strictCatch(err, 'backend:label_mode');
        throw err;
      }
      return true;
    }],
    ['mjvOption::frame', (value) => {
      const mode = Math.max(0, Math.trunc(toNumber(value)));
      lastSnapshot.frameMode = mode;
      try {
        client.postMessage?.({ cmd: 'setFrameMode', mode });
      } catch (err) {
        logWarn('[backend frame mode] post failed', err);
        strictCatch(err, 'backend:frame_mode');
        throw err;
      }
      return true;
    }],
  ]);

  const bindingRegexHandlers = [
    {
      pattern: /^Simulate::opt\.(flex_layer|bvh_depth)$/,
      handle: (match, value) => {
        const field = match[1];
        const nextValue = Math.max(0, Math.trunc(toNumber(value)));
        if (!lastSnapshot.options || typeof lastSnapshot.options !== 'object') {
          lastSnapshot.options = {};
        }
        lastSnapshot.options[field] = nextValue;
        try {
          client.postMessage?.({
            cmd: 'setVisualOption',
            field,
            value: nextValue,
          });
        } catch (err) {
          logWarn('[backend setVisualOption] post failed', err);
          strictCatch(err, 'backend:set_visual_option');
          throw err;
        }
        return true;
      },
    },
    {
      pattern: /^mjvOption::(geom|site|joint|tendon|actuator|flex|skin)group\[(\d+)\]$/,
      handle: (match, value) => {
        const type = match[1];
        const idx = Math.max(0, Math.trunc(toNumber(match[2])));
        if (idx < MJ_GROUP_COUNT) {
          const nextGroups = normaliseGroupState(lastSnapshot.groups || {});
          if (Array.isArray(nextGroups[type]) && idx < nextGroups[type].length) {
            nextGroups[type][idx] = !!bool(value);
            lastSnapshot.groups = nextGroups;
          }
          try {
            client.postMessage?.({ cmd: 'setGroupState', group: type, index: idx, enabled: bool(value) });
          } catch (err) {
            logWarn('[backend group] post failed', err);
            strictCatch(err, 'backend:group');
            throw err;
          }
        }
        return true;
      },
    },
    {
      pattern: /^mjvOption::flags\[(\d+)\]$/,
      handle: (match, value) => {
        const idx = Number(match[1]);
        const enabled = bool(value);
        const flags = Array.isArray(lastSnapshot.voptFlags) ? lastSnapshot.voptFlags.slice() : [];
        flags[idx] = enabled ? 1 : 0;
        lastSnapshot.voptFlags = flags;
        try {
          client.postMessage?.({ cmd: 'setVoptFlag', index: idx, enabled });
        } catch (err) {
          logWarn('[backend vopt flag] post failed', err);
          strictCatch(err, 'backend:vopt_flag');
          throw err;
        }
        return true;
      },
    },
    {
      pattern: /^mjvScene::flags\[(\d+)\]$/,
      handle: (match, value) => {
        const idx = Number(match[1]);
        const enabled = bool(value);
        const flags = Array.isArray(lastSnapshot.sceneFlags) ? lastSnapshot.sceneFlags.slice() : [];
        flags[idx] = enabled ? 1 : 0;
        lastSnapshot.sceneFlags = flags;
        try {
          client.postMessage?.({ cmd: 'setSceneFlag', index: idx, enabled });
        } catch (err) {
          logWarn('[backend scene flag] post failed', err);
          strictCatch(err, 'backend:scene_flag');
          throw err;
        }
        return true;
      },
    },
  ];

  function dispatchBinding(binding, value) {
    if (!binding) return { handled: false, updated: false, notify: false };
    const exactHandler = bindingExactHandlers.get(binding);
    if (exactHandler) {
      exactHandler(value);
      const updated = binding !== 'Simulate::tracking_geom';
      return { handled: true, updated, notify: updated };
    }
    if (applySimulateMaskBinding(binding, value, 'Simulate::disable', 'disableflags', false, 'disableflags')) {
      return { handled: true, updated: true, notify: true };
    }
    if (applySimulateMaskBinding(binding, value, 'Simulate::enable', 'enableflags', false, 'enableflags')) {
      return { handled: true, updated: true, notify: true };
    }
    if (applySimulateMaskBinding(binding, value, 'Simulate::enableactuator', 'disableactuator', true, 'disableactuator')) {
      return { handled: true, updated: true, notify: true };
    }
    for (const entry of bindingRegexHandlers) {
      const match = binding.match(entry.pattern);
      if (!match) continue;
      entry.handle(match, value);
      return { handled: true, updated: true, notify: true };
    }
    return { handled: false, updated: false, notify: false };
  }

  async function apply(payload) {
    if (!payload) {
      return readPublishedSnapshot(false);
    }
    if (payload.kind === 'gesture') {
      const mode = payload.mode ?? payload.gesture?.mode ?? 'idle';
      const phase = payload.phase ?? payload.gesture?.phase ?? 'update';
      const gestureType = typeof payload.gestureType === 'string' ? payload.gestureType : null;
      const pointerSource = payload.pointer ?? payload.gesture?.pointer ?? null;
      const pointer = pointerSource
        ? {
            x: Number(pointerSource.x) || 0,
            y: Number(pointerSource.y) || 0,
            dx: Number(pointerSource.dx) || 0,
            dy: Number(pointerSource.dy) || 0,
            buttons: Number(pointerSource.buttons ?? 0),
            pressure: Number(pointerSource.pressure ?? 0),
          }
        : null;
      const dragSource = payload.drag ?? (pointer ? { dx: pointer.dx, dy: pointer.dy } : null);
      const gesture = {
        mode: phase === 'end' ? 'idle' : mode,
        phase,
        pointer,
      };
      const drag = dragSource
        ? {
            dx: Number(dragSource.dx) || 0,
            dy: Number(dragSource.dy) || 0,
          }
        : (phase === 'end' ? { dx: 0, dy: 0 } : null);
      try {
        client.postMessage?.({
          cmd: 'gesture',
          gesture,
          pointer,
          drag,
          gestureType,
          reldx: Number(payload.reldx),
          reldy: Number(payload.reldy),
          shiftKey: !!payload.shiftKey,
          cam: payload.cam || null,
          camSyncSeq: Number.isFinite(payload.camSyncSeq) ? Math.trunc(payload.camSyncSeq) : null,
        });
      } catch (err) {
        logError('[backend gesture] failed', err);
        strictCatch(err, 'backend:gesture');
      }
      return readPublishedSnapshot(false);
    }
    if (payload.kind !== 'ui') {
      return readPublishedSnapshot(false);
    }
    const { id, value, control } = payload;
    const binding = typeof control?.binding === 'string' ? control.binding : null;
    const dispatchResult = dispatchBinding(binding, value);
    if (dispatchResult.handled) {
      if (!dispatchResult.updated) {
        return readPublishedSnapshot(false);
      }
      return publishMutation(dispatchResult.notify);
    }
    const uiHandler = uiHandlers.get(id);
    if (uiHandler) {
      uiHandler(value);
      return readPublishedSnapshot(false);
    }
    const prepared = typeof prepareBindingUpdate === 'function'
      ? await prepareBindingUpdate(control, value)
      : null;
    if (prepared) {
      try {
        client.postMessage?.({
          cmd: 'setField',
          target: prepared.meta.scope,
          path: prepared.meta.path,
          kind: prepared.meta.kind,
          size: prepared.meta.size,
          value: prepared.value,
        });
        // Force a fresh snapshot so UI can observe the updated struct fields,
        // even when the worker is paused or snapshot delivery is delayed.
        client.postMessage?.({ cmd: 'snapshot' });
      } catch (err) {
        logWarn('[backend setField] post failed', err);
        strictCatch(err, 'backend:setField_post');
      }
      return readPublishedSnapshot(false);
    }
    switch (id) {
      case 'simulation.run': {
        const run = value === 'Run' || value === true || value === 1;
        return setRunState(run, 'ui');
      }
      case 'simulation.reset':
        client.postMessage?.({ cmd: 'reset' });
        break;
      case 'simulation.reload': {
        if (lastXmlTextRef.current && typeof lastXmlTextRef.current === 'string' && lastXmlTextRef.current.trim().length > 0) {
          return restartWorkerWithXml(lastXmlTextRef.current);
        }
        const loadPayload = await loadDefaultXml();
        lastXmlTextRef.current = typeof loadPayload?.xmlText === 'string' ? loadPayload.xmlText : String(loadPayload?.xmlText ?? '');
        return restartWorkerWithLoadPayload(loadPayload);
      }
      case 'simulation.align': {
        try {
          client.postMessage?.({ cmd: 'align', source: 'ui' });
        } catch (err) {
          logWarn('[backend align] post failed', err);
          strictCatch(err, 'backend:align');
        }
        break;
      }
      case 'simulation.copy_state': {
        const meta = value && typeof value === 'object' ? value : {};
        const precision = meta.shiftKey ? 'full' : 'standard';
        try {
          client.postMessage?.({ cmd: 'copyState', precision, source: 'ui' });
        } catch (err) {
          logWarn('[backend copyState] post failed', err);
          strictCatch(err, 'backend:copy_state');
        }
        break;
      }
      case 'simulation.noise_scale':
      case 'simulation.noise_rate':
        // Noise controls are disabled in this build; UI state is still
        // tracked via Simulate::ctrl_noise_* bindings but no messages are
        // sent to the worker.
        break;
      case 'rendering.camera_mode':
      case 'option.help':
      default:
        break;
    }
    return readPublishedSnapshot(false);
  }

  function snapshot() {
    return readPublishedSnapshot(false);
  }

  function subscribe(fn) {
    listeners.add(fn);
    fn(readPublishedSnapshot(false));
    return () => listeners.delete(fn);
  }

  async function step(direction = 1) {
    const dir = direction >= 0 ? 1 : -1;
    const history = lastSnapshot.history || createDefaultHistoryState();
    const currentOffset = Number.isFinite(history.scrubIndex) ? history.scrubIndex : 0;
    const count = Number.isFinite(history.count) ? history.count : 0;
    let nextOffset = currentOffset;

    if (currentOffset !== 0 || (dir < 0 && count > 0)) {
      if (currentOffset === 0) {
        if (dir < 0) {
          nextOffset = -1;
        }
      } else if (dir > 0) {
        nextOffset = Math.min(0, currentOffset + 1);
      } else if (dir < 0) {
        const minOffset = -Math.max(0, count);
        nextOffset = Math.max(minOffset, currentOffset - 1);
      }

      if (nextOffset === currentOffset) {
        return readPublishedSnapshot(false);
      }

      try {
        client.postMessage?.({ cmd: 'historyScrub', offset: nextOffset });
      } catch (err) {
        logWarn('[backend history step] post failed', err);
        strictCatch(err, 'backend:history_step');
      }
      return readPublishedSnapshot(false);
    }

    setRunState(false, 'ui');
    const n = Math.max(1, Math.abs(direction | 0) || 1);
    try {
      client.postMessage?.({ cmd: 'step', n });
    } catch (err) {
      logWarn('[backend step] post failed', err);
      strictCatch(err, 'backend:step');
    }
    return readPublishedSnapshot(false);
  }

  async function setCameraIndex() {
    return readPublishedSnapshot(false);
  }

  const toVec3 = (value) => {
    if (Array.isArray(value)) {
      return [
        Number(value[0]) || 0,
        Number(value[1]) || 0,
        Number(value[2]) || 0,
      ];
    }
    return [0, 0, 0];
  };

  async function applyPerturbCommand(options = {}) {
    const phase = typeof options.phase === 'string' ? options.phase : '';
    if (!phase) return readPublishedSnapshot(false);

    const msg = { cmd: 'applyPerturb', phase };
    const mode = options.mode === 'rotate' ? 'rotate' : 'translate';
    const cam = options.cam && typeof options.cam === 'object' ? options.cam : null;
    const camPayload = cam
      ? {
          lookat: toVec3(cam.lookat),
          distance: Number(cam.distance) || 0,
          azimuth: Number(cam.azimuth) || 0,
          elevation: Number(cam.elevation) || 0,
          orthographic: !!cam.orthographic,
        }
      : null;

    if (phase === 'begin') {
      msg.mode = mode;
      msg.shiftKey = !!options.shiftKey;
      const bodyIdRaw = Number(options.bodyId);
      if (Number.isFinite(bodyIdRaw) && (bodyIdRaw | 0) > 0) {
        msg.bodyId = bodyIdRaw | 0;
        if (Array.isArray(options.localpos)) {
          msg.localpos = toVec3(options.localpos);
        }
      }
      const scaleRaw = Number(options.scale);
      if (Number.isFinite(scaleRaw) && scaleRaw > 0) {
        msg.scale = scaleRaw;
      }
      if (camPayload) msg.cam = camPayload;
    } else if (phase === 'move') {
      msg.mode = mode;
      msg.shiftKey = !!options.shiftKey;
      msg.reldx = Number(options.reldx) || 0;
      msg.reldy = Number(options.reldy) || 0;
      if (camPayload) msg.cam = camPayload;
    } else if (phase === 'end') {
      // nothing else
    } else {
      return readPublishedSnapshot(false);
    }

    try {
      client.postMessage?.(msg);
    } catch (err) {
      logWarn('[backend applyPerturb] failed', err);
      strictCatch(err, 'backend:applyPerturb');
    }
    return readPublishedSnapshot(false);
  }

  async function setSelectionCommand(options = {}) {
    const bodyId = Number(options.bodyId) | 0;
    const msg = { cmd: 'setSelection', bodyId };
    const localpos = Array.isArray(options.localpos) ? toVec3(options.localpos) : [0, 0, 0];
    if (Array.isArray(options.localpos)) msg.localpos = localpos;
    const point = Array.isArray(options.point) ? toVec3(options.point) : [0, 0, 0];
    const currentSeq = Number(lastSnapshot.selection?.seq) || 0;
    lastSnapshot.selection = {
      seq: Number(options.seq) || (currentSeq + 1),
      bodyId,
      geomId: Number.isFinite(options.geomId) ? (Number(options.geomId) | 0) : -1,
      flexId: -1,
      skinId: -1,
      point,
      localpos,
      timestamp: Number(options.timestamp) || Date.now(),
    };
    try {
      client.postMessage?.(msg);
    } catch (err) {
      logWarn('[backend setSelection] failed', err);
      strictCatch(err, 'backend:setSelection');
    }
    return publishMutation(true);
  }

  async function selectAtCommand(options = {}) {
    const relxRaw = Number(options.relx);
    const relyRaw = Number(options.rely);
    const aspectRaw = Number(options.aspect);
    const msg = {
      cmd: 'selectAt',
      relx: Number.isFinite(relxRaw) ? relxRaw : 0,
      rely: Number.isFinite(relyRaw) ? relyRaw : 0,
      aspect: Number.isFinite(aspectRaw) && aspectRaw > 0 ? aspectRaw : 1,
    };
    try {
      client.postMessage?.(msg);
    } catch (err) {
      logWarn('[backend selectAt] failed', err);
      strictCatch(err, 'backend:selectAt');
    }
    return readPublishedSnapshot(false);
  }

  return {
    apply,
    step,
    applyPerturb: applyPerturbCommand,
    setSelection: setSelectionCommand,
    selectAt: selectAtCommand,
    setVisualState: applyVisualStatePayload,
  };
}
