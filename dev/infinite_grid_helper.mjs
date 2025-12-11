import * as THREE from 'three';

/**
 * Creates a single-quad grid that mimics an infinite plane with smooth fade.
 * Ported from the prototype in local_temp/infinity (Fyrestar's helper).
 */
export function createInfiniteGridHelper({
  size1 = 1.0,
  size2 = 10.0,
  color = 0xffffff,
  distance = 400.0,
  axes = 'xyz',
  renderOrder = -5,
} = {}) {
  const colorObj = color instanceof THREE.Color ? color.clone() : new THREE.Color(color);
  const planeAxes = axes.slice(0, 2);
  const geometry = new THREE.PlaneGeometry(2, 2, 1, 1);
  const material = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: true,
    depthTest: true,
    uniforms: {
      uSize1: { value: size1 },
      uSize2: { value: size2 },
      uColor: { value: colorObj },
      uDistance: { value: distance },
    },
    vertexShader: `
      varying vec3 worldPosition;
      uniform float uDistance;
      void main() {
        vec3 pos = position.${axes} * uDistance;
        pos.${planeAxes} += cameraPosition.${planeAxes};
        worldPosition = pos;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 worldPosition;
      uniform float uSize1;
      uniform float uSize2;
      uniform vec3 uColor;
      uniform float uDistance;

      float getGrid(float size) {
        vec2 r = worldPosition.${planeAxes} / size;
        vec2 grid = abs(fract(r - 0.5) - 0.5) / fwidth(r);
        float line = min(grid.x, grid.y);
        return 1.0 - min(line, 1.0);
      }

      void main() {
        float d = 1.0 - min(distance(cameraPosition.${planeAxes}, worldPosition.${planeAxes}) / uDistance, 1.0);
        float g1 = getGrid(uSize1);
        float g2 = getGrid(uSize2);
        float strength = mix(g2, g1, g1) * pow(d, 3.0);
        vec4 color = vec4(uColor.rgb, strength);
        color.a = mix(0.5 * color.a, color.a, g2);
        if (color.a <= 0.0) discard;
        gl_FragColor = color;
      }
    `,
    extensions: {
      derivatives: true,
    },
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = renderOrder;
  mesh.userData.infiniteGrid = {
    uniforms: material.uniforms,
    baseDistance: distance,
  };
  return mesh;
}

/**
 * Infinite ground plane that fades out with distance using the same distance logic as the grid.
 * Intended to be used as a solid ground color that smoothly blends into the background.
 */
export function createInfiniteGroundHelper({
  color = 0xffffff,
  distance = 2000.0,
  renderOrder = -10,
} = {}) {
  const colorObj = color instanceof THREE.Color ? color.clone() : new THREE.Color(color);
  const geometry = new THREE.PlaneGeometry(2, 2, 1, 1);
  const material = new THREE.MeshStandardMaterial({
    color: colorObj,
    roughness: 0.9,
    metalness: 0,
    transparent: true,
    opacity: 1,
    side: THREE.DoubleSide,
  });
  const uniforms = {
    uDistance: { value: distance },
    uFadeStart: { value: distance * 0.9 },
    uFadeEnd: { value: distance },
    // Quad half-size in plane space; also used as the base cutoff radius
    // so the visible ground disc is always inscribed in the quad.
    uQuadDistance: { value: distance },
    uFadePow: { value: 2.5 },
    uPlaneOrigin: { value: new THREE.Vector3(0, 0, 0) },
    uPlaneAxisU: { value: new THREE.Vector3(1, 0, 0) },
    uPlaneAxisV: { value: new THREE.Vector3(0, 1, 0) },
    uPlaneNormal: { value: new THREE.Vector3(0, 0, 1) },
    uGridStep: { value: 2.0 },
    uGridColor: { value: colorObj.clone() },
    uGridIntensity: { value: 0.2 },
  };
  material.extensions = material.extensions || {};
  material.extensions.derivatives = true;
  material.userData.infiniteUniforms = uniforms;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uDistance = uniforms.uDistance;
    shader.uniforms.uFadeStart = uniforms.uFadeStart;
    shader.uniforms.uFadeEnd = uniforms.uFadeEnd;
    shader.uniforms.uQuadDistance = uniforms.uQuadDistance;
    shader.uniforms.uFadePow = uniforms.uFadePow;
    shader.uniforms.uPlaneOrigin = uniforms.uPlaneOrigin;
    shader.uniforms.uPlaneAxisU = uniforms.uPlaneAxisU;
    shader.uniforms.uPlaneAxisV = uniforms.uPlaneAxisV;
    shader.uniforms.uPlaneNormal = uniforms.uPlaneNormal;
    shader.uniforms.uGridStep = uniforms.uGridStep;
    shader.uniforms.uGridColor = uniforms.uGridColor;
    shader.uniforms.uGridIntensity = uniforms.uGridIntensity;
    shader.vertexShader = `
varying vec3 vInfiniteWorldPosition;
varying vec2 vPlaneCoord;
varying float vCameraSide;
uniform vec3 uPlaneOrigin;
uniform vec3 uPlaneAxisU;
uniform vec3 uPlaneAxisV;
uniform vec3 uPlaneNormal;
uniform float uDistance;
uniform float uQuadDistance;
${shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      vec3 camVec = cameraPosition - uPlaneOrigin;
      float camSide = dot(camVec, uPlaneNormal);
      vec3 camProjected = cameraPosition - camSide * uPlaneNormal;
      float quadScale = uQuadDistance;
      if (quadScale <= 0.0) quadScale = uDistance;
      vec3 span = position.x * quadScale * uPlaneAxisU + position.y * quadScale * uPlaneAxisV;
      transformed = camProjected + span;
      vPlaneCoord = vec2(dot(transformed - uPlaneOrigin, uPlaneAxisU), dot(transformed - uPlaneOrigin, uPlaneAxisV));
      vCameraSide = camSide;`
    )}`.replace(
      '#include <worldpos_vertex>',
      `#include <worldpos_vertex>
      vec4 infiniteWorldPosition = modelMatrix * vec4(transformed, 1.0);
      vInfiniteWorldPosition = infiniteWorldPosition.xyz;`
    );
    shader.fragmentShader = `
