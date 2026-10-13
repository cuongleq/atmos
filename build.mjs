import fs from 'node:fs/promises';
const dir=new URL('./dist/',import.meta.url);
let html=await fs.readFile(new URL('index.template.html',dir),'utf8');
// Replace with literal content, preserving dollar characters in JavaScript.
for(const [marker,file] of [['STYLE','style.css'],['BENCHMARK','benchmark.json'],['ENGINE','engine.js'],['APP','app.js']]){
  let content=await fs.readFile(new URL(file,dir),'utf8');
  if(marker==='BENCHMARK')content=content.replace(/</g,'\\u003c');
  html=html.replace('/*'+marker+'*/',()=>content);
}
// NCHMF la du lieu thu thap ngoai: thieu file van build duoc voi stub rong.
try{
  let nchmf=await fs.readFile(new URL('nchmf.json',dir),'utf8');
  nchmf=nchmf.replace(/</g,'\\u003c');
  html=html.replace('/*NCHMF*/',()=>nchmf);
}catch{
  html=html.replace('/*NCHMF*/',()=>JSON.stringify({collectedAt:null,categories:[],errors:['chua thu thap'],stub:true}));
}
// Chi so doi luu: thieu file (chua chay ltbench.mjs) van build duoc, UI tu hien
// "chua co du lieu" thay vi ban trang.
try{
  let lt=await fs.readFile(new URL('lightning.json',dir),'utf8');
  lt=lt.replace(/</g,'\\u003c');
  html=html.replace('/*LIGHTNING*/',()=>lt);
}catch{
  html=html.replace('/*LIGHTNING*/',()=>JSON.stringify({stub:true,locations:{},summary:{},limits:['chua chay ltbench.mjs']}));
}
await fs.writeFile(new URL('index.html',dir),html);
console.log('Standalone HTML assembled:',Buffer.byteLength(html),'bytes');
