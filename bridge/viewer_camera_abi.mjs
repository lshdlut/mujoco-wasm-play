import { MJV_MOVE_CAMERA_HAS_SCENE_ARG_BY_VER } from './forge_abi_snapshot.gen.mjs';

// MuJoCo removed the scene argument from mjv_moveCamera. Normalize only this
// changed native signature using Forge audit facts, never a JS camera fallback.
export function createMoveCameraAdapter(mod) {
  const hasScene = MJV_MOVE_CAMERA_HAS_SCENE_ARG_BY_VER[mod.__mujocoVer];
  if (typeof hasScene !== 'boolean') throw new Error(`Unknown mjv_moveCamera ABI for ${mod.__mujocoVer}`);
  const fn = mod._mjwf_mjv_moveCamera;
  if (typeof fn !== 'function') throw new Error('Missing Forge mjv_moveCamera export');
  return hasScene
    ? (model, action, dx, dy, scene, camera) => fn.call(mod, model, action, dx, dy, scene, camera)
    : (model, action, dx, dy, _scene, camera) => fn.call(mod, model, action, dx, dy, camera);
}
