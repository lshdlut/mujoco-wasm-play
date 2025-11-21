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
  distance = 400.0,
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
    uFadePow: { value: 2.5 },
    uPlaneOrigin: { value: new THREE.Vector3(0, 0, 0) },
    uPlaneAxisU: { value: new THREE.Vector3(1, 0, 0) },
    uPlaneAxisV: { value: new THREE.Vector3(0, 1, 0) },
    uPlaneNormal: { value: new THREE.Vector3(0, 0, 1) },
    uGridStep: { value: 1.0 },
  };
  material.extensions = material.extensions || {};
  material.extensions.derivatives = true;
  material.userData.infiniteUniforms = uniforms;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uDistance = uniforms.uDistance;
    shader.uniforms.uFadePow = uniforms.uFadePow;
    shader.uniforms.uPlaneOrigin = uniforms.uPlaneOrigin;
    shader.uniforms.uPlaneAxisU = uniforms.uPlaneAxisU;
    shader.uniforms.uPlaneAxisV = uniforms.uPlaneAxisV;
    shader.uniforms.uPlaneNormal = uniforms.uPlaneNormal;
    shader.uniforms.uGridStep = uniforms.uGridStep;
    shader.vertexShader = `
varying vec3 vInfiniteWorldPosition;
varying vec2 vPlaneCoord;
varying float vCameraSide;
uniform vec3 uPlaneOrigin;
uniform vec3 uPlaneAxisU;
uniform vec3 uPlaneAxisV;
uniform vec3 uPlaneNormal;
uniform float uDistance;
${shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      vec3 camVec = cameraPosition - uPlaneOrigin;
      float camSide = dot(camVec, uPlaneNormal);
      vec3 camProjected = cameraPosition - camSide * uPlaneNormal;
      vec3 span = position.x * uDistance * uPlaneAxisU + position.y * uDistance * uPlaneAxisV;
      transformed = camProjected + span;
      vPlaneCoord = vec2(dot(transformed - uPlaneOrigin, uPlaneAxisU), dot(transformed - uPlaneOrigin, uPlaneAxisV));
      vCameraSide = camSide;`
    )}`.replace(
      '#include <worldpos_vertex>',
      `#include <worldpos_vertex>
      vInfiniteWorldPosition = worldPosition.xyz;`
    );
    shader.fragmentShader = `
varying vec3 vInfiniteWorldPosition;
varying vec2 vPlaneCoord;
varying float vCameraSide;
uniform float uDistance;
uniform float uFadePow;
uniform vec3 uPlaneOrigin;
uniform vec3 uPlaneAxisU;
uniform vec3 uPlaneAxisV;
uniform vec3 uPlaneNormal;
uniform float uGridStep;
${shader.fragmentShader.replace(
      '#include <dithering_fragment>',
      `
      // Radial fade around the camera projection on the plane
      vec3 camVec = cameraPosition - uPlaneOrigin;
      vec2 camCoord = vec2(dot(camVec, uPlaneAxisU), dot(camVec, uPlaneAxisV));
      float planarDist = length(camCoord - vPlaneCoord);
      float t = clamp(planarDist / max(uDistance, 1e-6), 0.0, 1.0);
      float alpha = pow(1.0 - t, uFadePow);
      // Optional soft edge to avoid hard quad boundary
      float edge = smoothstep(uDistance * 0.9, uDistance, planarDist);
      alpha *= (1.0 - edge);
      // Attenuate underside
      if (vCameraSide < -0.01) {
        alpha *= 0.25;
      }
      if (alpha <= 0.0) discard;
      // Grid strength only influences color, not alpha
      float gridMod = 1.0;
      if (uGridStep > 1e-6) {
        vec2 r = vPlaneCoord / max(uGridStep, 1e-6);
        vec2 grid = abs(fract(r - 0.5) - 0.5) / fwidth(r);
        float line = min(grid.x, grid.y);
        float gridStrength = 1.0 - min(line, 1.0);
        gridMod = mix(0.9, 1.0, gridStrength);
      }
      gl_FragColor.rgb *= gridMod;
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
  mesh.userData.infiniteGround = {
    uniforms,
    baseDistance: distance,
    baseFadePow: uniforms.uFadePow.value,
    defaultGridStep: 1.0,
  };
  return mesh;
}
