#!/usr/bin/env node
const gfsProcessed = [
  { fhr: 0, data: { variables: { temp: 1 } }, rawFile: null },
  { fhr: 1, data: { variables: { wind: 1 } }, rawFile: null },
];
const gefsResults = [
  { member: 0, fhr: 0, data: {} },
  { member: 1, fhr: 3, data: {} },
];

const gfsOutput = [];
for (let i = 0; i < gfsProcessed.length; i++) {
  const p = gfsProcessed[i];
  gfsOutput.push({
    fhr: p.fhr,
    variables: p.data?.variables ? Object.keys(p.data.variables) : [],
    rawFile: p.rawFile || null,
    parsed: !!p.data
  });
}
const gefsOutput = [];
for (let i = 0; i < gefsResults.length; i++) {
  const r = gefsResults[i];
  if (r) {
    gefsOutput.push({
      member: r.member,
      fhr: r.fhr,
      data: r.data
    });
  }
}
console.log('Success:', JSON.stringify({ gfs: gfsOutput, gefs: gefsOutput }));