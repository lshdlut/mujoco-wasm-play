export const FALLBACK_PRESET_ALIASES = {
  'bright-outdoor': 'bright-outdoor',
  bright: 'bright-outdoor',
  outdoor: 'bright-outdoor',
};

export const FALLBACK_PRESETS = {
  'bright-outdoor': {
    background: 0xdde6f4,
    exposure: 1.15,
    ambient: { color: 0xf0f4ff, intensity: 0.4 },
    hemi: { sky: 0xf0f4ff, ground: 0x10121a, intensity: 0.6 },
    dir: { color: 0xffffff, intensity: 2.0, position: [6, -5, 4], target: [0, 0, 1], shadowBias: -0.0001 },
    fill: { color: 0xb6d5ff, intensity: 0.45, position: [-4, 3, 2] },
    shadowBias: -0.00015,
    envIntensity: 1.6,
    ground: { style: 'shadow', opacity: 0.35 },
  },
};

const HDRI_FALLBACK_PATHS = [
  'dist/assets/env/sky_clear_4k.hdr',
  'dist/assets/env/hausdorf_clear_sky_4k.hdr',
  'dist/assets/env/autumn_field_puresky_4k.hdr',
];

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

function isPresetMode(state) {
  return (state?.visualSourceMode ?? 'model') === 'preset';
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
  hdriQueryParam,
  fallbackEnabledDefault,
}) {

  function ensureOutdoorSkyEnv(ctx, preset) {
    if (!ctx || !ctx.renderer || !ctx.scene) return;
    if (typeof skyOffParam !== 'undefined' && skyOffParam) {
      try {
        if (ctx.sky) ctx.sky.visible = false;
      } catch {}
    }
    try {
      if (ctx.sky) {
        ctx.sky.visible = !ctx.envFromHDRI;
      }
    } catch {}
    const hdrReady = ctx.envFromHDRI && ctx.envRT && ctx.hdriReady;
    if (hdrReady || ctx.hdriLoading || ctx.hdriLoadPromise) {
      return;
    }
    if (!ctx.pmrem) {
      ctx.pmrem = new THREE_NS.PMREMGenerator(ctx.renderer);
    }
    if (!ctx.envFromHDRI && !hasModelEnvironment(store.get())) {
      const candidates = [];
      if (hdriQueryParam) candidates.push(hdriQueryParam);
      candidates.push(...HDRI_FALLBACK_PATHS);
      const tryLoadHDRI = async (url) => {
        try {
          const mod = await import('three/addons/loaders/RGBELoader.js');
          if (!mod || !mod.RGBELoader) return false;
          const loader = new mod.RGBELoader().setDataType(THREE_NS.FloatType);
          if (typeof console !== 'undefined') console.log('[env] trying HDRI', url);
          ctx.hdriLoading = true;
          const hdr = await new Promise((resolve, reject) =>
            loader.load(url, resolve, undefined, reject)
          );
          hdr.mapping = THREE_NS.EquirectangularReflectionMapping;
          const isUByte = hdr.type === THREE_NS.UnsignedByteType;
          if (THREE_NS.SRGBColorSpace && isUByte) {
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
          const prevEnvRT = ctx.envRT;
          const prevHdr = ctx.hdriBackground;
          ctx.envRT = envRT;
          ctx.hdriBackground = hdr;
          ctx.envFromHDRI = true;
          ctx.hdriReady = true;
          ctx.envDirty = false;
          if (ctx.scene) {
            ctx.scene.environment = envTexture;
            ctx.scene.background = hdr;
            if ('backgroundIntensity' in ctx.scene) {
              ctx.scene.backgroundIntensity = 1.0;
            }
            if ('backgroundBlurriness' in ctx.scene) {
              ctx.scene.backgroundBlurriness = 0.0;
            }
          }
          // dispose previous resources now that replacements are active
          try { prevEnvRT?.dispose?.(); } catch {}
          try { prevHdr?.dispose?.(); } catch {}
          const intensity = preset?.envIntensity ?? 1.7;
          if (typeof console !== 'undefined') console.log('[env] HDRI loaded', { url, intensity });
          ctx.envIntensity = intensity;
          ctx.hdriLoading = false;
          return true;
        } catch (error) {
          ctx.hdriLoading = false;
          ctx.hdriReady = false;
          if (typeof console !== 'undefined') {
            console.warn('[env] HDRI load failed', { url, error: String(error) });
          }
          return false;
        }
      };
      ctx.hdriLoadPromise = (async () => {
        for (const url of candidates) {
          // eslint-disable-next-line no-await-in-loop
          if (await tryLoadHDRI(url)) {
            return true;
          }
        }
        ctx.hdriLoading = false;
        if (!ctx.envFromHDRI) {
          ctx.hdriReady = false;
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
          }
          return false;
        })
        .finally(() => {
          ctx.hdriLoadPromise = null;
        });
    }
    if (!ctx.skyInit) {
      ctx.skyInit = true;
      try {
        import('three/addons/objects/Sky.js')
          .then((mod) => {
            if (!mod || !mod.Sky) return;
            const sky = new mod.Sky();
            sky.name = 'procedural_sky';
            const far = ctx?.camera?.far ? ctx.camera.far : 100;
            const radius = Math.max(10, Math.min(far * 0.9, 90000));
            sky.scale.setScalar(radius);
            try {
              sky.rotation.x = Math.PI / 2;
            } catch {}
            if (sky.material) {
              sky.material.depthWrite = false;
              sky.material.depthTest = false;
              if (typeof THREE_NS.BackSide !== 'undefined') {
                sky.material.side = THREE_NS.BackSide;
              }
            }
            ctx.scene.add(sky);
            ctx.sky = sky;
            ctx.sunVec = new THREE_NS.Vector3();
          })
          .catch(() => {});
      } catch {}
    }
    if (!ctx.envFromHDRI && ctx.sky && ctx.pmrem) {
      const sky = ctx.sky;
      const uniforms = sky.material.uniforms;
      const cfg = preset || {};
      uniforms['turbidity'].value = 5.0;
      uniforms['rayleigh'].value = 2.5;
      uniforms['mieCoefficient'].value = 0.004;
      uniforms['mieDirectionalG'].value = 0.8;
      if (ctx.light) {
        const L = ctx.light.position.clone().normalize();
        ctx.sunVec.copy(L);
        uniforms['sunPosition'].value.copy(ctx.sunVec);
      }
      if (!ctx.envRT || ctx.envDirty) {
        if (ctx.envRT) {
          ctx.envRT.dispose();
        }
        ctx.envRT = ctx.pmrem.fromScene(sky);
        if (ctx.scene) ctx.scene.environment = ctx.envRT.texture;
        ctx.envDirty = false;
        const intensity = cfg.envIntensity ?? 1.3;
        ctx.envIntensity = intensity;
      }
      if (ctx.scene) {
        ctx.scene.background = null;
      }
    }
  }

  function applyFallbackAppearance(ctx, state) {
    const fallback = ctx.fallback || { enabled: fallbackEnabledDefault, preset: 'bright-outdoor' };
    const renderer = ctx.renderer;
    ensureBaseLightingCache(ctx);
    const presetMode = isPresetMode(state);
    fallback.enabled = fallbackEnabledDefault && presetMode;
    if (!fallback.enabled) {
      restoreBaseLighting(ctx);
      return;
    }
    const preset = FALLBACK_PRESETS['bright-outdoor'];
    if (renderer && preset.exposure != null) {
      renderer.toneMappingExposure = preset.exposure;
    }

    if (!hasModelLights(state)) {
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
    }
  }

  function ensureEnvIfNeeded(ctx, state) {
    const fallback = ctx.fallback || { enabled: fallbackEnabledDefault, preset: 'bright-outdoor' };
    const preset = FALLBACK_PRESETS['bright-outdoor'];
    const presetMode = isPresetMode(state);
    fallback.enabled = fallbackEnabledDefault && presetMode;
    if (!presetMode) {
      if (ctx.scene && ctx.envFromHDRI && ctx.envRT && ctx.scene.environment === ctx.envRT.texture) {
        ctx.scene.environment = null;
      }
      if (ctx.scene && ctx.hdriBackground && ctx.scene.background === ctx.hdriBackground) {
        ctx.scene.background = null;
      }
      if (ctx.sky) {
        ctx.sky.visible = false;
      }
      return;
    }
    if (ctx.envFromHDRI && ctx.envRT && ctx.scene && !ctx.scene.environment) {
      ctx.scene.environment = ctx.envRT.texture;
      if (ctx.hdriBackground) {
        ctx.scene.background = ctx.hdriBackground;
      }
    }
    const hasEnv = hasModelEnvironment(state);
    if (!hasEnv && fallback.enabled) {
      ensureOutdoorSkyEnv(ctx, preset);
    }
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