varying vec3 vInfiniteWorldPosition;
varying vec2 vPlaneCoord;
varying float vCameraSide;
uniform float uDistance;
uniform float uFadeStart;
uniform float uFadeEnd;
uniform float uQuadDistance;
uniform float uFadePow;
uniform vec3 uPlaneOrigin;
uniform vec3 uPlaneAxisU;
uniform vec3 uPlaneAxisV;
uniform vec3 uPlaneNormal;
uniform float uGridStep;
uniform vec3 uGridColor;
uniform float uGridIntensity;
${shader.fragmentShader.replace(
      '#include <dithering_fragment>',
      `
      // Radial masking around the camera projection on the plane.
      // 1) Base cutoff disc: always active, used to hide the quad boundary.
      // 2) Optional haze-driven fade inside the disc when enabled.
      vec3 camVec = cameraPosition - uPlaneOrigin;
      vec2 camCoord = vec2(dot(camVec, uPlaneAxisU), dot(camVec, uPlaneAxisV));
      float planarDist = length(camCoord - vPlaneCoord);

      // Base cutoff radius: tied to quad half-size so the disc fits in the quad.
      float baseRadius = max(1e-4, uQuadDistance);
      if (planarDist >= baseRadius) discard;

      float alpha = 1.0;

      // Optional haze fade inside the base disc. Disabled when fadeEnd <= fadeStart
      // or uFadePow is non-positive.
      float fadeStart = max(0.0, uFadeStart);
      float fadeEnd = max(fadeStart, uFadeEnd);
      if (fadeEnd > fadeStart + 1e-4 && uFadePow > 1e-5) {
        float t = clamp((planarDist - fadeStart) / max(fadeEnd - fadeStart, 1e-6), 0.0, 1.0);
        float hazeAlpha = pow(1.0 - t, uFadePow);
        alpha *= hazeAlpha;
      }

      // Soft edge near the base radius to avoid a harsh disc boundary.
      float edge = smoothstep(baseRadius * 0.9, baseRadius, planarDist);
      alpha *= (1.0 - edge);

      // Attenuate underside
      if (vCameraSide < -0.01) {
        alpha *= 0.25;
      }
      if (alpha <= 0.0) discard;
      // Grid overlay: tint towards uGridColor where grid lines fall.
      vec3 baseColor = gl_FragColor.rgb;
      if (uGridStep > 1e-6 && uGridIntensity > 1e-6) {
        vec2 r = vPlaneCoord / max(uGridStep, 1e-6);
        vec2 grid = abs(fract(r - 0.5) - 0.5) / fwidth(r);
        float line = min(grid.x, grid.y);
        float gridStrength = 1.0 - min(line, 1.0);
        float mixAmt = clamp(gridStrength * uGridIntensity, 0.0, 1.0);
        gl_FragColor.rgb = mix(baseColor, uGridColor, mixAmt);
      } else {
        gl_FragColor.rgb = baseColor;
      }
      gl_FragColor.a = alpha;
      #include <dithering_fragment>`
    )}`;
    material.userData.shader = shader;
  };
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = renderOrder;
  mesh.receiveShadow = true;
  mesh.matrixAutoUpdate = false;
  mesh.matrix.identity();
  mesh.updateMatrix();
  // Attach a lightweight handle so renderer-side code can access uniforms
  // without enforcing additional default behaviour from this helper.
  mesh.userData.infiniteGround = { uniforms };
  return mesh;
}
