import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Object3D, PerspectiveCamera, Vector3 } from 'three';
import { bishaPlacement, BISHA_HEIGHT, BISHA_IDS, BISHA_ROTATION, MAP_SCALE, STREET_Y, centre, contains, projectLocation, visibleBuildings, type District } from './toronto-data';
import { frameDistrict, frameTower } from './scene';
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

test('live elevator interior stays inside Bisha, aligns with the street and roof, and remains frameable', () => {
  const footprint = data.buildings.find(b => b.id === BISHA_IDS[2])!.points;
  for (const floors of [10, 20, 40]) for (const cars of [1, 3, 5]) {
    const placement = bishaPlacement(footprint, floors, cars), tower = new Object3D();
    tower.position.set(...placement.position); tower.scale.set(...placement.scale); tower.rotation.y = BISHA_ROTATION; tower.updateMatrixWorld();
    const width = cars * 1.85 + 3.8, height = (floors + 6) * 0.65;
    const ground = new Vector3(0, STREET_Y, 0).applyMatrix4(tower.matrixWorld);
    const roof = new Vector3(0, height, 0).applyMatrix4(tower.matrixWorld);
    assert.ok(Math.abs(ground.y - STREET_Y) < 1e-8);
    assert.ok(Math.abs(roof.y - STREET_Y - BISHA_HEIGHT * MAP_SCALE) < 1e-8);
    for (const x of [-width / 2, width / 2]) for (const z of [-2, 2]) {
      const p = new Vector3(x, 0, z).applyMatrix4(tower.matrixWorld);
      assert.ok(contains([p.x / MAP_SCALE, p.z / MAP_SCALE], footprint), 'interior corners fit the real tower');
    }
    for (const [w, h] of [[1440, 900], [390, 844]]) {
      const camera = new PerspectiveCamera(38, 1, 0.1, 3000);
      frameTower(camera, floors, cars, w, h, tower.matrixWorld);
      for (const p of [ground, roof]) {
        const projected = p.clone().project(camera), x = (projected.x + 1) * w / 2, y = (1 - projected.y) * h / 2;
        assert.ok(x > 16 && x < w - (w <= 640 ? 16 : 290));
        assert.ok(y > 90 && y < h - 100);
      }
    }
  }
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
