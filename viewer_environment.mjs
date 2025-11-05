export const FALLBACK_PRESET_ALIASES = {
  'bright-outdoor': 'bright-outdoor',
  bright: 'bright-outdoor',
  outdoor: 'bright-outdoor',
  'studio-clean': 'studio-clean',
  clean: 'studio-clean',
  studio: 'studio-clean',
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
  'studio-clean': {
    background: 0xe0e6ef,
    exposure: 1.0,
    ambient: { color: 0xffffff, intensity: 0.0 },
    hemi: { sky: 0xeef5ff, ground: 0xb7bcc2, intensity: 0.8 },
    dir: { color: 0xffffff, intensity: 2.0, position: [5, -6, 4] },
    fill: { color: 0xcfe3ff, intensity: 0.5, position: [-5, 4, 3] },
    shadowBias: -0.0001,
    envIntensity: 1.0,
    ground: { style: 'shadow', opacity: 0.5 },
  },
};

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

function applyEnvRotationToScene(scene, THREE_NS, rx, ry, rz) {
  if (!scene || !THREE_NS) return;
  try {
    if (typeof scene.backgroundRotation !== 'undefined') {
      const val = scene.backgroundRotation;
      if (val && typeof val.set === 'function') {
        val.set(rx, ry, rz);
      } else if (THREE_NS.Euler) {
        scene.backgroundRotation = new THREE_NS.Euler(rx, ry, rz, 'YXZ');
      }
    }
  } catch {}
  try {
    if (typeof scene.environmentRotation !== 'undefined') {
      const val = scene.environmentRotation;
      if (val && typeof val.set === 'function') {
        val.set(rx, ry, rz);
      } else if (THREE_NS.Euler) {
        scene.environmentRotation = new THREE_NS.Euler(rx, ry, rz, 'YXZ');
      }
    }
  } catch {}
}

