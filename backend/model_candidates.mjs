// Built-in model aliases and candidate resolution for the backend.

const MODEL_ALIASES = {
  rkob: 'model/mujoco_Rajagopal2015_simple.xml',
  raj: 'model/mujoco_Rajagopal2015_simple.xml',
  'mujoco_rajagopal2015_simple.xml': 'model/mujoco_Rajagopal2015_simple.xml',
  humanoid: 'model/humanoid/humanoid.xml',
  humanoid100: 'model/humanoid/humanoid100.xml',
  cards: 'model/cards/cards.xml',
  sensor: 'model/plugin/sensor/touch_grid.xml',
};

export const MODEL_POOL = [
  'model/mujoco_Rajagopal2015_simple.xml',
  'model/humanoid/humanoid.xml',
  'model/humanoid/humanoid100.xml',
  'model/cards/cards.xml',
  'model/plugin/sensor/touch_grid.xml',
];

export function resolveModelFileName(raw) {
  if (raw === null || raw === undefined) return null;
  const token = String(raw).trim();
  if (!token) return null;
  const key = token.toLowerCase();
  const alias = MODEL_ALIASES[key];
  let file = alias || token;
  if (!file.toLowerCase().endsWith('.xml')) {
    file = `${file}.xml`;
  }
  return file;
}

export function buildModelCandidates(modelToken, modelFile) {
  const out = [];
  const seen = new Set();
  const pushCandidate = (file, label) => {
    if (!file || seen.has(file)) return;
    seen.add(file);
    out.push({ file, label: label || file });
  };
  if (modelFile) {
    pushCandidate(modelFile, modelToken || modelFile);
  }
  for (const file of MODEL_POOL) {
    pushCandidate(file, file);
  }
  return out;
}
