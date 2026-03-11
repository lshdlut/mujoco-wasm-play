// Renderer controllers (camera + picking).

import * as THREE from 'three';
import { isPerfEnabled, isStrictEnabled, perfMarkOnce, perfNow, perfSample, logDebug, logWarn, logStatus, logError, strictCatch, strictEnsure, strictOverride } from '../core/viewer_runtime.mjs';
import { compatFallback } from '../core/fallbacks.mjs';
import { getSnapshotBodyJointAdr, getSnapshotBodyJointNum, getSnapshotCameraMode, getSnapshotGeoms, getSnapshotGeomBodyIds, getSnapshotJointTypes, getSnapshotSelection } from '../core/snapshot_selectors.mjs';
import { pushSkyDebug } from '../environment/environment.mjs';
import { buildViewerCameraPayload, normalizeDeltaByViewportHeight, resolveTrackingBodyId } from './pipeline.mjs';
import { geomNameFromLookup, getOrCreateGeomNameLookup } from './geom_names.mjs';

function createCameraController({
  THREE_NS,
  canvas,
  store,
  backend,
  onGesture,
  renderCtx,
  debugMode = false,
  getSnapshot = null,
  useWasmCamera = false,
  globalUp = new THREE_NS.Vector3(0, 0, 1),
  // new options (high‑leverage changes)
  minDistance,
  getMinDistance,
  zoomK = 0.35,
  maxWheelStep,
  invertY = false,
  keyRoot = null,
  assertUp = false,
  wheelLineFactor = 16,
  wheelPageFactor = 800,
  minOrthoZoom = 0.05,
  maxOrthoZoom = 200,
}) {
  const pointerState = {
    id: null,
    mode: 'idle',
    lastX: null,
    lastY: null,
    active: false,
  };

  const modifierState = {
    ctrl: false,
    shift: false,
    alt: false,
    meta: false,
  };

  const tempVecA = new THREE_NS.Vector3();
  const tempVecB = new THREE_NS.Vector3();
  const tempVecC = new THREE_NS.Vector3();
  const tempVecD = new THREE_NS.Vector3();
  const tempVecE = new THREE_NS.Vector3();
  const tempSpherical = new THREE_NS.Spherical();

  const cleanup = [];
  let initialised = false;
  let upNormalised = new THREE_NS.Vector3().copy(globalUp).normalize();
  let up0 = upNormalised.clone();

  const cameraModeIndex = () => {
    try {
      const snapshot = typeof getSnapshot === 'function' ? getSnapshot() : null;
      return getSnapshotCameraMode(snapshot) ?? 0;
    } catch (err) {
      strictCatch(err, 'main:cameraModeIndex');
      return 0;
    }
  };

  const isInteractiveCamera = () => cameraModeIndex() <= 1;

  function currentCtrl(event) {
    return !!event?.ctrlKey || modifierState.ctrl;
  }

  function currentShift(event) {
    return !!event?.shiftKey || modifierState.shift;
  }

  function resolveGestureMode(event) {
    const btn = typeof event.button === 'number' ? event.button : 0;
    if (btn === 2) return 'translate';
    if (btn === 1) return 'zoom';
    return 'rotate';
  }

  function pointerButtons(event) {
    if (event && typeof event.buttons === 'number') return event.buttons;
    if (event && typeof event.button === 'number') {
      switch (event.button) {
        case 0:
          return 1;
        case 1:
          return 4;
        case 2:
          return 2;
        default:
          return 1 << event.button;
      }
    }
    return 0;
  }

  function computeMinDistance(camera, target) {
    if (Number.isFinite(minDistance)) return Math.max(0.01, Number(minDistance));
    if (typeof getMinDistance === 'function') {
      const v = Number(getMinDistance(camera, target, renderCtx));
      if (Number.isFinite(v) && v > 0) return Math.max(0.01, v);
    }
    return 0.15;
  }

  const ZOOM_INCREMENT = 0.02;

  function computeWheelReldy(dy) {
    const dyLines = dy / wheelLineFactor;
    return ZOOM_INCREMENT * dyLines;
  }

  function buildCameraPayloadIfNeeded() {
    if (!useWasmCamera || !renderCtx) return null;
    const state = typeof store?.get === 'function' ? store.get() : null;
    const snapshot = typeof getSnapshot === 'function' ? getSnapshot() : null;
    const mode = getSnapshotCameraMode(snapshot) | 0;
    const trackingBodyId = mode === 1 ? resolveTrackingBodyId(snapshot, state) : null;
    const trackingChanged =
      mode === 1 && Number.isFinite(trackingBodyId) && trackingBodyId !== renderCtx.viewerCameraTrackId;
    const needsSync = trackingChanged || !renderCtx.viewerCameraSynced;
    if (!needsSync) return null;

    const seqSentSource = Number(renderCtx.viewerCameraSyncSeqSent);
    const seqSent = Number.isFinite(seqSentSource) ? Math.max(0, Math.trunc(seqSentSource)) : 0;
    const seqAckSource = Number(renderCtx.viewerCameraSyncSeqAck);
    const seqAck = Number.isFinite(seqAckSource) ? Math.max(0, Math.trunc(seqAckSource)) : 0;
    const syncInFlight = seqSent > 0 && seqAck < seqSent;
    if (syncInFlight && !trackingChanged) return null;

    const cam = buildViewerCameraPayload(renderCtx, snapshot, state, tempVecE);
    if (!cam) return null;
    const camSyncSeq = seqSent + 1;
    renderCtx.viewerCameraSyncSeqSent = camSyncSeq;
    renderCtx.viewerCameraSynced = false;
    renderCtx.viewerCameraTrackId = Number.isFinite(cam.trackbodyid) ? (cam.trackbodyid | 0) : null;
    return { cam, camSyncSeq };
  }

  function applyCameraGesture(mode, dx, dy) {
    const ctx = renderCtx;
    const camera = ctx.camera;
    if (!camera) return;
    if (!ctx.cameraTarget) {
      ctx.cameraTarget = new THREE_NS.Vector3(0, 0, 0);
    }
    const target = ctx.cameraTarget;
    const offset = tempVecA.copy(camera.position).sub(target);
    const distance = offset.length();
    const minDist = computeMinDistance(camera, target);
    if (assertUp && renderCtx?.camera) {
      try {
        const dot = renderCtx.camera.up.clone().normalize().dot(up0);
        if (dot < 0.999) {
          renderCtx.camera.up.copy(upNormalised);
        }
      } catch (err) {
        strictCatch(err, 'main:camera_up_adjust');
      }
    }

    const elementWidth = canvas?.clientWidth || (typeof window !== 'undefined' ? window.innerWidth : 1) || 1;
    const { reldx: relDx, reldy: relDy } = normalizeDeltaByViewportHeight(canvas, dx, dy, invertY);
    const fovRad = THREE_NS.MathUtils.degToRad(typeof camera.fov === 'number' ? camera.fov : 45);
    const isOrtho = !!camera.isOrthographicCamera;

    switch (mode) {
      case 'translate': {
        let moveX = 0;
        let moveY = 0;
        if (isOrtho && typeof camera.zoom === 'number') {
          const zoom = Math.max(1e-6, camera.zoom || 1);
          const widthWorld = Math.abs((camera.right ?? 1) - (camera.left ?? -1)) / zoom;
          const heightWorld = Math.abs((camera.top ?? 1) - (camera.bottom ?? -1)) / zoom;
          moveX = -relDx * widthWorld;
          moveY = relDy * heightWorld;
        } else {
          const panScale = distance * Math.tan(fovRad / 2);
          moveX = -2 * relDx * panScale;
          moveY = 2 * relDy * panScale;
        }
        const forward = tempVecB;
        camera.getWorldDirection(forward).normalize();
        const up = tempVecD.copy(upNormalised);
        const right = tempVecC.copy(forward).cross(up).normalize();
        const pan = right.multiplyScalar(moveX).add(up.multiplyScalar(moveY));
        camera.position.add(pan);
        target.add(pan);
        camera.lookAt(target);
        break;
      }
      case 'zoom': {
        if (isOrtho && typeof camera.zoom === 'number') {
          const base = Math.max(1e-6, camera.zoom || 1);
          const factor = Math.exp((dy / shortEdge) * (Number.isFinite(zoomK) ? zoomK * 0.2 : 0.07));
          const nextZoom = THREE_NS.MathUtils.clamp(base * factor, minOrthoZoom, maxOrthoZoom);
          camera.zoom = nextZoom;
          if (typeof camera.updateProjectionMatrix === 'function') camera.updateProjectionMatrix();
        } else {
          const zoomSpeed = distance * 0.002;
          const delta = dy * zoomSpeed;
          const newLen = Math.max(minDist, distance + delta);
          offset.setLength(newLen);
          camera.position.copy(tempVecC.copy(target).add(offset));
          camera.lookAt(target);
        }
        break;
      }
      case 'rotate': {
        let yaw = -relDx * Math.PI;
        let pitch = -relDy * Math.PI;
        if (distance <= minDist * 1.05) {
          yaw *= 0.35;
          pitch *= 0.35;
        }
        const up = tempVecD.copy(upNormalised);
        const forward = tempVecB.copy(target).sub(camera.position).normalize();
        const right = tempVecC.copy(forward).cross(up).normalize();
        forward.applyAxisAngle(up, -yaw);
        forward.applyAxisAngle(right, -pitch);
        forward.normalize();
        const nextTarget = tempVecA.copy(camera.position).add(forward.multiplyScalar(distance));
        target.copy(nextTarget);
        camera.lookAt(target);
        break;
      }
      case 'orbit':
      default: {
        const thetaDelta = -relDx * Math.PI;
        const phiDelta = -relDy * Math.PI;
        tempSpherical.setFromVector3(offset);
        tempSpherical.theta += thetaDelta;
        tempSpherical.phi += phiDelta;
        tempSpherical.makeSafe();
        tempSpherical.radius = Math.max(minDist, tempSpherical.radius);
        offset.setFromSpherical(tempSpherical);
        camera.position.copy(tempVecC.copy(target).add(offset));
        camera.lookAt(target);
        break;
      }
    }
  }

  function handlePointerDown(event) {
    if (!event || !isInteractiveCamera()) return;
    const mode = resolveGestureMode(event);
    pointerState.id = event.pointerId ?? event.pointerId === 0 ? event.pointerId : 'mouse';
    pointerState.active = true;
    pointerState.mode = mode;
    pointerState.lastX = event.clientX;
    pointerState.lastY = event.clientY;
    if (canvas && typeof canvas.setPointerCapture === 'function' && event.pointerId != null) {
      try { canvas.setPointerCapture(event.pointerId); } catch (err) { strictCatch(err, 'main:pointer_capture'); }
    }
    if (typeof onGesture === 'function') {
      const camPayload = buildCameraPayloadIfNeeded();
      onGesture({
        mode,
        phase: 'start',
        pointer: event,
        gestureType: 'camera',
        shiftKey: currentShift(event),
        reldx: 0,
        reldy: 0,
        cam: camPayload?.cam || null,
        camSyncSeq: camPayload?.camSyncSeq ?? null,
      });
    }
  }

  function handlePointerMove(event) {
    if (!event || !pointerState.active) return;
    if (pointerState.id !== (event.pointerId ?? pointerState.id)) return;
    const dx = (event.clientX ?? 0) - (pointerState.lastX ?? event.clientX ?? 0);
    const dy = (event.clientY ?? 0) - (pointerState.lastY ?? event.clientY ?? 0);
    pointerState.lastX = event.clientX;
    pointerState.lastY = event.clientY;
    if (!dx && !dy) return;
    const { reldx, reldy } = normalizeDeltaByViewportHeight(canvas, dx, dy, invertY);
    if (!useWasmCamera) {
      applyCameraGesture(pointerState.mode, dx, dy);
    }
    if (typeof onGesture === 'function') {
      const camPayload = buildCameraPayloadIfNeeded();
      onGesture({
        mode: pointerState.mode,
        phase: 'update',
        pointer: event,
        drag: { dx, dy },
        gestureType: 'camera',
        shiftKey: currentShift(event),
        reldx,
        reldy,
        cam: camPayload?.cam || null,
        camSyncSeq: camPayload?.camSyncSeq ?? null,
      });
    }
  }

  function handlePointerUp(event) {
    if (!event || !pointerState.active) return;
    if (pointerState.id !== (event.pointerId ?? pointerState.id)) return;
    if (typeof onGesture === 'function') {
      onGesture({
        mode: pointerState.mode,
        phase: 'end',
        pointer: event,
        gestureType: 'camera',
        shiftKey: currentShift(event),
        reldx: 0,
        reldy: 0,
      });
    }
    pointerState.active = false;
    pointerState.id = null;
    pointerState.mode = 'idle';
    pointerState.lastX = null;
    pointerState.lastY = null;
    if (canvas && typeof canvas.releasePointerCapture === 'function' && event.pointerId != null) {
      try { canvas.releasePointerCapture(event.pointerId); } catch (err) { strictCatch(err, 'main:pointer_release'); }
    }
  }

  function handleWheel(event) {
    if (!event || !isInteractiveCamera()) return;
    if (typeof event.preventDefault === 'function') event.preventDefault();
    let dy = event.deltaY;
    if (event.deltaMode === 1) dy *= wheelLineFactor;
    if (event.deltaMode === 2) dy *= wheelPageFactor;
    if (Number.isFinite(maxWheelStep)) {
      dy = Math.max(-maxWheelStep, Math.min(maxWheelStep, dy));
    }
    const reldy = computeWheelReldy(dy);
    if (!useWasmCamera) {
      applyCameraGesture('zoom', 0, dy);
    }
    if (typeof onGesture === 'function') {
      const camPayload = buildCameraPayloadIfNeeded();
      onGesture({
        mode: 'zoom',
        phase: 'update',
        pointer: event,
        drag: { dx: 0, dy },
        gestureType: 'camera',
        shiftKey: currentShift(event),
        reldx: 0,
        reldy,
        cam: camPayload?.cam || null,
        camSyncSeq: camPayload?.camSyncSeq ?? null,
      });
    }
  }

  function handleKey(event, nextState) {
    if (!event) return;
    if (typeof event.key !== 'string') return;
    const key = event.key.toLowerCase();
    if (key === 'control') modifierState.ctrl = nextState;
    if (key === 'shift') modifierState.shift = nextState;
    if (key === 'alt') modifierState.alt = nextState;
    if (key === 'meta') modifierState.meta = nextState;
  }

  function install() {
    if (initialised) return;
    initialised = true;
    if (!canvas) return;
    const root = keyRoot || canvas;
    const onPointerDown = (event) => handlePointerDown(event);
    const onPointerMove = (event) => handlePointerMove(event);
    const onPointerUp = (event) => handlePointerUp(event);
    const onWheel = (event) => handleWheel(event);
    const onContextMenu = (event) => {
      if (typeof event?.preventDefault === 'function') event.preventDefault();
    };
    const onKeyDown = (event) => handleKey(event, true);
    const onKeyUp = (event) => handleKey(event, false);
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('contextmenu', onContextMenu);
    if (root) {
      root.addEventListener('keydown', onKeyDown);
      root.addEventListener('keyup', onKeyUp);
    }
    cleanup.push(() => {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('contextmenu', onContextMenu);
      if (root) {
        root.removeEventListener('keydown', onKeyDown);
        root.removeEventListener('keyup', onKeyUp);
      }
    });
  }

  function dispose() {
    while (cleanup.length) {
      const fn = cleanup.pop();
      try { fn(); } catch (err) { strictCatch(err, 'main:camera_cleanup'); }
    }
  }

  return {
    install,
    setup: install,
    dispose,
    applyGesture: applyCameraGesture,
    getModifierState: () => ({ ...modifierState }),
    isInteractiveCamera,
  };
}

