import assert from 'node:assert/strict';
import {original,stage,moves,inputs,contract,intersect,counts,subdivide,positions,facesOf} from '../../contraction-model.js';
const equal=(a,b)=>assert.deepEqual([...a].sort(),[...b].sort());
for(let j=0;j<3;j++) {
  const m=stage(j);equal(intersect(...m.B),m.X);
  assert.deepEqual(counts(m.X),[6-j,6-j,0]);
  assert.deepEqual(m.B.map(K=>counts(K)[2]),[4-j,4-j]);
  assert.equal(counts(m.ambient).reduce((s,v,i)=>s+(i%2?-v:v),0),2);
  if(j){const move=moves[j-1],before=stage(j-1);for(const name of ['X','ambient'])equal(subdivide(m[name],[move.to,move.opposite],move.from),before[name]);for(let b=0;b<2;b++)equal(subdivide(m.B[b],[move.to,move.opposite],move.from),before.B[b]);}
}
// Independent truth tables: every local irrelevant-coordinate contraction in
// the 254 nonconstant functions on three variables preserves the entire pair.
let checks=0;
for(let table=1;table<255;table++){
  const f=x=>table>>(x[0]*4+x[1]*2+x[2])&1,m=original(f);
  for(let k=0;k<3;k++)for(let a=0;a<2;a++)for(let i=0;i<3;i++){
    if(i===k||!m.X.has(String(2*k+a)))continue;
    if(inputs.filter(x=>x[k]===a).some(x=>{const y=[...x];y[i]=1-y[i];return f(x)!==f(y);}))continue;
    const from=2*k+a,to=2*i;
    const next={B:m.B.map(K=>contract(K,from,to)),X:contract(m.X,from,to),ambient:contract(m.ambient,from,to)};
    equal(intersect(...next.B),next.X);
    for(const name of ['X','ambient'])equal(subdivide(next[name],[to,to+1],from),m[name]);
    for(let b=0;b<2;b++)equal(subdivide(next.B[b],[to,to+1],from),m.B[b]);
    checks++;
  }
}
// The redraw never flips a triangle through the interior. At contractions the
// disappearing faces alone become degenerate; the retained facets stay finite.
for(const progress of [0,.25,.5,.9,1,1.5,1.999,2,2.5,2.999,3]){
  const p=positions(progress);assert(p.flat().every(Number.isFinite));
  const m=stage(progress>=3?2:progress>=2?1:0);
  for(const [a,b,c] of facesOf(m.ambient,2)){
    const u=p[b].map((x,i)=>x-p[a][i]),v=p[c].map((x,i)=>x-p[a][i]);
    const cross=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
    assert(Math.hypot(...cross)>1e-8,'A retained triangle is degenerate');
    const sides=p.map(point=>point.reduce((s,x,i)=>s+cross[i]*(x-p[a][i]),0));
    assert(!(sides.some(x=>x>1e-8)&&sides.some(x=>x< -1e-8)),'A face leaves the convex boundary');
  }
}
console.log(`Passed: 3 stages, ${checks} contractions, exact intersections and common subdivisions, finite nondegenerate geometry.`);
