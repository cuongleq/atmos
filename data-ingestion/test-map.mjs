const out = [];
const result = [];
for (const p of []) {
  result.push({
    fhr: p.fhr,
    variables: p.data?.variables ? Object.keys(p.data.variables) : [],
    rawFile: p.rawFile || null,
    parsed: !!p.data
  });
}
console.log('Success:', JSON.stringify(result));