// MuJoCo runtime enums/constants used by the viewer renderer.

export const MJ_GEOM = {
  PLANE: 0,
  HFIELD: 1,
  SPHERE: 2,
  CAPSULE: 3,
  ELLIPSOID: 4,
  CYLINDER: 5,
  BOX: 6,
  MESH: 7,
  SDF: 8,
  // rendering-only geom types (from mjmodel_tmp.h:mjtGeom)
  ARROW: 100,
  ARROW1: 101,
  ARROW2: 102,
  LINE: 103,
  LINEBOX: 104,
  FLEX: 105,
  SKIN: 106,
  LABEL: 107,
  TRIANGLE: 108,
  NONE: 1001,
};

export const MJ_VIS = {
  CONVEXHULL: 0,
  TEXTURE: 1,
  JOINT: 2,
  CAMERA: 3,
  ACTUATOR: 4,
  ACTIVATION: 5,
  LIGHT: 6,
  TENDON: 7,
  RANGEFINDER: 8,
  CONSTRAINT: 9,
  INERTIA: 10,
  SCLINERTIA: 11,
  PERTFORCE: 12,
  PERTOBJ: 13,
  CONTACTPOINT: 14,
  ISLAND: 15,
  CONTACTFORCE: 16,
  CONTACTSPLIT: 17,
  TRANSPARENT: 18,
  AUTOCONNECT: 19,
  COM: 20,
  SELECT: 21,
  STATIC: 22,
  SKIN: 23,
  FLEXVERT: 24,
  FLEXEDGE: 25,
  FLEXFACE: 26,
  FLEXSKIN: 27,
  BODYBVH: 28,
  MESHBVH: 29,
  SDFITER: 30,
};

export const MJ_OBJ = {
  UNKNOWN: 0,
  BODY: 1,
  XBODY: 2,
  JOINT: 3,
  DOF: 4,
  GEOM: 5,
  SITE: 6,
  CAMERA: 7,
  LIGHT: 8,
  FLEX: 9,
  MESH: 10,
  SKIN: 11,
  HFIELD: 12,
  TEXTURE: 13,
  MATERIAL: 14,
  PAIR: 15,
  EXCLUDE: 16,
  EQUALITY: 17,
  TENDON: 18,
  ACTUATOR: 19,
  SENSOR: 20,
  NUMERIC: 21,
  TEXT: 22,
  TUPLE: 23,
  KEY: 24,
  PLUGIN: 25,
  FRAME: 100,
  DEFAULT: 101,
  MODEL: 102,
};

export const MJ_LIGHT_TYPE = {
  SPOT: 0,
  DIRECTIONAL: 1,
  POINT: 2,
  IMAGE: 3,
};

export const MJ_MAXLIGHT = 128;

// MuJoCo constant from mjmodel.h; used by engine_vis_visualize.c when
// re-centering infinite planes.
export const MJ_MAXPLANEGRID = 11;

export const MJ_MINVAL = 1e-12;
export const MJ_TEXTURE = {
  TEX2D: 0,
};

