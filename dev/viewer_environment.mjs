export const FALLBACK_PRESETS = {
  sun: {
    // Bright daytime preset: strong directional light with moderate IBL so
    // shadows remain clearly visible.
    background: 0xdde6f4,
    // Base clear colour used when no skybox/environment is active.
    clearColor: 0xd6dce4,
    exposure: 0.5,
    ambient: { color: 0xf0f4ff, intensity: 0.1 },
    hemi: { sky: 0xf0f4ff, ground: 0x10121a, intensity: 0.18 },
    dir: {
      color: 0xffffff,
      intensity: 4,
      position: [6, -5, 4],
      target: [0, 0, 1],
      shadowBias: -0.0001,
    },
    fill: { color: 0xb6d5ff, intensity: 0.18, position: [-4, 3, 2] },
    shadowBias: -0.00015,
    // Kept deliberately low so HDRI does not wash out shadows.
    envIntensity: 0.35,
    // Preset-specific environment settings
    hdri: 'rustig_koppie_puresky_4k.hdr',
    backgroundBottom: 0x6a8bb3,
    ground: {
      style: 'shadow',
      opacity: 0.95,
      color: 0xffffff,
      metallic: 0,
      infinite: {
        distance: 2000,
        fadePow: 2.5,
        fadeStartFactor: 0.7,
        gridStep: 2.0,
        gridIntensity: 0.3,
        gridColor: 0x3a4250,
      },
    },
    overlays: {
      contactPoint: 0xff8a2b,
      contactForce: 0x4d7cfe,
      selectPoint: 0xff8a2b,
      selectionHighlight: 0x40ff99,
      selectionOverlay: 0x66ffcc,
      perturbRing: 0xff8a2b,
      perturbArrow: 0xffb366,
    },
    fogColor: 0xb3bfd9,
  },
  moon: {
    // Night preset: darker exposure and very weak IBL so forms are defined
    // mostly by a single moon-like directional light.
    background: 0x02030a,
    // Base clear colour for night preset when no skybox/environment is active.
    clearColor: 0x02030a,
    exposure: 0.5,
    ambient: { color: 0xf0f4ff, intensity: 0.2 },
    hemi: { sky: 0x22273a, ground: 0x02030a, intensity: 0.05 },
    dir: {
      color: 0xffffff,
      intensity: 2,
      position: [-2, 3, -1.5],
      target: [0, 1, 1],
      shadowBias: -0.0001,
    },
    fill: { color: 0x182030, intensity: 0.14, position: [-1.5, 1.5, 1] },
    shadowBias: -0.0002,
    envIntensity: 0.08,
    hdri: 'starmap_random_2020_4k_rot.exr',
    backgroundBottom: 0x02030a,
    ground: {
      style: 'shadow',
      opacity: 0.25,
      color: 0xffffff,
      infinite: {
        distance: 2000,
        fadePow: 2.5,
        fadeStartFactor: 0.7,
        gridStep: 2.0,
        gridIntensity: 0.18,
        gridColor: 0x2a2f3c,
      },
    },
    overlays: {
      contactPoint: 0xff8a2b,
      contactForce: 0x4d7cfe,
      selectPoint: 0xff8a2b,
      selectionHighlight: 0x40ff99,
      selectionOverlay: 0x66ffcc,
      perturbRing: 0xff8a2b,
      perturbArrow: 0xffb366,
    },
    fogColor: 0x243040,
  },
};

export const FALLBACK_PRESET_ALIASES = {
  'bright-outdoor': 'sun',
  bright: 'sun',
  outdoor: 'sun',
};

const SKY_MODE_NONE = 'none';
const SKY_MODE_PRESET = 'preset-hdri';
const SKY_MODE_MODEL = 'mj-sky';

function ensureSkyCache(ctx) {
  if (!ctx) return null;
  if (!ctx.skyCache) {
    ctx.skyCache = {
      preset: null,
      model: null,
      none: null,
    };
  }
  return ctx.skyCache;
}

function hasModelEnvironment(state) {
  const env = state?.rendering?.environment;
  if (!env) return false;
  if (env.hdr || env.texture || env.color) return true;
  if (Array.isArray(env.sources) && env.sources.length > 0) return true;
  return false;
}

function hasModelLights(state) {
  const lights = state?.rendering?.lights;
  return Array.isArray(lights) && lights.length > 0;
}

function hasModelBackground(state) {
  const bg = state?.rendering?.background;
  if (!bg) return false;
  return bg.color != null || !!bg.texture;
}

function pushSkyDebug(ctx, payload) {
  try {
    const log = ctx?._skyDebug || (ctx._skyDebug = []);
    log.push({ ts: Date.now(), source: 'env', ...payload });
    if (log.length > 40) log.shift();
    if (typeof window !== 'undefined') {
      window.__skyDebug = log;
    }
  } catch {}
}

function detachEnvironment(ctx) {
  const worldScene = getWorldScene(ctx);
  if (worldScene) {
    worldScene.environment = null;
    worldScene.background = null;
  }
  if (ctx.skyShader) ctx.skyShader.visible = false;
  ctx.envIntensity = 0;
  ctx.skyMode = null;
  ctx.skyBackground = null;
  ctx.skyCube = null;
}

function ensureModelGradientEnv(ctx, THREE_NS) {
  const worldScene = getWorldScene(ctx);
  if (!ctx || !ctx.renderer || !worldScene) return null;
  const cache = ensureSkyCache(ctx);
  const cached = cache?.model;
  if (cached?.envRT && cached.background) {
    worldScene.environment = cached.envRT.texture || null;
    worldScene.background = cached.background;
    ctx.envRT = cached.envRT;
    ctx.envIntensity = 1.0;
    ctx.envFromHDRI = false;
    ctx.hdriReady = false;
    ctx.envDirty = false;
    return cached;
  }
  if (!ctx.pmrem) {
    ctx.pmrem = new THREE_NS.PMREMGenerator(ctx.renderer);
  }
  // Use a lightweight gradient as a MuJoCo-like clear sky
  // MuJoCo builtin gradient defaults: rgb1=[0.6,0.8,1], rgb2=[0,0,0]
  const gradTex = createVerticalGradientTexture(THREE_NS, 0x99ccff, 0x000000, 256);
  const envRT = ctx.pmrem.fromEquirectangular(gradTex);
  worldScene.background = gradTex;
  worldScene.environment = envRT?.texture || null;
  ctx.envRT = envRT;
  ctx.envIntensity = 1.0;
  ctx.skyBackground = gradTex;
  ctx.skyMode = 'cube';
  if (ctx.skyShader) ctx.skyShader.visible = false;
  ctx.skyCube = null;
  ctx.envFromHDRI = false;
  ctx.hdriReady = false;
  ctx.envDirty = false;
  if (cache) {
    cache.model = {
      key: 'model-gradient',
      envRT,
      background: gradTex,
      kind: 'gradient',
    };
  }
  return cache?.model || null;
}

