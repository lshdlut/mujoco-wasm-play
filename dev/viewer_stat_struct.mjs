import { writeStructField, readStructSnapshot } from './viewer_struct_access.mjs';

export const STAT_FIELD_DESCRIPTORS = [
  {
    "path": [
      "center"
    ],
    "kind": "float_vec",
    "size": 3
  },
  {
    "path": [
      "extent"
    ],
    "kind": "float",
    "size": 1
  },
  {
    "path": [
      "meansize"
    ],
    "kind": "float",
    "size": 1
  },
  {
    "path": [
      "meanmass"
    ],
    "kind": "float",
    "size": 1
  }
];

export function writeStatisticField(mod, handle, pathSegments, kind, value, size) {
  return writeStructField(mod, handle, 'stat', pathSegments, kind, size, value);
}

export function readStatisticStruct(mod, handle) {
  return readStructSnapshot(mod, handle, 'stat', STAT_FIELD_DESCRIPTORS);
}
