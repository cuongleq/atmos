import fs from 'node:fs';
const s = fs.readFileSync('dist/index.template.html', 'utf8');
const i = s.indexOf('id="radarMap"');
console.log('--- khối radar ---');
console.log(s.slice(Math.max(0, i - 700), i + 900));