let LAST_SKYBOX_TEXTURE = null;

function readSkyboxTextureFromAssets(state) {
  const textures = state?.rendering?.assets?.textures || null;
  if (!textures || !textures.type || !textures.data) {
    return LAST_SKYBOX_TEXTURE;
  }
  const typeArr = textures.type;
  const adrArr = textures.adr;
  const widthArr = textures.width;
  const heightArr = textures.height;
  const nchanArr = textures.nchannel;
  const data = textures.data;
  const count = Array.isArray(typeArr) ? typeArr.length : (typeArr?.length ?? 0);
  for (let i = 0; i < count; i += 1) {
    const t = typeArr[i] ?? 0;
    // MuJoCo: mjtTexture type 2 is skybox (cube)
    if (t !== 2) continue;
    const width = Number(widthArr?.[i]) || 0;
    const height = Number(heightArr?.[i]) || 0;
    const nchan = Number(nchanArr?.[i]) || 0;
    const adr = Number(adrArr?.[i]) || 0;
    if (!(width > 0 && height > 0 && nchan > 0)) continue;
    const texSize = width * height * nchan;
    const nextAdr = i + 1 < count ? Number(adrArr?.[i + 1]) || texSize + adr : texSize + adr;
    const end = Math.min(data.length, nextAdr);
    const start = Math.max(0, adr);
    if (!(end > start)) continue;
    // Copy underlying data into a stable Uint8Array slice so later frames
    // can continue to build a cube texture even if assets.textures is absent.
    const src = data;
    const byteOffset = start * (src.BYTES_PER_ELEMENT || 1);
    const byteLength = (end - start) * (src.BYTES_PER_ELEMENT || 1);
    const uint8 = new Uint8Array(src.buffer || src, byteOffset, byteLength);
    const tex = {
      width,
      height,
      nchan,
      data: uint8.slice(),
      adr,
    };
    LAST_SKYBOX_TEXTURE = tex;
    return tex;
  }
  return LAST_SKYBOX_TEXTURE;
}

function createCubeTextureFromSkybox(THREE_NS, skyTex) {
  if (!skyTex || !THREE_NS || !skyTex.data) return null;
  const { width, height, nchan, data } = skyTex;
  if (!(width > 0 && height > 0 && nchan > 0)) return null;
  const faces = 6;
  if (height !== width * faces) return null;
  const faceSize = width * width * nchan;
  if (data.length < faceSize * faces) return null;
  const fmt = nchan === 4 ? THREE_NS.RGBAFormat
    : nchan === 3 ? THREE_NS.RGBFormat
    : THREE_NS.RedFormat;
  const type = THREE_NS.UnsignedByteType;
  const images = [];
  for (let i = 0; i < faces; i += 1) {
    const start = i * faceSize;
    const end = start + faceSize;
    const faceData = data.subarray(start, end);
    const tex = new THREE_NS.DataTexture(faceData, width, width, fmt, type);
    tex.needsUpdate = true;
    tex.generateMipmaps = false;
    tex.minFilter = THREE_NS.LinearFilter;
    tex.magFilter = THREE_NS.LinearFilter;
    tex.colorSpace = THREE_NS.SRGBColorSpace || THREE_NS.LinearSRGBColorSpace || undefined;
    images.push(tex);
  }
  const cube = new THREE_NS.CubeTexture(images);
  cube.needsUpdate = true;
  cube.colorSpace = THREE_NS.SRGBColorSpace || THREE_NS.LinearSRGBColorSpace || undefined;
  cube.generateMipmaps = false;
  cube.minFilter = THREE_NS.LinearFilter;
  cube.magFilter = THREE_NS.LinearFilter;
  cube.mapping = THREE_NS.CubeReflectionMapping;
  return cube;
}

