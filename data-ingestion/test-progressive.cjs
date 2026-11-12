#!/usr/bin/env node
// Minimal test
console.log('Hello World');

const arr = [];
for (let i = 0; i < 10; i++) {
  arr.push({
    fhr: i,
    variables: [],
    rawFile: null,
    parsed: false
  });
}
console.log('Success:', JSON.stringify(arr));