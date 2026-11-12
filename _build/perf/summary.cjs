const fs=require('fs');
const lab=process.argv[2]; const {rows}=JSON.parse(fs.readFileSync(require('path').join(__dirname,`out/${lab}/results.json`),'utf8'));
const bad=rows.filter(r=>r.oom>0||r.missAfter>0);
const sum=(k)=>rows.reduce((a,r)=>a+r[k],0);
const fpsS=rows.map(r=>r.fps).sort((a,b)=>a-b);
console.log(`[${lab}] ${rows.length} flights | OOM flights ${rows.filter(r=>r.oom>0).length} | flights w/ tiles still missing after landing ${rows.filter(r=>r.missAfter>0).length} | missing tiles in flight total ${sum('missFlight')} after ${sum('missAfter')}`);
console.log(`fps median ${fpsS[Math.floor(fpsS.length/2)]} | p10 ${fpsS[Math.floor(fpsS.length*.1)]} | min ${fpsS[0]} | flights <50fps ${rows.filter(r=>r.fps<50).length} | worst frame gap ${Math.max(...rows.map(r=>r.gapMs))}ms | longest main task ${Math.max(...rows.map(r=>r.longTaskMs))}ms`);
if (process.argv[3]) { console.log('worst:'); rows.slice().sort((a,b)=>(b.missFlight+b.missAfter*5)-(a.missFlight+a.missAfter*5)).slice(0,+process.argv[3]).forEach(r=>console.log(`  ${String(r.i).padStart(3)} ${r.from} → ${r.id}  zoom×${r.zoom} fps ${r.fps} gap ${r.gapMs}ms missFly ${r.missFlight} missAfter ${r.missAfter} oom ${r.oom} task ${r.longTaskMs}ms`)); }