function ensureModelSkyFromAssets(ctx, state, THREE_NS, options = {}) {
  const cache = ensureSkyCache(ctx);
  const worldScene = getWorldScene(ctx);
  if (!ctx || !worldScene || !THREE_NS) return false;
  const skyDebugMode = typeof options.skyDebugMode === 'string'
    ? options.skyDebugMode
    : (ctx.skyDebugMode || null);
  const forceCube = skyDebugMode === 'cube' || skyDebugMode === 'off';
  const forceShader = skyDebugMode === 'mj-sky-shader' || skyDebugMode === 'shader';
  const cachedModel = cache?.model;

  if (!forceCube && cachedModel?.envRT && cachedModel?.background && cachedModel.kind === 'shader') {
    const dome = ensureSkyDome(ctx, THREE_NS);
    updateSkyDome(ctx, cachedModel.palette || null, THREE_NS);
    if (dome) dome.visible = true;
    worldScene.environment = cachedModel.envRT.texture || null;
    worldScene.background = cachedModel.background;
    ctx.envRT = cachedModel.envRT;
    ctx.envIntensity = 1.0;
    ctx.skyBackground = cachedModel.background;
    ctx.skyMode = 'shader';
    ctx.skyPalette = cachedModel.palette || null;
    ctx.skyCube = cachedModel.cube || null;
    ctx.envFromHDRI = false;
    ctx.hdriReady = false;
    ctx.envDirty = false;
    pushSkyDebug(ctx, { mode: 'model-sky-shader-cache', stats: cachedModel.stats || null });
    return true;
  }
  if (!forceShader && cachedModel?.envRT && cachedModel?.cube && cachedModel.kind === 'cube') {
    worldScene.environment = cachedModel.envRT.texture || null;
    worldScene.background = cachedModel.cube;
    if (ctx.skyShader) ctx.skyShader.visible = false;
    ctx.envRT = cachedModel.envRT;
    ctx.envIntensity = 1.0;
    ctx.skyBackground = cachedModel.cube;
    ctx.skyMode = 'cube';
    ctx.skyCube = cachedModel.cube;
    ctx.envFromHDRI = false;
    ctx.hdriReady = false;
    ctx.envDirty = false;
    pushSkyDebug(ctx, { mode: 'model-sky-cube-cache', stats: cachedModel.stats || null });
    return true;
  }

  const skyTex = readSkyboxTextureFromAssets(state);
  if (!skyTex) return false;
  if (!ctx.pmrem && ctx.renderer) {
    ctx.pmrem = new THREE_NS.PMREMGenerator(ctx.renderer);
  }
  if (!ctx.pmrem) return false;
  const classification = classifySkyboxTexture(THREE_NS, skyTex);
  const palette = classification.palette || extractMjSkyPalette(THREE_NS, skyTex) || {
    zenith: new THREE_NS.Color(0.6, 0.8, 1),
    horizon: new THREE_NS.Color(0.45, 0.6, 0.8),
    ground: new THREE_NS.Color(0.12, 0.16, 0.22),
    brightness: 0.72,
  };
  const useShader = !forceCube && (forceShader || classification.kind === 'builtin');
  const cube = createCubeTextureFromSkybox(THREE_NS, skyTex);
  if (!cube && !useShader) return false;
  const envRT = cube && ctx.pmrem ? ctx.pmrem.fromCubemap(cube) : null;

  if (useShader) {
    const dome = ensureSkyDome(ctx, THREE_NS);
    const background = buildSkyBackground(THREE_NS, palette);
    updateSkyDome(ctx, palette, THREE_NS);
    if (dome) dome.visible = true;
    if (worldScene) {
      worldScene.environment = envRT?.texture || null;
      worldScene.background = background;
    }
    ctx.envRT = envRT || null;
    ctx.envIntensity = 1.0;
    ctx.skyBackground = background;
    ctx.skyMode = 'shader';
    ctx.skyPalette = palette;
    ctx.skyCube = cube || null;
    ctx.envFromHDRI = false;
    ctx.hdriReady = false;
    ctx.envDirty = false;
    ctx.skyInit = true;
    if (cache) {
      cache.model = {
        key: 'model-skybox',
        envRT,
        cube,
        background,
        palette,
        kind: 'shader',
        stats: classification.stats || null,
      };
    }
    pushSkyDebug(ctx, {
      mode: 'model-sky-shader',
      forced: skyDebugMode || null,
      stats: classification.stats || null,
    });
    return true;
  }

  const envTexture = envRT?.texture || null;
  if (worldScene) {
    worldScene.environment = envTexture;
    worldScene.background = cube;
  }
  if (ctx.skyShader) ctx.skyShader.visible = false;
  ctx.envRT = envRT;
  ctx.envIntensity = 1.0;
  ctx.skyBackground = cube;
  ctx.skyMode = 'cube';
  ctx.skyCube = cube;
  ctx.envFromHDRI = false;
  ctx.hdriReady = false;
  ctx.envDirty = false;
  ctx.skyInit = true;
  if (cache) {
    cache.model = {
      key: 'model-skybox',
      envRT,
      cube,
      kind: 'cube',
      stats: classification.stats || null,
    };
  }
  pushSkyDebug(ctx, {
    mode: 'model-sky-cube',
    forced: skyDebugMode || null,
    stats: classification.stats || null,
  });
  return true;
}

function disposeEnvResources(ctx, { resetFlags = true } = {}) {
  const worldScene = getWorldScene(ctx);
  if (worldScene && ctx.envRT && worldScene.environment === ctx.envRT.texture) {
    worldScene.environment = null;
  }
  if (worldScene && ctx.hdriBackground && worldScene.background === ctx.hdriBackground) {
    worldScene.background = null;
  }
  try { ctx.envRT?.dispose?.(); } catch {}
  try { ctx.hdriBackground?.dispose?.(); } catch {}
  ctx.envRT = null;
  ctx.hdriBackground = null;
  if (resetFlags) {
    ctx.envFromHDRI = false;
    ctx.hdriReady = false;
    ctx.hdriLoading = false;
    ctx.hdriLoadPromise = null;
    ctx.hdriLoadGen = ctx.hdriLoadGen || 0;
  }
}

function getWorldScene(ctx) {
  return ctx?.sceneWorld || ctx?.scene || null;
}


export function createVerticalGradientTexture(THREE_NS, topHex, bottomHex, height = 256) {
  const width = 2;
  const h = Math.max(8, height | 0);
  const data = new Uint8Array(width * h * 4);
  const top = new THREE_NS.Color(topHex);
  const bot = new THREE_NS.Color(bottomHex);
  for (let y = 0; y < h; y += 1) {
    const t = y / (h - 1);
    const r = bot.r * t + top.r * (1 - t);
    const g = bot.g * t + top.g * (1 - t);
    const b = bot.b * t + top.b * (1 - t);
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      data[i + 0] = Math.round(r * 255);
      data[i + 1] = Math.round(g * 255);
      data[i + 2] = Math.round(b * 255);
      data[i + 3] = 255;
    }
  }
  const tex = new THREE_NS.DataTexture(data, width, h);
  tex.needsUpdate = true;
  tex.magFilter = THREE_NS.LinearFilter;
  tex.minFilter = THREE_NS.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.colorSpace = THREE_NS.SRGBColorSpace;
  return tex;
}

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function colorL1(a, b) {
  if (!a || !b) return 0;
  return Math.abs((a[0] ?? 0) - (b[0] ?? 0))
    + Math.abs((a[1] ?? 0) - (b[1] ?? 0))
    + Math.abs((a[2] ?? 0) - (b[2] ?? 0));
}

function computeRowVariance(skyTex, faceIndex, row, step = 1) {
  const { width, nchan, data } = skyTex;
  const faces = Math.max(1, Math.floor(skyTex.height / width));
  if (faceIndex < 0 || faceIndex >= faces) return 0;
  const faceSize = width * width * nchan;
  const base = faceIndex * faceSize;
  const r = Math.max(0, Math.min(width - 1, Math.floor(row)));
  const stride = Math.max(1, Math.floor(step) || 1);
  let mean = [0, 0, 0];
  let count = 0;
  for (let x = 0; x < width; x += stride) {
    const idx = base + (r * width + x) * nchan;
    if (idx + 2 >= data.length) break;
    mean[0] += data[idx + 0] || 0;
    mean[1] += data[idx + 1] || 0;
    mean[2] += data[idx + 2] || 0;
    count += 1;
  }
  if (count === 0) return 0;
  mean = mean.map((v) => v / count);
  let varSum = 0;
  for (let x = 0; x < width; x += stride) {
    const idx = base + (r * width + x) * nchan;
    if (idx + 2 >= data.length) break;
    varSum += Math.abs((data[idx + 0] || 0) - mean[0]);
    varSum += Math.abs((data[idx + 1] || 0) - mean[1]);
    varSum += Math.abs((data[idx + 2] || 0) - mean[2]);
  }
  const inv = 1 / (count * 255);
  return varSum * inv;
}

