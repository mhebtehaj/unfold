import {label,moves,stage,facesOf,counts,positions,completedAt,cycle,intersect} from './contraction-model.js';
const $=id=>document.getElementById(id), NS='http://www.w3.org/2000/svg';
const state={progress:0,yaw:.55,pitch:-.30,regions:'both',opacity:.45,playing:false};
function el(tag,attrs={},text) { const e=document.createElementNS(NS,tag); for(const [k,v] of Object.entries(attrs))e.setAttribute(k,v); if(text!==undefined)e.textContent=text; return e; }
function add(svg,tag,attrs,text){const e=el(tag,attrs,text);svg.append(e);return e;}
const colour=b=>b?'var(--one)':'var(--zero)';
function camera([x,y,z]){const c=Math.cos(state.yaw),s=Math.sin(state.yaw),p=Math.cos(state.pitch),q=Math.sin(state.pitch);const a=c*x-s*y,b=s*x+c*y;return [a,p*z-q*b,p*b+q*z];}
function project(v){const [x,y,z]=camera(v);return [300+110*x,197-110*y,z];}
function activeMove(){return state.progress<2?moves[0]:state.progress<3?moves[1]:null;}
function drawSolid(model){
  const svg=$('solid');svg.replaceChildren();const p=positions(state.progress).map(project);
  const triangles=state.regions==='seam'?[]:model.B.flatMap((K,b)=>state.regions==='both'||state.regions===(b?'one':'zero')?facesOf(K,2).map(v=>({v,b,z:v.reduce((s,i)=>s+p[i][2],0)/3})):[]);
  triangles.sort((a,b)=>a.z-b.z);
  for(const {v,b} of triangles)add(svg,'polygon',{points:v.map(i=>p[i].slice(0,2).join(',')).join(' '),fill:colour(b),'fill-opacity':state.opacity,stroke:colour(b),'stroke-opacity':.65,'stroke-width':1.1,'data-output':b});
  const seam=facesOf(model.X,1), move=activeMove();
  for(const [a,b] of seam){const selected=move&&[a,b].includes(move.from)&&[a,b].includes(move.to);add(svg,'line',{x1:p[a][0],y1:p[a][1],x2:p[b][0],y2:p[b][1],stroke:selected?'var(--move)':'var(--seam)','stroke-width':selected?6:3.4,'stroke-linecap':'round'});}
  const vertices=facesOf(model.X,0).flat();
  for(const v of vertices){const moving=move&&v===move.from;add(svg,'circle',{cx:p[v][0],cy:p[v][1],r:moving?6.5:4.5,fill:moving?'var(--move)':'var(--seam)',stroke:'var(--card)','stroke-width':1.5});}
  // Labels are offset radially; tiny contracting edges share one combined label.
  const hidden=new Set();
  for(const m of moves){if(vertices.includes(m.from)&&Math.hypot(p[m.from][0]-p[m.to][0],p[m.from][1]-p[m.to][1])<30)hidden.add(m.from);}
  for(const v of vertices){if(hidden.has(v))continue;const near=moves.find(m=>m.to===v&&hidden.has(m.from));const name=near?`${label(near.from)} → ${label(v)}`:label(v);const [x,y]=p[v], dx=x-300,dy=y-197,l=Math.hypot(dx,dy)||1;add(svg,'text',{x:x+dx/l*20,y:y+dy/l*20+5,'text-anchor':'middle'},name);}
  svg.dataset.completed=completedAt(state.progress);svg.dataset.xEdges=seam.length;
}
function boundaryPositions(){
  const p=Array.from({length:6});cycle.forEach((v,i)=>{const a=-Math.PI/2+i*Math.PI/3;p[v]=[240+125*Math.cos(a),190+125*Math.sin(a)];});
  for(let j=0;j<2;j++){const m=moves[j], t=Math.max(0,Math.min(state.progress-j-1,1));p[m.from]=p[m.from].map((v,i)=>(1-t)*v+t*p[m.to][i]);}
  return p;
}
function drawBoundary(model){
  const svg=$('boundary');svg.replaceChildren();const p=boundaryPositions(),move=activeMove();
  for(const [a,b] of facesOf(model.X,1)){const selected=move&&[a,b].includes(move.from)&&[a,b].includes(move.to);add(svg,'line',{x1:p[a][0],y1:p[a][1],x2:p[b][0],y2:p[b][1],stroke:selected?'var(--move)':'var(--seam)','stroke-width':selected?7:4,'stroke-linecap':'round'});}
  const verts=facesOf(model.X,0).flat(),hidden=new Set();
  for(const m of moves)if(verts.includes(m.from)&&Math.hypot(p[m.from][0]-p[m.to][0],p[m.from][1]-p[m.to][1])<45)hidden.add(m.from);
  for(const v of verts){const [x,y]=p[v],moving=move&&v===move.from;add(svg,'circle',{cx:x,cy:y,r:moving?7:5,fill:moving?'var(--move)':'var(--seam)',stroke:'var(--card)','stroke-width':2});if(hidden.has(v))continue;const near=moves.find(m=>m.to===v&&hidden.has(m.from));const dx=x-240,dy=y-190,l=Math.hypot(dx,dy)||1;add(svg,'text',{x:x+dx/l*25,y:y+dy/l*25+5,'text-anchor':'middle'},near?`${label(near.from)} → ${label(v)}`:label(v));}
  add(svg,'text',{x:240,y:192,'text-anchor':'middle',class:'caption'},'X remains a circle');
}
const notes=[
  '<strong>Start:</strong> the selector colours four triangles orange and four blue. They meet along a six-edge circle. Purple marks the first edge we will contract.',
  '<strong>Redraw only:</strong> the same eight triangles now lie on a tetrahedron. No vertices or edges have been identified. 1− and 1+ are subdivision points.',
  '<strong>First contraction complete:</strong> 1− has merged into 2−. The path 2−–1−–2+ is now one edge, 2−–2+. Both output regions remain disks.',
  '<strong>Both contractions complete:</strong> 1+ has also merged into 3−. X is a four-edge circle, and each output region consists of two triangles.'
];
function render(){
  const p=state.progress,completed=completedAt(p),model=stage(completed),c=counts(model.X);drawSolid(model);drawBoundary(model);
  $('progress').value=p;$('progress-value').value=p.toFixed(2);
  document.querySelectorAll('[data-step]').forEach(b=>b.setAttribute('aria-pressed',String(Math.abs(p-Number(b.dataset.step))<.002)));
  let note=notes[Math.round(p)];if(p>0&&p<1)note='<strong>Redrawing:</strong> changing only the embedding. The triangulation still has six vertices and eight triangles.';else if(p>1&&p<2)note='<strong>Contracting 1−–2−:</strong> move 1− toward 2− on both coloured sides at once. They become one vertex only at the endpoint.';else if(p>2&&p<3)note='<strong>Contracting 1+–3−:</strong> move 1+ toward 3− on both sides. The new edge 3−–3+ represents the old two-edge path.';
  if($('stage-note').innerHTML!==note)$('stage-note').innerHTML=note;
  $('cycle-badge').textContent=`${c[1]}-edge circle`;$('x-count').textContent=`${c[0]} vertices · ${c[1]} edges`;$('b-count').textContent=`${counts(model.B[0])[2]} / ${counts(model.B[1])[2]}`;
  $('path-note').textContent=completed===2?'Both extra subdivision vertices are gone. The four remaining labels are 2−, 2+, 3−, 3+.':completed===1?'Next: contract 1+–3− in the path 3−–1+–3+.':'First: contract 1−–2− in the path 2−–1−–2+.';
  $('play').textContent=state.playing?'Ⅱ Pause':'▶ Play';
  const intersection=intersect(...model.B);if(intersection.size!==model.X.size||[...model.X].some(f=>!intersection.has(f)))throw Error('The output regions no longer have the right intersection');
}
let last=0,frame=0;
function stop(){state.playing=false;cancelAnimationFrame(frame);}
function animate(time){if(!state.playing)return;const dt=last?Math.min(time-last,70):0;last=time;state.progress=Math.min(3,state.progress+dt/2700);if(state.progress===3)state.playing=false;render();if(state.playing)frame=requestAnimationFrame(animate);}
$('play').addEventListener('click',()=>{if(state.playing)stop();else{if(state.progress===3)state.progress=0;state.playing=true;last=0;frame=requestAnimationFrame(animate);}render();});
$('progress').addEventListener('input',e=>{stop();state.progress=Number(e.target.value);render();});
document.querySelectorAll('[data-step]').forEach(b=>b.addEventListener('click',()=>{stop();state.progress=Number(b.dataset.step);render();}));
$('regions').addEventListener('change',e=>{state.regions=e.target.value;render();});$('opacity').addEventListener('input',e=>{state.opacity=e.target.value/100;render();});
$('turn-left').addEventListener('click',()=>{state.yaw-=.4;render();});$('turn-right').addEventListener('click',()=>{state.yaw+=.4;render();});$('reset-view').addEventListener('click',()=>{state.yaw=.55;state.pitch=-.30;render();});
let drag=null;const solid=$('solid');solid.addEventListener('pointerdown',e=>{if(e.button!==0)return;drag=[e.clientX,e.clientY];solid.setPointerCapture(e.pointerId);});solid.addEventListener('pointermove',e=>{if(!drag)return;state.yaw+=(e.clientX-drag[0])*.012;state.pitch=Math.max(-1.4,Math.min(1.4,state.pitch+(e.clientY-drag[1])*.012));drag=[e.clientX,e.clientY];render();});for(const type of ['pointerup','pointercancel','lostpointercapture'])solid.addEventListener(type,()=>drag=null);
render();
