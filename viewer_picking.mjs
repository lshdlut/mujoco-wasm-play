import * as THREE from 'three';

function clampVector(vec, max = Infinity) {
  if (!Number.isFinite(max) || max <= 0) return vec;
  const len = vec.length();
  if (len > max && len > 0) {
    vec.setLength(max);
  }
  return vec;
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
} = {}) {
  if (!canvas || !store || !backend || !renderCtx) {
    throw new Error('Picking controller requires canvas, store, backend, and renderCtx.');
  }
  const raycaster = new THREE_NS.Raycaster();
  const pointerNdc = new THREE_NS.Vector2();
  const normalMatrix = new THREE_NS.Matrix3();
  const tempVecA = new THREE_NS.Vector3();
  const tempVecB = new THREE_NS.Vector3();
  const tempVecC = new THREE_NS.Vector3();
  const tempVecD = new THREE_NS.Vector3();
  const selectionWorld = new THREE_NS.Vector3();
  const dragState = {
    active: false,
    pointerId: null,
    mode: 'idle',
    lastX: 0,
    lastY: 0,
  };
  const cleanup = [];

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
        draft.toast = { message: 'Selection cleared' };
      }
    });
  }

  function showToast(message) {
    if (!message) return;
    store.update((draft) => {
      draft.toast = { message };
    });
  }

  function updateSelection(pick) {
    if (!pick) return;
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
        timestamp: Date.now(),
      };
      draft.runtime.lastAction = 'select';
      draft.toast = { message: `Selected ${pick.geomName}` };
    });
  }

  function getMeshList() {
    return Array.isArray(renderCtx.meshes) ? renderCtx.meshes.filter(Boolean) : [];
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
    const adr = state?.model?.bodyJntAdr;
    const num = state?.model?.bodyJntNum;
    if (!adr || !num) return -1;
    try {
      const base = adr[bodyId] ?? -1;
      const count = num[bodyId] ?? 0;
      return count > 0 ? base : -1;
    } catch {
      return -1;
    }
  }

  function isStaticBody(bodyId) {
    return Number.isFinite(bodyId) && bodyId <= 0;
  }

  function pickGeom(event) {
    if (!renderCtx.camera) return null;
    const { width, height } = projectPointer(event);
    raycaster.setFromCamera(pointerNdc, renderCtx.camera);
    const intersections = raycaster.intersectObjects(getMeshList(), true);
    if (!intersections.length) return null;
    let skippedStatic = false;
    for (const hit of intersections) {
      const mesh = resolveGeomMesh(hit.object);
      if (!mesh || mesh.visible === false) continue;
      const geomIndex = mesh.userData.geomIndex | 0;
      if (!(geomIndex >= 0)) continue;
      const worldPoint = hit.point.clone();
      const localPoint = mesh.worldToLocal(hit.point.clone());
      const worldNormal = hit.face
        ? hit.face.normal.clone()
        : new THREE_NS.Vector3(0, 0, 1);
      normalMatrix.getNormalMatrix(mesh.matrixWorld);
      worldNormal.applyMatrix3(normalMatrix).normalize();
      const geomName = geomNameFor(geomIndex);
      const bodyId = bodyIdFor(geomIndex);
      if (isStaticBody(bodyId)) {
        skippedStatic = true;
        continue;
      }
      const jointId = jointIdFor(bodyId);
      return {
        geomIndex,
        mesh,
        worldPoint,
        localPoint,
        worldNormal,
        geomName,
        bodyId,
        jointId,
        viewport: { width, height },
      };
    }
    if (skippedStatic) return STATIC_PICK_BLOCK;
    return null;
  }

  function resolveSelectionWorldPoint(selection, outVec) {
    if (!selection || selection.geom < 0) return false;
    const mesh = Array.isArray(renderCtx.meshes) ? renderCtx.meshes[selection.geom] : null;
    if (mesh && Array.isArray(selection.localPoint) && selection.localPoint.length >= 3) {
      outVec.set(selection.localPoint[0], selection.localPoint[1], selection.localPoint[2]);
      mesh.localToWorld(outVec);
      return true;
    }
    if (Array.isArray(selection.point) && selection.point.length >= 3) {
      outVec.set(selection.point[0], selection.point[1], selection.point[2]);
      return true;
    }
    return false;
  }

  function computeWorldDrag(dx, dy) {
    const camera = renderCtx.camera;
    if (!camera) return null;
    const target = renderCtx.cameraTarget
      ? tempVecC.copy(renderCtx.cameraTarget)
      : tempVecC.set(0, 0, 0);
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);
    const shortEdge = Math.max(1, Math.min(width, height));
    const distance = camera.position.distanceTo(target);
    const fovRad = THREE_NS.MathUtils.degToRad(typeof camera.fov === 'number' ? camera.fov : 45);
    const panScale = distance * Math.tan(fovRad / 2);
    const moveX = (-2 * dx * panScale) / shortEdge;
    const moveY = (2 * -dy * panScale) / shortEdge;
    const forward = tempVecA;
    camera.getWorldDirection(forward).normalize();
    const up = tempVecB.copy(camera.up).normalize();
    if (up.lengthSq() === 0) {
      up.copy(globalUp).normalize();
    }
    const right = tempVecD.copy(forward).cross(up).normalize();
    return right.multiplyScalar(moveX).add(up.multiplyScalar(moveY));
  }

  function computeTorque(dx, dy) {
    const camera = renderCtx.camera;
    if (!camera) return null;
    const boundsRadius = Math.max(0.1, renderCtx.bounds?.radius || 1);
    const torqueScale = boundsRadius * 8;
    const forward = tempVecA;
    camera.getWorldDirection(forward).normalize();
    const up = tempVecB.copy(camera.up).normalize();
    if (up.lengthSq() === 0) up.copy(globalUp).normalize();
    const right = tempVecC.copy(forward).cross(up).normalize();
    const torque = tempVecD.set(0, 0, 0);
    torque.add(up.clone().multiplyScalar(dx * torqueScale));
    torque.add(right.multiplyScalar(-dy * torqueScale));
    return torque.clone();
  }

  function setPerturbState(mode, active) {
    store.update((draft) => {
      if (!draft.runtime) draft.runtime = {};
      if (active) {
        draft.runtime.perturb = { mode, active: true };
        draft.runtime.lastAction = PERTURB_LABEL[mode] || 'perturb';
      } else {
        draft.runtime.perturb = { mode: 'idle', active: false };
        if (!draft.runtime.gesture || draft.runtime.gesture.mode === 'idle') {
          draft.runtime.lastAction = 'idle';
        }
      }
    });
  }

  function applyPerturb(deltaX, deltaY) {
    const selection = currentSelection();
    if (!selection || selection.geom < 0) return;
    const geomIndex = selection.geom | 0;
    const worldPoint = resolveSelectionWorldPoint(selection, selectionWorld)
      ? selectionWorld.clone()
      : null;
    if (!worldPoint) return;
    const boundsRadius = Math.max(0.1, renderCtx.bounds?.radius || 1);
    if (dragState.mode === 'translate') {
      const delta = computeWorldDrag(deltaX, deltaY);
      if (!delta) return;
      const force = clampVector(delta.clone().multiplyScalar(boundsRadius * 60), boundsRadius * 200);
      backend.applyForce?.({
        geomIndex,
        force: [force.x, force.y, force.z],
        torque: [0, 0, 0],
        point: [worldPoint.x, worldPoint.y, worldPoint.z],
      });
      setPerturbState('translate', true);
    } else if (dragState.mode === 'rotate') {
      const torque = computeTorque(deltaX, deltaY);
      if (!torque) return;
      const limited = clampVector(torque, boundsRadius * 80);
      backend.applyForce?.({
        geomIndex,
        force: [0, 0, 0],
        torque: [limited.x, limited.y, limited.z],
        point: [worldPoint.x, worldPoint.y, worldPoint.z],
      });
      setPerturbState('rotate', true);
    }
  }

  function beginPerturb(event, mode) {
    dragState.active = true;
    dragState.pointerId = typeof event.pointerId === 'number' ? event.pointerId : null;
    dragState.mode = mode;
    dragState.lastX = event.clientX;
    dragState.lastY = event.clientY;
    backend.clearForces?.();
    if (typeof dragState.pointerId === 'number' && canvas.setPointerCapture) {
      try {
        canvas.setPointerCapture(dragState.pointerId);
      } catch {}
    }
    setPerturbState(mode, true);
  }

  function endPerturb() {
    if (!dragState.active) return;
    backend.clearForces?.();
    if (typeof dragState.pointerId === 'number' && canvas.releasePointerCapture) {
      try {
        canvas.releasePointerCapture(dragState.pointerId);
      } catch {}
    }
    dragState.active = false;
    dragState.pointerId = null;
    dragState.mode = 'idle';
    setPerturbState('idle', false);
  }

  function handleDoubleClick(event) {
    if (event.button !== 0) return;
    const hit = pickGeom(event);
    event.preventDefault();
    if (hit?.blocked === 'static') {
      showToast('Ground / static geometry cannot be selected');
      return;
    }
    if (hit) {
      updateSelection(hit);
      if (debugMode) {
        console.info('[pick] selection', hit);
      }
    } else {
      clearSelection({ toast: true });
    }
  }

  function handlePointerDown(event) {
    if (!event.isPrimary || !event.ctrlKey) return;
    if (!hasSelection()) {
      return;
    }
    const mode = event.button === 0 ? 'rotate' : event.button === 2 ? 'translate' : null;
    if (!mode) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    beginPerturb(event, mode);
  }

  function handlePointerMove(event) {
    if (!dragState.active) return;
    if (typeof dragState.pointerId === 'number' && event.pointerId !== dragState.pointerId) {
      return;
    }
    if (!event.ctrlKey) {
      endPerturb();
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    const deltaX = event.clientX - dragState.lastX;
    const deltaY = event.clientY - dragState.lastY;
    dragState.lastX = event.clientX;
    dragState.lastY = event.clientY;
    if (deltaX === 0 && deltaY === 0) return;
    applyPerturb(deltaX, deltaY);
  }

  function handlePointerUp(event) {
    if (!dragState.active) return;
    if (typeof dragState.pointerId === 'number' && event.pointerId !== dragState.pointerId) {
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    endPerturb();
  }

  function setup() {
    if (!canvas) return;
    const dbl = (event) => handleDoubleClick(event);
    const down = (event) => handlePointerDown(event);
    const move = (event) => handlePointerMove(event);
    const up = (event) => handlePointerUp(event);
    canvas.addEventListener('dblclick', dbl);
    canvas.addEventListener('pointerdown', down, { capture: true });
    canvas.addEventListener('pointermove', move, { capture: true });
    canvas.addEventListener('pointerup', up, { capture: true });
    canvas.addEventListener('pointercancel', up, { capture: true });
    cleanup.push(() => {
      canvas.removeEventListener('dblclick', dbl);
      canvas.removeEventListener('pointerdown', down, { capture: true });
      canvas.removeEventListener('pointermove', move, { capture: true });
      canvas.removeEventListener('pointerup', up, { capture: true });
      canvas.removeEventListener('pointercancel', up, { capture: true });
    });
  }

  function dispose() {
    endPerturb();
    while (cleanup.length) {
      const fn = cleanup.pop();
      try { fn(); } catch {}
    }
  }

  return {
    setup,
    dispose,
  };
}