function sampleFaceBand(skyTex, faceIndex, rowStart, rowEnd, step = 1) {
  const { width, nchan, data } = skyTex;
  const faces = Math.max(1, Math.floor(skyTex.height / width));
  if (faceIndex < 0 || faceIndex >= faces) return [0.5, 0.5, 0.5];
  const faceSize = width * width * nchan;
  const base = faceIndex * faceSize;
  const startRow = Math.max(0, Math.min(width, Math.floor(rowStart)));
  const endRow = Math.max(startRow + 1, Math.min(width, Math.floor(rowEnd)));
  const stride = Math.max(1, Math.floor(step) || 1);
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let count = 0;
  for (let y = startRow; y < endRow; y += stride) {
    const rowBase = base + y * width * nchan;
    for (let x = 0; x < width; x += stride) {
      const idx = rowBase + x * nchan;
      if (idx + 2 >= data.length) break;
      sumR += data[idx + 0] || 0;
      sumG += data[idx + 1] || 0;
      sumB += data[idx + 2] || 0;
      count += 1;
    }
  }
  if (count === 0) return [0.5, 0.5, 0.5];
  const inv = 1 / (count * 255);
  return [sumR * inv, sumG * inv, sumB * inv].map(clamp01);
}

function extractMjSkyPalette(THREE_NS, skyTex) {
  if (!skyTex || !skyTex.data || !THREE_NS) return null;
  const { width, height, nchan } = skyTex;
  if (!(width > 0 && height >= width && nchan >= 3)) return null;
  const faces = Math.max(1, Math.floor(height / width));
  const step = Math.max(1, Math.floor(width / 64));
  const top = sampleFaceBand(skyTex, 0, 0, Math.max(2, Math.floor(width * 0.16)), step);
  const horizon = sampleFaceBand(skyTex, 0, Math.floor(width * 0.45), Math.floor(width * 0.62), step);
  const ground = sampleFaceBand(skyTex, 0, Math.floor(width * 0.78), width, step);
  const toColor = (arr, fallback) => {
    const [r, g, b] = Array.isArray(arr) && arr.length >= 3 ? arr : fallback || [0.5, 0.6, 0.8];
    return new THREE_NS.Color().setRGB(clamp01(r), clamp01(g), clamp01(b));
  };
  const zenith = toColor(top, [0.6, 0.8, 1]);
  const horizonColor = toColor(horizon, [0.45, 0.6, 0.8]);
  const groundColor = toColor(ground, [0.08, 0.11, 0.18]);
  const brightness = clamp01((horizon[0] + horizon[1] + horizon[2]) / 3);
  return {
    zenith,
    horizon: horizonColor,
    ground: groundColor,
    brightness,
    samples: { top, horizon, ground },
    faces,
  };
}

function classifySkyboxTexture(THREE_NS, skyTex) {
  if (!skyTex || !skyTex.data) return { kind: 'unknown', palette: null, stats: null };
  const { width, height, nchan, data } = skyTex;
  if (!(width > 0 && height > 0 && nchan >= 3)) {
    return { kind: 'unknown', palette: null, stats: null };
  }
  const faces = Math.min(6, Math.max(1, Math.floor(height / width)));
  const faceSize = width * width * nchan;
  const step = Math.max(1, Math.floor(width / 64));
  const faceMeans = [];
  for (let i = 0; i < faces; i += 1) {
    const base = i * faceSize;
    if (base + nchan >= data.length) break;
    faceMeans.push(sampleFaceBand(skyTex, i, 0, width, step));
  }
  let maxFaceDiff = 0;
  for (let i = 0; i < faceMeans.length; i += 1) {
    for (let j = i + 1; j < faceMeans.length; j += 1) {
      maxFaceDiff = Math.max(maxFaceDiff, colorL1(faceMeans[i], faceMeans[j]));
    }
  }
  const palette = extractMjSkyPalette(THREE_NS, skyTex);
  const gradMag = palette?.samples
    ? colorL1(palette.samples.top, palette.samples.ground)
    : 0;
  const uniformFaces = maxFaceDiff < 0.35;
  const rowVar = computeRowVariance(skyTex, 0, width * 0.5, Math.max(1, Math.floor(width / 64)));
  const gradientLike = gradMag > 0.2 && rowVar < 0.02;
  const likelyBuiltin = faces === 6 && (uniformFaces || gradientLike);
  return {
    kind: likelyBuiltin ? 'builtin' : 'file',
    palette,
    stats: {
      faces: faceMeans.length,
      maxFaceDiff,
      gradientMag: gradMag,
      uniformFaces,
      rowVar,
    },
  };
}

