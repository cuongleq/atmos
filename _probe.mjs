import fs from 'node:fs';
const r = JSON.parse(fs.readFileSync('dist/benchmark.json', 'utf8'));
const rows = [];
for (const l of r.locations) {
  for (const t of l.tests || []) {
    if (t.usable && t.probabilistic?.coverage) rows.push([l.id, t.variable, t.lead, t.probabilistic.coverage]);
  }
}
const bad = rows.filter(x => Math.abs(x[3].p25p75 - 0.5) > 0.15);
console.log('lệch >0.15:', bad.length, '/', rows.length);
const by = {};
for (const x of bad) (by[x[1]] = by[x[1]] || []).push(x);
for (const v of Object.keys(by)) console.log(' ', v, by[v].length, 'lead', [...new Set(by[v].map(x => x[2]))].join(','));
console.log(bad.slice(0, 6).map(x => `${x[0]}/${x[1]}/d${x[2]}=${x[3].p25p75.toFixed(2)}`).join('  '));
// phân nhóm theo kind
const kind = {};
for (const x of rows) (kind[x[1]] = r.variables[x[1]].kind);
const g = {};
for (const x of rows) (g[kind[x[1]]] = g[kind[x[1]]] || []).push(x[3].p25p75);
for (const k of Object.keys(g)) { const a = g[k].sort((p, q) => p - q); console.log('kind', k, 'median', a[a.length >> 1].toFixed(2)); }