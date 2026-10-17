import { PerspectiveCamera, Vector3 } from 'three';

// Fit the cutaway between the HUD and playback dock, including floor labels.
export function frameTower(camera: PerspectiveCamera, floors: number, cars: number, width: number, height: number) {
  const towerHeight = (floors + 6) * 0.65;
  const towerWidth = cars * 1.85 + 3.8;
  const mobile = width <= 640;
  const left = mobile ? 16 : Math.min(200, width * 0.2);
  const right = mobile ? 16 : 290;
  const top = Math.min(mobile ? 180 : 90, height * 0.28);
  const bottom = Math.min(mobile ? 200 : 100, height * 0.3);
  const target = new Vector3(0, towerHeight / 2, 0);
  camera.aspect = width / height; camera.fov = mobile ? 43 : 35;
  camera.setViewOffset(width, height, (right - left) / 2, (bottom - top) / 2, width, height);
  camera.updateProjectionMatrix();
  const offset = new Vector3(towerWidth * 1.65, towerHeight * 0.25, towerHeight * 1.6);
  const corners = [];
  for (const x of [-towerWidth / 2 - 1.6, towerWidth / 2 + 1])
    for (const y of [-0.7, towerHeight + 1.2])
      for (const z of [-2.6, 2.6]) corners.push(new Vector3(x, y, z));
  for (let i = 0; i < 60; i++) {
    camera.position.copy(target).add(offset); camera.lookAt(target); camera.updateMatrixWorld();
    const fits = corners.every(corner => {
      const point = corner.clone().project(camera);
      const x = (point.x + 1) * width / 2, y = (1 - point.y) * height / 2;
      return x >= left && x <= width - right && y >= top && y <= height - bottom;
    });
    if (fits) break;
    offset.multiplyScalar(1.05);
  }
  return target;
}
