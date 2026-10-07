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
await fs.writeFile(new URL('index.html',dir),html);
console.log('Standalone HTML assembled:',Buffer.byteLength(html),'bytes');
