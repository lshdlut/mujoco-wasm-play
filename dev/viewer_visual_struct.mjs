import { writeStructField, readStructSnapshot } from './viewer_struct_access.mjs';

export const VISUAL_FIELD_DESCRIPTORS = [
  {
    "path": [
      "global",
      "azimuth"
    ],
    "kind": "float",
    "size": 1
  },
  {
    "path": [
      "global",
      "bvactive"
    ],
    "kind": "enum",
    "size": 1
  },
  {
    "path": [
      "global",
      "elevation"
    ],
    "kind": "float",
    "size": 1
  },
  {
    "path": [
      "global",
      "ellipsoidinertia"
    ],
    "kind": "enum",
    "size": 1
  },
  {
    "path": [
      "global",
      "fovy"
    ],
    "kind": "float",
    "size": 1
  },
  {
    "path": [
      "global",
      "orthographic"
    ],
    "kind": "enum",
    "size": 1
  },
  {
    "path": [
      "headlight",
      "active"
    ],
    "kind": "enum",
    "size": 1
  },
  {
    "path": [
      "headlight",
      "ambient"
    ],
    "kind": "float_vec",
    "size": 3
  },
  {
    "path": [
      "headlight",
      "diffuse"
    ],
    "kind": "float_vec",
    "size": 3
  },
  {
    "path": [
      "headlight",
      "specular"
    ],
    "kind": "float_vec",
    "size": 3
  },
  {
    "path": [
      "map",
      "alpha"
    ],
    "kind": "float",
    "size": 1
  },
  {
    "path": [
      "map",
      "fogend"
    ],
    "kind": "float",
    "size": 1
  },
  {
    "path": [
      "map",
      "fogstart"
    ],
    "kind": "float",
    "size": 1
  },
  {
    "path": [
      "map",
      "force"
    ],
    "kind": "float",
    "size": 1
  },
  {
    "path": [
      "map",
      "haze"
    ],
    "kind": "float",
    "size": 1
  },
  {
    "path": [
      "map",
      "shadowclip"
    ],
    "kind": "float",
    "size": 1
  },
  {
    "path": [
      "map",
      "shadowscale"
    ],
    "kind": "float",
    "size": 1
  },
  {
    "path": [
      "map",
      "stiffness"
    ],
    "kind": "float",
    "size": 1
  },
  {
    "path": [
      "map",
      "stiffnessrot"
    ],
    "kind": "float",
    "size": 1
  },
  {
    "path": [
      "map",
      "torque"
    ],
    "kind": "float",
    "size": 1
  },
  {
    "path": [
      "map",
      "zfar"
    ],
    "kind": "float",
    "size": 1
  },
  {
    "path": [
      "map",
      "znear"
    ],
    "kind": "float",
    "size": 1
  },
  {
    "path": [
      "rgba",
      "actuator"
    ],
    "kind": "float_vec",
    "size": 4
  },
  {
    "path": [
      "rgba",
      "actuatornegative"
    ],
    "kind": "float_vec",
    "size": 4
  },
  {
    "path": [
      "rgba",
      "actuatorpositive"
    ],
    "kind": "float_vec",
    "size": 4
  },
  {
    "path": [
      "rgba",
      "bv"
    ],
    "kind": "float_vec",
    "size": 4
  },
  {
    "path": [
      "rgba",
      "bvactive"
    ],
    "kind": "float_vec",
    "size": 4
  },
  {
    "path": [
      "rgba",
      "camera"
    ],
    "kind": "float_vec",
    "size": 4
  },
  {
    "path": [
      "rgba",
      "com"
    ],
    "kind": "float_vec",
    "size": 4
  },
  {
    "path": [
      "rgba",
      "connect"
    ],
    "kind": "float_vec",
    "size": 4
  },
  {
    "path": [
      "rgba",
      "constraint"
    ],
    "kind": "float_vec",
    "size": 4
  },
  {
    "path": [
      "rgba",
      "contactforce"
    ],
    "kind": "float_vec",
    "size": 4
  },
  {
    "path": [
      "rgba",
      "contactfriction"
    ],
    "kind": "float_vec",
    "size": 4
  },
  {
    "path": [
      "rgba",
      "contactgap"
    ],
    "kind": "float_vec",
    "size": 4
  },
  {
    "path": [
      "rgba",
      "contactpoint"
    ],
    "kind": "float_vec",
    "size": 4
  },
  {
    "path": [
      "rgba",
      "contacttorque"
    ],
    "kind": "float_vec",
    "size": 4
  },
  {
    "path": [
      "rgba",
      "crankbroken"
    ],
    "kind": "float_vec",
    "size": 4
  },
  {
    "path": [
      "rgba",
      "fog"
    ],
    "kind": "float_vec",
    "size": 4
  },
  {
    "path": [
      "rgba",
      "force"
    ],
    "kind": "float_vec",
    "size": 4
  },
  {
    "path": [
      "rgba",
      "frustum"
    ],
    "kind": "float_vec",
    "size": 4
  },
  {
    "path": [
      "rgba",
      "haze"
    ],
    "kind": "float_vec",
    "size": 4
  },
  {
    "path": [
      "rgba",
      "inertia"
    ],
    "kind": "float_vec",
    "size": 4
  },
  {
    "path": [
      "rgba",
      "joint"
    ],
    "kind": "float_vec",
    "size": 4
  },
  {
    "path": [
      "rgba",
      "light"
    ],
    "kind": "float_vec",
    "size": 4
  },
  {
    "path": [
      "rgba",
      "rangefinder"
    ],
    "kind": "float_vec",
    "size": 4
  },
  {
    "path": [
      "rgba",
      "selectpoint"
    ],
    "kind": "float_vec",
    "size": 4
  },
  {
    "path": [
      "rgba",
      "slidercrank"
    ],
    "kind": "float_vec",
    "size": 4
  },
  {
    "path": [
      "scale",
      "actuatorlength"
    ],
    "kind": "float",
    "size": 1
  },
  {
    "path": [
      "scale",
      "actuatorwidth"
    ],
    "kind": "float",
    "size": 1
  },
  {
    "path": [
      "scale",
      "camera"
    ],
    "kind": "float",
    "size": 1
  },
  {
    "path": [
      "scale",
      "com"
    ],
    "kind": "float",
    "size": 1
  },
  {
    "path": [
      "scale",
      "connect"
    ],
    "kind": "float",
    "size": 1
  },
  {
    "path": [
      "scale",
      "constraint"
    ],
    "kind": "float",
    "size": 1
  },
  {
    "path": [
      "scale",
      "contactheight"
    ],
    "kind": "float",
    "size": 1
  },
  {
    "path": [
      "scale",
      "contactwidth"
    ],
    "kind": "float",
    "size": 1
  },
  {
    "path": [
      "scale",
      "forcewidth"
    ],
    "kind": "float",
    "size": 1
  },
  {
    "path": [
      "scale",
      "framelength"
    ],
    "kind": "float",
    "size": 1
  },
  {
    "path": [
      "scale",
      "framewidth"
    ],
    "kind": "float",
    "size": 1
  },
  {
    "path": [
      "scale",
      "jointlength"
    ],
    "kind": "float",
    "size": 1
  },
  {
    "path": [
      "scale",
      "jointwidth"
    ],
    "kind": "float",
    "size": 1
  },
  {
    "path": [
      "scale",
      "light"
    ],
    "kind": "float",
    "size": 1
  },
  {
    "path": [
      "scale",
      "selectpoint"
    ],
    "kind": "float",
    "size": 1
  },
  {
    "path": [
      "scale",
      "slidercrank"
    ],
    "kind": "float",
    "size": 1
  }
];

export function writeVisualField(mod, handle, pathSegments, kind, value, size) {
  return writeStructField(mod, handle, 'vis', pathSegments, kind, size, value);
}

export function readVisualStruct(mod, handle) {
  return readStructSnapshot(mod, handle, 'vis', VISUAL_FIELD_DESCRIPTORS);
}
