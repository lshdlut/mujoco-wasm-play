// Classical MuJoCo lighting consumes ambient/diffuse/specular RGB directly.
// Photometric intensity belongs to the newer rendering route, not an extra
// multiplier on these already-effective classical channels. Play retains its
// existing point-light extension; this does not implement photometric rendering.
export function classicLightScale(_photometricIntensity) {
  return 1;
}
