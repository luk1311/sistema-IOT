// Gemelo digital 3D del brazo (Fase 4) — Three.js, 100% en el navegador.
// HUD holográfico: lee los ángulos de las entidades del brazo cada frame y mueve
// el modelo, proyectando etiquetas de ángulo flotantes sobre cada articulación.
// Control: arrastrar una articulación cambia su ángulo y publica el comando
// (vía el slider de la entidad -> entities.js onRangeInput). Sin carga al servidor.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';

const JOINTS = ['base', 'shoulder', 'elbow', 'wrist'];
const LABELS = { base: 'Base', shoulder: 'Hombro', elbow: 'Codo', wrist: 'Pinza' };
const DEG = Math.PI / 180;
let initialized = false;

// Lee el ángulo actual de una articulación desde el slider de su entidad.
function getAngle(id) {
  const el = document.querySelector(`#ent-brazo-${id} .entity-range`);
  const v = el ? parseFloat(el.value) : 90;
  return Number.isFinite(v) ? v : 90;
}

// Aplica un ángulo a la entidad: mueve el slider y dispara el flujo de publicación.
function setAngle(id, value, commit) {
  const el = document.querySelector(`#ent-brazo-${id} .entity-range`);
  if (!el) return;
  el.value = Math.max(0, Math.min(180, Math.round(value)));
  el.dispatchEvent(new Event(commit ? 'change' : 'input', { bubbles: true }));
}

