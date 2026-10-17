import test from 'node:test';
import assert from 'node:assert/strict';
import { PerspectiveCamera, Vector3 } from 'three';
import { frameTower } from './scene';

test('default camera keeps 10–40 floors and 1–5 cars clear of the HUD on desktop and phones', () => {
  for (const [width, height] of [[1440, 900], [1024, 768], [768, 600], [844, 390], [390, 844], [375, 667], [320, 400]]) {
    for (const floors of [10, 40]) for (const cars of [1, 3, 5]) {
      const camera = new PerspectiveCamera(35, 1, 0.1, 300);
      const target = frameTower(camera, floors, cars, width, height);
      assert.ok(camera.position.distanceTo(target) < 150, 'camera stays within orbit zoom limits');
      const towerWidth = cars * 1.85 + 3.8, towerHeight = (floors + 6) * 0.65;
      for (const x of [-towerWidth / 2 - 1.5, towerWidth / 2 + 0.75]) for (const y of [-0.5, towerHeight + 1]) for (const z of [-2, 2]) {
        const point = new Vector3(x, y, z).project(camera);
        const px = (point.x + 1) * width / 2, py = (1 - point.y) * height / 2;
        assert.ok(px >= 16 && px <= width - 16, `tower clipped horizontally at ${width}×${height}`);
        assert.ok(py > Math.min(width <= 640 ? 180 : 90, height * 0.28), 'roof clears navigation');
        assert.ok(py < height - Math.min(width <= 640 ? 200 : 100, height * 0.3), 'base clears playback and mobile cards');
      }
    }
  }
});
