'use strict';
/** Skill-icon grids: 6 files (one per class path), 4x2 icons each, row-major in skills.json order. */
const GRID_PATHS = ['kiem', 'phap', 'the', 'dan_phu', 'thuong', 'dao'];

/**
 * Skill ids per class path, in skills.json order (that order IS the icon order of each grid, row-major).
 * Throws unless there are exactly the 6 known paths with 8 skills each.
 */
function classGrids(skillsJson) {
  const g = {};
  for (const s of skillsJson.skills) (g[s.path] = g[s.path] || []).push(s.id);
  for (const p of GRID_PATHS) if (!g[p] || g[p].length !== 8) throw new Error(`skills.json: path ${p} has ${g[p] ? g[p].length : 0} skills, the icon grid has 8`);
  const extra = Object.keys(g).filter((p) => !GRID_PATHS.includes(p));
  if (extra.length) throw new Error(`skills.json: path(s) ${extra.join(', ')} have no icon grid`);
  return g;
}

module.exports = { GRID_PATHS, classGrids };