function defaultSelection() {
  return {
    geom: -1,
    body: -1,
    joint: -1,
    name: '',
    kind: 'geom',
    point: [0, 0, 0],
    localPoint: [0, 0, 0],
    anchorLocal: null,
    normal: [0, 0, 1],
    seq: 0,
    timestamp: 0,
  };
}

const PERTURB_LABEL = {
  translate: 'perturb-translate',
  rotate: 'perturb-rotate',
};

const STATIC_PICK_BLOCK = { blocked: 'static' };

function createPickingController({
  THREE_NS = THREE,
  canvas,
  store,
  backend,
  renderCtx,
  applySpecAction: applySpecActionFn = null,
  debugMode = false,
  globalUp = new THREE_NS.Vector3(0, 0, 1),
  getSnapshot = null,
} = {}) {
  if (!canvas || !store || !backend || !renderCtx) {
    throw new Error('Picking controller requires canvas, store, backend, and renderCtx.');
  }
  const raycaster = new THREE_NS.Raycaster();
  const pointerNdc = new THREE_NS.Vector2();
  const normalMatrix = new THREE_NS.Matrix3();
  const tempQuat = new THREE_NS.Quaternion();
  const tempMat4 = new THREE_NS.Matrix4();
  const tempVecA = new THREE_NS.Vector3();
  const dragState = {
    active: false,
    pointerId: null,
    mode: 'idle',
    lastX: 0,
    lastY: 0,
    shiftKey: false,
    startButton: 0,
    perturbBegun: false,
    anchorLocal: new THREE_NS.Vector3(),
    bodyId: -1,
  };
  const cleanup = [];
  const tempBodyPos = new THREE_NS.Vector3();
  const tempBodyRot = new Float64Array(9);
  const tempVecLocal = new THREE_NS.Vector3();

  function hasSelection() {
    const sel = currentSelection();
    return !!sel && Number.isInteger(sel.body) && sel.body > 0;
  }

  function currentSelection() {
    const snapshot = typeof getSnapshot === 'function' ? getSnapshot() : null;
    const sel = getSnapshotSelection(snapshot);
    if (!sel || typeof sel !== 'object') return null;
    const geom = Number(sel.geomId) | 0;
    const body = Number(sel.bodyId) | 0;
    const point = Array.isArray(sel.point) ? sel.point.slice(0, 3).map((n) => Number(n) || 0) : [0, 0, 0];
    const anchorLocal = Array.isArray(sel.localpos) ? sel.localpos.slice(0, 3).map((n) => Number(n) || 0) : null;
    return {
      geom,
      body,
      name: geom >= 0 ? geomNameFor(geom) : (body >= 0 ? `Body ${body}` : ''),
      point,
      anchorLocal,
      seq: Number(sel.seq) || 0,
      timestamp: Number(sel.timestamp) || 0,
    };
  }

  function selectionSeq(nextSeq) {
    return Number.isFinite(nextSeq) ? nextSeq : (currentSelection()?.seq || 0) + 1;
  }

  function clearSelection({ toast = false } = {}) {
    const ts = Date.now();
    store.update((draft) => {
      if (!draft.runtime) draft.runtime = { ...(draft.runtime || {}) };
      draft.runtime.lastAction = 'select-none';
      if (toast) {
        draft.toast = { message: 'Selection cleared', ts };
      }
    });
    dragState.bodyId = -1;
    backend.setSelection?.({ bodyId: 0, seq: 0, timestamp: ts });
  }

  function showToast(message) {
    if (!message) return;
    const ts = Date.now();
    store.update((draft) => {
      draft.toast = { message, ts };
    });
  }

  function updateSelection(pick) {
    if (!pick) return;
    const ts = Date.now();
    let anchor = null;
    dragState.bodyId = -1;
    const nextSeq = (Number(currentSelection()?.seq) || 0) + 1;
    if (pick.bodyId > 0 && setAnchorLocalFromWorld(pick.bodyId, pick.worldPoint)) {
      dragState.bodyId = pick.bodyId;
      anchor = [dragState.anchorLocal.x, dragState.anchorLocal.y, dragState.anchorLocal.z];
    }
    store.update((draft) => {
      if (!draft.runtime) draft.runtime = { ...(draft.runtime || {}) };
      draft.runtime.lastAction = 'select';
      draft.toast = { message: `Selected ${pick.geomName}`, ts };
    });
    backend.setSelection?.({
      bodyId: pick.bodyId,
      geomId: pick.geomIndex,
      point: [pick.worldPoint.x, pick.worldPoint.y, pick.worldPoint.z],
      localpos: anchor || [pick.localPoint.x, pick.localPoint.y, pick.localPoint.z],
      seq: nextSeq,
      timestamp: ts,
    });
  }

  const meshList = [];
  function getMeshList() {
    meshList.length = 0;
    const batches = renderCtx?._instancing?.batches || null;
    if (batches instanceof Map) {
      for (const batch of batches.values()) {
        const mesh = batch?.mesh || null;
        const count = typeof mesh?.count === 'number' ? (mesh.count | 0) : 0;
        if (mesh && mesh.visible !== false && count > 0) {
          meshList.push(mesh);
        }
      }
    }
    if (Array.isArray(renderCtx.meshes)) {
      for (const mesh of renderCtx.meshes) {
        if (mesh && mesh.visible !== false) meshList.push(mesh);
      }
    }
    return meshList;
  }

  function projectPointer(event) {
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);
    pointerNdc.x = ((event.clientX - rect.left) / width) * 2 - 1;
    pointerNdc.y = -(((event.clientY - rect.top) / height) * 2 - 1);
    return { width, height };
  }

  function resolveGeomMesh(object) {
    let current = object;
    while (current) {
      if (typeof current.userData?.geomIndex === 'number') {
        return current;
      }
      current = current.parent;
    }
    return null;
  }

  function geomNameFor(index) {
    const mesh = Array.isArray(renderCtx.meshes) ? renderCtx.meshes[index] : null;
    if (mesh?.userData?.geomName) {
      return mesh.userData.geomName;
    }
    const snapshot = typeof getSnapshot === 'function' ? getSnapshot() : null;
    const lookup = getOrCreateGeomNameLookup(renderCtx, getSnapshotGeoms(snapshot) || null);
    return geomNameFromLookup(lookup, index);
  }

  function bodyIdFor(index) {
    const mesh = Array.isArray(renderCtx.meshes) ? renderCtx.meshes[index] : null;
    if (Number.isFinite(mesh?.userData?.geomBodyId)) {
      return mesh.userData.geomBodyId | 0;
    }
    const arr = getSnapshotGeomBodyIds(typeof getSnapshot === 'function' ? getSnapshot() : null) || null;
    if (!arr || !(index >= 0) || index >= arr.length) return -1;
    const bodyId = arr[index];
    return Number.isFinite(bodyId) ? (bodyId | 0) : -1;
  }

  function jointIdFor(bodyId) {
    if (!(bodyId >= 0)) return -1;
    const snapshot = typeof getSnapshot === 'function' ? getSnapshot() : null;
    const bodyAdr = getSnapshotBodyJointAdr(snapshot);
    const bodyNum = getSnapshotBodyJointNum(snapshot);
    const jtype = getSnapshotJointTypes(snapshot);
    if (!bodyAdr || !bodyNum || !jtype) return -1;
    const base = bodyAdr[bodyId] ?? -1;
    const num = bodyNum[bodyId] ?? 0;
    if (!(num > 0)) return -1;
    const j = base >= 0 ? (base | 0) : -1;
    if (j < 0 || j >= jtype.length) return -1;
    return j;
  }

  function applySelectionFromPick(pick, event = null) {
    updateSelection(pick);
    if (!event) return;
    if (event.shiftKey && typeof applySpecActionFn === 'function') {
      store.update((draft) => {
        const runtime = draft.runtime || (draft.runtime = {});
        runtime.trackingGeom = pick.geomIndex;
      });
      const trackingCtrl = { item_id: 'simulation.tracking_geom', type: 'select' };
      const cameraCtrl = { item_id: 'simulation.camera', type: 'select' };
      Promise.resolve(
        applySpecActionFn(store, backend, trackingCtrl, pick.geomIndex),
      )
        .then(() => applySpecActionFn(store, backend, cameraCtrl, 1))
        .catch((err) => {
          strictCatch(err, 'main:applySelectionFromPick');
        });
    }
  }

  function resolveDragMode(event) {
    const buttons = typeof event.buttons === 'number' ? event.buttons : 0;
    if ((buttons & 2) !== 0 || event.button === 2) return 'translate';
    return 'rotate';
  }

  function selectionAsBody() {
    const sel = currentSelection();
    if (!sel || sel.body < 0) return null;
    return sel.body;
  }

  function updateAnchorFromSelection() {
    const sel = currentSelection();
    if (!sel || sel.body < 1) return false;
    dragState.bodyId = sel.body | 0;
    if (Array.isArray(sel.anchorLocal) && sel.anchorLocal.length >= 3) {
      dragState.anchorLocal.set(
        Number(sel.anchorLocal[0]) || 0,
        Number(sel.anchorLocal[1]) || 0,
        Number(sel.anchorLocal[2]) || 0,
      );
      return true;
    }
    if (!sel.point) return false;
    tempVecA.set(sel.point[0], sel.point[1], sel.point[2]);
    return setAnchorLocalFromWorld(sel.body, tempVecA);
  }

  function setAnchorLocalFromWorld(bodyId, worldPoint) {
    const snapshot = typeof getSnapshot === 'function' ? getSnapshot() : null;
    const bxpos = snapshot?.bxpos || null;
    const bxmat = snapshot?.bxmat || null;
    if (!bxpos || !bxmat) return false;
    const base = bodyId * 3;
    const baseMat = bodyId * 9;
    if (base + 2 >= bxpos.length || baseMat + 8 >= bxmat.length) return false;
    tempBodyPos.set(
      Number(bxpos[base + 0]) || 0,
      Number(bxpos[base + 1]) || 0,
      Number(bxpos[base + 2]) || 0,
    );
    tempBodyRot.set([
      Number(bxmat[baseMat + 0]) || 1,
      Number(bxmat[baseMat + 1]) || 0,
      Number(bxmat[baseMat + 2]) || 0,
      Number(bxmat[baseMat + 3]) || 0,
      Number(bxmat[baseMat + 4]) || 1,
      Number(bxmat[baseMat + 5]) || 0,
      Number(bxmat[baseMat + 6]) || 0,
      Number(bxmat[baseMat + 7]) || 0,
      Number(bxmat[baseMat + 8]) || 1,
    ]);
    tempQuat.setFromRotationMatrix(tempMat4.set(
      tempBodyRot[0], tempBodyRot[1], tempBodyRot[2], 0,
      tempBodyRot[3], tempBodyRot[4], tempBodyRot[5], 0,
      tempBodyRot[6], tempBodyRot[7], tempBodyRot[8], 0,
      0, 0, 0, 1,
    ));
    tempVecLocal.copy(worldPoint).sub(tempBodyPos);
    tempVecLocal.applyQuaternion(tempQuat.invert());
    dragState.anchorLocal.copy(tempVecLocal);
    return true;
  }

  function resolvePick(event) {
    const { width, height } = projectPointer(event);
    const camera = renderCtx.camera;
    if (!camera) return null;
    raycaster.setFromCamera(pointerNdc, camera);
    const list = getMeshList();
    if (!list.length) return null;
    const hits = raycaster.intersectObjects(list, true);
    if (!hits.length) return null;
    let hit = null;
    let mesh = null;
    let geomIndex = -1;
    for (const entry of hits) {
      if (!entry?.object || !entry?.point) continue;
      const resolved = resolveGeomMesh(entry.object);
      const idx = resolved?.userData?.geomIndex ?? -1;
      if (resolved && idx >= 0) {
        hit = entry;
        mesh = resolved;
        geomIndex = idx;
        break;
      }
    }
    if (!hit || !mesh || geomIndex < 0) return null;
    const geomName = mesh.userData?.geomName || geomNameFor(geomIndex);
    const bodyId = bodyIdFor(geomIndex);
    if (mesh.userData?.geomStatic) {
      return { blocked: 'static', geomIndex, geomName };
    }
    const normal = hit.face?.normal || null;
    if (!normal) return null;
    const worldNormal = normal.clone().applyMatrix3(normalMatrix.getNormalMatrix(hit.object.matrixWorld)).normalize();
    const localPoint = hit.point.clone();
    hit.object.worldToLocal(localPoint);
    return {
      geomIndex,
      geomName,
      bodyId,
      jointId: jointIdFor(bodyId),
      worldPoint: hit.point.clone(),
      localPoint,
      worldNormal,
      screen: { width, height },
    };
  }

  function selectionFromPick(pick, event) {
    if (!pick) return null;
    if (pick.blocked === 'static') return STATIC_PICK_BLOCK;
    if (!Number.isFinite(pick.geomIndex) || pick.geomIndex < 0) return null;
    applySelectionFromPick(pick, event);
    return pick;
  }

  function beginPerturb(event) {
    const bodyId = dragState.bodyId;
    if (!(bodyId > 0)) return;
    backend.applyPerturb?.({
      phase: 'begin',
      mode: dragState.mode,
      shiftKey: !!event?.shiftKey,
      bodyId,
      localpos: [dragState.anchorLocal.x, dragState.anchorLocal.y, dragState.anchorLocal.z],
    });
    store.update((draft) => {
      const runtime = draft.runtime || (draft.runtime = {});
      const perturb = runtime.perturb || (runtime.perturb = { mode: 'idle', active: false });
      perturb.mode = dragState.mode;
      perturb.active = true;
      runtime.lastAction = dragState.mode === 'translate' ? 'translate' : 'rotate';
    });
  }

  function movePerturb(event) {
    if (!dragState.active || dragState.pointerId !== event.pointerId) return;
    const dx = event.clientX - dragState.lastX;
    const dy = event.clientY - dragState.lastY;
    dragState.lastX = event.clientX;
    dragState.lastY = event.clientY;
    if (!dragState.perturbBegun) return;
    // MuJoCo/simulate normalizes by viewport height, using the UI "y-down" convention:
    // dy > 0 means pointer moved down (browser `clientY` increases).
    const { reldx, reldy } = normalizeDeltaByViewportHeight(canvas, dx, dy);
    backend.applyPerturb?.({
      phase: 'move',
      mode: dragState.mode,
      shiftKey: !!event.shiftKey,
      reldx,
      reldy,
    });
  }

  function endPerturb() {
    backend.applyPerturb?.({ phase: 'end' });
    store.update((draft) => {
      if (draft.runtime?.perturb) {
        draft.runtime.perturb.active = false;
        draft.runtime.perturb.mode = 'idle';
      }
    });
  }

  function onClick(event) {
    if (!event) return;
    if (event.button !== 0) return;
  }

  function onDoubleClick(event) {
    if (!event) return;
    endPerturb();
    const rect = canvas?.getBoundingClientRect?.() || null;
    const width = rect ? rect.width : (canvas?.clientWidth || 1);
    const height = rect ? rect.height : (canvas?.clientHeight || 1);
    if (!(width > 0) || !(height > 0)) return;
    const relx = rect ? ((event.clientX - rect.left) / width) : 0;
    // NOTE: MuJoCo's `mjv_select` expects `rely` in a bottom-origin convention:
    // rely=0 at the viewport bottom, rely=1 at the viewport top (see `engine_vis_interact.c`).
    // Browser `clientY` is top-origin, so we flip it here to match MuJoCo/simulate semantics.
    const rely = rect ? ((rect.bottom - event.clientY) / height) : 0;
    backend.selectAt?.({
      relx: THREE_NS.MathUtils.clamp(relx, 0, 1),
      rely: THREE_NS.MathUtils.clamp(rely, 0, 1),
      aspect: width / height,
    });
  }

  function onPointerMove(event) {
    if (!dragState.active || dragState.pointerId !== event.pointerId) return;
    movePerturb(event);
  }

  function onPointerDragStart(event) {
    if (!event) return;
    if (!hasSelection()) return;
    if (!event.ctrlKey) return;
    dragState.active = true;
    dragState.pointerId = event.pointerId ?? null;
    dragState.mode = resolveDragMode(event);
    dragState.lastX = event.clientX;
    dragState.lastY = event.clientY;
    dragState.shiftKey = !!event.shiftKey;
    dragState.startButton = typeof event.button === 'number' ? event.button : 0;
    dragState.perturbBegun = true;
    updateAnchorFromSelection();
    beginPerturb(event);
    if (dragState.pointerId != null && canvas?.setPointerCapture) {
      try { canvas.setPointerCapture(dragState.pointerId); } catch (err) { strictCatch(err, 'main:drag_pointer_capture'); }
    }
    return true;
  }

  function onPointerDragEnd(event) {
    if (!dragState.active) return;
    dragState.active = false;
    if (dragState.pointerId != null && canvas?.releasePointerCapture) {
      try { canvas.releasePointerCapture(dragState.pointerId); } catch (err) { strictCatch(err, 'main:drag_pointer_release'); }
    }
    dragState.pointerId = null;
    if (dragState.perturbBegun) {
      endPerturb();
    }
    dragState.perturbBegun = false;
  }

  function install() {
    const onPointerDownEvt = (event) => {
      if (event.ctrlKey && (event.button === 0 || event.button === 2)) {
        const started = onPointerDragStart(event);
        if (started) {
          if (typeof event?.preventDefault === 'function') event.preventDefault();
          if (typeof event?.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
        }
      }
    };
    const onPointerUpEvt = (event) => {
      if (dragState.active) {
        onPointerDragEnd(event);
        if (typeof event?.preventDefault === 'function') event.preventDefault();
        if (typeof event?.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
      }
    };
    const onPointerMoveEvt = (event) => {
      if (dragState.active) {
        onPointerMove(event);
        if (typeof event?.preventDefault === 'function') event.preventDefault();
        if (typeof event?.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
      }
    };
    const onContextMenu = (event) => {
      if (typeof event?.preventDefault === 'function') event.preventDefault();
    };
    canvas.addEventListener('pointerdown', onPointerDownEvt, true);
    canvas.addEventListener('pointerup', onPointerUpEvt, true);
    canvas.addEventListener('pointercancel', onPointerUpEvt, true);
    canvas.addEventListener('pointermove', onPointerMoveEvt, true);
    const contextTargets = [canvas, canvas?.parentElement].filter(Boolean);
    for (const target of contextTargets) {
      target.addEventListener('contextmenu', onContextMenu, true);
    }
    canvas.addEventListener('click', onClick);
    canvas.addEventListener('dblclick', onDoubleClick);
    cleanup.push(() => {
      canvas.removeEventListener('pointerdown', onPointerDownEvt, true);
      canvas.removeEventListener('pointerup', onPointerUpEvt, true);
      canvas.removeEventListener('pointercancel', onPointerUpEvt, true);
      canvas.removeEventListener('pointermove', onPointerMoveEvt, true);
      for (const target of contextTargets) {
        target.removeEventListener('contextmenu', onContextMenu, true);
      }
      canvas.removeEventListener('click', onClick);
      canvas.removeEventListener('dblclick', onDoubleClick);
    });
  }

  function dispose() {
    while (cleanup.length) {
      const fn = cleanup.pop();
      try { fn(); } catch (err) { strictCatch(err, 'main:picking_cleanup'); }
    }
  }

  return {
    install,
    setup: install,
    dispose,
    updateSelection,
    clearSelection,
    hasSelection,
    applySelectionFromPick,
    selectionFromPick,
    selectionSeq,
    PERTURB_LABEL,
  };
}



export {
  createCameraController,
  createPickingController,
};
