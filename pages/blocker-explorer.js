import { exits, FULL, vertices, label, contains, modes, witness } from './blocker-model.js';

const $ = selector => document.querySelector(selector);
const mathLabel = text => text.replaceAll('_f', '<sub>f</sub>').replaceAll('^max', '<sup>max</sup>');
let key = 'noTree', chosen = 0, selected = 27;
const node = (tag, attrs, content = '') => `<${tag} ${Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(' ')}>${content}</${tag}>`;
const combinations = (v, n) => n === 0 ? [[]] : v.flatMap((x, i) => combinations(v.slice(i + 1), n - 1).map(t => [x, ...t]));
const points = [[77, 62], [40, 210], [175, 173], [310, 62], [240, 210], [380, 173]];
const line = (a, b, cls) => node('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], class: cls });
function vertex(i, p, dimmed = false) {
  return node('circle', { cx: p[0], cy: p[1], r: 10, class: `node ${i < 3 ? 'first' : 'second'}${dimmed ? ' dimmed' : ''}` }) +
    node('text', { x: p[0], y: p[1] - 17, 'text-anchor': 'middle' }, exits[i].id);
}

$('#exit-key').innerHTML = exits.map((e, i) => `<article class="exit-card ${i < 3 ? '' : 'second'}"><div class="letter">${e.id}</div><div class="history">${e.history.map(([q, b]) => `${q} = ${b}`).join('<br>')}</div><div class="detail">${e.history.length} ${e.history.length === 1 ? 'query' : 'queries'} · output ${e.output}</div></article>`).join('');
$('#exit-selection').innerHTML = exits.map(e => `<button type="button" data-exit="${e.id}" aria-pressed="false" aria-label="Exit ${e.id}">${e.id}</button>`).join('');

function drawIncidence() {
  const mode = modes[key], facet = mode.facets[chosen], v = vertices(facet);
  const edges = mode.faces.filter(m => vertices(m).length === 2);
  $('#incidence').innerHTML = '<title>All six exits and the 1-skeleton; selected maximal face ' + label(facet) + '</title>' +
    combinations(v, 3).map(t => node('polygon', { points: t.map(i => points[i].join(',')).join(' '), class: 'face' })).join('') +
    edges.map(m => { const [a, b] = vertices(m); return line(points[a], points[b], contains(facet, m) ? 'highlight-edge' : 'skeleton'); }).join('') +
    exits.map((_, i) => vertex(i, points[i], !(facet & (1 << i)))).join('');
}

function drawSolid() {
  const facet = modes[key].facets[chosen], v = vertices(facet);
  const coords = v.length === 4 ? [[-1,-1,-1],[1,1,-1],[1,-1,1],[-1,1,1]]
    : v.length === 3 ? [[-1, .7, 0],[1,.7,0],[0,-1,0]] : [[-1,0,0],[1,0,0]];
  const yaw = Number($('#yaw').value) * Math.PI / 180, pitch = Number($('#pitch').value) * Math.PI / 180;
  const rotated = coords.map(([x, y, z]) => {
    const xx = x * Math.cos(yaw) + z * Math.sin(yaw), zz = -x * Math.sin(yaw) + z * Math.cos(yaw);
    const yy = y * Math.cos(pitch) - zz * Math.sin(pitch), zzz = y * Math.sin(pitch) + zz * Math.cos(pitch);
    return [210 + 76 * xx, 145 + 76 * yy, zzz];
  });
  const triangles = combinations(v.map((_, i) => i), 3).sort((a, b) => a.reduce((s, i) => s + rotated[i][2], 0) - b.reduce((s, i) => s + rotated[i][2], 0));
  $('#solid').innerHTML = `<title>Maximal face ${label(facet)}, dimension ${v.length - 1}</title>` +
    triangles.map(t => node('polygon', { points: t.map(i => rotated[i].slice(0,2).join(',')).join(' '), class: 'face' })).join('') +
    combinations(v.map((_, i) => i), 2).map(([a, b]) => line(rotated[a], rotated[b], 'highlight-edge')).join('') +
    v.map((i, j) => vertex(i, rotated[j])).join('');
  $('#facet-heading').textContent = `${v.length === 4 ? 'One solid tetrahedron' : v.length === 3 ? 'One filled triangle' : 'One edge'} · ${label(facet)}`;
  $('#solid-note').textContent = v.length === 4 ? `Drag to rotate, or use the sliders. The complement ${label(FULL ^ facet)} is the adversary that avoids this tetrahedron’s four exits.` : 'Drag to rotate, or use the sliders. This is one maximal face, including all its subfaces.';
}

function membership() {
  const allowed = modes[key].faces.includes(selected);
  $('#membership').dataset.allowed = String(allowed);
  $('#membership-title').innerHTML = `${label(selected)} ${allowed ? 'is a face of' : 'is not a face of'} ${mathLabel(modes[key].short)}.`;
  $('#membership-reason').innerHTML = mathLabel(witness(key, selected));
  document.querySelectorAll('[data-exit]').forEach((b, i) => b.setAttribute('aria-pressed', String(Boolean(selected & (1 << i)))));
  document.documentElement.dataset.complex = key;
  document.documentElement.dataset.selection = String(selected);
}

function render() {
  const mode = modes[key];
  document.querySelectorAll('[data-mode]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === key)));
  $('#mode-title').innerHTML = mathLabel(mode.title);
  $('#mode-meaning').textContent = mode.meaning;
  $('#metrics').innerHTML = `<span class="metric">Dimension <strong>${mode.dimension}</strong></span><span class="metric"><strong>${mode.facets.length}</strong> maximal faces</span><span class="metric">Face counts <strong>(${mode.counts.join(', ')})</strong></span>`;
  $('#metrics').title = 'Face counts list vertices, edges, triangles, then tetrahedra when present.';
  $('#facets').innerHTML = mode.facets.map((f, i) => `<button type="button" data-facet="${i}" aria-pressed="${i === chosen}" aria-label="Inspect maximal face ${label(f)}">${vertices(f).map(j => exits[j].id).join('')}</button>`).join('');
  $('#geometry').innerHTML = mathLabel(mode.geometry);
  $('#topology').innerHTML = mathLabel(mode.topology);
  drawIncidence(); drawSolid(); membership();
}

document.addEventListener('click', event => {
  const b = event.target.closest('button');
  if (!b) return;
  if (b.dataset.mode) { key = b.dataset.mode; chosen = 0; render(); }
  if (b.dataset.facet !== undefined) { chosen = Number(b.dataset.facet); render(); }
  if (b.dataset.exit) { selected ^= 1 << exits.findIndex(e => e.id === b.dataset.exit); membership(); }
  if (b.dataset.preset !== undefined) { selected = Number(b.dataset.preset); membership(); }
});
$('#reset').addEventListener('click', () => { key = 'noTree'; chosen = 0; selected = 27; $('#yaw').value = 24; $('#pitch').value = -12; render(); });
['#yaw', '#pitch'].forEach(id => $(id).addEventListener('input', drawSolid));
let drag = null;
$('#solid').addEventListener('pointerdown', event => {
  drag = [event.clientX, event.clientY, Number($('#yaw').value), Number($('#pitch').value)];
  event.currentTarget.setPointerCapture(event.pointerId);
});
$('#solid').addEventListener('pointermove', event => {
  if (!drag) return;
  $('#yaw').value = Math.max(-180, Math.min(180, drag[2] + (event.clientX - drag[0]) * .7));
  $('#pitch').value = Math.max(-70, Math.min(70, drag[3] + (event.clientY - drag[1]) * .5));
  drawSolid();
});
['pointerup', 'pointercancel', 'lostpointercapture'].forEach(type => $('#solid').addEventListener(type, () => { drag = null; }));
render();