export function initHud3d() {
  if (initialized) return;
  const container = document.getElementById('hud3d');
  if (!container || !container.clientWidth) return; // aún no visible
  initialized = true;

  const scene = new THREE.Scene();
  scene.background = null; // transparente: el fondo holográfico vive en el CSS
  scene.fog = new THREE.Fog(0x0a0a14, 9, 20);
  const camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 100);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.domElement.style.position = 'relative';
  renderer.domElement.style.zIndex = '1';
  container.appendChild(renderer.domElement);

  // Capa de overlay HUD (etiquetas flotantes), por encima del canvas.
  const overlay = document.createElement('div');
  overlay.className = 'hud-overlay';
  container.appendChild(overlay);

  // Luces (entorno oscuro con realce púrpura/cian).
  scene.add(new THREE.AmbientLight(0x9a8cff, 0.55));
  const dir = new THREE.DirectionalLight(0xffffff, 1.1);
  dir.position.set(4, 8, 5);
  scene.add(dir);
  const fill = new THREE.DirectionalLight(0x8a2be2, 0.7);
  fill.position.set(-5, 3, -4);
  scene.add(fill);
  const rim = new THREE.PointLight(0x00ff7f, 0.5, 20);
  rim.position.set(0, 1.5, -4);
  scene.add(rim);

  // Rejilla de suelo estilo sci-fi (líneas púrpura sobre oscuro).
  const grid = new THREE.GridHelper(10, 20, 0x8a2be2, 0x2a2440);
  grid.material.opacity = 0.55; grid.material.transparent = true;
  scene.add(grid);

  // Anillo emisivo en la base (efecto plataforma holográfica).
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.95, 1.15, 48),
    new THREE.MeshBasicMaterial({ color: 0x8a2be2, transparent: true, opacity: 0.45, side: THREE.DoubleSide })
  );
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.012;
  scene.add(ring);

  const matSeg = new THREE.MeshStandardMaterial({ color: 0x5a4a9a, emissive: 0x2a1a5a, emissiveIntensity: 0.35, metalness: 0.6, roughness: 0.35 });
  const matJoint = new THREE.MeshStandardMaterial({ color: 0x8a2be2, emissive: 0x8a2be2, emissiveIntensity: 0.9, metalness: 0.3, roughness: 0.3 });
  const matBase = new THREE.MeshStandardMaterial({ color: 0x1e1a32, emissive: 0x150f2a, emissiveIntensity: 0.4, metalness: 0.7, roughness: 0.5 });

  const root = new THREE.Group();
  scene.add(root);

  // Plataforma
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.8, 0.2, 24), matBase);
  base.position.y = 0.1; root.add(base);

  // Grupo que rota en Y (servo base)
  const baseGroup = new THREE.Group(); baseGroup.position.y = 0.2; root.add(baseGroup);
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.2, 0.5, 16), matSeg);
  post.position.y = 0.25; baseGroup.add(post);

  const joints = {};
  function jointHandle(id) {
    const s = new THREE.Mesh(new THREE.SphereGeometry(0.16, 20, 20), matJoint.clone());
    s.userData.entityId = id;
    return s;
  }
  function segment(len, w) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, len, w), matSeg);
    m.position.y = len / 2;
    return m;
  }

  // Hombro
  const shoulderPivot = new THREE.Group(); shoulderPivot.position.y = 0.5; baseGroup.add(shoulderPivot);
  shoulderPivot.add(jointHandle('shoulder'));
  shoulderPivot.add(segment(1.6, 0.22));

  // Codo
  const elbowPivot = new THREE.Group(); elbowPivot.position.y = 1.6; shoulderPivot.add(elbowPivot);
  elbowPivot.add(jointHandle('elbow'));
  elbowPivot.add(segment(1.3, 0.18));

  // Muñeca
  const wristPivot = new THREE.Group(); wristPivot.position.y = 1.3; elbowPivot.add(wristPivot);
  wristPivot.add(jointHandle('wrist'));
  wristPivot.add(segment(0.8, 0.14));

  // Pinza (gripper) al final de la muñeca
  const gripper = new THREE.Group(); gripper.position.y = 0.8; wristPivot.add(gripper);
  const g1 = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.3, 0.06), matJoint);
  g1.position.set(0.12, 0.15, 0); gripper.add(g1);
  const g2 = g1.clone(); g2.position.x = -0.12; gripper.add(g2);

  // Manija de la base (para arrastrar el servo base): anillo en la plataforma
  const baseHandle = jointHandle('base');
  baseHandle.position.y = 0.2; baseHandle.scale.set(1.1, 0.5, 1.1); baseGroup.add(baseHandle);

  joints.base = baseGroup;
  joints.shoulder = shoulderPivot;
  joints.elbow = elbowPivot;
  joints.wrist = wristPivot;

  const handleMeshes = [];
  scene.traverse((o) => { if (o.userData && o.userData.entityId) handleMeshes.push(o); });

  // --- Etiquetas HUD flotantes (un div por articulación, posición proyectada) ---
  const labelAnchors = { base: baseHandle, shoulder: shoulderPivot, elbow: elbowPivot, wrist: wristPivot };
  const labelEls = {};
  for (const id of JOINTS) {
    const el = document.createElement('div');
    el.className = 'hud-label';
    el.innerHTML = `<span class="lh">${LABELS[id]}</span><span class="lv">90°</span>`;
    overlay.appendChild(el);
    labelEls[id] = el;
  }
  const projV = new THREE.Vector3();
  function placeLabels() {
    const w = container.clientWidth, h = container.clientHeight;
    for (const id of JOINTS) {
      labelAnchors[id].getWorldPosition(projV);
      projV.project(camera);
      const visible = projV.z < 1;
      const el = labelEls[id];
      el.style.opacity = visible ? '1' : '0';
      if (!visible) continue;
      const x = (projV.x * 0.5 + 0.5) * w;
      const y = (-projV.y * 0.5 + 0.5) * h;
      el.style.transform = `translate(-50%, -50%) translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      el.querySelector('.lv').textContent = `${Math.round(shown[id])}°`;
    }
  }

  // Ángulos suavizados
  const shown = { base: 90, shoulder: 90, elbow: 90, wrist: 90 };

  // --- Cámara orbital (esférica) ---
  const target = new THREE.Vector3(0, 1.6, 0);
  const cam = { radius: 6.5, theta: 0.7, phi: 1.15 };
  function updateCamera() {
    camera.position.x = target.x + cam.radius * Math.sin(cam.phi) * Math.sin(cam.theta);
    camera.position.y = target.y + cam.radius * Math.cos(cam.phi);
    camera.position.z = target.z + cam.radius * Math.sin(cam.phi) * Math.cos(cam.theta);
    camera.lookAt(target);
  }

  // --- Interacción ---
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let mode = null; // 'orbit' | 'drag'
  let dragId = null; let startX = 0; let startAngle = 0; let lastX = 0; let lastY = 0;

  function pointerNdc(e) {
    const r = renderer.domElement.getBoundingClientRect();
    pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1;
  }

  renderer.domElement.addEventListener('pointerdown', (e) => {
    pointerNdc(e);
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(handleMeshes, false)[0];
    lastX = e.clientX; lastY = e.clientY;
    if (hit) {
      mode = 'drag'; dragId = hit.object.userData.entityId; startX = e.clientX; startAngle = getAngle(dragId);
      container.classList.add('is-grabbing');
    } else {
      mode = 'orbit';
      container.classList.add('is-orbiting');
    }
    renderer.domElement.setPointerCapture(e.pointerId);
  });

  renderer.domElement.addEventListener('pointermove', (e) => {
    if (mode === 'orbit') {
      cam.theta -= (e.clientX - lastX) * 0.01;
      cam.phi = Math.max(0.2, Math.min(Math.PI - 0.2, cam.phi - (e.clientY - lastY) * 0.01));
      lastX = e.clientX; lastY = e.clientY;
    } else if (mode === 'drag' && dragId) {
      const delta = (e.clientX - startX) * 0.5;
      setAngle(dragId, startAngle + delta, false);
    }
  });

  function endPointer(e) {
    if (mode === 'drag' && dragId) setAngle(dragId, getAngle(dragId), true); // commit final
    mode = null; dragId = null;
    container.classList.remove('is-grabbing', 'is-orbiting');
    try { renderer.domElement.releasePointerCapture(e.pointerId); } catch (err) { /* noop */ }
  }
  renderer.domElement.addEventListener('pointerup', endPointer);
  renderer.domElement.addEventListener('pointercancel', endPointer);

  // Zoom con rueda
  renderer.domElement.addEventListener('wheel', (e) => {
    e.preventDefault();
    cam.radius = Math.max(3, Math.min(14, cam.radius + Math.sign(e.deltaY) * 0.6));
  }, { passive: false });

  // Resize (cubre cambios de layout y entrada/salida de pantalla completa)
  function resize() {
    if (!container.clientWidth) return;
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
  }
  const ro = new ResizeObserver(resize);
  ro.observe(container);

  // Marco HUD (esquinas estilo visor) + botón de pantalla completa.
  const frame = document.createElement('div');
  frame.className = 'hud-frame';
  frame.innerHTML = '<i></i><i></i><i></i><i></i>';
  container.appendChild(frame);

  const fsBtn = document.createElement('button');
  fsBtn.type = 'button';
  fsBtn.className = 'hud-fs-btn';
  fsBtn.title = 'Pantalla completa';
  fsBtn.innerHTML = '<span class="material-symbols-outlined">fullscreen</span>';
  fsBtn.addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else container.requestFullscreen().catch(() => {});
  });
  container.appendChild(fsBtn);
  document.addEventListener('fullscreenchange', () => {
    const on = document.fullscreenElement === container;
    fsBtn.querySelector('.material-symbols-outlined').textContent = on ? 'fullscreen_exit' : 'fullscreen';
    setTimeout(resize, 60);
  });

  // --- Bucle ---
  function animate() {
    requestAnimationFrame(animate);
    for (const id of JOINTS) {
      const tgt = getAngle(id);
      shown[id] += (tgt - shown[id]) * 0.18; // suavizado
      const rot = (shown[id] - 90) * DEG;
      if (id === 'base') joints.base.rotation.y = rot;
      else joints[id].rotation.z = rot;
    }
    ring.material.opacity = 0.35 + Math.sin(Date.now() * 0.002) * 0.12; // latido suave
    updateCamera();
    renderer.render(scene, camera);
    placeLabels();
  }
  updateCamera();
  animate();
}
