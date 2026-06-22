// Gemelo digital 3D del brazo (Fase 4) — Three.js, 100% en el navegador.
// Espejo: lee los ángulos de las entidades del brazo cada frame y mueve el modelo.
// Control: arrastrar una articulación cambia su ángulo y publica el comando
// (vía el slider de la entidad -> entities.js onRangeInput). Sin carga al servidor.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';

const JOINTS = ['base', 'shoulder', 'elbow', 'wrist'];
const DEG = Math.PI / 180;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
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

  // Luces (entorno oscuro con realce púrpura/cian).
  scene.add(new THREE.AmbientLight(0x9a8cff, 0.5));
  const dir = new THREE.DirectionalLight(0xffffff, 1.15);
  dir.position.set(4, 9, 5);
  scene.add(dir);
  const fill = new THREE.DirectionalLight(0x8a2be2, 0.7);
  fill.position.set(-5, 3, -4);
  scene.add(fill);
  const rim = new THREE.PointLight(0x00ff7f, 0.45, 22);
  rim.position.set(0, 1.6, -4);
  scene.add(rim);

  // Rejilla de suelo estilo sci-fi (líneas púrpura sobre oscuro).
  const grid = new THREE.GridHelper(10, 20, 0x8a2be2, 0x2a2440);
  grid.material.opacity = 0.5; grid.material.transparent = true;
  scene.add(grid);

  // Anillo emisivo de plataforma (efecto holográfico, con latido suave).
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.95, 1.18, 56),
    new THREE.MeshBasicMaterial({ color: 0x8a2be2, transparent: true, opacity: 0.4, side: THREE.DoubleSide })
  );
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.01;
  scene.add(ring);

  // --- Materiales ---
  const matBody = new THREE.MeshStandardMaterial({ color: 0x3a3556, metalness: 0.78, roughness: 0.34 });
  const matLink = new THREE.MeshStandardMaterial({ color: 0x4a4470, metalness: 0.6, roughness: 0.42 });
  const matJoint = new THREE.MeshStandardMaterial({ color: 0x8a2be2, emissive: 0x8a2be2, emissiveIntensity: 0.85, metalness: 0.4, roughness: 0.3 });
  const matBase = new THREE.MeshStandardMaterial({ color: 0x16132a, emissive: 0x110c26, emissiveIntensity: 0.4, metalness: 0.7, roughness: 0.5 });
  const matGrip = new THREE.MeshStandardMaterial({ color: 0x00ff7f, emissive: 0x00a85a, emissiveIntensity: 0.55, metalness: 0.5, roughness: 0.4 });

  const root = new THREE.Group();
  scene.add(root);

  // --- Helpers de geometría mecánica ---
  // Motor de articulación: cilindro corto con el eje en Z (cara del servo a la vista).
  // El cuerpo es el "handle" arrastrable (userData.entityId).
  function motorJoint(id, radius = 0.17) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 0.3, 30), matJoint.clone());
    body.rotation.x = Math.PI / 2;
    body.userData.entityId = id;
    g.add(body);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.45, radius * 0.45, 0.34, 20),
      new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x8a2be2, emissiveIntensity: 0.4, metalness: 0.6, roughness: 0.3 }));
    cap.rotation.x = Math.PI / 2;
    g.add(cap);
    return { group: g, handle: body };
  }

  // Eslabón tipo viga: núcleo delgado + dos placas laterales (look mecánico).
  function link(len, w) {
    const g = new THREE.Group();
    const core = new THREE.Mesh(new THREE.BoxGeometry(w * 0.55, len, w * 0.55), matLink);
    core.position.y = len / 2; g.add(core);
    const plate = new THREE.BoxGeometry(0.035, len * 0.92, w);
    const pL = new THREE.Mesh(plate, matBody); pL.position.set(w * 0.33, len / 2, 0); g.add(pL);
    const pR = pL.clone(); pR.position.x = -w * 0.33; g.add(pR);
    return g;
  }

  // --- Plataforma base ---
  const baseDisk = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.96, 0.12, 36), matBase);
  baseDisk.position.y = 0.06; root.add(baseDisk);
  const baseStep = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.68, 0.16, 36), matBody);
  baseStep.position.y = 0.18; root.add(baseStep);

  // --- Torreta giratoria (servo base) ---
  const baseGroup = new THREE.Group(); baseGroup.position.y = 0.26; root.add(baseGroup);
  const turret = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.4, 0.32, 30), matBody);
  turret.position.y = 0.16; baseGroup.add(turret);
  const facing = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.14), matJoint.clone());
  facing.position.set(0, 0.16, 0.37); baseGroup.add(facing); // indicador de orientación frontal
  // Handle plano para arrastrar la base (anillo translúcido sobre la torreta).
  const baseHandle = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.05, 36), matJoint.clone());
  baseHandle.material.transparent = true; baseHandle.material.opacity = 0.22;
  baseHandle.position.y = 0.02; baseHandle.userData.entityId = 'base'; baseGroup.add(baseHandle);

  // --- Hombro ---
  const shoulderPivot = new THREE.Group(); shoulderPivot.position.y = 0.42; baseGroup.add(shoulderPivot);
  shoulderPivot.add(motorJoint('shoulder', 0.19).group);
  shoulderPivot.add(link(1.5, 0.28));

  // --- Codo ---
  const elbowPivot = new THREE.Group(); elbowPivot.position.y = 1.5; shoulderPivot.add(elbowPivot);
  elbowPivot.add(motorJoint('elbow', 0.16).group);
  elbowPivot.add(link(1.2, 0.22));

  // --- Muñeca + pinza ---
  const wristPivot = new THREE.Group(); wristPivot.position.y = 1.2; elbowPivot.add(wristPivot);
  wristPivot.add(motorJoint('wrist', 0.14).group);
  const wristLink = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.11, 0.34, 22), matBody);
  wristLink.position.y = 0.18; wristPivot.add(wristLink);
  const palm = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.12, 0.22), matBody);
  palm.position.y = 0.4; wristPivot.add(palm);

  // Dedos de la pinza (se abren/cierran según el servo 4).
  const gripper = new THREE.Group(); gripper.position.y = 0.46; wristPivot.add(gripper);
  function finger() {
    const f = new THREE.Group();
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.26, 0.13), matGrip);
    arm.position.y = 0.13; f.add(arm);
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.05, 0.13), matGrip);
    tip.position.y = 0.25; f.add(tip);
    return f;
  }
  const fingerL = finger(); gripper.add(fingerL);
  const fingerR = finger(); gripper.add(fingerR);

  const joints = { base: baseGroup, shoulder: shoulderPivot, elbow: elbowPivot };

  const handleMeshes = [];
  scene.traverse((o) => { if (o.userData && o.userData.entityId) handleMeshes.push(o); });

  // Ángulos suavizados
  const shown = { base: 90, shoulder: 90, elbow: 90, wrist: 90 };

  // --- Cámara orbital (esférica) ---
  const target = new THREE.Vector3(0, 1.6, 0);
  const cam = { radius: 6.5, theta: 0.7, phi: 1.1 };
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
      if (id === 'wrist') {
        // Servo 4 = apertura de la pinza (0° cerrada · 180° abierta).
        const sep = 0.05 + clamp(shown.wrist / 180, 0, 1) * 0.17;
        fingerL.position.x = sep;
        fingerR.position.x = -sep;
      } else if (id === 'base') {
        joints.base.rotation.y = (shown.base - 90) * DEG;
      } else {
        joints[id].rotation.z = (shown[id] - 90) * DEG;
      }
    }
    ring.material.opacity = 0.32 + Math.sin(Date.now() * 0.002) * 0.12; // latido
    updateCamera();
    renderer.render(scene, camera);
  }
  updateCamera();
  animate();
}
