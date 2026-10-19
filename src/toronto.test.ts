import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PerspectiveCamera, Vector3 } from 'three';
import { BISHA_IDS, centre, contains, projectLocation, visibleBuildings, type District } from './toronto-data';
import { frameDistrict } from './scene';
const data = JSON.parse(fs.readFileSync(new URL('../public/toronto/district.json', import.meta.url), 'utf8')) as District;

test('Toronto dataset locates the real landmarks and retains mapped geometry and height provenance', () => {
  assert.equal(data.license, 'ODbL-1.0');
  for (const id of [...BISHA_IDS, 32742038, 7969701]) assert.ok(data.buildings.some(b => b.id === id));
  const cn = projectLocation(-79.387057, 43.642566, data.origin);
  assert.ok(cn[0] > 400 && cn[0] < 450 && cn[1] > 280 && cn[1] < 330, 'CN Tower is southeast of Bisha at geographic scale');
  const bisha = data.buildings.find(b => b.id === BISHA_IDS[0])!;
  assert.ok(contains([0, 0], bisha.points));
  const visible = visibleBuildings(data.buildings);
  assert.ok(!visible.some(b => b.id === BISHA_IDS[0]), 'parent envelope cannot obscure the mapped podium and tower');
  assert.ok(visible.some(b => b.id === BISHA_IDS[2]));
  assert.ok(visible.length > 100 && visible.length < data.buildings.length);
  for (const b of data.buildings) { assert.ok(b.points.length >= 3); assert.ok(b.points.flat().every(Number.isFinite)); assert.ok(b.height > 0 && Number.isFinite(b.base)); assert.ok(['tag', 'levels', 'estimated'].includes(b.heightSource)); }
  assert.ok(data.streets.some(s => s.name === 'Blue Jays Way'));
  assert.ok(data.streets.some(s => s.name === 'Front Street West'));
  assert.ok(data.rails.length > 0 && data.parks.length > 0);
  assert.ok(contains(centre(bisha.points), bisha.points));
});

test('Toronto overview keeps Bisha, CN Tower and Rogers Centre inside the usable viewport', () => {
  for (const [w, h] of [[1440, 900], [1024, 768], [390, 844], [375, 667]]) {
    const camera = new PerspectiveCamera(38, 1, 0.1, 3000), target = frameDistrict(camera, w, h);
    assert.ok(camera.position.distanceTo(target) < 1600);
    for (const p of [new Vector3(0, 34, 0), new Vector3(85, 117, 61), new Vector3(50, 22, 90)]) {
      const point = p.project(camera), x = (point.x + 1) * w / 2, y = (1 - point.y) * h / 2;
      assert.ok(x > 16 && x < w - (w <= 640 ? 16 : 290));
      assert.ok(y > Math.min(w <= 640 ? 180 : 90, h * 0.28) && y < h - Math.min(w <= 640 ? 200 : 105, h * 0.3));
    }
  }
});
