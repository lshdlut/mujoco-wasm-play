// Shared defaults live here to keep worker/state aligned without duplicating
// literals across modules. Centralizing these values reduces drift risk and
// lowers maintenance cost when MuJoCo default behavior changes.

const VOPT_FLAG_DEFAULT_INDICES = Object.freeze([1, 7, 8, 13, 22, 23, 25, 27]);

function makeFlagArray(length, enabledIndices) {
  const flags = Array.from({ length }, () => false);
  for (const idx of enabledIndices) {
    if (idx >= 0 && idx < flags.length) {
      flags[idx] = true;
    }
  }
  return flags;
}

export const MJ_GROUP_TYPES = Object.freeze(['geom', 'site', 'joint', 'tendon', 'actuator', 'flex', 'skin']);
export const MJ_GROUP_COUNT = 6;

export const SCENE_FLAG_DEFAULTS = Object.freeze([
  true,  // shadow
  false, // wireframe
  true,  // reflection
  false, // additive
  true,  // skybox
  false, // fog
  true,  // haze
  false, // segment
  false, // id color
  true,  // cull face
]);

// Default mjvOption.flags state. Mirror simulate's mjVISSTRING defaults, which
// turn on texture, tendon, range finder, perturb object, static body, skin,
// flex edge, and flex skin when mjv_defaultOption populates mjvOption.flags.
export const DEFAULT_VOPT_FLAGS = Object.freeze(makeFlagArray(32, VOPT_FLAG_DEFAULT_INDICES));

export const SCENE_FLAG_DEFAULTS_NUMERIC = Object.freeze(
  SCENE_FLAG_DEFAULTS.map((flag) => (flag ? 1 : 0)),
);
export const DEFAULT_VOPT_FLAGS_NUMERIC = Object.freeze(
  DEFAULT_VOPT_FLAGS.map((flag) => (flag ? 1 : 0)),
);
