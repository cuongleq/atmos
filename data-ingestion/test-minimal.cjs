#!/usr/bin/env node
// Minimal test

const gfsProcessed = [];

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

const output = {
  meta: { test: 'value' },
  gfs: gfsOutput,
  gefs: gefsOutput
};

console.log('Success:', JSON.stringify(output));