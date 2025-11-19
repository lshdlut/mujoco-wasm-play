import * as THREE from 'three';

const DEFAULT_SLICES = 96;

function computeTransitionHeight(radiusParam) {
  const r = Math.max(1e-5, Math.min(0.999, radiusParam));
  const alpha = Math.atan2(1, r);
  const beta = 0.75 * Math.PI - alpha;
  const numerator = Math.sqrt(0.5) * r * Math.sin(alpha);
  const denom = Math.sin(beta) || 1;
  return Math.min(1, Math.max(0, numerator / denom));
}

function setVertex(target, azimuth, height, radiusParam) {
  const radius = 1 - radiusParam * (1 - height);
  target[0] = Math.cos(azimuth) * radius;
  target[1] = Math.sin(azimuth) * radius;
  target[2] = height;
  return target;
}

export function createHazeMesh({ slices = DEFAULT_SLICES, renderOrder = 0 } = {}) {
  const geometry = new THREE.BufferGeometry();
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
    blending: THREE.NormalBlending,
    uniforms: {
      baseColor: { value: new THREE.Color(0xffffff) },
      opacityMul: { value: 1 },
    },
    vertexShader: `
      attribute float alpha;
      varying float vAlpha;
      void main() {
        vAlpha = alpha;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 baseColor;
      uniform float opacityMul;
      varying float vAlpha;
      void main() {
        float a = clamp(vAlpha * opacityMul, 0.0, 1.0);
        if (a <= 0.0) discard;
        gl_FragColor = vec4(baseColor, a);
      }
    `,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = renderOrder;
  mesh.visible = false;
  mesh.userData.slices = Math.max(8, Math.floor(slices));
  mesh.userData.radiusParam = -1;
  return mesh;
}

export function rebuildHazeGeometry(mesh, radiusParam = 0.3) {
  if (!mesh) return;
  const slices = Math.max(8, mesh.userData.slices || DEFAULT_SLICES);
  const stacks = 2;
  const totalQuads = slices * stacks;
  const vertsPerQuad = 6;
  const totalVerts = totalQuads * vertsPerQuad;
  const positions = new Float32Array(totalVerts * 3);
  const alphas = new Float32Array(totalVerts);
  const v1 = [0, 0, 0];
  const v2 = [0, 0, 0];
  const v3 = [0, 0, 0];
  const v4 = [0, 0, 0];
  const hTransition = computeTransitionHeight(radiusParam);
  let idx = 0;
  for (let stack = 0; stack < stacks; stack += 1) {
    const h1 = stack === 0 ? 0 : hTransition;
    const h2 = stack === 0 ? hTransition : 1;
    const alphaBottom = stack === 1 ? 1 : 0;
    const alphaTop = stack === 0 ? 1 : 0;
    for (let slice = 0; slice < slices; slice += 1) {
      const az1 = (2 * Math.PI * slice) / slices;
      const az2 = (2 * Math.PI * (slice + 1)) / slices;
      setVertex(v1, az1, h1, radiusParam);
      setVertex(v2, az2, h1, radiusParam);
      setVertex(v3, az2, h2, radiusParam);
      setVertex(v4, az1, h2, radiusParam);
      const quadVerts = [
        [v1, alphaBottom],
        [v2, alphaBottom],
        [v3, alphaTop],
        [v1, alphaBottom],
        [v3, alphaTop],
        [v4, alphaTop],
      ];
      for (const [point, alphaValue] of quadVerts) {
        positions[idx * 3 + 0] = point[0];
        positions[idx * 3 + 1] = point[1];
        positions[idx * 3 + 2] = point[2];
        alphas[idx] = alphaValue;
        idx += 1;
      }
    }
  }
  const geometry = mesh.geometry;
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('alpha', new THREE.BufferAttribute(alphas, 1));
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
  mesh.userData.radiusParam = radiusParam;
}
