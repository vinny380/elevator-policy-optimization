import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { floorLabel, type Simulation } from './engine';
import { frameTower } from './scene';

const CYAN = '#92e6f6';
export function Building({ simulation, onSelect, resetToken }: { simulation: Simulation; onSelect: (id: number) => void; resetToken: number }) {
  const host = useRef<HTMLDivElement>(null);
  const current = useRef(simulation); current.current = simulation;
  const select = useRef(onSelect); select.current = onSelect;
  const controlsRef = useRef<OrbitControls | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => { controlsRef.current?.reset(); }, [resetToken]);
  useEffect(() => {
    const el = host.current!;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); } catch { setFailed(true); return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor('#0b101a', 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    el.appendChild(renderer.domElement);
    renderer.domElement.setAttribute('aria-label', 'Interactive 3D tower. Drag to rotate, scroll to zoom, arrow keys to pan when focused. Select a passenger to follow their journey.');
    renderer.domElement.setAttribute('role', 'img');
    renderer.domElement.tabIndex = 0;
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2('#101a2b', 0.012);
    const height = (simulation.config.floors + 6) * 0.65;
    const width = simulation.config.cars * 1.85 + 3.8;
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 300);

    const controls = new OrbitControls(camera, renderer.domElement);
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    controls.enableDamping = !reducedMotion.matches; controls.enablePan = true;
    controls.dampingFactor = 0.075; controls.rotateSpeed = 0.55;
    controls.minDistance = 6; controls.maxDistance = 150; controls.maxPolarAngle = Math.PI * 0.51;
    controls.listenToKeyEvents(renderer.domElement);
    controlsRef.current = controls;
    scene.add(new THREE.HemisphereLight('#b1cffa', '#1b243d', 2));
    const sun = new THREE.DirectionalLight('#e2eaff', 3); sun.position.set(8, 25, 12); scene.add(sun);
    const blue = new THREE.DirectionalLight('#7ba9e5', 2); blue.position.set(-10, 8, -12); scene.add(blue);
    const geometries: THREE.BufferGeometry[] = []; const materials: THREE.Material[] = []; const textures: THREE.Texture[] = [];
    function box(w: number, h: number, d: number, x: number, y: number, z: number, color: string, opacity = 1) {
      const geometry = new THREE.BoxGeometry(w, h, d); geometries.push(geometry);
      const material = new THREE.MeshStandardMaterial({ color, roughness: 0.65, metalness: 0.25, transparent: opacity < 1, opacity }); materials.push(material);
      const mesh = new THREE.Mesh(geometry, material); mesh.position.set(x, y, z); scene.add(mesh); return mesh;
    }
    function label(text: string, x: number, y: number, z: number, color = '#92a7a3', scale = 1) {
      const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 80;
      const ctx = canvas.getContext('2d')!; ctx.font = '500 44px -apple-system, BlinkMacSystemFont, sans-serif'; ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, 128, 40);
      const texture = new THREE.CanvasTexture(canvas); textures.push(texture);
      const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }); materials.push(material);
      const sprite = new THREE.Sprite(material); sprite.position.set(x, y, z); sprite.scale.set(1.6 * scale, 0.5 * scale, 1); scene.add(sprite);
    }
    const yOf = (floor: number) => (floor + 5) * 0.65 + 0.45;
    const xOf = (id: number) => -width / 2 + 2.8 + id * 1.85;
    box(130, 0.2, 130, 0, -0.8, 0, '#101b2c');
    box(width + 5, 0.4, 8, 0, -0.45, 0, '#26334a');
    box(width + 1.5, 0.28, 5.2, 0, -0.1, 0, '#4b5e79');
    box(width, height, 0.12, 0, height / 2, -1.8, '#27374e');
    // Low city blocks give the cutaway a world without competing with its live floors.
    for (const [x, z, w, h, d] of [[-21, -15, 7, 6, 8], [19, -20, 8, 9, 7], [-29, 10, 8, 3, 10], [28, 9, 6, 4, 8], [4, -30, 11, 5, 8]]) {
      box(w, h, d, x, h / 2 - 0.65, z, '#1b2b43');
      box(w + 0.2, 0.15, d + 0.2, x, h - 0.65, z, '#34465f');
      for (let row = 1; row < h; row += 1.4) {
        box(w - 1, 0.08, 0.02, x, row, z + d / 2 + 0.02, '#4b627d');
      }
    }
    for (let floor = -5; floor <= simulation.config.floors; floor++) {
      const y = yOf(floor) - 0.33;
      box(width, 0.065, 4, 0, y, 0, floor === 0 ? '#a4b8c7' : floor < 0 ? '#465166' : '#586b83');
      box(width, 0.025, 0.035, 0, y + 0.03, 2.02, floor === 0 ? '#e9bf8a' : '#9bacc5');
      if (floor % 5 === 0 || floor === -1) label(floorLabel(floor), -width / 2 - 0.75, y + 0.28, 2.1, floor === 0 ? '#f5d8b5' : '#b9cbe0', floor === 0 ? 1.2 : 0.85);
      for (let id = 0; id < simulation.config.cars; id++) {
        box(1.2, 0.47, 0.025, xOf(id), y + 0.27, -1.7, '#18283d');
        box(0.025, 0.47, 0.025, xOf(id), y + 0.27, -1.67, '#576e8b');
      }
    }
    for (const x of [-width / 2, width / 2]) box(0.13, height + 0.2, 0.13, x, height / 2, 2, '#a3b3c8');
    for (let id = 0; id <= simulation.config.cars; id++) box(0.07, height, 0.07, xOf(id) - 0.93, height / 2, 0.65, '#7792b0');
    box(width + 0.15, 0.2, 4.2, 0, height + 0.05, 0, '#acbcd0');
    for (let id = 0; id < simulation.config.cars; id++) label(String.fromCharCode(65 + id), xOf(id), height + 0.7, 1, '#b5c8df', 0.85);
    const cars = simulation.cars.map(car => {
      const group = new THREE.Group(); scene.add(group); group.position.set(xOf(car.id), yOf(car.position), 0.5);
      const geometry = new THREE.BoxGeometry(1.38, 0.48, 1.55); geometries.push(geometry);
      const material = new THREE.MeshStandardMaterial({ color: CYAN, emissive: '#54b9dc', emissiveIntensity: 0.9, roughness: 0.25, metalness: 0.3, transparent: true, opacity: 0.9 }); materials.push(material);
      const body = new THREE.Mesh(geometry, material); group.add(body);
      const edgeGeo = new THREE.EdgesGeometry(geometry); geometries.push(edgeGeo);
      const edgeMaterial = new THREE.LineBasicMaterial({ color: '#c7f2ff' }); materials.push(edgeMaterial);
      group.add(new THREE.LineSegments(edgeGeo, edgeMaterial));
      const doors = [-1, 1].map(side => {
        const geo = new THREE.BoxGeometry(0.6, 0.4, 0.04); geometries.push(geo);
        const mat = new THREE.MeshStandardMaterial({ color: '#c3d7e6', metalness: 0.6, roughness: 0.2 }); materials.push(mat);
        const mesh = new THREE.Mesh(geo, mat); mesh.position.set(side * 0.31, 0, 0.8); group.add(mesh); return mesh;
      });
      return { group, material, doors };
    });
    const passengerGeo = new THREE.CapsuleGeometry(0.065, 0.15, 2, 6); geometries.push(passengerGeo);
    const passengerMat = new THREE.MeshStandardMaterial({ color: 'white', roughness: 0.5 }); materials.push(passengerMat);
    const passengers = new THREE.InstancedMesh(passengerGeo, passengerMat, 1200); passengers.count = 0; scene.add(passengers);
    const matrix = new THREE.Object3D(); const color = new THREE.Color(); let passengerIds: number[] = [];
    const grid = new THREE.GridHelper(120, 40, '#26364d', '#1c2b42'); grid.position.y = -0.68; scene.add(grid);
    const resize = () => {
      const { width: w, height: h } = el.getBoundingClientRect(); if (!w || !h) return;
      renderer.setSize(w, h);
      controls.target.copy(frameTower(camera, simulation.config.floors, simulation.config.cars, w, h));
      controls.update(); controls.saveState();
    };
    const observer = new ResizeObserver(resize); observer.observe(el); resize();
    const raycaster = new THREE.Raycaster(); let pointerStart = [0, 0];
    const down = (event: PointerEvent) => { pointerStart = [event.clientX, event.clientY]; };
    const click = (event: PointerEvent) => {
      if (Math.hypot(event.clientX - pointerStart[0], event.clientY - pointerStart[1]) > 5) return;
      const rect = renderer.domElement.getBoundingClientRect();
      raycaster.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1), camera);
      const hit = raycaster.intersectObject(passengers)[0]; if (hit?.instanceId !== undefined) select.current(passengerIds[hit.instanceId]);
    };
    renderer.domElement.addEventListener('pointerdown', down); renderer.domElement.addEventListener('pointerup', click);
    let frame: number;
    let previousTime = performance.now();
    function render(now = performance.now()) {
      const dt = Math.min((now - previousTime) / 1000, 0.1); previousTime = now;
      const positionBlend = reducedMotion.matches ? 1 : 1 - Math.exp(-10 * dt);
      const doorBlend = reducedMotion.matches ? 1 : 1 - Math.exp(-14 * dt);
      controls.enableDamping = !reducedMotion.matches;
      const sim = current.current;
      cars.forEach((view, i) => {
        const car = sim.cars[i]; if (!car) return;
        view.group.position.y += (yOf(car.position) - view.group.position.y) * positionBlend;
        view.material.color.set(car.enabled ? CYAN : '#70798d'); view.material.emissive.set(car.enabled ? '#54b9dc' : '#271f22');
        view.doors.forEach((door, j) => { const x = (j ? 1 : -1) * (car.door > 0 ? 0.62 : 0.31); door.position.x += (x - door.position.x) * doorBlend; });
      });
      const positions: Record<number, number> = {}; passengerIds = [];
      for (const p of sim.people) {
        if (p.boarded !== null || passengerIds.length >= 1200) continue;
        const index = positions[p.from] ?? 0; positions[p.from] = index + 1;
        matrix.position.set(-width / 2 + 0.35 + index % 24 * 0.25, yOf(p.from) - 0.15, 1.75 - Math.floor(index / 24) * 0.26);
        matrix.scale.setScalar(p.id === 1 && sim.config.pattern === 'night' ? 1.4 : 1); matrix.updateMatrix();
        const instance = passengerIds.length; passengers.setMatrixAt(instance, matrix.matrix);
        color.setHSL(0.48 * (1 - Math.min(1, (sim.time - p.arrived) / 120)), 0.65, 0.7); passengers.setColorAt(instance, color); passengerIds.push(p.id);
      }
      passengers.count = passengerIds.length; passengers.instanceMatrix.needsUpdate = true;
      if (passengers.instanceColor) passengers.instanceColor.needsUpdate = true;
      passengers.computeBoundingSphere(); controls.update(); renderer.render(scene, camera); frame = requestAnimationFrame(render);
    }
    render();
    return () => {
      cancelAnimationFrame(frame); observer.disconnect(); controls.dispose(); controlsRef.current = null;
      renderer.domElement.removeEventListener('pointerdown', down); renderer.domElement.removeEventListener('pointerup', click);
      geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); textures.forEach(t => t.dispose());
      grid.geometry.dispose(); (grid.material as THREE.Material).dispose(); renderer.dispose(); renderer.domElement.remove();
    };
  }, [simulation.config.floors, simulation.config.cars]);
  return <div className="building-canvas" ref={host}>{failed && <div className="webgl-fallback">3D rendering needs WebGL. Simulation and training controls remain available.</div>}</div>;
}