function createSkyShaderMaterial(THREE_NS) {
  const uniforms = {
    uZenithColor: { value: new THREE_NS.Color(0.6, 0.8, 1.0) },
    uHorizonColor: { value: new THREE_NS.Color(0.45, 0.6, 0.8) },
    uGroundColor: { value: new THREE_NS.Color(0.08, 0.11, 0.18) },
    uSunDirection: { value: new THREE_NS.Vector3(0.15, 0.35, 0.92) },
    uExposure: { value: 1.0 },
    uGradientPower: { value: 1.1 },
    uHorizonSharpness: { value: 0.6 },
    uEffectStrength: { value: 0.25 },
    uBaseAlpha: { value: 0.04 },
  };
  const vertexShader = `
    varying vec3 vWorldDirection;
    void main() {
      vec4 worldPos = modelMatrix * vec4(position, 1.0);
      vWorldDirection = normalize(worldPos.xyz - cameraPosition);
      gl_Position = projectionMatrix * viewMatrix * worldPos;
    }
  `;
  const fragmentShader = `
    varying vec3 vWorldDirection;
    uniform vec3 uZenithColor;
    uniform vec3 uHorizonColor;
    uniform vec3 uGroundColor;
    uniform vec3 uSunDirection;
    uniform float uExposure;
    uniform float uGradientPower;
    uniform float uHorizonSharpness;
    uniform float uEffectStrength;
    uniform float uBaseAlpha;

    float remapUp(float v) {
      return clamp(v * 0.5 + 0.5, 0.0, 1.0);
    }

    void main() {
      vec3 dir = normalize(vWorldDirection);
      float up = remapUp(dir.z);
      float grad = pow(clamp(up, 0.0, 1.0), uGradientPower);
      // Base vertical gradient between ground and zenith; keep this as close
      // as possible to the MuJoCo strip-derived colors. Horizon color is not
      // mixed into the base so that non-solar regions visually match the
      // underlying gradient/background.
      vec3 base = mix(uGroundColor, uZenithColor, grad);

      // Localised sun highlight; keep most of the sky close to the base gradient
      vec3 sunDir = normalize(uSunDirection);
      float sunAmount = max(dot(sunDir, dir), 0.0);

      // --- Anisotropic halo shape: vertical streak broader than horizontal ---
      vec3 sunHoriz = normalize(vec3(sunDir.x, sunDir.y, 0.0));
      vec3 dirHoriz = normalize(vec3(dir.x, dir.y, 0.0));
      float horizDot = dot(sunHoriz, dirHoriz);
      if (!all(greaterThan(vec3(length(sunHoriz)), vec3(1e-4)))) {
        horizDot = 1.0;
      }
      horizDot = clamp(horizDot, -1.0, 1.0);
      // Horizontal: keep relatively tight around sun azimuth
      float horizMask = smoothstep(0.92, 0.99, horizDot);

      float sunUp = remapUp(sunDir.z);
      float upDiff = abs(up - sunUp);
      // Vertical: allow a noticeably wider band to create a streak
      float vertMask = smoothstep(0.9, -0.05, upDiff);

      float shapeMask = clamp(horizMask * vertMask, 0.0, 1.0);

      // Radial falloff for core and halo
      // - core: sharper highlight very close to the sun
      // - halo: slower decay so the influence extends further but remains subtle
      float glow = pow(sunAmount, 12.0);
      float halo = pow(sunAmount, 1.5);

      // Blend towards brighter/whiter near the sun, but keep base colour visible
      vec3 glowColor = mix(base, vec3(1.0), 0.6);
      vec3 haloColor = mix(base, uZenithColor, 0.4);

      float intensity = uEffectStrength * shapeMask;
      vec3 color = base
        + glowColor * glow * intensity
        + haloColor * halo * (intensity * 0.4);

      // Simple exposure; keep contrast and saturation
      color *= uExposure;
      color = clamp(color, 0.0, 1.0);

      // Angle-dependent alpha: far from the sun we are almost transparent,
      // near the sun we blend in more strongly (matching the halo radius).
      float alphaSun = clamp(intensity + intensity * 0.4 * halo, 0.0, 1.0);
      float alpha = clamp(uBaseAlpha + alphaSun, 0.0, 1.0);
      gl_FragColor = vec4(color, alpha);
    }
  `;
  const material = new THREE_NS.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    side: THREE_NS.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
    toneMapped: false,
    transparent: true,
    blending: THREE_NS.NormalBlending,
  });
  return material;
}

function ensureSkyDome(ctx, THREE_NS) {
  const worldScene = getWorldScene(ctx);
  if (!ctx || !THREE_NS || !worldScene) return null;
  if (ctx.skyShader && ctx.skyShader.material && ctx.skyShader.geometry) return ctx.skyShader;
  const geometry = new THREE_NS.SphereGeometry(1, 48, 32);
  const material = createSkyShaderMaterial(THREE_NS);
  const dome = new THREE_NS.Mesh(geometry, material);
  dome.name = 'mj_sky_shader';
  dome.frustumCulled = false;
  dome.renderOrder = -100;
  worldScene.add(dome);
  ctx.skyShader = dome;
  return dome;
}

function updateSkyDome(ctx, palette, THREE_NS) {
  if (!ctx?.skyShader || !palette) return;
  const mat = ctx.skyShader.material;
  if (!mat || !mat.uniforms) return;
  if (palette.zenith) mat.uniforms.uZenithColor.value.copy(palette.zenith);
  if (palette.horizon) mat.uniforms.uHorizonColor.value.copy(palette.horizon);
  if (palette.ground) mat.uniforms.uGroundColor.value.copy(palette.ground);
  const brightness = clamp01(palette.brightness ?? 0.7);
  // Keep exposure very close to 1 so we stay near the underlying gradient
  mat.uniforms.uExposure.value = 0.95 + brightness * 0.1;          // ~[0.95, 1.05]
  // Gentle tweak of gradient steepness
  mat.uniforms.uGradientPower.value = 1.0 + (0.5 - brightness) * 0.2;
  // Horizon sharpness: dimmer skies get a slightly stronger band, still subtle
  mat.uniforms.uHorizonSharpness.value = 0.5 + (1.0 - brightness) * 0.2;
  // Effect and base alpha: keep very subtle by default; uBaseAlpha can be
  // driven lower if we want the sky layer to be almost invisible away from
  // the sun direction.
  if (mat.uniforms.uEffectStrength) {
    mat.uniforms.uEffectStrength.value = 0.25;
  }
  if (mat.uniforms.uBaseAlpha) {
    mat.uniforms.uBaseAlpha.value = 0.03;
  }
  if (ctx.light) {
    const sun = ctx.light.position.clone().normalize();
    mat.uniforms.uSunDirection.value.copy(sun);
  }
  mat.needsUpdate = true;
  const worldScene = getWorldScene(ctx);
  const far = ctx?.camera && Number.isFinite(ctx.camera.far) && ctx.camera.far > 0 ? ctx.camera.far : 1000;
  const radius = Math.max(50, Math.min(far * 0.9, 120000));
  try { ctx.skyShader.scale.setScalar(radius); } catch {}
  if (worldScene && !ctx.skyShader.parent) {
    worldScene.add(ctx.skyShader);
  }
}

function buildSkyBackground(THREE_NS, palette) {
  const top = palette?.zenith ? palette.zenith.getHex() : 0x99ccff;
  const bottom = palette?.ground ? palette.ground.getHex() : 0x0b1018;
  return createVerticalGradientTexture(THREE_NS, top, bottom, 96);
}

function isPresetMode(state) {
  const mode = state?.visualSourceMode;
  return mode === 'preset-sun' || mode === 'preset-moon';
}

function currentPresetKeyFromState(state) {
  const mode = state?.visualSourceMode;
  if (mode === 'preset-moon') return 'moon';
  if (mode === 'preset-sun') return 'sun';
  // Default to sun when not in an explicit preset mode.
  return 'sun';
}

