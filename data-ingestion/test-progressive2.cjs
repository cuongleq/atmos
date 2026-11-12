#!/usr/bin/env node
// Test with for loop and push
const gfsProcessed = [];
const gfsOutput = [];
for (let i = 0; i < 10; i++) {
  const p = { fhr: i, data: { variables: { temp: 1 } }, rawFile: null };
  gfsOutput.push({
    fhr: i,
    variables: { temp: 1 },
    rawFile: null,
    parsed: true
  });
}
console.log('Success:', JSON.stringify(gfsOutput));