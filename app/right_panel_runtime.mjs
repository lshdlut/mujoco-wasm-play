import {
  getSnapshotGeoms,
  getSnapshotGroups,
} from '../core/snapshot_selectors.mjs';
import {
  isPerfEnabled,
  perfNow,
  perfSample,
} from '../core/viewer_runtime.mjs';

export function createRightPanelRuntime({ controlManager, store }) {
  if (!store || typeof store.get !== 'function') {
    throw new Error('createRightPanelRuntime: missing store');
  }
  let visibleLastFrame = false;
  let lastCtrlRef = null;
  let lastActsRef = null;
  let lastQposRef = null;
  let lastEqActiveRef = null;
  const dynamicSectionState = {
    control: { expanded: false, dirty: true },
    joint: { expanded: false, dirty: true },
    equality: { expanded: false, dirty: true },
  };
  let cachedJointDofs = [];
  let cachedJointDofsMeta = null;
  let cachedEqualityEntries = [];
  let cachedEqualityMeta = null;
  let cachedEqualityActiveRef = null;

  function reset() {
    visibleLastFrame = false;
    lastCtrlRef = null;
    lastActsRef = null;
    lastQposRef = null;
    lastEqActiveRef = null;
    for (const section of Object.values(dynamicSectionState)) {
      section.expanded = false;
      section.dirty = true;
    }
  }

  function syncDynamicSection(sectionId, panelVisible) {
    const state = dynamicSectionState[sectionId];
    if (!state) return false;
    const collapsed = store.get()?.sectionsCollapsed?.right?.[sectionId] === true;
    const expanded = !!panelVisible && !collapsed;
    if (expanded && !state.expanded) {
      state.dirty = true;
    }
    state.expanded = expanded;
    return expanded;
  }

  function deriveJointDofs(snapshot) {
    if (!snapshot) return [];
    const jtype = snapshot.jtype instanceof Int32Array
      ? snapshot.jtype
      : (Array.isArray(snapshot.jtype) ? Int32Array.from(snapshot.jtype) : null);
    const jqpos = snapshot.jnt_qposadr instanceof Int32Array
      ? snapshot.jnt_qposadr
      : (Array.isArray(snapshot.jnt_qposadr) ? Int32Array.from(snapshot.jnt_qposadr) : null);
    const jrange = snapshot.jnt_range instanceof Float64Array
      ? snapshot.jnt_range
      : (Array.isArray(snapshot.jnt_range) ? Float64Array.from(snapshot.jnt_range) : null);
    const names = Array.isArray(snapshot.jnt_names) ? snapshot.jnt_names : [];
    const qpos = snapshot.qpos instanceof Float64Array
      ? snapshot.qpos
      : (Array.isArray(snapshot.qpos) ? Float64Array.from(snapshot.qpos) : null);
    const nq = snapshot.nq | 0;
    const groupState = getSnapshotGroups(snapshot)?.joint;
    const jointGroupEnabled = Array.isArray(groupState) ? groupState.some(Boolean) : true;
    if (!jointGroupEnabled) return [];
    if (!jtype || !jqpos || !jrange) return [];

    const metaSame = !!(cachedJointDofsMeta
      && cachedJointDofsMeta.jtype === jtype
      && cachedJointDofsMeta.jqpos === jqpos
      && cachedJointDofsMeta.jrange === jrange
      && cachedJointDofsMeta.names === names
      && cachedJointDofsMeta.nq === nq);

    if (!metaSame) {
      const out = [];
      for (let i = 0; i < jtype.length; i += 1) {
        const type = jtype[i] | 0;
        if (type !== 2 && type !== 3) continue;
        const qposIndex = jqpos && i < jqpos.length ? jqpos[i] : -1;
        if (qposIndex < 0 || qposIndex >= nq) continue;
        const r0 = jrange && jrange.length >= 2 * (i + 1) ? jrange[2 * i] : null;
        const r1 = jrange && jrange.length >= 2 * (i + 1) ? jrange[2 * i + 1] : null;
        const min = Number.isFinite(r0) ? r0 : (type === 3 ? -Math.PI : -1);
        const max = Number.isFinite(r1) ? r1 : (type === 3 ? Math.PI : 1);
        const value = qpos && qpos.length > qposIndex ? qpos[qposIndex] : 0;
        const label = names[i] ? String(names[i]) : `Joint ${i}`;
        out.push({ index: qposIndex, jointIndex: i, min, max, value, label });
      }
      cachedJointDofs = out;
      cachedJointDofsMeta = { jtype, jqpos, jrange, names, nq };
      return out;
    }

    if (qpos && qpos.length) {
      for (const entry of cachedJointDofs) {
        const idx = entry.index | 0;
        if (idx >= 0 && idx < qpos.length) {
          entry.value = qpos[idx];
        }
      }
    }
    return cachedJointDofs;
  }

  function deriveEqualityList(snapshot) {
    if (!snapshot) return [];
    const eqActive = snapshot.eq_active instanceof Uint8Array
      ? snapshot.eq_active
      : (Array.isArray(snapshot.eq_active) ? Uint8Array.from(snapshot.eq_active) : null);
    if (!eqActive || !eqActive.length) return [];
    const eqType = snapshot.eq_type instanceof Int32Array
      ? snapshot.eq_type
      : (Array.isArray(snapshot.eq_type) ? Int32Array.from(snapshot.eq_type) : null);
    const eqObj1 = snapshot.eq_obj1id instanceof Int32Array
      ? snapshot.eq_obj1id
      : (Array.isArray(snapshot.eq_obj1id) ? Int32Array.from(snapshot.eq_obj1id) : null);
    const eqObj2 = snapshot.eq_obj2id instanceof Int32Array
      ? snapshot.eq_obj2id
      : (Array.isArray(snapshot.eq_obj2id) ? Int32Array.from(snapshot.eq_obj2id) : null);
    const eqObjType = snapshot.eq_objtype instanceof Int32Array
      ? snapshot.eq_objtype
      : (Array.isArray(snapshot.eq_objtype) ? Int32Array.from(snapshot.eq_objtype) : null);
    const eqNames = Array.isArray(snapshot.eq_names) ? snapshot.eq_names : null;
    const jointNames = Array.isArray(snapshot.jnt_names) ? snapshot.jnt_names : [];
    const typeLabels = ['connect', 'weld', 'joint', 'tendon', 'flex', 'contact'];

    const meta = { n: eqActive.length | 0, eqType, eqObj1, eqObj2, eqObjType, eqNames, jointNames };
    const metaSame = !!(cachedEqualityMeta
      && cachedEqualityMeta.n === meta.n
      && cachedEqualityMeta.eqType === meta.eqType
      && cachedEqualityMeta.eqObj1 === meta.eqObj1
      && cachedEqualityMeta.eqObj2 === meta.eqObj2
      && cachedEqualityMeta.eqObjType === meta.eqObjType
      && cachedEqualityMeta.eqNames === meta.eqNames
      && cachedEqualityMeta.jointNames === meta.jointNames);

    if (!metaSame) {
      const out = [];
      for (let i = 0; i < meta.n; i += 1) {
        const active = !!eqActive[i];
        const typeIndex = eqType && i < eqType.length ? (eqType[i] | 0) : -1;
        const typeName = typeIndex >= 0 && typeIndex < typeLabels.length ? typeLabels[typeIndex] : null;
        const objStride = eqObj1 && eqObj1.length >= 2 * meta.n ? 2 : 1;
        const objTypeStride = eqObjType && eqObjType.length >= 2 * meta.n ? 2 : 1;
        const obj1Id = eqObj1 ? eqObj1[(objStride * i) | 0] : -1;
        const obj2Id = eqObj2 ? eqObj2[(objStride * i) | 0] : -1;
        const objType1 = eqObjType ? eqObjType[(objTypeStride * i) | 0] : -1;
        const objType2 = eqObjType ? (eqObjType[(objTypeStride * i) + 1] ?? objType1) : objType1;
        const nameFromEq = eqNames && eqNames[i] ? String(eqNames[i]) : null;
        const name1 = objType1 === 3 && obj1Id >= 0 && obj1Id < jointNames.length
          ? String(jointNames[obj1Id] ?? '')
          : null;
        const name2 = objType2 === 3 && obj2Id >= 0 && obj2Id < jointNames.length
          ? String(jointNames[obj2Id] ?? '')
          : null;
        let label = nameFromEq || `Eq ${i}`;
        let fullLabel = label;
        if (!nameFromEq) {
          if (name1 && name2 && name1 !== name2) {
            label = typeName ? `[${typeName}] ${name1} ↔ ${name2}` : `${name1} ↔ ${name2}`;
          } else if (name1) {
            label = typeName ? `[${typeName}] ${name1}` : name1;
          } else if (typeName) {
            label = `[${typeName}] Eq ${i}`;
          }
          fullLabel = label;
        }
        out.push({ index: i, active, label, fullLabel, typeName, objType1, objType2, obj1Id, obj2Id });
      }
      cachedEqualityEntries = out;
      cachedEqualityMeta = meta;
      cachedEqualityActiveRef = eqActive;
      return out;
    }

    if (cachedEqualityActiveRef !== eqActive) {
      cachedEqualityActiveRef = eqActive;
      for (let i = 0; i < meta.n && i < cachedEqualityEntries.length; i += 1) {
        cachedEqualityEntries[i].active = !!eqActive[i];
      }
    }
    return cachedEqualityEntries;
  }

  function update(snapshot, { panelVisible }) {
    if (!panelVisible || !snapshot) {
      reset();
      return;
    }

    const panelJustOpened = !visibleLastFrame;
    visibleLastFrame = true;
    const perfEnabled = isPerfEnabled();
    const controlExpanded = syncDynamicSection('control', panelVisible);
    const jointExpanded = syncDynamicSection('joint', panelVisible);
    const equalityExpanded = syncDynamicSection('equality', panelVisible);

    const actsRef = Array.isArray(snapshot.actuators) ? snapshot.actuators : null;
    const acts = actsRef || [];
    const ctrlValues = snapshot.ctrl ?? [];
    if (panelJustOpened || lastActsRef !== actsRef || lastCtrlRef !== ctrlValues) {
      lastActsRef = actsRef;
      lastCtrlRef = ctrlValues;
      dynamicSectionState.control.dirty = true;
    }
    if (controlExpanded && dynamicSectionState.control.dirty && typeof controlManager.ensureActuatorSliders === 'function') {
      if (perfEnabled) {
        const tActsStart = perfNow();
        controlManager.ensureActuatorSliders(acts, ctrlValues);
        perfSample('main:subscriber_ensureActuatorSliders_ms', perfNow() - tActsStart);
      } else {
        controlManager.ensureActuatorSliders(acts, ctrlValues);
      }
      dynamicSectionState.control.dirty = false;
    }

    const qposRef = snapshot.qpos || null;
    if (panelJustOpened || lastQposRef !== qposRef) {
      lastQposRef = qposRef;
      dynamicSectionState.joint.dirty = true;
    }
    if (jointExpanded && dynamicSectionState.joint.dirty && typeof controlManager.ensureJointSliders === 'function') {
      const tDofsStart = perfEnabled ? perfNow() : 0;
      const dofs = deriveJointDofs(snapshot);
      if (perfEnabled) {
        perfSample('main:subscriber_deriveJointDofs_ms', perfNow() - tDofsStart, {
          ngeom: typeof snapshot?.ngeom === 'number' ? (snapshot.ngeom | 0) : null,
          hasDofs: Array.isArray(dofs) ? dofs.length : null,
        });
      }
      if (perfEnabled) {
        const tJointStart = perfNow();
        controlManager.ensureJointSliders(dofs);
        perfSample('main:subscriber_ensureJointSliders_ms', perfNow() - tJointStart);
      } else {
        controlManager.ensureJointSliders(dofs);
      }
      dynamicSectionState.joint.dirty = false;
    }

    const eqActiveRef = snapshot.eq_active || null;
    if (panelJustOpened || lastEqActiveRef !== eqActiveRef) {
      lastEqActiveRef = eqActiveRef;
      dynamicSectionState.equality.dirty = true;
    }
    if (equalityExpanded && dynamicSectionState.equality.dirty && typeof controlManager.ensureEqualityToggles === 'function') {
      const tEqStart = perfEnabled ? perfNow() : 0;
      const eqs = deriveEqualityList(snapshot);
      if (perfEnabled) {
        perfSample('main:subscriber_deriveEqualityList_ms', perfNow() - tEqStart);
      }
      if (perfEnabled) {
        const tEqToggleStart = perfNow();
        controlManager.ensureEqualityToggles(eqs);
        perfSample('main:subscriber_ensureEqualityToggles_ms', perfNow() - tEqToggleStart);
      } else {
        controlManager.ensureEqualityToggles(eqs);
      }
      dynamicSectionState.equality.dirty = false;
    }
  }

  return {
    reset,
    update,
  };
}
