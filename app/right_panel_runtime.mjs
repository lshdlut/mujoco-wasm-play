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
  let lastActuatorSource = null;
  let lastJointSource = null;
  let lastEqualitySource = null;
  const dynamicSectionState = {
    control: { expanded: false, dirty: true },
    joint: { expanded: false, dirty: true },
    equality: { expanded: false, dirty: true },
  };
  let cachedJointDofs = [];
  let cachedJointDofsMeta = null;
  let cachedActuatorMetaRef = null;
  let cachedActuatorMetaKey = '';
  let cachedEqualityEntries = [];
  let cachedEqualityMeta = null;
  let cachedEqualityActiveRef = null;

  function reset() {
    visibleLastFrame = false;
    lastActuatorSource = null;
    lastJointSource = null;
    lastEqualitySource = null;
    cachedActuatorMetaRef = null;
    cachedActuatorMetaKey = '';
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

  function sameSource(prev, next) {
    if (!prev || !next) return false;
    const keys = Object.keys(next);
    for (const key of keys) {
      if (prev[key] !== next[key]) return false;
    }
    return true;
  }

  function buildJointSource(snapshot) {
    const groupState = getSnapshotGroups(snapshot)?.joint;
    const groupKey = Array.isArray(groupState) ? groupState.map((enabled) => (enabled ? '1' : '0')).join('') : '';
    return {
      qpos: snapshot?.qpos || null,
      groupKey,
      jtype: snapshot?.jtype || null,
      jqpos: snapshot?.jnt_qposadr || null,
      jrange: snapshot?.jnt_range || null,
      names: Array.isArray(snapshot?.jnt_names) ? snapshot.jnt_names : null,
      nq: snapshot?.nq | 0,
    };
  }

  function buildActuatorSource(snapshot) {
    const actuators = Array.isArray(snapshot?.actuators) ? snapshot.actuators : null;
    const count = Array.isArray(actuators) ? (actuators.length | 0) : 0;
    let metadataKey = '';
    if (count > 0) {
      if (cachedActuatorMetaRef === actuators) {
        metadataKey = cachedActuatorMetaKey;
      } else {
        metadataKey = actuators.map((item, fallback) => {
          const index = Number.isFinite(Number(item?.index)) ? (Number(item.index) | 0) : fallback;
          const name = String(item?.name ?? '');
          const min = Number.isFinite(Number(item?.min)) ? Number(item.min) : '';
          const max = Number.isFinite(Number(item?.max)) ? Number(item.max) : '';
          const step = Number.isFinite(Number(item?.step)) ? Number(item.step) : '';
          return `${index}:${name}:${min}:${max}:${step}`;
        }).join('|');
        cachedActuatorMetaRef = actuators;
        cachedActuatorMetaKey = metadataKey;
      }
    } else {
      cachedActuatorMetaRef = null;
      cachedActuatorMetaKey = '';
    }
    return {
      actuators,
      ctrl: snapshot?.ctrl || null,
      count,
      metadataKey,
    };
  }

  function buildEqualitySource(snapshot) {
    return {
      eqActive: snapshot?.eq_active || null,
      eqType: snapshot?.eq_type || null,
      eqObj1: snapshot?.eq_obj1id || null,
      eqObj2: snapshot?.eq_obj2id || null,
      eqObjType: snapshot?.eq_objtype || null,
      eqNames: Array.isArray(snapshot?.eq_names) ? snapshot.eq_names : null,
      jointNames: Array.isArray(snapshot?.jnt_names) ? snapshot.jnt_names : null,
    };
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

    const actuatorSource = buildActuatorSource(snapshot);
    const acts = actuatorSource.actuators || [];
    const ctrlValues = actuatorSource.ctrl ?? [];
    if (panelJustOpened || !sameSource(lastActuatorSource, actuatorSource)) {
      lastActuatorSource = actuatorSource;
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

    const jointSource = buildJointSource(snapshot);
    if (panelJustOpened || !sameSource(lastJointSource, jointSource)) {
      lastJointSource = jointSource;
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

    const equalitySource = buildEqualitySource(snapshot);
    if (panelJustOpened || !sameSource(lastEqualitySource, equalitySource)) {
      lastEqualitySource = equalitySource;
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