function ensureBaseLightingCache(ctx) {
  if (!ctx) return;
  if (!ctx._baseLighting) {
    ctx._baseLighting = {
      exposure: ctx.renderer ? ctx.renderer.toneMappingExposure : null,
      ambientIntensity: ctx.ambient ? ctx.ambient.intensity : null,
      ambientColor: ctx.ambient ? ctx.ambient.color.clone() : null,
      hemiIntensity: ctx.hemi ? ctx.hemi.intensity : null,
      hemiSky: ctx.hemi ? ctx.hemi.color.clone() : null,
      hemiGround: ctx.hemi ? ctx.hemi.groundColor.clone() : null,
      lightIntensity: ctx.light ? ctx.light.intensity : null,
      lightColor: ctx.light ? ctx.light.color.clone() : null,
      lightPosition: ctx.light ? ctx.light.position.clone() : null,
      lightTargetPosition: ctx.lightTarget ? ctx.lightTarget.position.clone() : null,
      fillIntensity: ctx.fill ? ctx.fill.intensity : null,
      fillColor: ctx.fill ? ctx.fill.color.clone() : null,
      fillPosition: ctx.fill ? ctx.fill.position.clone() : null,
    };
  }
}

function restoreBaseLighting(ctx) {
  if (!ctx || !ctx._baseLighting) return;
  const base = ctx._baseLighting;
  if (ctx.renderer && base.exposure != null) {
    ctx.renderer.toneMappingExposure = base.exposure;
  }
  if (ctx.ambient) {
    if (base.ambientIntensity != null) ctx.ambient.intensity = base.ambientIntensity;
    if (base.ambientColor) ctx.ambient.color.copy(base.ambientColor);
  }
  if (ctx.hemi) {
    if (base.hemiIntensity != null) ctx.hemi.intensity = base.hemiIntensity;
    if (base.hemiSky) ctx.hemi.color.copy(base.hemiSky);
    if (base.hemiGround) ctx.hemi.groundColor.copy(base.hemiGround);
  }
  if (ctx.light) {
    if (base.lightIntensity != null) ctx.light.intensity = base.lightIntensity;
    if (base.lightColor) ctx.light.color.copy(base.lightColor);
    if (base.lightPosition) ctx.light.position.copy(base.lightPosition);
  }
  if (ctx.lightTarget && base.lightTargetPosition) {
    ctx.lightTarget.position.copy(base.lightTargetPosition);
    ctx.light.target?.updateMatrixWorld?.();
  }
  if (ctx.fill) {
    if (base.fillIntensity != null) ctx.fill.intensity = base.fillIntensity;
    if (base.fillColor) ctx.fill.color.copy(base.fillColor);
    if (base.fillPosition) ctx.fill.position.copy(base.fillPosition);
  }
}