function createVerticalGradientTexture(THREE_NS, topHex, bottomHex, height = 256) {
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

export function createEnvironmentManager({
  THREE_NS,
  store,
  skyOffParam,
  hdriQueryParam,
  fallbackEnabledDefault,
  fallbackPresetKey,
  envRotation,
}) {
  const envRot = {
    x: envRotation?.x ?? 0,
    y: envRotation?.y ?? 0,
    z: envRotation?.z ?? 0,
  };

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
    if ((ctx.envFromHDRI && ctx.envRT && ctx.scene.environment) || ctx.hdriLoading) {
      return;
    }
    if (!ctx.pmrem) {
      ctx.pmrem = new THREE_NS.PMREMGenerator(ctx.renderer);
    }
    if (!ctx.envFromHDRI && !hasModelEnvironment(store.get())) {
      const candidates = [];
      if (hdriQueryParam) candidates.push(hdriQueryParam);
      candidates.push('local_tools/assets/env/sky_clear_4k.hdr');
      candidates.push('local_tools/assets/env/hausdorf_clear_sky_4k.hdr');
      candidates.push('local_tools/assets/env/autumn_field_puresky_4k.hdr');
      candidates.push('dist/assets/env/sky_clear_4k.hdr');
      candidates.push('dist/assets/env/hausdorf_clear_sky_4k.hdr');
      candidates.push('dist/assets/env/autumn_field_puresky_4k.hdr');
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
          ctx.hdriBackground = hdr;
          ctx.envFromHDRI = true;
          ctx.hdriReady = true;
          const envRT = ctx.pmrem.fromEquirectangular(hdr);
          const envTexture = envRT.texture;
          if (THREE_NS.LinearSRGBColorSpace && envTexture) {
            envTexture.colorSpace = THREE_NS.LinearSRGBColorSpace;
          }
          if (ctx.scene) {
            ctx.scene.environment = envTexture;
            ctx.scene.background = hdr;
            if ('backgroundIntensity' in ctx.scene) {
              ctx.scene.backgroundIntensity = 1.0;
            }
            if ('backgroundBlurriness' in ctx.scene) {
              ctx.scene.backgroundBlurriness = 0.0;
            }
            try {
              applyEnvRotationToScene(ctx.scene, THREE_NS, envRot.x, envRot.y, envRot.z);
            } catch {}
          }
          ctx.envRT = envRT;
          ctx.hdriBackground = hdr;
          ctx.envFromHDRI = true;
          ctx.hdriReady = true;
          const intensity = preset?.envIntensity ?? 1.7;
          if (typeof console !== 'undefined') console.log('[env] HDRI loaded', { url, intensity });
          if (Array.isArray(ctx.meshes)) {
            for (const m of ctx.meshes) {
              if (m && m.material && 'envMapIntensity' in m.material) {
                m.material.envMapIntensity = intensity;
              }
            }
          }
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
      (async () => {
        for (const url of candidates) {
          // eslint-disable-next-line no-await-in-loop
          if (await tryLoadHDRI(url)) {
            ctx.envDirty = false;
            return;
          }
        }
        ctx.hdriLoading = false;
        if (!ctx.envFromHDRI) {
          ctx.hdriReady = false;
        }
      })();
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
        if (Array.isArray(ctx.meshes)) {
          for (const m of ctx.meshes) {
            if (m && m.material && 'envMapIntensity' in m.material) {
              m.material.envMapIntensity = intensity;
            }
          }
        }
      }
      if (ctx.scene) {
        ctx.scene.background = null;
      }
    }
  }

  function applyFallbackAppearance(ctx, state) {
    const fallback = ctx.fallback || { enabled: fallbackEnabledDefault, preset: fallbackPresetKey };
    const preset = FALLBACK_PRESETS[fallback.preset] || FALLBACK_PRESETS[fallbackPresetKey];
    const renderer = ctx.renderer;
    if (renderer) {
      renderer.toneMappingExposure = preset.exposure ?? 1.0;
    }

    if (!fallback.enabled) {
      if (!hasModelLights(state)) {
        if (ctx.ambient) ctx.ambient.intensity = 0;
        if (ctx.hemi) ctx.hemi.intensity = 0;
        if (ctx.light) ctx.light.intensity = 0;
      }
      return;
    }

    if (!hasModelBackground(state) && ctx.scene && !ctx.hdriReady) {
      if (fallback.preset === 'studio-clean') {
        if (!ctx.studioBgTex) {
          ctx.studioBgTex = createVerticalGradientTexture(
            THREE_NS,
            0xeef5ff,
            0xd2dae6,
            256
          );
        }
        ctx.scene.background = ctx.studioBgTex;
        if (ctx.scene.environment) {
          ctx.scene.environment = null;
        }
      } else {
        const noEnv = !ctx.scene.environment;
        const noSky = !ctx.sky;
        if (noEnv && noSky) {
          if (!ctx.outdoorBgTex) {
            ctx.outdoorBgTex = createVerticalGradientTexture(
              THREE_NS,
              0xe7edf5,
              0xcdd5e0,
              256
            );
          }
          ctx.scene.background = ctx.outdoorBgTex;
        }
      }
    }

    if (ctx.scene && fallback.preset === 'bright-outdoor' && !ctx.hdriReady) {
      const noEnv = !ctx.scene.environment;
      const noSky = !ctx.sky;
      const noHdri = !ctx.hdriBackground;
      if (noEnv && noSky && noHdri) {
        if (!ctx.outdoorBgTex) {
          ctx.outdoorBgTex = createVerticalGradientTexture(
            THREE_NS,
            0xe7edf5,
            0xcdd5e0,
            256
          );
        }
        ctx.scene.background = ctx.outdoorBgTex;
      }
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

    const hasEnv = hasModelEnvironment(state);
    if (!hasEnv && fallback.enabled) {
      if (fallback.preset === 'bright-outdoor') {
        ensureOutdoorSkyEnv(ctx, preset);
      } else if (ctx.scene && ctx.scene.environment) {
        ctx.scene.environment = null;
      }
    }
  }

  return {
    applyFallbackAppearance,
    ensureOutdoorSkyEnv,
    applyEnvRotationToScene: (scene, rx, ry, rz) =>
      applyEnvRotationToScene(scene, THREE_NS, rx, ry, rz),
    hasModelEnvironment,
    hasModelLights,
    hasModelBackground,
  };
}
