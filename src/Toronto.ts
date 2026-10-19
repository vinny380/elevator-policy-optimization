import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BISHA_HEIGHT, BISHA_IDS, CN_HEIGHT, MAP_SCALE, centre, contains, projectLocation, streetWidth, visibleBuildings, type District, type MapPoint } from './toronto-data';

// Mapped massing, with hand-modelled landmark details. Metres throughout this group.
export function createToronto(data: District) {
  const root = new T.Group(), neighbourhood = new T.Group(), near = new T.Group(), bisha = new T.Group(), labels = new T.Group();
  root.add(neighbourhood, near, bisha, labels); root.scale.setScalar(MAP_SCALE); root.position.y = 3.37;
  const geometries = new Set<T.BufferGeometry>(), materials = new Set<T.Material>(), textures = new Set<T.Texture>();
  const mat = (color: string, extra: T.MeshStandardMaterialParameters = {}) => {
    const m = new T.MeshStandardMaterial({ color, roughness: 0.8, ...extra }); materials.add(m); return m;
  };
  const concrete = mat('#a6b5c2'), roof = mat('#9eadbb'), dark = mat('#223747'), pale = mat('#c2ced5'), gold = mat('#f1c688', { emissive: '#b7854a', emissiveIntensity: 0.25 });
  const road = mat('#293b4a'), pavement = mat('#566674'), park = mat('#456b60'), rail = mat('#81909b', { metalness: 0.7 }), grass = mat('#477d68');
  const batches = new Map<T.Group, Map<T.Material, T.BufferGeometry[]>>();
  function batch(g: T.BufferGeometry, m: T.Material, parent = neighbourhood) {
    if (!batches.has(parent)) batches.set(parent, new Map());
    const groups = batches.get(parent)!; if (!groups.has(m)) groups.set(m, []);
    // Use the same attributes/index layout for primitives and extrusions.
    const flat = g.index ? g.toNonIndexed() : g; if (flat !== g) g.dispose(); flat.clearGroups();
    groups.get(m)!.push(flat);
  }
  function mesh(g: T.BufferGeometry, m: T.Material, parent = neighbourhood) {
    geometries.add(g); const o = new T.Mesh(g, m); o.castShadow = true; o.receiveShadow = true; parent.add(o); return o;
  }
  function box(w: number, h: number, d: number, x: number, y: number, z: number, m: T.Material, parent = neighbourhood, angle = 0) {
    const g = new T.BoxGeometry(w, h, d); g.rotateY(angle); g.translate(x, y, z); batch(g, m, parent);
  }
  function prism(points: MapPoint[], height: number, base = 0) {
    const shape = new T.Shape(points.map(([x, z]) => new T.Vector2(x, -z)));
    const g = new T.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false }); g.rotateX(-Math.PI / 2); g.translate(0, base, 0); return g;
  }
  function strip(points: MapPoint[], width: number, y: number, m: T.Material, parent = neighbourhood) {
    const positions: number[] = [], uvs: number[] = [];
    for (let i = 1; i < points.length; i++) {
      const [ax, az] = points[i - 1], [bx, bz] = points[i], length = Math.hypot(bx - ax, bz - az); if (length < 0.01) continue;
      const dx = -(bz - az) / length * width / 2, dz = (bx - ax) / length * width / 2;
      for (const p of [[ax + dx, az + dz], [bx + dx, bz + dz], [bx - dx, bz - dz], [ax + dx, az + dz], [bx - dx, bz - dz], [ax - dx, az - dz]]) { positions.push(p[0], y, p[1]); uvs.push(p[0], p[1]); }
    }
    if (!positions.length) return;
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(positions, 3)); g.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2)); g.computeVertexNormals(); batch(g, m, parent);
  }
  function sign(text: string, x: number, y: number, z: number, size: number, color = '#e0eaf1', parent = labels, depthTest = false) {
    const canvas = document.createElement('canvas'); canvas.width = 768; canvas.height = 96;
    const ctx = canvas.getContext('2d')!; ctx.font = '500 38px -apple-system, BlinkMacSystemFont, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.shadowColor = '#101b2b'; ctx.shadowBlur = 8; ctx.fillStyle = color; ctx.fillText(text, 384, 48);
    const texture = new T.CanvasTexture(canvas); texture.colorSpace = T.SRGBColorSpace; textures.add(texture);
    const material = new T.SpriteMaterial({ map: texture, depthTest, transparent: true, sizeAttenuation: depthTest }); materials.add(material);
    const sprite = new T.Sprite(material); sprite.position.set(x, y, z); sprite.scale.set(size * (depthTest ? 8 : 0.07), size * (depthTest ? 1 : 0.00875), 1); parent.add(sprite); return sprite;
  }
  function facade(color: string, brick = false) {
    const canvas = document.createElement('canvas'); canvas.width = 128; canvas.height = 128;
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = color; ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = brick ? '#9a7765' : '#728c9b'; ctx.fillRect(0, 0, 128, 3); ctx.fillRect(0, 0, 3, 128);
    ctx.fillStyle = brick ? '#253a4a' : '#355063'; ctx.fillRect(10, 9, 108, 105);
    ctx.fillStyle = brick ? '#68818b' : '#789aaa'; ctx.fillRect(15, 12, 100, 4);
    ctx.fillStyle = '#182c3a'; ctx.fillRect(62, 9, 3, 105);
    const t = new T.CanvasTexture(canvas); t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(1 / 3.2, 1 / 3.3); t.colorSpace = T.SRGBColorSpace; textures.add(t);
    return mat('#ffffff', { map: t, metalness: brick ? 0.05 : 0.35, roughness: brick ? 0.9 : 0.4 });
  }
  const glass = [facade('#87a7b6'), facade('#6a899a'), facade('#a1adb5')], brick = facade('#9c705e', true);
  const corners = [[data.bbox[0], data.bbox[3]], [data.bbox[2], data.bbox[1]]].map(p => projectLocation(p[0], p[1], data.origin));
  const w = corners[1][0] - corners[0][0] + 60, d = corners[1][1] - corners[0][1] + 60, cx = (corners[0][0] + corners[1][0]) / 2, cz = (corners[0][1] + corners[1][1]) / 2;
  box(w, 12, d, cx, -7, cz, mat('#203344'), near);
  box(w, 0.8, d, cx, -0.5, cz, mat('#63717a'), near);
  for (const p of data.parks) if (p.points.length >= 3) batch(prism(p.points, 0.4), park, near);
  const streetLabels = new Set<string>();
  for (const path of data.streets) {
    const width = streetWidth(path.kind), small = width < 6;
    if (!small) strip(path.points, width + 5, 0.35, pavement, near);
    strip(path.points, width, small ? 0.55 : 0.5, small ? pavement : road, near);
    if (width >= 9) {
      for (let i = 1; i < path.points.length; i++) {
        const a = path.points[i - 1], b = path.points[i], length = Math.hypot(b[0] - a[0], b[1] - a[1]);
        for (let t = 3; t < length - 3; t += 12) {
          const p: MapPoint = [a[0] + (b[0] - a[0]) * t / length, a[1] + (b[1] - a[1]) * t / length];
          const q: MapPoint = [a[0] + (b[0] - a[0]) * (t + 4) / length, a[1] + (b[1] - a[1]) * (t + 4) / length]; strip([p, q], 0.18, 0.57, pale, near);
        }
      }
    }
    if (['Blue Jays Way', 'King Street West', 'Wellington Street West', 'Front Street West', 'Bremner Boulevard'].includes(path.name) && !streetLabels.has(path.name) && path.points.length > 3 && !small) {
      const p = path.points[Math.floor(path.points.length / 2)]; sign(path.name.toUpperCase(), p[0], 5, p[1], 9, '#c7d7e0'); streetLabels.add(path.name);
    }
  }
  for (const path of data.rails) { strip(path.points, 2.3, 0.15, dark, near); strip(path.points, 0.25, 0.22, rail, near); }
  const stadiumOutline = data.buildings.find(b => b.id === 7969701)!;
  const cnOutline = data.buildings.find(b => b.id === 32742038)!;
  const bishaOutline = data.buildings.find(b => b.id === BISHA_IDS[0])!;
  const cnPosition = projectLocation(-79.387057, 43.642566, data.origin);
  const stadiumPosition = projectLocation(-79.389353, 43.641438, data.origin);
  for (const b of visibleBuildings(data.buildings)) {
    const c = centre(b.points);
    if (BISHA_IDS.includes(b.id) || b.id === cnOutline.id || b.id === stadiumOutline.id || contains(c, stadiumOutline.points) || contains(c, bishaOutline.points) || Math.hypot(c[0] - cnPosition[0], c[1] - cnPosition[1]) < 24) continue;
    const parent = Math.hypot(...c) < 95 ? near : neighbourhood;
    // Centimetre offsets avoid coplanar flicker where mapped building parts overlap.
    const top = Math.max(b.base + 1, Math.min(b.height, 350)) + b.id % 97 * 0.003;
    const material = b.material === 'brick' || top < 20 ? brick : glass[b.id % 3];
    batch(prism(b.points, top - b.base, b.base), material, parent);
    batch(prism(b.points, 0.6, top), roof, parent);
  }
  // Bisha: mapped podium and tower outline, heritage base, balcony edges, KŌST roof.
  const tower = data.buildings.find(b => b.id === 944510172)!;
  const podium = data.buildings.find(b => b.id === 944510170)!;
  const towerCenter = centre(tower.points);
  batch(prism(bishaOutline.points, 10), brick, bisha);
  batch(prism(podium.points, 12, 10), glass[1], bisha);
  batch(prism(tower.points, BISHA_HEIGHT - 10, 10), glass[0], bisha);
  for (let floor = 4; floor < 44; floor++) {
    const points = tower.points.map(([x, z]) => [towerCenter[0] + (x - towerCenter[0]) * 1.035, towerCenter[1] + (z - towerCenter[1]) * 1.035] as MapPoint);
    batch(prism(points, 0.25, floor * BISHA_HEIGHT / 44), pale, bisha);
  }
  batch(prism(tower.points, 0.8, BISHA_HEIGHT), dark, bisha);
  const angle = 0.285;
  box(23, 2.8, 10, towerCenter[0] - 2, BISHA_HEIGHT + 1.8, towerCenter[1] - 3, glass[1], bisha, angle);
  box(19, 0.4, 5, towerCenter[0] + 1, BISHA_HEIGHT + 0.65, towerCenter[1] + 8, mat('#69d4df', { emissive: '#2a8891', emissiveIntensity: 0.35 }), bisha, angle);
  box(13, 0.7, 4, 17, 4.6, 2, dark, bisha, angle);
  sign('B I S H A', 21, 9, 0, 4, '#ffe1ac', bisha, true);
  sign('BISHA · 88 BLUE JAYS WAY', towerCenter[0], BISHA_HEIGHT + 15, towerCenter[1], 11, '#ffdb9c');
  const ring = new T.Mesh(new T.RingGeometry(29, 30.2, 64), new T.MeshBasicMaterial({ color: '#efc98a', side: T.DoubleSide, transparent: true, opacity: 0.8 }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 1; near.add(ring); geometries.add(ring.geometry); materials.add(ring.material);
  // CN Tower: tapered concrete legs, observation pod, upper shaft and antenna.
  const cn = new T.Group(); cn.position.set(cnPosition[0], 0, cnPosition[1]); neighbourhood.add(cn);
  function cylinder(top: number, bottom: number, h: number, y: number, material: T.Material, parent: T.Group, segments = 48) {
    const g = new T.CylinderGeometry(top, bottom, h, segments); g.translate(0, y, 0); batch(g, material, parent);
  }
  cylinder(8, 18, 340, 170, concrete, cn, 6);
  for (let i = 0; i < 3; i++) {
    const g = new T.CylinderGeometry(2.2, 14, 318, 3); g.translate(0, 159, 7); g.rotateY(i * Math.PI * 2 / 3); batch(g, concrete, cn);
    const track = new T.BoxGeometry(1.1, 330, 0.6); track.translate(0, 165, 11.5); track.rotateY(i * Math.PI * 2 / 3); batch(track, gold, cn);
  }
  const pod = [[8, 325], [20, 332], [21, 338], [21, 346], [20, 352], [15, 359], [8, 365]].map(([x, y]) => new T.Vector2(x, y));
  batch(new T.LatheGeometry(pod, 64), pale, cn);
  cylinder(21.15, 21.15, 6, 345, glass[1], cn);
  cylinder(20.5, 20.5, 1, 350, mat('#df6383', { emissive: '#c54b72', emissiveIntensity: 0.7 }), cn);
  cylinder(3.8, 8, 91, 405.5, concrete, cn);
  cylinder(7.5, 6, 7, 447, pale, cn); cylinder(7.6, 7.6, 3, 449, glass[1], cn);
  cylinder(1.2, 3.8, CN_HEIGHT - 451, 451 + (CN_HEIGHT - 451) / 2, pale, cn, 16);
  for (let y = 470; y < 540; y += 15) cylinder(2, 2, 3, y, mat('#ba6f73'), cn, 16);
  sign('CN TOWER', cnPosition[0], CN_HEIGHT + 12, cnPosition[1], 12);
  // Rogers Centre: mapped footprint with a segmented dome and a visible ballpark.
  const stadium = new T.Group(); stadium.position.set(stadiumPosition[0], 0, stadiumPosition[1]); neighbourhood.add(stadium);
  const outline = stadiumOutline.points.map(([x, z]) => [x - stadiumPosition[0], z - stadiumPosition[1]] as MapPoint);
  batch(prism(outline, 30), concrete, stadium);
  cylinder(97, 97, 1, 31, grass, stadium, 96);
  for (let tier = 0; tier < 5; tier++) {
    const seating = new T.RingGeometry(70 + tier * 4.2, 73.7 + tier * 4.2, 96); seating.rotateX(-Math.PI / 2); seating.translate(0, 32 + tier * 2, 0); batch(seating, mat(tier % 2 ? '#426b90' : '#335779'), stadium);
  }
  const diamond = new T.PlaneGeometry(35, 35); diamond.rotateX(-Math.PI / 2); diamond.rotateY(Math.PI / 4); diamond.translate(0, 31.7, 26); batch(diamond, mat('#b39578'), stadium);
  strip([[0, 70], [-72, -2]], 0.4, 32, pale, stadium); strip([[0, 70], [72, -2]], 0.4, 32, pale, stadium);
  // Curved roof panels frame a rectangular opening, rather than a radial wedge.
  const roofPositions: number[] = [], roofUV: number[] = [], radius = 108, steps = 72;
  const roofHeight = (x: number, z: number) => 35 + 51 * Math.sqrt(Math.max(0, 1 - (x * x + z * z) / radius ** 2));
  for (let row = 0; row < steps; row++) for (let col = 0; col < steps; col++) {
    const x = -radius + col * radius * 2 / steps, z = -radius + row * radius * 2 / steps, delta = radius * 2 / steps;
    const midX = x + delta / 2, midZ = z + delta / 2;
    if (midX ** 2 + midZ ** 2 > radius ** 2 || (Math.abs(midX) < 68 && midZ > -25 && midZ < 75)) continue;
    for (const [px, pz] of [[x, z], [x, z + delta], [x + delta, z + delta], [x, z], [x + delta, z + delta], [x + delta, z]]) { roofPositions.push(px, roofHeight(px, pz), pz); roofUV.push(px / radius, pz / radius); }
  }
  const dome = new T.BufferGeometry(); dome.setAttribute('position', new T.Float32BufferAttribute(roofPositions, 3)); dome.setAttribute('uv', new T.Float32BufferAttribute(roofUV, 2)); dome.computeVertexNormals(); batch(dome, pale, stadium);
  for (const z of [-78, -50]) {
    const span = Math.sqrt(radius ** 2 - z ** 2), points = Array.from({ length: 49 }, (_, i) => { const x = -span + i * span * 2 / 48; return new T.Vector3(x, roofHeight(x, z) + 0.4, z); });
    batch(new T.TubeGeometry(new T.CatmullRomCurve3(points), 48, 0.7, 4, false), roof, stadium);
  }
  const roofEdge = new T.TorusGeometry(108, 1.5, 6, 96); roofEdge.rotateX(Math.PI / 2); roofEdge.translate(0, 35, 0); batch(roofEdge, roof, stadium);
  sign('ROGERS CENTRE', stadiumPosition[0], 92, stadiumPosition[1], 13);
  // Actual mapped trees; instancing keeps the district inexpensive to orbit.
  const treeGeo = new T.IcosahedronGeometry(3.4, 0), treeMat = mat('#42715f'); geometries.add(treeGeo);
  const trees = new T.InstancedMesh(treeGeo, treeMat, data.trees.length), transform = new T.Object3D(); near.add(trees);
  data.trees.forEach(([x, z], i) => { transform.position.set(x, 5.3, z); transform.scale.set(1, 1.3, 1); transform.updateMatrix(); trees.setMatrixAt(i, transform.matrix); });
  trees.computeBoundingSphere();
  for (const [parent, groups] of batches) for (const [m, parts] of groups) {
    if (!parts.length) continue; const merged = mergeGeometries(parts); parts.forEach(g => g.dispose());
    if (merged) mesh(merged, m, parent);
  }
  // Exact footprint is also the click target, even where balconies have small gaps.
  const hit = mesh(prism(tower.points, BISHA_HEIGHT + 4), new T.MeshBasicMaterial({ visible: false }), bisha); materials.add(hit.material);
  return { root, bisha, near, labels, hit,
    setCutaway(enabled: boolean) { root.visible = !enabled; },
    dispose() { geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); textures.forEach(t => t.dispose()); root.removeFromParent(); },
  };
}
