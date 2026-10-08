import { PLAY_COMPATIBILITY_BY_VER, TYPEDEF_BYTES_BY_VER } from './forge_abi_snapshot.gen.mjs';
import { heapViewI32, resolveHeapBuffer } from './heap_views.mjs';

// Select by native identity, never by the requested download URL.
export function playCompatibility(mod) {
  const result = PLAY_COMPATIBILITY_BY_VER[mod?.__mujocoVer];
  if (!result) throw new Error(`Unknown native MuJoCo compatibility: ${mod?.__mujocoVer}`);
  return result;
}

export function integrationStateSpec(mod) { return playCompatibility(mod).integrationState; }

export function controlSlotOwners(nu, nactuator, addresses = null, counts = null) {
  const slots = Array.from({ length: nu }, () => null);
  for (let actuator = 0; actuator < nactuator; actuator += 1) {
    const address = addresses ? addresses[actuator] : actuator;
    const count = counts ? counts[actuator] : 1;
    if (!Number.isInteger(address) || !Number.isInteger(count) || address < 0 || count < 0 || address + count > nu) {
      throw new Error(`Invalid actuator control layout: actuator ${actuator}`);
    }
    for (let input = 0; input < count; input += 1) {
      const index = address + input;
      if (slots[index]) throw new Error(`Overlapping actuator control slot: ${index}`);
      slots[index] = { index, actuator, input, inputCount: count };
    }
  }
  if (slots.some(slot => !slot)) throw new Error('Incomplete actuator control layout');
  return slots;
}

export function readMjtSize(mod, ptr) {
  const bytes = TYPEDEF_BYTES_BY_VER.mjtSize[mod?.__mujocoVer];
  if (bytes === 4) return heapViewI32(mod, ptr, 1)[0];
  if (bytes !== 8) throw new Error(`Unknown mjtSize width: ${mod?.__mujocoVer}`);
  const value = new DataView(resolveHeapBuffer(mod)).getBigInt64(ptr >>> 0, true);
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric)) throw new Error('mjtSize is outside safe HUD integer range');
  return numeric;
}
