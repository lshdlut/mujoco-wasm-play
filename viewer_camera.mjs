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
 * Deprecated: applyGesture(store, backend, event) — prefer onGesture(event) at call site.
 */
export function createCameraController({
  THREE_NS,
  canvas,
  store,
  backend,
  applyGesture,
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
  let warnedUpDrift = false;
  let warnedApplyGesture = false;

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
    // Priority: explicit minDistance > dynamic getMinDistance
    if (Number.isFinite(minDistance)) return Math.max(0.01, Number(minDistance));
    if (typeof getMinDistance === 'function') {
      const v = Number(getMinDistance(camera, target, renderCtx));
      if (Number.isFinite(v) && v > 0) return Math.max(0.01, v);
    }
    // default fallback that does not read bounds: keep legacy feel (0.25 * 0.6)
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
    // Optional: enforce camera.up invariant
    if (assertUp && renderCtx?.camera) {
      try {
        const dot = renderCtx.camera.up.clone().normalize().dot(up0);
        if (dot < 0.999) {
          renderCtx.camera.up.copy(upNormalised);
          if (!warnedUpDrift && debugMode) {
            console.warn('[camera] up drift corrected');
            warnedUpDrift = true;
          }
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
        const forward = tempVecB; // world forward
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
        // First-person style: rotate view direction around camera, keep position
        // and update cameraTarget at same distance.
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
        // clamp polar angle to avoid singularities
        const eps = 0.05;
        let phi = Math.acos(THREE_NS.MathUtils.clamp(forward.dot(up), -1, 1));
        const minPhi = eps;
        const maxPhi = Math.PI - eps;
        if (phi < minPhi || phi > maxPhi) {
          const phiClamped = THREE_NS.MathUtils.clamp(phi, minPhi, maxPhi);
          // rebuild forward from its projection on the horizontal plane
          const horiz = forward.clone().sub(up.clone().multiplyScalar(forward.dot(up)));
          if (horiz.lengthSq() < 1e-12) {
            // choose an arbitrary horizontal axis orthogonal to up
            horiz.copy(new THREE_NS.Vector3(1, 0, 0).cross(up)).normalize();
            if (horiz.lengthSq() < 1e-12) horiz.copy(new THREE_NS.Vector3(0, 1, 0).cross(up)).normalize();
          } else {
            horiz.normalize();
          }
          forward.copy(horiz.multiplyScalar(Math.sin(phiClamped)).add(up.clone().multiplyScalar(Math.cos(phiClamped))));
        }
        const distSafe = Number.isFinite(distance) && distance > 0 ? Math.max(distance, minDist) : minDist;
        const newTarget = camera.position.clone().add(forward.multiplyScalar(distSafe));
        target.copy(newTarget);
        camera.lookAt(target);
        break;
      }
      case 'orbit':
      default: {
        let yaw = (1.6 * Math.PI * dx) / elementWidth;
        let pitch = (1.6 * Math.PI * (invertY ? -dy : dy)) / elementHeight;
        if (distance <= minDist * 1.05) {
          yaw *= 0.35;
          pitch *= 0.35;
        }
        const up = tempVecD.copy(upNormalised);
        // rotate offset around global up (yaw)
        offset.applyAxisAngle(up, -yaw);
        // rotate around local right (pitch)
        const right = tempVecB.copy(up).cross(offset).normalize();
        offset.applyAxisAngle(right, -pitch);
        // clamp polar angle
        const eps = 0.05;
        const r = offset.length();
        const offNorm = tempVecC.copy(offset).normalize();
        let phi = Math.acos(THREE_NS.MathUtils.clamp(offNorm.dot(up), -1, 1));
        const minPhi = eps;
        const maxPhi = Math.PI - eps;
        if (phi < minPhi || phi > maxPhi) {
          const phiClamped = THREE_NS.MathUtils.clamp(phi, minPhi, maxPhi);
          const horiz = offNorm.clone().sub(up.clone().multiplyScalar(offNorm.dot(up)));
          if (horiz.lengthSq() < 1e-12) {
            horiz.copy(new THREE_NS.Vector3(1, 0, 0).cross(up)).normalize();
            if (horiz.lengthSq() < 1e-12) horiz.copy(new THREE_NS.Vector3(0, 1, 0).cross(up)).normalize();
          } else {
            horiz.normalize();
          }
          offset.copy(horiz.multiplyScalar(Math.sin(phiClamped) * r).add(up.clone().multiplyScalar(Math.cos(phiClamped) * r)));
        }
        if (offset.length() < minDist) offset.setLength(minDist);
        camera.position.copy(tempVecD.copy(target).add(offset));
        camera.lookAt(target);
        break;
      }
    }

    if (cameraModeIndex() === 1) {
      syncTrackingOffsetFromCamera();
    }
    if (debugMode) {
      try {
        console.log('[camera] gesture', {
          mode,
          dx,
          dy,
          position: camera.position.toArray().map((v) => Number(v.toFixed(3))),
          target: target.toArray().map((v) => Number(v.toFixed(3))),
        });
      } catch {}
    }
  }

  function syncTrackingOffsetFromCamera() {
    if (cameraModeIndex() !== 1) return;
    if (!renderCtx?.camera || !renderCtx.cameraTarget) return;
    if (!renderCtx.trackingOffset) {
      renderCtx.trackingOffset = new THREE_NS.Vector3();
    }
    renderCtx.trackingOffset.copy(renderCtx.camera.position).sub(renderCtx.cameraTarget);
    renderCtx.trackingRadius = Math.max(1e-6, renderCtx.trackingOffset.length());
  }

  function beginGesture(event) {
    if (!isInteractiveCamera()) return;
    pointerState.id = typeof event.pointerId === 'number' ? event.pointerId : null;
    pointerState.mode = resolveGestureMode(event);
    pointerState.lastX = event.clientX ?? 0;
    pointerState.lastY = event.clientY ?? 0;
    pointerState.active = true;
    // focus canvas/root to receive key events locally
    try { (keyRoot || canvas)?.focus?.(); } catch {}
    if (typeof event.pointerId === 'number' && canvas?.setPointerCapture) {
      try {
        canvas.setPointerCapture(event.pointerId);
      } catch {}
    }
    if (applyGesture && isInteractiveCamera()) {
      if (!warnedApplyGesture) {
        try { console.warn('[camera] applyGesture is deprecated; prefer onGesture(event)'); } catch {}
        warnedApplyGesture = true;
      }
      applyGesture(store, backend, {
        mode: pointerState.mode,
        phase: 'start',
        pointer: {
          x: pointerState.lastX,
          y: pointerState.lastY,
          dx: 0,
          dy: 0,
          buttons: pointerButtons(event),
          pressure: Number(event?.pressure ?? 0),
        },
      });
    }
  }

  function moveGesture(event) {
    if (!pointerState.active || !isInteractiveCamera()) return;
    if (typeof event.pointerId === 'number' && pointerState.id !== null && event.pointerId !== pointerState.id) {
      return;
    }
    const currentX = event.clientX ?? pointerState.lastX ?? 0;
    const currentY = event.clientY ?? pointerState.lastY ?? 0;
    const prevX = pointerState.lastX ?? currentX;
    const prevY = pointerState.lastY ?? currentY;
    pointerState.lastX = currentX;
    pointerState.lastY = currentY;
    applyCameraGesture(pointerState.mode, currentX - prevX, currentY - prevY);
    if (applyGesture && isInteractiveCamera()) {
      applyGesture(store, backend, {
        mode: pointerState.mode,
        phase: 'move',
        pointer: {
          x: currentX,
          y: currentY,
          dx: currentX - prevX,
          dy: currentY - prevY,
          buttons: pointerButtons(event),
          pressure: Number(event?.pressure ?? 0),
        },
      });
    }
  }

  function endGesture(event, { releaseCapture = true } = {}) {
    if (!pointerState.active) return;
    const pointerId =
      typeof event?.pointerId === 'number'
        ? event.pointerId
        : pointerState.id !== null
        ? pointerState.id
        : undefined;
    if (
      typeof pointerId === 'number' &&
      pointerState.id !== null &&
      pointerId !== pointerState.id
    ) {
      return;
    }
    const currentX =
      typeof event?.clientX === 'number' ? event.clientX : pointerState.lastX ?? 0;
    const currentY =
      typeof event?.clientY === 'number' ? event.clientY : pointerState.lastY ?? 0;

    if (applyGesture && isInteractiveCamera()) {
      applyGesture(store, backend, {
        mode: pointerState.mode,
        phase: 'end',
        pointer: {
          x: currentX,
          y: currentY,
          dx: 0,
          dy: 0,
          buttons: pointerButtons(event),
          pressure: Number(event?.pressure ?? 0),
        },
      });
    }

    if (releaseCapture && typeof pointerId === 'number' && canvas?.releasePointerCapture) {
      try {
        canvas.releasePointerCapture(pointerId);
      } catch {}
    }
    pointerState.id = null;
    pointerState.mode = 'idle';
    pointerState.lastX = null;
    pointerState.lastY = null;
    pointerState.active = false;
  }

  function attachWindowListeners() {
    // Scope keyboard to canvas (or provided root) to avoid cross-instance coupling
    const root = keyRoot || canvas;
    if (!root) return;
    // ensure focusable
    try {
      if (typeof root.tabIndex !== 'number' || root.tabIndex < 0) {
        root.tabIndex = 0;
      }
    } catch {}

    const keydown = (event) => {
      if (event.key === 'Control' || event.ctrlKey) modifierState.ctrl = true;
      if (event.key === 'Shift' || event.shiftKey) modifierState.shift = true;
      if (event.key === 'Alt' || event.altKey) modifierState.alt = true;
      if (event.key === 'Meta' || event.metaKey) modifierState.meta = true;
    };
    const keyup = (event) => {
      if (!event.ctrlKey || event.key === 'Control') modifierState.ctrl = false;
      if (!event.shiftKey || event.key === 'Shift') modifierState.shift = false;
      if (!event.altKey || event.key === 'Alt') modifierState.alt = false;
      if (!event.metaKey || event.key === 'Meta') modifierState.meta = false;
    };
    const clearMods = () => {
      modifierState.ctrl = false;
      modifierState.shift = false;
      modifierState.alt = false;
      modifierState.meta = false;
    };

    root.addEventListener('keydown', keydown, { capture: true });
    root.addEventListener('keyup', keyup, { capture: true });
    root.addEventListener('focusout', clearMods, { capture: true });

    cleanup.push(() => {
      try { root.removeEventListener('keydown', keydown, { capture: true }); } catch {}
      try { root.removeEventListener('keyup', keyup, { capture: true }); } catch {}
      try { root.removeEventListener('focusout', clearMods, { capture: true }); } catch {}
    });
  }

  function attachCanvasListeners() {
    if (!canvas) return;
    const pointerOptions = { passive: false };
    const pointerHandlers = {
      pointerdown: (event) => {
        event.preventDefault();
        beginGesture(event);
      },
      pointermove: (event) => {
        if (!pointerState.active) return;
        event.preventDefault();
        // keep modifier state in sync with live event to avoid stale keys
        try {
          modifierState.ctrl = !!event.ctrlKey;
          modifierState.shift = !!event.shiftKey;
          modifierState.alt = !!event.altKey;
          modifierState.meta = !!event.metaKey;
        } catch {}
        moveGesture(event);
      },
      pointerup: (event) => {
        event.preventDefault();
        endGesture(event);
      },
      pointercancel: (event) => {
        endGesture(event);
      },
    };

    Object.entries(pointerHandlers).forEach(([type, handler]) => {
      canvas.addEventListener(type, handler, pointerOptions);
      cleanup.push(() => canvas.removeEventListener(type, handler, pointerOptions));
    });

    const lostPointerCapture = () => {
      if (!pointerState.active) return;
      endGesture(undefined, { releaseCapture: false });
    };
    canvas.addEventListener('lostpointercapture', lostPointerCapture);
    cleanup.push(() => canvas.removeEventListener('lostpointercapture', lostPointerCapture));

    const wheelHandler = (event) => {
      if (!isInteractiveCamera()) return;
      if (!renderCtx?.camera) return;
      event.preventDefault();
      const DOM_DELTA = { 0: 1, 1: wheelLineFactor, 2: wheelPageFactor };
      const unit = DOM_DELTA[event.deltaMode] ?? 1;
      let dy = Number(event.deltaY) * unit;
      if (!Number.isFinite(dy) || dy === 0) return;
      let scaled = dy * (Number.isFinite(zoomK) ? zoomK : 0.35);
      if (Number.isFinite(maxWheelStep)) {
        const lim = Math.abs(maxWheelStep);
        if (lim > 0) {
          scaled = THREE_NS.MathUtils.clamp(scaled, -lim, lim);
        }
      }
      applyCameraGesture('zoom', 0, scaled);
    };
    canvas.addEventListener('wheel', wheelHandler, { passive: false });
    cleanup.push(() => canvas.removeEventListener('wheel', wheelHandler, { passive: false }));

    const contextMenuHandler = (event) => {
      event.preventDefault();
    };
    canvas.addEventListener('contextmenu', contextMenuHandler);
    cleanup.push(() => canvas.removeEventListener('contextmenu', contextMenuHandler));

    // Pointer-only path retained; legacy Mouse handlers removed to reduce duplication
  }

  function setup() {
    if (initialised) return;
    // set camera up once
    try {
      if (renderCtx?.camera) {
        upNormalised.copy(globalUp).normalize();
        renderCtx.camera.up.copy(upNormalised);
        up0 = upNormalised.clone();
      }
    } catch {}
    attachWindowListeners();
    attachCanvasListeners();
    initialised = true;
  }

  function dispose() {
    while (cleanup.length) {
      const fn = cleanup.pop();
      try {
        fn();
      } catch {}
    }
    pointerState.id = null;
    pointerState.mode = 'idle';
    pointerState.lastX = null;
    pointerState.lastY = null;
    pointerState.active = false;
    initialised = false;
  }

  return {
    setup,
    dispose,
  };
}
