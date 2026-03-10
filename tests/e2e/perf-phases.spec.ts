import { expect, test } from '@playwright/test';
import { waitForViewerReady } from './test-utils';

test('perf: init + render phase timings', async ({ page }) => {
  page.on('console', (msg) => {
    // eslint-disable-next-line no-console
    console.log('[browser]', msg.type(), msg.text());
  });

  const url = '/index.html?perf=1&log=1&model=mujoco_Rajagopal2015_simple.xml';
  await waitForViewerReady(page, url);
  await page.evaluate(() => {
    const clear = (window as any).__PLAY_PERF_CLEAR_SAMPLES;
    if (typeof clear === 'function') clear();
  });
  await page.waitForTimeout(6000);
  const sceneStats = await page.evaluate(() => {
    const snap: any = (window as any).__PLAY_HOST__?.getSnapshot?.();
    const n = (snap?.scn_ngeom | 0) || 0;
    const baseNgeom = (snap?.ngeom | 0) || 0;
    const type: any = snap?.scn_type || null;
    const rgba: any = snap?.scn_rgba || null;
    const matid: any = snap?.scn_matid || null;
    const objtype: any = snap?.scn_objtype || null;
    const objid: any = snap?.scn_objid || null;
    const snapshot: any = (window as any).__PLAY_HOST__?.getSnapshot?.() || snap || null;
    const assets: any = snapshot?.renderAssets || null;
    const materials: any = assets?.materials || null;
    const texIdView: any = materials?.texid || null;
    const matCount: number = (materials?.count | 0) || 0;
    const stride: number =
      matCount > 0 && texIdView && texIdView.length >= matCount && texIdView.length % matCount === 0
        ? (texIdView.length / matCount)
        : 1;
    const rolePreferred = stride > 1 ? 1 : 0;
    const counts: Record<string, number> = {};
    const alphaByType: Record<string, { min: number; max: number; unique: Record<string, number> }> = {};
    let opaque = 0;
    let withTexture = 0;
    for (let i = 0; i < n; i += 1) {
      const t = type ? (type[i] | 0) : -1;
      const key = String(t);
      counts[key] = (counts[key] || 0) + 1;
      const a = rgba ? Number(rgba[i * 4 + 3]) : 1;
      if (Number.isFinite(a) && a >= 0.999) opaque += 1;
      const alphaEntry = alphaByType[key] || (alphaByType[key] = { min: 1, max: 0, unique: {} });
      if (Number.isFinite(a)) {
        alphaEntry.min = Math.min(alphaEntry.min, a);
        alphaEntry.max = Math.max(alphaEntry.max, a);
        const q = String(Math.round(a * 1000));
        alphaEntry.unique[q] = (alphaEntry.unique[q] || 0) + 1;
      }
      const mid = matid ? (matid[i] | 0) : -1;
      if (mid >= 0 && texIdView && mid < texIdView.length) {
        const idxPreferred = mid * stride + rolePreferred;
        const idxFallback = mid * stride;
        let texid = idxPreferred >= 0 && idxPreferred < texIdView.length ? (texIdView[idxPreferred] | 0) : -1;
        if (texid < 0 && idxFallback >= 0 && idxFallback < texIdView.length) {
          texid = texIdView[idxFallback] | 0;
        }
        if (texid >= 0) withTexture += 1;
      }
    }

    // Estimate instancing eligibility on the base-geom index space (0..ngeom-1).
    const geomToScn: Int32Array = new Int32Array(Math.max(0, baseNgeom));
    geomToScn.fill(-1);
    for (let i = 0; i < n; i += 1) {
      if (!objtype || !objid) break;
      const ot = objtype[i] | 0;
      if (ot !== 4) continue; // mjOBJ_GEOM
      const gid = objid[i] | 0;
      if (gid >= 0 && gid < geomToScn.length && geomToScn[gid] === -1) geomToScn[gid] = i;
    }
    let eligible = 0;
    let eligibleOpaque = 0;
    let eligibleBlockedByTex = 0;
    for (let gid = 0; gid < geomToScn.length; gid += 1) {
      const si = geomToScn[gid] | 0;
      if (si < 0) continue;
      const gt = type ? (type[si] | 0) : -1;
      const instType = gt === 2 || gt === 3 || gt === 4 || gt === 5 || gt === 6;
      if (!instType) continue;
      eligible += 1;
      const a = rgba ? Number(rgba[si * 4 + 3]) : 1;
      const isOpaque = Number.isFinite(a) && a >= 0.999;
      if (isOpaque) eligibleOpaque += 1;
      const mid = matid ? (matid[si] | 0) : -1;
      let hasTex = false;
      if (mid >= 0 && texIdView && mid < texIdView.length) {
        const idxPreferred = mid * stride + rolePreferred;
        const idxFallback = mid * stride;
        let texid = idxPreferred >= 0 && idxPreferred < texIdView.length ? (texIdView[idxPreferred] | 0) : -1;
        if (texid < 0 && idxFallback >= 0 && idxFallback < texIdView.length) {
          texid = texIdView[idxFallback] | 0;
        }
        hasTex = texid >= 0;
      }
      if (hasTex) eligibleBlockedByTex += 1;
    }
    return {
      ngeom: baseNgeom,
      scn_ngeom: n,
      opaque,
      withTexture,
      typeCounts: counts,
      alphaByType,
      instancingBaseEligible: eligible,
      instancingBaseEligibleOpaque: eligibleOpaque,
      instancingBaseEligibleBlockedByTex: eligibleBlockedByTex,
    };
  });
  // eslint-disable-next-line no-console
  console.log('[scene]', JSON.stringify(sceneStats, null, 2));

  const summary = await page.evaluate(() => {
    const fn = (window as any).__PLAY_PERF_SUMMARY;
    return typeof fn === 'function' ? fn() : null;
  });

  expect(summary).toBeTruthy();
  expect(summary.firstMarks).toBeTruthy();
  expect(summary.firstMarks['play:main:start']).toBeTruthy();
  expect(summary.firstMarks['play:backend:worker_ready']).toBeTruthy();
  expect(summary.firstMarks['play:backend:render_assets']).toBeTruthy();
  expect(summary.firstMarks['play:backend:first_snapshot']).toBeTruthy();
  expect(summary.firstMarks['play:backend:first_scene_snapshot']).toBeTruthy();
  expect(summary.firstMarks['play:renderer:first_renderScene_end']).toBeTruthy();
  expect(summary.firstMarks['play:renderer:first_draw']).toBeTruthy();

  const pick = (key: string) => (summary.sampleStats && summary.sampleStats[key]) ? summary.sampleStats[key] : null;
  const stable = {
    // Prefer p50/p90 to ignore occasional long frames.
    worker_snapshot_ms: pick('worker:snapshot_ms'),
    worker_createSceneSnap_ms: pick('worker:createSceneSnap_ms'),
    worker_to_main_snapshot_transfer_ms: pick('worker_to_main:snapshot_transfer_ms'),
    backend_snapshot_decode_ms: pick('backend:snapshot_decode_ms'),
    backend_notifyListeners_ms: pick('backend:notifyListeners_ms'),
    main_mergeBackendSnapshot_ms: pick('main:mergeBackendSnapshot_ms'),
    main_store_update_ms: pick('main:store_update_ms'),
    main_store_subscriber_ms: pick('main:store_subscriber_ms'),
    main_subscriber_renderScene_ms: pick('main:subscriber_renderScene_ms'),
    main_subscriber_deriveJointDofs_ms: pick('main:subscriber_deriveJointDofs_ms'),
    renderer_renderScene_ms: pick('renderer:renderScene_ms'),
    renderer_apply_scene_soa_ms: pick('renderer:apply_scene_soa_ms'),
    renderer_apply_scene_soa_mesh_ms: pick('renderer:apply_scene_soa_mesh_ms'),
    renderer_apply_scene_soa_xform_ms: pick('renderer:apply_scene_soa_xform_ms'),
    renderer_apply_scene_soa_flags_ms: pick('renderer:apply_scene_soa_flags_ms'),
    renderer_apply_scene_soa_texture_ms: pick('renderer:apply_scene_soa_texture_ms'),
    renderer_apply_scene_soa_misc_ms: pick('renderer:apply_scene_soa_misc_ms'),
    renderer_apply_scene_soa_ensure_calls: pick('renderer:apply_scene_soa_ensure_calls'),
    renderer_apply_scene_soa_ensure_created: pick('renderer:apply_scene_soa_ensure_created'),
    renderer_apply_scene_soa_ensure_rebuilt: pick('renderer:apply_scene_soa_ensure_rebuilt'),
    renderer_apply_scene_soa_ensure_rebuilt_type: pick('renderer:apply_scene_soa_ensure_rebuilt_type'),
    renderer_apply_scene_soa_ensure_rebuilt_infinite: pick('renderer:apply_scene_soa_ensure_rebuilt_infinite'),
    renderer_apply_scene_soa_ensure_rebuilt_dataid: pick('renderer:apply_scene_soa_ensure_rebuilt_dataid'),
    renderer_apply_scene_soa_ensure_rebuilt_size: pick('renderer:apply_scene_soa_ensure_rebuilt_size'),
    renderer_apply_scene_soa_ensure_rebuilt_size_line: pick('renderer:apply_scene_soa_ensure_rebuilt_size_line'),
    renderer_apply_scene_soa_ensure_rebuilt_size_linebox: pick('renderer:apply_scene_soa_ensure_rebuilt_size_linebox'),
    renderer_apply_scene_soa_ensure_rebuilt_size_arrow: pick('renderer:apply_scene_soa_ensure_rebuilt_size_arrow'),
    renderer_apply_scene_soa_ensure_rebuilt_size_triangle: pick('renderer:apply_scene_soa_ensure_rebuilt_size_triangle'),
    renderer_apply_scene_soa_ensure_rebuilt_size_capsule: pick('renderer:apply_scene_soa_ensure_rebuilt_size_capsule'),
    renderer_apply_scene_soa_ensure_rebuilt_size_cylinder: pick('renderer:apply_scene_soa_ensure_rebuilt_size_cylinder'),
    renderer_apply_scene_soa_ensure_rebuilt_size_other_gtype: pick('renderer:apply_scene_soa_ensure_rebuilt_size_other_gtype'),
    renderer_apply_scene_soa_ensure_rebuilt_other: pick('renderer:apply_scene_soa_ensure_rebuilt_other'),
    renderer_apply_scene_soa_texture_calls: pick('renderer:apply_scene_soa_texture_calls'),
    renderer_apply_scene_soa_tex_map_changed: pick('renderer:apply_scene_soa_tex_map_changed'),
    renderer_apply_scene_soa_uv_calls: pick('renderer:apply_scene_soa_uv_calls'),
    renderer_apply_scene_soa_uv_cache_hit: pick('renderer:apply_scene_soa_uv_cache_hit'),
    renderer_apply_scene_soa_uv_recompute: pick('renderer:apply_scene_soa_uv_recompute'),
    renderer_apply_scene_soa_uv_skip: pick('renderer:apply_scene_soa_uv_skip'),
    renderer_apply_scene_soa_uv_hit_rate: pick('renderer:apply_scene_soa_uv_hit_rate'),
    renderer_apply_scene_soa_uv_recompute_rate: pick('renderer:apply_scene_soa_uv_recompute_rate'),
    renderer_apply_scene_soa_color_updates: pick('renderer:apply_scene_soa_color_updates'),
    renderer_apply_scene_soa_opacity_updates: pick('renderer:apply_scene_soa_opacity_updates'),
    renderer_apply_scene_soa_xform_updates: pick('renderer:apply_scene_soa_xform_updates'),
    renderer_apply_scene_soa_xform_infinite_updates: pick('renderer:apply_scene_soa_xform_infinite_updates'),
    renderer_draw_ms: pick('renderer:draw_ms'),
    renderer_draw_calls: pick('renderer:draw_calls'),
    renderer_draw_triangles: pick('renderer:draw_triangles'),
    renderer_program_count: pick('renderer:program_count'),
    renderer_instancing_batches: pick('renderer:instancing_batches'),
    renderer_instancing_instances: pick('renderer:instancing_instances'),
    renderer_transparent_bins: pick('renderer:transparent_bins'),
    renderer_transparent_sort_strict: pick('renderer:transparent_sort_strict'),
    renderer_transparent_candidate_count: pick('renderer:transparent_candidate_count'),
    renderer_transparent_bin_count: pick('renderer:transparent_bin_count'),
    renderer_transparent_bin_migrations: pick('renderer:transparent_bin_migrations'),
    renderer_transparent_instanced_batches: pick('renderer:transparent_instanced_batches'),
    renderer_transparent_instanced_instances: pick('renderer:transparent_instanced_instances'),
    renderer_transparent_sort_ms: pick('renderer:transparent_sort_ms'),
    renderer_transparent_sorted_instances: pick('renderer:transparent_sorted_instances'),
  };

  // eslint-disable-next-line no-console
  console.log('[perf-steady]', JSON.stringify(stable, null, 2));
});

