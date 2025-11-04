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
  core: ['_mjwf_make_from_xml','_mjwf_step','_mjwf_reset','_mjwf_free','_mjwf_timestep','_mjwf_time'],
  views: ['_mjwf_qpos_ptr','_mjwf_qvel_ptr','_mjwf_nq','_mjwf_nv'],
  geom: ['_mjwf_geom_xpos_ptr','_mjwf_geom_xmat_ptr','_mjwf_ngeom'],
  material: ['_mjwf_geom_type_ptr','_mjwf_geom_size_ptr','_mjwf_geom_matid_ptr','_mjwf_nmat','_mjwf_mat_rgba_ptr'],
  joint: ['_mjwf_njnt','_mjwf_jnt_type_ptr','_mjwf_jnt_qposadr_ptr','_mjwf_jnt_range_ptr','_mjwf_jnt_name_of'],
  act: ['_mjwf_nu','_mjwf_ctrl_ptr','_mjwf_actuator_ctrlrange_ptr','_mjwf_actuator_name_of'],
  contact: ['_mjwf_ncon','_mjwf_contact_pos_ptr','_mjwf_contact_frame_ptr']
};

try {
  const txt = await readFile(loader, 'utf8');
  const have = new Set();
  // naive scan for symbol names in text (preflight, not ABI-proof but useful)
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/_mjwf_[A-Za-z0-9_]+/g);
    if (m) for (const s of m) have.add(s);
  }
  const ok = {}; for (const [g, list] of Object.entries(groups)) ok[g] = list.every(k=>have.has(k));
  const summary = Object.entries(ok).map(([k,v])=>`${k}=${v?'OK':'MISS'}`).join(' ');
  console.log(`probe:${ver}`, summary);
  process.exit(0);
} catch (e) {
  console.error('probe failed:', e.message);
  process.exit(1);
}

