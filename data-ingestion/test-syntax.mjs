const gfsOutput = [];
for (let i = 0; i < gfsProcessed.length; i++) {
  const p = gfsProcessed[i];
  gfsOutput.push({
    fhr: p.fhr,
    variables: p.data?.variables ? Object.keys(p.data.variables) : [],
    rawFile: p.rawFile || null,
    parsed: !!p.data
  });
});
console.log('Success');