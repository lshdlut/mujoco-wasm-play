import * as THREE from 'three';
import { applySpecAction } from './viewer_state.mjs';

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
  getSnapshot = null,
} = {}) {
  if (!canvas || !store || !backend || !renderCtx) {
    throw new Error('Picking controller requires canvas, store, backend, and renderCtx.');
  }
  const raycaster = new THREE_NS.Raycaster();
  const pointerNdc = new THREE_NS.Vector2();
  const pointerRaycaster = new THREE_NS.Raycaster();
  const pointerPlane = new THREE_NS.Plane();
  const pointerHit = new THREE_NS.Vector3();
  const normalMatrix = new THREE_NS.Matrix3();
  const tempQuat = new THREE_NS.Quaternion();
  const tempMat4 = new THREE_NS.Matrix4();
  const tempVecA = new THREE_NS.Vector3();
  const tempVecB = new THREE_NS.Vector3();
  const tempVecC = new THREE_NS.Vector3();
  const tempVecD = new THREE_NS.Vector3();
  const tempVecE = new THREE_NS.Vector3();
  const selectionWorld = new THREE_NS.Vector3();
  const dragState = {
    active: false,
    pointerId: null,
    mode: 'idle',
    lastX: 0,
    lastY: 0,
    lastClientX: 0,
    lastClientY: 0,
    shiftKey: false,
    payload: null,
    anchorLocal: new THREE_NS.Vector3(),
    anchorPoint: new THREE_NS.Vector3(),
    pointerTarget: new THREE_NS.Vector3(),
    bodyId: -1,
    scale: 1,
    planeNormal: new THREE_NS.Vector3(),
    planePoint: new THREE_NS.Vector3(),
    lastForceVec: new THREE_NS.Vector3(),
    lastTorqueVec: new THREE_NS.Vector3(),
    refQuat: null,
    lastRotVec: new THREE_NS.Vector3(),
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
    dragState.planeNormal.set(0, 0, 0);
    dragState.planePoint.set(0, 0, 0);
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

  function pointerToWorldTarget(clientX, clientY, referencePoint, overrideNormal = null) {
    if (!renderCtx.camera || !canvas || !referencePoint) return null;
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, rect.width || canvas.width || 1);
    const height = Math.max(1, rect.height || canvas.height || 1);
    pointerNdc.x = ((clientX - rect.left) / width) * 2 - 1;
    pointerNdc.y = -(((clientY - rect.top) / height) * 2 - 1);
    pointerRaycaster.setFromCamera(pointerNdc, renderCtx.camera);
    const normal = overrideNormal
      ? tempVecA.copy(overrideNormal).normalize()
      : tempVecA.copy(renderCtx.camera.getWorldDirection(new THREE_NS.Vector3())).normalize();
    pointerPlane.setFromNormalAndCoplanarPoint(normal, referencePoint);
    if (!pointerRaycaster.ray.intersectPlane(pointerPlane, pointerHit)) {
      return null;
    }
    return pointerHit.clone();
  }

  function refreshBodyPose(bodyId) {
    if (typeof getSnapshot !== 'function') return false;
    const snap = getSnapshot();
    const bxpos = snap?.bxpos;
    const bxmat = snap?.bxmat;
    const xipos = snap?.xipos;
    if (!snap || !bxpos || !bxmat) return false;
    if (!(bodyId >= 0)) return false;
    const posIdx = bodyId * 3;
    tempBodyPos.set(
      bxpos[posIdx + 0] ?? 0,
      bxpos[posIdx + 1] ?? 0,
      bxpos[posIdx + 2] ?? 0,
    );
    if (xipos) {
      tempBodyCom.set(
        xipos[posIdx + 0] ?? tempBodyPos.x,
        xipos[posIdx + 1] ?? tempBodyPos.y,
        xipos[posIdx + 2] ?? tempBodyPos.z,
      );
    } else {
      tempBodyCom.copy(tempBodyPos);
    }
    const rotIdx = bodyId * 9;
    for (let i = 0; i < 9; i += 1) {
      tempBodyRot[i] = bxmat[rotIdx + i] ?? 0;
    }
    return true;
  }

  function computePerturbScale(referencePoint) {
    if (!renderCtx.camera || !referencePoint) {
      return 1;
    }
    const camera = renderCtx.camera;
    const forward = tempVecA.copy(camera.getWorldDirection(new THREE_NS.Vector3()));
    if (forward.lengthSq() === 0) {
      forward.set(0, 0, 1);
    } else {
      forward.normalize();
    }
    const cameraPos = tempVecB.copy(camera.position);
    const depth = Math.max(
      1e-6,
      tempVecC.copy(referencePoint).sub(cameraPos).dot(forward),
    );
    let frustumHeight = 2;
    if (camera.isPerspectiveCamera) {
      const fovRad = THREE_NS.MathUtils.degToRad(camera.fov || 45);
      frustumHeight = 2 * Math.tan(fovRad / 2);
    } else if (camera.isOrthographicCamera) {
      frustumHeight = Math.max(1e-6, (camera.top ?? 1) - (camera.bottom ?? -1));
    }
    let scale = frustumHeight * depth;
    if (camera.isOrthographicCamera) {
      scale *= 0.15;
    }
    if (!Number.isFinite(scale) || scale <= 0) {
      scale = 1;
    }
    return scale;
  }

  function resolvePerturbAction(mode, shiftKey) {
    if (mode === 'translate') {
      return shiftKey ? 'MOVE_H' : 'MOVE_V';
    }
    if (mode === 'rotate') {
      return shiftKey ? 'ROTATE_H' : 'ROTATE_V';
    }
    return null;
  }

  function buildMouseVector(action, reldx, reldy, outVec) {
    switch (action) {
      case 'MOVE_V':
        outVec.set(reldx, 0, -reldy);
        return outVec;
      case 'MOVE_H':
        outVec.set(reldx, -reldy, 0);
        return outVec;
      case 'ROTATE_V':
        outVec.set(reldy, 0, reldx);
        return outVec;
      case 'ROTATE_H':
        outVec.set(reldy, reldx, 0);
        return outVec;
      default:
        return null;
    }
  }

  function alignVectorToCamera(vec, outVec) {
    if (!renderCtx.camera) return null;
    const camera = renderCtx.camera;
    const forward = tempVecB.copy(camera.getWorldDirection(new THREE_NS.Vector3()));
    if (forward.lengthSq() === 0) forward.set(0, 0, 1);
    forward.normalize();
    const planar = tempVecC.set(forward.x, forward.y, 0);
    const planarLen = planar.length();
    if (planarLen < 1e-12) {
      return null; // avoid arbitrary fallback that flips direction
    }
    planar.multiplyScalar(1 / planarLen);
    const yAxis = tempVecE.copy(planar); // forward-aligned y-axis
    const xAxis = tempVecD.set(yAxis.y, -yAxis.x, 0); // perpendicular in XY
    outVec.set(0, 0, vec.z);
    outVec.addScaledVector(xAxis, vec.x);
    outVec.addScaledVector(yAxis, vec.y);
    return outVec;
  }

  function applyPointerDelta(deltaX, deltaY) {
    if (!dragState.active || !canvas) return;
    const rect = typeof canvas.getBoundingClientRect === 'function'
      ? canvas.getBoundingClientRect()
      : { width: 1, height: 1 };
    const height = Math.max(1, rect.height || 1);
    // Match simulate: positive mouse-up yields positive reldy (see mjv_movePerturb call site).
    const reldx = deltaX / height;
    const reldy = -deltaY / height;
    if (!Number.isFinite(reldx) || !Number.isFinite(reldy)) return;
    const action = resolvePerturbAction(dragState.mode, dragState.shiftKey);
    if (!action) return;
    const mouseVec = buildMouseVector(action, reldx, reldy, tempVecLocal);
    if (!mouseVec) return;
    const worldVec = alignVectorToCamera(mouseVec, tempVecWorld);
    if (!worldVec) return;
    const scale = dragState.scale || computePerturbScale(dragState.anchorPoint);
    if (dragState.mode === 'rotate') {
      // Keep the raw convert2D-aligned vector for rotation magnitude; do NOT scale by depth.
      dragState.lastRotVec.copy(worldVec);
      const scl = worldVec.length();
      if (scl > 0) {
        const axis = worldVec.clone().normalize();
        const angle = scl * Math.PI * 2;
        dragState.lastTorqueVec.copy(axis).multiplyScalar(angle);
      } else {
        dragState.lastTorqueVec.set(0, 0, 0);
      }
      // Rotate模式不移动锚点/指示点，保持与 simulate 一致（仅改变 refquat）。
    } else {
      dragState.pointerTarget.addScaledVector(worldVec, scale);
    }
  }

  function applyRotation(mat, vec, out) {
    out.set(
      mat[0] * vec.x + mat[1] * vec.y + mat[2] * vec.z,
      mat[3] * vec.x + mat[4] * vec.y + mat[5] * vec.z,
      mat[6] * vec.x + mat[7] * vec.y + mat[8] * vec.z,
    );
    return out;
  }

  function applyRotationTranspose(mat, vec, out) {
    out.set(
      mat[0] * vec.x + mat[3] * vec.y + mat[6] * vec.z,
      mat[1] * vec.x + mat[4] * vec.y + mat[7] * vec.z,
      mat[2] * vec.x + mat[5] * vec.y + mat[8] * vec.z,
    );
    return out;
  }

  function setAnchorLocalFromWorld(bodyId, worldPoint) {
    if (!refreshBodyPose(bodyId)) return false;
    tempVecLocal.copy(worldPoint).sub(tempBodyPos);
    applyRotationTranspose(tempBodyRot, tempVecLocal, dragState.anchorLocal);
    dragState.bodyId = bodyId;
    return true;
  }

  function updateAnchorWorldFromLocal(outVec) {
    if (!refreshBodyPose(dragState.bodyId)) return false;
    applyRotation(tempBodyRot, dragState.anchorLocal, outVec);
    outVec.add(tempBodyPos);
    return true;
  }

  function samplePointerFromScreen() {
    if (!dragState.active || typeof dragState.lastClientX !== 'number') return false;
    // For rotate perturb, always drive the gizmo and refQuat from 2D mouse deltas
    // via applyPointerDelta so that behavior matches simulate's mjv_movePerturb,
    // which uses convert2D rather than ray-plane intersection.
    if (dragState.mode === 'rotate') {
      return false;
    }
    const planePoint = dragState.planePoint.lengthSq() > 0
      ? dragState.planePoint
      : dragState.anchorPoint;
    const planeNormal = dragState.planeNormal.lengthSq() > 0
      ? dragState.planeNormal
      : (renderCtx.camera?.getWorldDirection(new THREE_NS.Vector3()).normalize() || globalUp.clone());
    const target = pointerToWorldTarget(
      dragState.lastClientX,
      dragState.lastClientY,
      planePoint,
      planeNormal,
    );
    if (target) {
      dragState.pointerTarget.copy(target);
      return true;
    }
    return false;
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

  function updatePerturbViz({ active, mode, anchor, cursor, force, torque }) {
    try {
      store.update((draft) => {
        if (!draft.runtime) draft.runtime = {};
        draft.runtime.pertViz = {
          active: !!active,
          mode: String(mode || dragState.mode || 'idle'),
          anchor: Array.isArray(anchor) ? anchor : [anchor?.x || 0, anchor?.y || 0, anchor?.z || 0],
          cursor: Array.isArray(cursor) ? cursor : [cursor?.x || 0, cursor?.y || 0, cursor?.z || 0],
          force: Array.isArray(force) ? force : (force ? [force.x || 0, force.y || 0, force.z || 0] : null),
          torque: Array.isArray(torque) ? torque : (torque ? [torque.x || 0, torque.y || 0, torque.z || 0] : null),
          ts: Date.now(),
        };
      });
    } catch {}
  }

  function dispatchPerturbState(payload) {
    if (!payload) return;
    if (typeof backend.applyPerturb === 'function') {
      backend.applyPerturb(payload);
    } else if (Number.isFinite(payload.bodyId) && payload.bodyId >= 0 && typeof backend.applyBodyForce === 'function') {
      backend.applyBodyForce(payload);
    } else if (Number.isFinite(payload.geomIndex) && payload.geomIndex >= 0) {
      backend.applyForce?.(payload);
    }
  }

  function applyPerturb(fromLoop = false) {
    const selection = currentSelection();
    if (!selection || selection.geom < 0) return false;
    const geomIndex = selection.geom | 0;
    const camera = renderCtx.camera;
    if (!camera) return false;
    const bodyCapable = Number.isFinite(dragState.bodyId) && dragState.bodyId >= 0 && refreshBodyPose(dragState.bodyId);
    if (bodyCapable) {
      applyRotation(tempBodyRot, dragState.anchorLocal, dragState.anchorPoint);
      dragState.anchorPoint.add(tempBodyPos);
    } else if (!resolveSelectionWorldPoint(selection, dragState.anchorPoint)) {
      return false;
    }
    dragState.scale = computePerturbScale(dragState.anchorPoint);
    samplePointerFromScreen();
    const target = dragState.pointerTarget;
    if (!target) return false;
    const mode = dragState.mode === 'rotate' ? 'rotate' : 'translate';
    const payload = {
      bodyId: bodyCapable ? dragState.bodyId : -1,
      geomIndex: bodyCapable ? -1 : geomIndex,
      mode,
      anchor: [dragState.anchorPoint.x, dragState.anchorPoint.y, dragState.anchorPoint.z],
      cursor: mode === 'rotate'
        ? [dragState.anchorPoint.x, dragState.anchorPoint.y, dragState.anchorPoint.z]
        : [target.x, target.y, target.z],
    };
    if (mode === 'rotate' && !fromLoop) {
      payload.rotVec = [
        dragState.lastRotVec.x,
        dragState.lastRotVec.y,
        dragState.lastRotVec.z,
      ];
    }
    dragState.payload = payload;
    setPerturbState(mode, true);
    dispatchPerturbState(payload);
    const offsetVec = tempVecWorld.copy(dragState.pointerTarget).sub(dragState.anchorPoint);
    const vizForce = mode === 'translate' ? offsetVec : null;
    const vizTorque = mode === 'rotate'
      ? (dragState.lastTorqueVec.lengthSq() > 0 ? dragState.lastTorqueVec.clone() : offsetVec)
      : null;
    updatePerturbViz({
      active: true,
      mode,
      anchor: dragState.anchorPoint,
      cursor: dragState.pointerTarget,
      force: vizForce,
      torque: vizTorque,
    });
    return true;
  }

  function beginPerturb(event, mode) {
    dragState.active = true;
    dragState.pointerId = typeof event.pointerId === 'number' ? event.pointerId : null;
    dragState.mode = mode;
    dragState.lastX = event.clientX;
    dragState.lastY = event.clientY;
    dragState.lastClientX = event.clientX;
    dragState.lastClientY = event.clientY;
    dragState.shiftKey = !!event.shiftKey;
    dragState.payload = null;
    if (!updateAnchorWorldFromLocal(dragState.anchorPoint)) {
      resolveSelectionWorldPoint(currentSelection(), dragState.anchorPoint);
    }
    dragState.scale = computePerturbScale(dragState.anchorPoint);
    const cameraForward = renderCtx.camera?.getWorldDirection(new THREE_NS.Vector3()).normalize() || globalUp.clone();
    dragState.planeNormal.copy(cameraForward);
    dragState.planePoint.copy(dragState.anchorPoint);
    if (!samplePointerFromScreen()) {
      dragState.pointerTarget.copy(dragState.anchorPoint);
    }
    // Initialize reference orientation for rotate perturb using current body pose
    if (mode === 'rotate') {
      dragState.refQuat = null;
      const sel = currentSelection();
      const geomIndex = sel?.geom;
      const mesh = Number.isInteger(geomIndex) && geomIndex >= 0 && Array.isArray(renderCtx.meshes)
        ? renderCtx.meshes[geomIndex]
        : null;
      if (mesh && mesh.quaternion) {
        dragState.refQuat = mesh.quaternion.clone();
      } else if (refreshBodyPose(dragState.bodyId)) {
        tempMat4.identity();
        tempMat4.makeBasis(
          new THREE_NS.Vector3(tempBodyRot[0], tempBodyRot[3], tempBodyRot[6]),
          new THREE_NS.Vector3(tempBodyRot[1], tempBodyRot[4], tempBodyRot[7]),
          new THREE_NS.Vector3(tempBodyRot[2], tempBodyRot[5], tempBodyRot[8]),
        );
        dragState.refQuat = new THREE_NS.Quaternion().setFromRotationMatrix(tempMat4);
      }
      dragState.lastTorqueVec.set(0, 0, 0);
      dragState.lastRotVec.set(0, 0, 0);
    } else {
      dragState.refQuat = null;
      dragState.lastTorqueVec.set(0, 0, 0);
      dragState.lastRotVec.set(0, 0, 0);
    }
    backend.clearForces?.();
    if (typeof dragState.pointerId === 'number' && canvas.setPointerCapture) {
      try {
        canvas.setPointerCapture(dragState.pointerId);
      } catch {}
    }
    setPerturbState(mode, true);
    updatePerturbViz({ active: true, mode, anchor: dragState.anchorPoint, cursor: dragState.pointerTarget, force: null, torque: null });
  }

  function endPerturb() {
    if (!dragState.active) return;
    backend.clearForces?.();
    dragState.payload = null;
    dragState.lastForceVec.set(0, 0, 0);
    dragState.lastTorqueVec.set(0, 0, 0);
    dragState.lastRotVec.set(0, 0, 0);
    dragState.pointerTarget.copy(dragState.anchorPoint);
    dragState.planeNormal.set(0, 0, 0);
    dragState.planePoint.set(0, 0, 0);
    dragState.lastForceVec.set(0, 0, 0);
    dragState.lastTorqueVec.set(0, 0, 0);
    if (typeof dragState.pointerId === 'number' && canvas.releasePointerCapture) {
      try {
        canvas.releasePointerCapture(dragState.pointerId);
      } catch {}
    }
    dragState.active = false;
    dragState.pointerId = null;
    dragState.mode = 'idle';
    setPerturbState('idle', false);
    updatePerturbViz({ active: false, mode: 'idle', anchor: dragState.anchorPoint, cursor: dragState.pointerTarget, force: null, torque: null });
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
  function centerCameraOnHit(hit) {
    if (!hit || !hit.worldPoint || !renderCtx?.camera) return;
    const camera = renderCtx.camera;
    if (!camera) return;
    const target = renderCtx.cameraTarget || new THREE_NS.Vector3(0, 0, 0);
    if (!renderCtx.cameraTarget) {
      renderCtx.cameraTarget = target;
    }
    tempCameraOffset.copy(camera.position).sub(target);
    target.set(hit.worldPoint.x, hit.worldPoint.y, hit.worldPoint.z);
    camera.position.copy(target).add(tempCameraOffset);
    camera.lookAt(target);
    const ts = Date.now();
    store.update((draft) => {
      if (!draft.runtime) draft.runtime = draft.runtime || {};
      draft.runtime.lastAction = 'camera-center';
      draft.toast = { message: `Camera centered on ${hit.geomName}`, ts };
    });
  }

  function trackingCameraFromHit(hit) {
    if (!hit) return;
    const geomIndex = hit.geomIndex | 0;
    const trackingCtrl = {
      item_id: 'rendering.tracking_geom',
      type: 'select',
      label: 'Tracking geom',
      binding: 'Simulate::tracking_geom',
      default: -1,
    };
    const cameraCtrl = {
      item_id: 'rendering.camera_mode',
      type: 'select',
      label: 'Camera',
      binding: 'Simulate::camera',
      default: 0,
    };
    Promise.resolve(
      applySpecAction(store, backend, trackingCtrl, geomIndex),
    )
      .then(() => applySpecAction(store, backend, cameraCtrl, 1))
      .catch((err) => {
        console.warn('[pick] tracking camera apply failed', err);
      });
    const ts = Date.now();
    store.update((draft) => {
      if (!draft.runtime) draft.runtime = draft.runtime || {};
      draft.runtime.lastAction = 'camera-track';
      draft.toast = { message: `Tracking ${hit.geomName}`, ts };
    });
  }

  function maybeHandleRightDoubleCamera(event) {
    if (event.button !== 2) return false;
    const now = (typeof performance !== 'undefined' && performance.now)
      ? performance.now()
      : Date.now();
    const dt = now - lastRightDownTime;
    const ctrl = !!event.ctrlKey;
    const sameChord = ctrl === lastRightDownCtrl;
    lastRightDownTime = now;
    lastRightDownCtrl = ctrl;
    if (!sameChord || dt > 350) {
      return false;
    }
    const hit = pickGeom(event);
    event.preventDefault();
    event.stopImmediatePropagation();
    if (hit?.blocked === 'static') {
      showToast('Ground / static geometry cannot be used for camera focus');
      return true;
    }
    if (!hit) return true;
    if (ctrl) {
      trackingCameraFromHit(hit);
    } else {
      centerCameraOnHit(hit);
    }
    return true;
  }

  function handlePointerDown(event) {
    if (maybeHandleRightDoubleCamera(event)) return;
    if (!event.isPrimary || !event.ctrlKey) return;
    if (!hasSelection()) {
      return;
    }
    const mode = event.button === 0 && !event.altKey
      ? 'rotate'
      : (event.button === 2 || (event.button === 0 && event.altKey))
        ? 'translate'
        : null;
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
    dragState.shiftKey = !!event.shiftKey;
    const prevX = dragState.lastX;
    const prevY = dragState.lastY;
    dragState.lastX = event.clientX;
    dragState.lastY = event.clientY;
    dragState.lastClientX = event.clientX;
    dragState.lastClientY = event.clientY;
    if (renderCtx.camera) {
      dragState.planeNormal.copy(renderCtx.camera.getWorldDirection(new THREE_NS.Vector3()).normalize());
    }
    if (!samplePointerFromScreen()) {
      const deltaX = Number.isFinite(prevX) ? event.clientX - prevX : 0;
      const deltaY = Number.isFinite(prevY) ? event.clientY - prevY : 0;
      applyPointerDelta(deltaX, deltaY);
    }
    applyPerturb();
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
