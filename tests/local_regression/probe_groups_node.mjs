// Node preflight probe: scans loader JS for exported _mjwf_* names and reports group OK/MISS
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../');

const ver = process.argv[2] || '3.3.7';
const dist = path.resolve(root, `local_tools/forge/dist/${ver}`);
const loader = path.resolve(dist, `mujoco-${ver}.js`);

const groups = {
  core: [
    ['_mjwf_helper_make_from_xml'],
    ['_mjwf_helper_model_ptr'],
    ['_mjwf_helper_data_ptr'],
    ['_mjwf_helper_free'],
    ['_mjwf_mj_step'],
    ['_mjwf_mj_resetData'],
    ['_mjwf_model_opt_timestep_ptr'],
    ['_mjwf_data_time_ptr'],
  ],
  views: [
    ['_mjwf_data_qpos_ptr'],
    ['_mjwf_data_qvel_ptr'],
    ['_mjwf_model_nq'],
    ['_mjwf_model_nv'],
  ],
  geom: [
    ['_mjwf_data_geom_xpos_ptr'],
    ['_mjwf_data_geom_xmat_ptr'],
    ['_mjwf_model_ngeom'],
  ],
  material: [
    ['_mjwf_model_geom_type_ptr'],
    ['_mjwf_model_geom_size_ptr'],
    ['_mjwf_model_geom_matid_ptr'],
    ['_mjwf_model_nmat'],
    ['_mjwf_model_mat_rgba_ptr'],
  ],
  joint: [
    ['_mjwf_model_njnt'],
    ['_mjwf_model_jnt_type_ptr'],
    ['_mjwf_model_jnt_qposadr_ptr'],
    ['_mjwf_model_jnt_range_ptr'],
    ['_mjwf_model_name_jntadr_ptr'],
  ],
  act: [
    ['_mjwf_model_nu'],
    ['_mjwf_data_ctrl_ptr'],
    ['_mjwf_model_actuator_ctrlrange_ptr'],
    ['_mjwf_model_name_actuatoradr_ptr'],
  ],
  contact: [
    ['_mjwf_data_ncon'],
  ],
};

try {
  const txt = await readFile(loader, 'utf8');
  const have = new Set();
  // naive scan for symbol names in text (preflight, not ABI-proof but useful)
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/_mjwf_[A-Za-z0-9_]+/g);
    if (m) for (const s of m) have.add(s);
  }
  const ok = {};
  for (const [group, requirements] of Object.entries(groups)) {
    ok[group] = requirements.every((alts) => {
      const names = Array.isArray(alts) ? alts : [alts];
      return names.some((name) => have.has(name));
    });
  }
  const summary = Object.entries(ok).map(([k,v])=>`${k}=${v?'OK':'MISS'}`).join(' ');
  console.log(`probe:${ver}`, summary);
  process.exit(0);
} catch (e) {
  console.error('probe failed:', e.message);
  process.exit(1);
}