export function createEnvironmentManager({
  THREE_NS,
  store,
  skyOffParam,
  fallbackEnabledDefault,
  skyDebugModeParam,
}) {
  function ensureOutdoorSkyEnv(ctx, preset, generation = null, options = {}) {
    const worldScene = getWorldScene(ctx);
    if (!ctx || !ctx.renderer || !worldScene) return;
    const cache = ensureSkyCache(ctx);
    if (typeof skyOffParam !== 'undefined' && skyOffParam) {
      return;
    }
    if (ctx.hdriFailed) {
      return;
    }
    const hdriGen = typeof generation === 'number' ? generation : (ctx.hdriLoadGen ?? 0);
    if (!ctx.pmrem) {
      ctx.pmrem = new THREE_NS.PMREMGenerator(ctx.renderer);
    }
    const allowHDRI = options.allowHDRI !== false;
    // Decide which preset HDRI to use based on viewer state and preset config:
    // - preset.hdri (if provided) has priority
    // - otherwise fall back to legacy sun/moon mapping
    const state = store && typeof store.get === 'function' ? store.get() : null;
    const visualPresetKey = currentPresetKeyFromState(state);
    const defaultUrl = visualPresetKey === 'moon'
      ? 'starmap_random_2020_4k_rot.exr'
      : 'rustig_koppie_puresky_4k.hdr';
    const url = (preset && typeof preset.hdri === 'string' && preset.hdri.length)
      ? preset.hdri
      : defaultUrl;
    const hdrReady =
      ctx.envFromHDRI &&
      ctx.envRT &&
      ctx.hdriReady &&
      ctx.hdriActiveKey === url;
    if (hdrReady) {
      return;
    }
    const cachedPreset = cache?.preset;
    if (
      allowHDRI &&
      cachedPreset?.envRT &&
      cachedPreset.background &&
      cachedPreset.key === url
    ) {
      ctx.envRT = cachedPreset.envRT;
      ctx.hdriBackground = cachedPreset.background;
      ctx.envIntensity = preset?.envIntensity ?? 1.6;
      ctx.envFromHDRI = true;
      ctx.hdriReady = true;
      ctx.hdriActiveKey = cachedPreset.key || null;
      ctx.envDirty = false;
      worldScene.environment = cachedPreset.envRT.texture;
      worldScene.background = cachedPreset.background;
      if ('backgroundIntensity' in worldScene) {
        worldScene.backgroundIntensity = 1.0;
      }
      if ('backgroundBlurriness' in worldScene) {
        worldScene.backgroundBlurriness = 0.0;
      }
      pushSkyDebug(ctx, {
        mode: 'preset-cache',
        presetMode: true,
        allowHDRI: true,
        key: cachedPreset.key || 'cache',
      });
      return;
    }
    if (
      allowHDRI &&
      !ctx.hdriLoading &&
      !ctx.hdriLoadPromise
    ) {
      const tryLoadHDRI = async (hdriUrl, token) => {
        try {
          const urlStr = String(hdriUrl || '');
          const lowered = urlStr.toLowerCase();
          const isEXR = lowered.endsWith('.exr');
          const isHDR = lowered.endsWith('.hdr');
          let loader = null;
          if (isEXR) {
            const mod = await import('three/addons/loaders/EXRLoader.js');
            if (!mod || !mod.EXRLoader) return false;
            loader = new mod.EXRLoader().setDataType(THREE_NS.FloatType);
          } else {
            const mod = await import('three/addons/loaders/RGBELoader.js');
            if (!mod || !mod.RGBELoader) return false;
            loader = new mod.RGBELoader().setDataType(THREE_NS.FloatType);
          }
          if (typeof console !== 'undefined') console.log('[env] trying HDRI', hdriUrl);
          ctx.hdriLoading = true;
          const hdr = await new Promise((resolve, reject) =>
            loader.load(hdriUrl, resolve, undefined, reject),
          );
          hdr.mapping = THREE_NS.EquirectangularReflectionMapping;
          const isUByte = hdr.type === THREE_NS.UnsignedByteType;
          if (!isEXR && THREE_NS.SRGBColorSpace && isUByte) {
            hdr.colorSpace = THREE_NS.SRGBColorSpace;
          } else if (THREE_NS.LinearSRGBColorSpace) {
            hdr.colorSpace = THREE_NS.LinearSRGBColorSpace;
          }
          hdr.minFilter = THREE_NS.LinearFilter;
          hdr.magFilter = THREE_NS.LinearFilter;
          hdr.generateMipmaps = false;
          hdr.needsUpdate = true;
          const envRT = ctx.pmrem.fromEquirectangular(hdr);
          const envTexture = envRT.texture;
          if (THREE_NS.LinearSRGBColorSpace && envTexture) {
            envTexture.colorSpace = THREE_NS.LinearSRGBColorSpace;
          }
          if (ctx.hdriLoadGen !== token || !isPresetMode(store.get())) {
            try { envRT?.dispose?.(); } catch {}
            try { hdr?.dispose?.(); } catch {}
            ctx.hdriLoading = false;
            return false;
          }
          const prevEnvRT = ctx.envRT;
          const prevHdr = ctx.hdriBackground;
          ctx.envRT = envRT;
          ctx.hdriBackground = hdr;
          ctx.envFromHDRI = true;
          ctx.hdriReady = true;
          ctx.envDirty = false;
          worldScene.environment = envTexture;
          worldScene.background = hdr;
          if ('backgroundIntensity' in worldScene) {
            worldScene.backgroundIntensity = 1.0;
          }
          if ('backgroundBlurriness' in worldScene) {
            worldScene.backgroundBlurriness = 0.0;
          }
          if (cache) {
            cache.preset = {
              key: hdriUrl,
              envRT,
              background: hdr,
            };
          }
          const intensity = typeof preset?.envIntensity === 'number' ? preset.envIntensity : 1.0;
          if (typeof console !== 'undefined') {
            console.log('[env] HDRI loaded', { url: hdriUrl, intensity });
          }
          ctx.envIntensity = intensity;
          ctx._envDebugPreset = {
            key: visualPresetKey,
            url: hdriUrl,
            envIntensity: intensity,
          };
          ctx.hdriActiveKey = hdriUrl;
          ctx.hdriLoading = false;
          return true;
        } catch (error) {
          ctx.hdriLoading = false;
          ctx.hdriReady = false;
          if (typeof console !== 'undefined') {
            console.warn('[env] HDRI load failed', { url: hdriUrl, error: String(error) });
          }
          return false;
        }
      };
      const token = hdriGen;
      ctx.hdriLoadPromise = (async () => {
        // 单一预设：根据当前 visualPresetKey 选择 hausdorf 或 NightSkyHDRI008_4K。
        // eslint-disable-next-line no-await-in-loop
        const ok = await tryLoadHDRI(url, token);
        if (ok) return true;
        ctx.hdriLoading = false;
        if (!ctx.envFromHDRI) {
          ctx.hdriReady = false;
          if (ctx.hdriLoadGen === token) {
            ctx.hdriFailed = true;
          }
        }
        return false;
      })()
        .catch((err) => {
          if (typeof console !== 'undefined') {
            console.warn('[env] HDRI queue failed', err);
          }
          ctx.hdriLoading = false;
          if (!ctx.envFromHDRI) {
            ctx.hdriReady = false;
            if (ctx.hdriLoadGen === token) {
              ctx.hdriFailed = true;
            }
          }
          return false;
        })
        .finally(() => {
          ctx.hdriLoadPromise = null;
        });
    }
    // Fallback: if HDRI未就绪，优先复用 model 缓存，其次再用渐变生成环境。
    if (!ctx.envFromHDRI && !ctx.hdriLoading && !ctx.hdriReady) {
      let envRT = null;
      let background = null;
      const modelCached = cache?.model || null;
      if (modelCached?.envRT && modelCached.background) {
        envRT = modelCached.envRT;
        background = modelCached.background;
      } else {
        const bgTop = preset?.background ?? 0xdde6f4;
        const bgBottom = preset?.backgroundBottom ?? 0x6a8bb3;
        const grad = createVerticalGradientTexture(THREE_NS, bgTop, bgBottom, 256);
        envRT = ctx.pmrem.fromEquirectangular(grad);
        background = grad;
      }
      worldScene.environment = envRT?.texture || null;
      worldScene.background = background;
      ctx.envRT = envRT;
      ctx.envIntensity = typeof preset?.envIntensity === 'number' ? preset.envIntensity : 1.6;
      ctx.hdriBackground = background;
      ctx.envFromHDRI = false;
      ctx.hdriReady = true;
      ctx.envDirty = false;
      if (cache) {
        cache.preset = {
          key: modelCached?.key || 'preset-fallback',
          envRT,
          background,
        };
      }
      pushSkyDebug(ctx, {
        mode: 'preset-gradient-fallback',
        allowHDRI,
        generation: generation || 0,
      });
    }
  }

  function applyFallbackAppearance(ctx, state) {
    const fallback = ctx.fallback || { enabled: fallbackEnabledDefault, preset: 'sun' };
    const renderer = ctx.renderer;
    ensureBaseLightingCache(ctx);
    const presetMode = isPresetMode(state);
    fallback.enabled = fallbackEnabledDefault && presetMode;
    if (!fallback.enabled) {
      restoreBaseLighting(ctx);
      return;
    }
    const stateSnapshot = store && typeof store.get === 'function' ? store.get() : null;
    const visualPresetKey = currentPresetKeyFromState(stateSnapshot);
    const presetKey = visualPresetKey === 'moon' ? 'moon' : 'sun';
    const preset = FALLBACK_PRESETS[presetKey] || FALLBACK_PRESETS.sun;
    if (renderer && preset.exposure != null) {
      renderer.toneMappingExposure = preset.exposure;
    }

    // In preset mode, always apply preset lights, regardless of model-defined lights.
    if (ctx.ambient) {
      const ambientCfg = preset.ambient || {};
      ctx.ambient.color.setHex(ambientCfg.color ?? 0xffffff);
      ctx.ambient.intensity = ambientCfg.intensity ?? 0.2;
    }
    if (ctx.hemi) {
      const hemiCfg = preset.hemi || {};
      ctx.hemi.color.setHex(hemiCfg.sky ?? 0xffffff);
      ctx.hemi.groundColor.setHex(hemiCfg.ground ?? 0x20242f);
      ctx.hemi.intensity = hemiCfg.intensity ?? 0.6;
    }
    if (ctx.light) {
      const dirCfg = preset.dir || {};
      ctx.light.color.setHex(dirCfg.color ?? 0xffffff);
      ctx.light.intensity = dirCfg.intensity ?? 1.8;
      if (Array.isArray(dirCfg.position) && dirCfg.position.length === 3) {
        ctx.light.position.set(dirCfg.position[0], dirCfg.position[1], dirCfg.position[2]);
      }
      if (ctx.lightTarget && Array.isArray(dirCfg.target) && dirCfg.target.length === 3) {
        ctx.lightTarget.position.set(dirCfg.target[0], dirCfg.target[1], dirCfg.target[2]);
        ctx.light.target?.updateMatrixWorld?.();
      }
      if (ctx.light.shadow) {
        ctx.light.shadow.bias =
          dirCfg.shadowBias ?? preset.shadowBias ?? ctx.light.shadow.bias;
      }
    }
    if (ctx.fill) {
      const fillCfg = preset.fill || {};
      ctx.fill.color.setHex(fillCfg.color ?? 0xcfe3ff);
      ctx.fill.intensity = fillCfg.intensity ?? 0.3;
      if (Array.isArray(fillCfg.position) && fillCfg.position.length === 3) {
        ctx.fill.position.set(fillCfg.position[0], fillCfg.position[1], fillCfg.position[2]);
      }
    }
    // Base clear colour for renderer background when skybox/env are disabled.
    const presetClear =
      typeof preset.clearColor === 'number'
        ? preset.clearColor
        : (typeof preset.background === 'number' ? preset.background : null);
    if (presetClear != null) {
      ctx.baseClearHex = presetClear;
    }
    // Expose preset overrides for renderer (ground/infinite + overlays).
    if (ctx.fallback) {
      ctx.fallback.ground = preset.ground || null;
      ctx.fallback.overlays = preset.overlays || null;
      ctx.fallback.fogColor = typeof preset.fogColor === 'number' ? preset.fogColor : null;
    }
  }


  function ensureEnvIfNeeded(ctx, state, options = {}) {
    const presetMode = isPresetMode(state);
    const skyboxEnabled = options.skyboxEnabled !== false;
    const skyDebugMode = typeof options.skyDebugMode === 'string'
      ? options.skyDebugMode
      : skyDebugModeParam || null;
    ctx.skyDebugMode = skyDebugMode;
    const skyMode = !skyboxEnabled
      ? SKY_MODE_NONE
      : (presetMode ? SKY_MODE_PRESET : SKY_MODE_MODEL);
    const modeChanged = ctx._skyMode !== skyMode;
    ctx._skyMode = skyMode;
    ctx._lastPresetMode = presetMode;
    const stateSnapshot = store && typeof store.get === 'function' ? store.get() : null;
    const visualPresetKey = currentPresetKeyFromState(stateSnapshot);
    const presetKey = visualPresetKey === 'moon' ? 'moon' : 'sun';
    const preset = FALLBACK_PRESETS[presetKey] || FALLBACK_PRESETS.sun;
    const cache = ensureSkyCache(ctx);
    if (skyMode === SKY_MODE_PRESET && modeChanged) {
      ctx.hdriFailed = false;
      ctx.hdriLoadGen = (ctx.hdriLoadGen || 0) + 1;
      ctx.envDirty = true;
      // 初始化 preset 缓存：如果 model 有缓存，先复制一份作为基线。
      const modelCached = cache?.model || null;
      if (cache && modelCached && modelCached.envRT && modelCached.background) {
        cache.preset = {
          key: modelCached.key || preset.hdri || presetKey,
          envRT: modelCached.envRT,
          background: modelCached.background,
        };
      }
    }
    if (ctx.fallback) {
      ctx.fallback.ground = preset.ground || null;
      ctx.fallback.overlays = preset.overlays || null;
      ctx.fallback.fogColor = typeof preset.fogColor === 'number' ? preset.fogColor : null;
    }
    const hasEnv = hasModelEnvironment(state);
    const allowHDRI = skyMode === SKY_MODE_PRESET && fallbackEnabledDefault;
    if (skyMode === SKY_MODE_NONE) {
      ctx.envFromHDRI = false;
      ctx.hdriReady = false;
      ctx.envDirty = false;
      detachEnvironment(ctx);
      pushSkyDebug(ctx, {
        mode: 'skip',
        reason: 'skybox-off',
        presetMode,
        hasEnv,
        skyMode,
      });
      return;
    }
    if (skyMode === SKY_MODE_PRESET) {
      // Keep renderer clear colour in sync with the active preset when using HDRI.
      const presetClear =
        typeof preset.clearColor === 'number'
          ? preset.clearColor
          : (typeof preset.background === 'number' ? preset.background : null);
      if (presetClear != null) {
        ctx.baseClearHex = presetClear;
      }
      ensureOutdoorSkyEnv(ctx, preset, ctx.hdriLoadGen || 0, { allowHDRI });
      pushSkyDebug(ctx, {
        mode: 'ensure-preset',
        presetMode: true,
        allowHDRI,
        hasEnv,
        skyMode,
      });
      return;
    }

    // Model mode: prefer MuJoCo-driven sky; clear any HDRI state but keep caches
    ctx.envFromHDRI = false;
    ctx.hdriReady = false;
    const skyOk = ensureModelSkyFromAssets(ctx, state, THREE_NS, { skyDebugMode });
    if (!skyOk) {
      ensureModelGradientEnv(ctx, THREE_NS);
    }
    const worldScene = getWorldScene(ctx);
    if (worldScene && !worldScene.background) {
      worldScene.background = ctx.skyBackground || null;
    }
    pushSkyDebug(ctx, {
      mode: skyOk ? 'ensure-model-sky-tex' : 'ensure-model-sky',
      presetMode: false,
      hasEnv,
      skyMode,
      skyKind: ctx.skyMode || null,
      skyDebugMode,
    });
  }

  return {
    applyFallbackAppearance,
    ensureOutdoorSkyEnv,
    ensureEnvIfNeeded,
    hasModelEnvironment,
    hasModelLights,
    hasModelBackground,
  };
}
