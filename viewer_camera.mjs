export function createCameraController({
  THREE_NS,
  canvas,
  store,
  backend,
  applyGesture,
  renderCtx,
  debugMode = false,
  globalUp = new THREE_NS.Vector3(0, 0, 1),
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

  function applyCameraGesture(mode, dx, dy) {
    const ctx = renderCtx;
    const camera = ctx.camera;
    if (!camera) return;
    if (!ctx.cameraTarget) {
      ctx.cameraTarget = new THREE_NS.Vector3(0, 0, 0);
    }
    const target = ctx.cameraTarget;
    const distance = tempVecA.copy(camera.position).sub(target).length();
    const radius = Math.max(ctx.bounds?.radius || 0, 0.6);
    const offset = tempVecA.copy(camera.position).sub(target);
    const elementWidth = canvas?.clientWidth || (typeof window !== 'undefined' ? window.innerWidth : 1) || 1;
    const elementHeight =
      canvas?.clientHeight || (typeof window !== 'undefined' ? window.innerHeight : 1) || 1;
    const toRadians = THREE_NS.MathUtils.degToRad(camera.fov || 45);

    switch (mode) {
      case 'translate': {
        const panScale = distance * Math.tan(toRadians / 2);
        const moveX = (-2 * dx * panScale) / elementHeight;
        const moveY = (2 * dy * panScale) / elementHeight;
        const forward = tempVecB;
        camera.getWorldDirection(forward).normalize();
        const up = tempVecD.copy(globalUp);
        const right = tempVecC.copy(forward).cross(up).normalize();
        const pan = right.multiplyScalar(moveX).add(up.multiplyScalar(moveY));
        camera.position.add(pan);
        target.add(pan);
        camera.up.copy(globalUp);
        camera.lookAt(target);
        break;
      }
      case 'zoom': {
        const zoomSpeed = distance * 0.002;
        const delta = dy * zoomSpeed;
        const newLen = Math.max(radius * 0.25, distance + delta);
        offset.setLength(newLen);
        camera.position.copy(tempVecC.copy(target).add(offset));
        camera.up.copy(globalUp);
        camera.lookAt(target);
        break;
      }
      case 'rotate':
      case 'orbit':
      default: {
        const yaw = (1.6 * Math.PI * dx) / elementWidth;
        const pitch = (1.6 * Math.PI * dy) / elementHeight;
        const orbitOffset = tempVecC.set(offset.x, offset.z, -offset.y);
        tempSpherical.setFromVector3(orbitOffset);
        tempSpherical.theta -= yaw;
        tempSpherical.phi = THREE_NS.MathUtils.clamp(
          tempSpherical.phi - pitch,
          0.05,
          Math.PI - 0.05,
        );
        orbitOffset.setFromSpherical(tempSpherical);
        offset.set(orbitOffset.x, -orbitOffset.z, orbitOffset.y);
        camera.position.copy(tempVecD.copy(target).add(offset));
        camera.up.copy(globalUp);
        camera.lookAt(target);
        break;
      }
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

  function beginGesture(event) {
    pointerState.id = typeof event.pointerId === 'number' ? event.pointerId : null;
    pointerState.mode = resolveGestureMode(event);
    pointerState.lastX = event.clientX ?? 0;
    pointerState.lastY = event.clientY ?? 0;
    pointerState.active = true;
    if (typeof event.pointerId === 'number' && canvas?.setPointerCapture) {
      try {
        canvas.setPointerCapture(event.pointerId);
      } catch {}
    }
    if (applyGesture) {
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
    if (!pointerState.active) return;
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
    if (applyGesture) {
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

    if (applyGesture) {
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
    if (typeof window === 'undefined') return;

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
    const blur = () => {
      modifierState.ctrl = false;
      modifierState.shift = false;
      modifierState.alt = false;
      modifierState.meta = false;
    };

    window.addEventListener('keydown', keydown, { capture: true });
    window.addEventListener('keyup', keyup, { capture: true });
    window.addEventListener('blur', blur, { capture: true });

    cleanup.push(() => {
      window.removeEventListener('keydown', keydown, { capture: true });
      window.removeEventListener('keyup', keyup, { capture: true });
      window.removeEventListener('blur', blur, { capture: true });
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
      if (!renderCtx?.camera) return;
      event.preventDefault();
      const delta = event.deltaY;
      if (!Number.isFinite(delta) || delta === 0) return;
      const direction = delta > 0 ? 1 : -1;
      applyCameraGesture('zoom', 0, direction * Math.abs(delta) * 0.35);
    };
    canvas.addEventListener('wheel', wheelHandler, { passive: false });
    cleanup.push(() => canvas.removeEventListener('wheel', wheelHandler, { passive: false }));

    const contextMenuHandler = (event) => {
      event.preventDefault();
    };
    canvas.addEventListener('contextmenu', contextMenuHandler);
    cleanup.push(() => canvas.removeEventListener('contextmenu', contextMenuHandler));

    const mouseHandlers = {
      mousedown: (event) => {
        if (pointerState.active) return;
        pointerHandlers.pointerdown(event);
      },
      mousemove: (event) => {
        if (!pointerState.active) return;
        pointerHandlers.pointermove(event);
      },
      mouseup: (event) => {
        if (!pointerState.active) return;
        pointerHandlers.pointerup(event);
      },
    };

    Object.entries(mouseHandlers).forEach(([type, handler]) => {
      canvas.addEventListener(type, handler, { passive: false });
      cleanup.push(() => canvas.removeEventListener(type, handler, { passive: false }));
    });
  }

  function setup() {
    if (initialised) return;
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
