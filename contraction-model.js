// Signed vertex 2*i+b means x_(i+1)=b. Keep the existing explorer's selector.
export const selector = x => x[0] === 0 ? x[2] : x[1];
export const label = v => ['1−', '1+', '2−', '2+', '3−', '3+'][v];
export const moves = [{from: 0, to: 2, opposite: 3}, {from: 1, to: 4, opposite: 5}];
export const inputs = Array.from({length: 8}, (_, m) => [m >> 2 & 1, m >> 1 & 1, m & 1]);
export const key = face => [...new Set(face)].sort((a,b) => a-b).join(',');
export function closure(facets) {
  const faces = new Set(['']);
  for (const f of facets) for (let m=1; m<2**f.length; m++) faces.add(key(f.filter((_,i) => m >> i & 1)));
  return faces;
}
export function decode(k) { return k === '' ? [] : k.split(',').map(Number); }
export function contract(K, from, to) { return new Set([...K].map(k => key(decode(k).map(v => v===from ? to : v)))); }
export const intersect = (A,B) => new Set([...A].filter(k => B.has(k)));
export function original(f=selector) {
  const triangles = inputs.map(bits => ({vertices: bits.map((b,i) => 2*i+b), output:f(bits), input:bits.join('')}));
  const B = [0,1].map(b => closure(triangles.filter(t=>t.output===b).map(t=>t.vertices)));
  return {triangles, B, X:intersect(...B), ambient:closure(triangles.map(t=>t.vertices))};
}
export function stage(completed=0, f=selector) {
  const model=original(f);
  for (const {from,to} of moves.slice(0,completed)) {
    model.B=model.B.map(K=>contract(K,from,to));
    model.X=contract(model.X,from,to);
    model.ambient=contract(model.ambient,from,to);
  }
  return model;
}
export const facesOf = (K,dim) => [...K].map(decode).filter(f=>f.length===dim+1);
export function counts(K) { return [0,1,2].map(d=>facesOf(K,d).length); }
export function subdivide(K, edge, vertex) {
  const facets=[];
  for(const k of K) {
    const f=decode(k);
    if(edge.every(v=>f.includes(v))) for(const v of edge) facets.push([...f.filter(x=>x!==v),vertex]);
    else facets.push(f);
  }
  return closure(facets);
}
// First redraw the octahedral triangulation as a subdivided tetrahedron.
// Then slide each subdivision vertex along its edge. The two coloured subsets
// stay fixed during those slides. At each endpoint use the simplicial image.
export function positions(progress) {
  const a=Math.min(progress,1), t=Math.max(0,Math.min(progress-1,1)), u=Math.max(0,Math.min(progress-2,1));
  const p=[[0,0,-1],[0,0,1],[-1,-1,-a],[1,1,-a],[-1,1,a],[1,-1,a]];
  p[0]=p[0].map((v,i)=>v*(1-t)+p[2][i]*t);
  p[1]=p[1].map((v,i)=>v*(1-u)+p[4][i]*u);
  return p;
}
export const completedAt = p => p>=3 ? 2 : p>=2 ? 1 : 0;
export const cycle=[0,2,5,1,4,3];
