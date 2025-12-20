import * as THREE from 'three';
import { applySpecAction } from './viewer_state.mjs';
import { logWarn } from './viewer_runtime.mjs';

/**
 * Camera controller for orbit/pan/zoom with pointer gestures.
 *
 * Options:
 * - minDistance: fixed minimum distance (takes precedence over getMinDistance).
 * - getMinDistance(camera, target, ctx): dynamic minimum distance when minDistance is not provided.
 * - zoomK: wheel delta scale (default 0.35), maxWheelStep clamps magnitude pre-scaling.
 * - invertY: inverts vertical component for orbit/rotate and translate.
 * - keyRoot: element to receive key events (falls back to canvas).
 * - assertUp: when true, verify camera.up matches initial up and realign if it drifts.
 * - wheelLineFactor / wheelPageFactor: DOM_DELTA normalization constants.
 * - minOrthoZoom / maxOrthoZoom: zoom clamps for orthographic cameras.
 *
 */
export function createCameraController({
  THREE_NS,
  canvas,
  store,
  backend,
  onGesture,
  renderCtx,
  debugMode = false,
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
  const tempSpherical = new THREE_NS.Spherical();

  const cleanup = [];
  let initialised = false;
  let upNormalised = new THREE_NS.Vector3().copy(globalUp).normalize();
  let up0 = upNormalised.clone();

  const cameraModeIndex = () => {
    try {
      return store.get()?.runtime?.cameraIndex ?? 0;
    } catch {
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
    if (currentCtrl(event)) return 'rotate';
    if (currentShift(event)) return 'translate';
    if (btn === 2) return 'translate';
    if (btn === 1) return 'zoom';
    return 'orbit';
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
      } catch {}
    }

    const elementWidth = canvas?.clientWidth || (typeof window !== 'undefined' ? window.innerWidth : 1) || 1;
    const elementHeight = canvas?.clientHeight || (typeof window !== 'undefined' ? window.innerHeight : 1) || 1;
    const shortEdge = Math.max(1, Math.min(elementWidth, elementHeight));
    const fovRad = THREE_NS.MathUtils.degToRad(typeof camera.fov === 'number' ? camera.fov : 45);
    const isOrtho = !!camera.isOrthographicCamera;

    switch (mode) {
      case 'translate': {
        const dyEff = invertY ? -dy : dy;
        let moveX = 0;
        let moveY = 0;
        if (isOrtho && typeof camera.zoom === 'number') {
          const zoom = Math.max(1e-6, camera.zoom || 1);
          const widthWorld = Math.abs((camera.right ?? 1) - (camera.left ?? -1)) / zoom;
          const heightWorld = Math.abs((camera.top ?? 1) - (camera.bottom ?? -1)) / zoom;
          moveX = -dx * (widthWorld / elementWidth);
          moveY = dyEff * (heightWorld / elementHeight);
        } else {
          const panScale = distance * Math.tan(fovRad / 2);
          moveX = (-2 * dx * panScale) / shortEdge;
          moveY = (2 * dyEff * panScale) / shortEdge;
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
        let yaw = (1.6 * Math.PI * dx) / elementWidth;
        let pitch = (1.6 * Math.PI * (invertY ? -dy : dy)) / elementHeight;
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
        const dyEff = invertY ? -dy : dy;
        const radiansPerPixel = Math.PI / shortEdge;
        const thetaDelta = -dx * radiansPerPixel;
        const phiDelta = -dyEff * radiansPerPixel;
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
      try { canvas.setPointerCapture(event.pointerId); } catch {}
    }
    if (typeof onGesture === 'function') {
      onGesture({ mode, phase: 'start', pointer: event });
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
    applyCameraGesture(pointerState.mode, dx, dy);
    if (typeof onGesture === 'function') {
      onGesture({ mode: pointerState.mode, phase: 'update', pointer: event, drag: { dx, dy } });
    }
  }

  function handlePointerUp(event) {
    if (!event || !pointerState.active) return;
    if (pointerState.id !== (event.pointerId ?? pointerState.id)) return;
    if (typeof onGesture === 'function') {
      onGesture({ mode: pointerState.mode, phase: 'end', pointer: event });
    }
    pointerState.active = false;
    pointerState.id = null;
    pointerState.mode = 'idle';
    pointerState.lastX = null;
    pointerState.lastY = null;
    if (canvas && typeof canvas.releasePointerCapture === 'function' && event.pointerId != null) {
      try { canvas.releasePointerCapture(event.pointerId); } catch {}
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
    applyCameraGesture('zoom', 0, dy);
    if (typeof onGesture === 'function') {
      onGesture({ mode: 'zoom', phase: 'update', pointer: event, drag: { dx: 0, dy } });
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
    const onKeyDown = (event) => handleKey(event, true);
    const onKeyUp = (event) => handleKey(event, false);
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
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
      if (root) {
        root.removeEventListener('keydown', onKeyDown);
        root.removeEventListener('keyup', onKeyUp);
      }
    });
  }

  function dispose() {
    while (cleanup.length) {
      const fn = cleanup.pop();
      try { fn(); } catch {}
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

export function createPickingController({
  THREE_NS = THREE,
  canvas,
  store,
  backend,
  renderCtx,
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
  const tempMat4B = new THREE_NS.Matrix4();
  const tempVecA = new THREE_NS.Vector3();
  const dragState = {
    active: false,
    pointerId: null,
    mode: 'idle',
    lastX: 0,
    lastY: 0,
    shiftKey: false,
    anchorLocal: new THREE_NS.Vector3(),
    bodyId: -1,
  };
  const cleanup = [];
  const tempBodyPos = new THREE_NS.Vector3();
  const tempBodyCom = new THREE_NS.Vector3();
  const tempBodyRot = new Float64Array(9);
  const tempVecLocal = new THREE_NS.Vector3();
  const tempVecWorld = new THREE_NS.Vector3();
  const tempCameraOffset = new THREE_NS.Vector3();
  let lastRightDownTime = 0;
  let lastRightDownCtrl = false;

  function hasSelection() {
    const sel = store.get()?.runtime?.selection;
    return !!sel && Number.isInteger(sel.geom) && sel.geom >= 0;
  }

  function currentSelection() {
    return store.get()?.runtime?.selection || null;
  }

  function selectionSeq(nextSeq) {
    return Number.isFinite(nextSeq) ? nextSeq : (currentSelection()?.seq || 0) + 1;
  }

  function clearSelection({ toast = false } = {}) {
    store.update((draft) => {
      if (!draft.runtime) draft.runtime = {};
      const prevSeq = (draft.runtime.selection?.seq || 0) + 1;
      draft.runtime.selection = { ...defaultSelection(), seq: prevSeq, timestamp: Date.now() };
      draft.runtime.lastAction = 'select-none';
      if (toast) {
        draft.toast = { message: 'Selection cleared', ts: Date.now() };
      }
    });
    dragState.bodyId = -1;
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
    store.update((draft) => {
      if (!draft.runtime) draft.runtime = {};
      const seq = (draft.runtime.selection?.seq || 0) + 1;
      draft.runtime.selection = {
        geom: pick.geomIndex,
        body: pick.bodyId,
        joint: pick.jointId,
        name: pick.geomName,
        kind: 'geom',
        point: [pick.worldPoint.x, pick.worldPoint.y, pick.worldPoint.z],
        localPoint: [pick.localPoint.x, pick.localPoint.y, pick.localPoint.z],
        normal: [pick.worldNormal.x, pick.worldNormal.y, pick.worldNormal.z],
        seq,
        timestamp: ts,
      };
      draft.runtime.lastAction = 'select';
      draft.toast = { message: `Selected ${pick.geomName}`, ts };
    });
    if (pick.bodyId >= 0) {
      dragState.bodyId = pick.bodyId;
      setAnchorLocalFromWorld(pick.bodyId, pick.worldPoint);
    }
  }

  function getMeshList() {
    const list = [];
    const batches = renderCtx?._instancing?.batches || null;
    if (batches instanceof Map) {
      for (const batch of batches.values()) {
        const mesh = batch?.mesh || null;
        const count = typeof mesh?.count === 'number' ? (mesh.count | 0) : 0;
        if (mesh && mesh.visible !== false && count > 0) {
          list.push(mesh);
        }
      }
    }
    if (Array.isArray(renderCtx.meshes)) {
      for (const mesh of renderCtx.meshes) {
        if (mesh && mesh.visible !== false) list.push(mesh);
      }
    }
    return list;
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
    const state = store.get();
    const geoms = Array.isArray(state?.model?.geoms) ? state.model.geoms : [];
    for (const geom of geoms) {
      if ((geom?.index | 0) === index) {
        return (geom?.name || `Geom ${index}`).trim();
      }
    }
    return `Geom ${index}`;
  }

  function bodyIdFor(index) {
    const mesh = Array.isArray(renderCtx.meshes) ? renderCtx.meshes[index] : null;
    if (Number.isFinite(mesh?.userData?.geomBodyId)) {
      return mesh.userData.geomBodyId | 0;
    }
    const state = store.get();
    const arr = state?.model?.geomBodyId;
    if (!arr) return -1;
    try {
      return arr[index] ?? -1;
    } catch {
      return -1;
    }
  }

  function jointIdFor(bodyId) {
    if (!(bodyId >= 0)) return -1;
    const state = store.get();
    const bodyAdr = state?.model?.bodyJntAdr;
    const bodyNum = state?.model?.bodyJntNum;
    const jtype = state?.model?.jntType;
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
    if (event.shiftKey) {
      store.update((draft) => {
        if (!draft.runtime) draft.runtime = {};
        draft.runtime.trackingGeom = pick.geomIndex;
      });
      const trackingCtrl = { item_id: 'simulation.tracking_geom', type: 'select' };
      const cameraCtrl = { item_id: 'simulation.camera', type: 'select' };
      Promise.resolve(
        applySpecAction(store, backend, trackingCtrl, pick.geomIndex),
      )
        .then(() => applySpecAction(store, backend, cameraCtrl, 1))
        .catch(() => {});
    }
  }

  function resolveDragMode(event) {
    if (event.ctrlKey) return 'rotate';
    if (event.shiftKey) return 'translate';
    if (event.button === 2) return 'translate';
    return 'rotate';
  }

  function selectionAsBody() {
    const sel = currentSelection();
    if (!sel || sel.body < 0) return null;
    return sel.body;
  }

  function updateAnchorFromSelection() {
    const sel = currentSelection();
    if (!sel || sel.body < 0 || !sel.point) return;
    tempVecA.set(sel.point[0], sel.point[1], sel.point[2]);
    setAnchorLocalFromWorld(sel.body, tempVecA);
  }

  function setAnchorLocalFromWorld(bodyId, worldPoint) {
    const snapshot = typeof getSnapshot === 'function' ? getSnapshot() : null;
    if (!snapshot || !snapshot.body_xpos || !snapshot.body_xmat) return;
    const base = bodyId * 3;
    const baseMat = bodyId * 9;
    if (!snapshot.body_xpos || !snapshot.body_xmat) return;
    tempBodyPos.set(
      snapshot.body_xpos[base + 0] ?? 0,
      snapshot.body_xpos[base + 1] ?? 0,
      snapshot.body_xpos[base + 2] ?? 0,
    );
    tempBodyRot.set([
      snapshot.body_xmat[baseMat + 0] ?? 1,
      snapshot.body_xmat[baseMat + 1] ?? 0,
      snapshot.body_xmat[baseMat + 2] ?? 0,
      snapshot.body_xmat[baseMat + 3] ?? 0,
      snapshot.body_xmat[baseMat + 4] ?? 1,
      snapshot.body_xmat[baseMat + 5] ?? 0,
      snapshot.body_xmat[baseMat + 6] ?? 0,
      snapshot.body_xmat[baseMat + 7] ?? 0,
      snapshot.body_xmat[baseMat + 8] ?? 1,
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
  }

  function readBodyPose(bodyId, outPos, outRot) {
    const snapshot = typeof getSnapshot === 'function' ? getSnapshot() : null;
    if (!snapshot || !snapshot.body_xpos || !snapshot.body_xmat) return false;
    const base = bodyId * 3;
    const baseMat = bodyId * 9;
    outPos.set(
      snapshot.body_xpos[base + 0] ?? 0,
      snapshot.body_xpos[base + 1] ?? 0,
      snapshot.body_xpos[base + 2] ?? 0,
    );
    outRot.set([
      snapshot.body_xmat[baseMat + 0] ?? 1,
      snapshot.body_xmat[baseMat + 1] ?? 0,
      snapshot.body_xmat[baseMat + 2] ?? 0,
      snapshot.body_xmat[baseMat + 3] ?? 0,
      snapshot.body_xmat[baseMat + 4] ?? 1,
      snapshot.body_xmat[baseMat + 5] ?? 0,
      snapshot.body_xmat[baseMat + 6] ?? 0,
      snapshot.body_xmat[baseMat + 7] ?? 0,
      snapshot.body_xmat[baseMat + 8] ?? 1,
    ]);
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
    const hit = hits.find((entry) => entry?.object && entry?.point);
    if (!hit) return null;
    const mesh = resolveGeomMesh(hit.object);
    if (!mesh) return null;
    const geomIndex = mesh.userData?.geomIndex ?? -1;
    if (!(geomIndex >= 0)) return null;
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

  function updatePerturb(pointWorld, mode) {
    const bodyId = dragState.bodyId;
    if (!(bodyId >= 0)) return;
    const outPos = tempBodyPos;
    if (!readBodyPose(bodyId, outPos, tempBodyRot)) return;
    tempQuat.setFromRotationMatrix(tempMat4.set(
      tempBodyRot[0], tempBodyRot[1], tempBodyRot[2], 0,
      tempBodyRot[3], tempBodyRot[4], tempBodyRot[5], 0,
      tempBodyRot[6], tempBodyRot[7], tempBodyRot[8], 0,
      0, 0, 0, 1,
    ));
    const anchorWorld = dragState.anchorLocal.clone().applyQuaternion(tempQuat).add(outPos);
    const action = mode === 'translate' ? 'translate' : 'rotate';
    const payload = {
      kind: 'gesture',
      mode: action,
      phase: 'update',
      pointer: {
        x: 0,
        y: 0,
        dx: 0,
        dy: 0,
      },
      drag: {
        dx: pointWorld.x - anchorWorld.x,
        dy: pointWorld.y - anchorWorld.y,
        dz: pointWorld.z - anchorWorld.z,
      },
      target: {
        body: bodyId,
        anchor: [anchorWorld.x, anchorWorld.y, anchorWorld.z],
      },
    };
    backend.apply?.(payload);
    store.update((draft) => {
      if (!draft.runtime) draft.runtime = {};
      if (!draft.runtime.perturb) {
        draft.runtime.perturb = { mode: 'idle', active: false };
      }
      draft.runtime.perturb.mode = mode;
      draft.runtime.perturb.active = true;
      draft.runtime.lastAction = action;
    });
  }

  function onPointerDown(event) {
    if (!event) return;
    if (event.button === 2) {
      lastRightDownTime = Date.now();
      lastRightDownCtrl = !!event.ctrlKey;
    }
  }

  function onPointerUp(event) {
    if (!event) return;
    if (event.button === 2) {
      const dt = Date.now() - lastRightDownTime;
      if (dt < 260 && lastRightDownCtrl && hasSelection()) {
        clearSelection({ toast: true });
        return;
      }
    }
  }

  function onClick(event) {
    if (!event) return;
    if (event.button !== 0) return;
    const pick = resolvePick(event);
    if (pick === STATIC_PICK_BLOCK) {
      showToast('Selection blocked (static geom)');
      return;
    }
    selectionFromPick(pick, event);
  }

  function onDoubleClick(event) {
    if (!event) return;
    const pick = resolvePick(event);
    if (pick === STATIC_PICK_BLOCK) {
      showToast('Selection blocked (static geom)');
      return;
    }
    const result = selectionFromPick(pick, event);
    if (!result || !result.geomIndex) return;
    updateAnchorFromSelection();
  }

  function onPointerMove(event) {
    if (!dragState.active || dragState.pointerId !== event.pointerId) return;
    const pick = resolvePick(event);
    if (!pick || pick.blocked) return;
    const point = pick.worldPoint;
    dragState.lastX = event.clientX;
    dragState.lastY = event.clientY;
    const mode = dragState.mode;
    updatePerturb(point, mode);
  }

  function onPointerDragStart(event) {
    if (!event) return;
    if (!hasSelection()) return;
    dragState.active = true;
    dragState.pointerId = event.pointerId ?? null;
    dragState.mode = resolveDragMode(event);
    dragState.lastX = event.clientX;
    dragState.lastY = event.clientY;
    dragState.shiftKey = !!event.shiftKey;
    updateAnchorFromSelection();
    if (dragState.pointerId != null && canvas?.setPointerCapture) {
      try { canvas.setPointerCapture(dragState.pointerId); } catch {}
    }
  }

  function onPointerDragEnd(event) {
    if (!dragState.active) return;
    dragState.active = false;
    if (dragState.pointerId != null && canvas?.releasePointerCapture) {
      try { canvas.releasePointerCapture(dragState.pointerId); } catch {}
    }
    dragState.pointerId = null;
    store.update((draft) => {
      if (draft.runtime?.perturb) {
        draft.runtime.perturb.active = false;
        draft.runtime.perturb.mode = 'idle';
      }
    });
  }

  function install() {
    const onPointerDownEvt = (event) => {
      if (event.button === 0) {
        onPointerDragStart(event);
      }
      onPointerDown(event);
    };
    const onPointerUpEvt = (event) => {
      if (dragState.active) {
        onPointerDragEnd(event);
      }
      onPointerUp(event);
    };
    canvas.addEventListener('pointerdown', onPointerDownEvt);
    canvas.addEventListener('pointerup', onPointerUpEvt);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('click', onClick);
    canvas.addEventListener('dblclick', onDoubleClick);
    cleanup.push(() => {
      canvas.removeEventListener('pointerdown', onPointerDownEvt);
      canvas.removeEventListener('pointerup', onPointerUpEvt);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('click', onClick);
      canvas.removeEventListener('dblclick', onDoubleClick);
    });
  }

  function dispose() {
    while (cleanup.length) {
      const fn = cleanup.pop();
      try { fn(); } catch {}
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
