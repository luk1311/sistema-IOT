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
  scene.fog = new THREE.Fog(0x080c14, 10, 22);
  const camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 100);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.domElement.style.position = 'relative';
  renderer.domElement.style.zIndex = '1';
  container.appendChild(renderer.domElement);

  // --- Luces (entorno oscuro, metal claro bien iluminado + realce cian) ---
  scene.add(new THREE.AmbientLight(0xb8c4ff, 0.55));
  const key = new THREE.DirectionalLight(0xffffff, 1.25);
  key.position.set(4, 9, 6);
  scene.add(key);
  const fillFront = new THREE.DirectionalLight(0xdfe6ff, 0.5);
  fillFront.position.set(0, 4, 8);
  scene.add(fillFront);
  const fill = new THREE.DirectionalLight(0x2a6cff, 0.45);
  fill.position.set(-6, 3, -4);
  scene.add(fill);
  const rim = new THREE.PointLight(0x00d4ff, 0.7, 24);
  rim.position.set(0, 1.6, -5);
  scene.add(rim);

  // Rejilla de suelo (líneas cian sobre oscuro).
  const grid = new THREE.GridHelper(10, 20, 0x00d4ff, 0x1a222e);
  grid.material.opacity = 0.45; grid.material.transparent = true;
  scene.add(grid);

  // Anillo emisivo de plataforma (efecto holográfico, con latido suave).
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.98, 1.2, 64),
    new THREE.MeshBasicMaterial({ color: 0x00d4ff, transparent: true, opacity: 0.38, side: THREE.DoubleSide })
  );
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.01;
  scene.add(ring);

  // --- Materiales (paleta Titanio + Cian) ---
  const matBody = new THREE.MeshStandardMaterial({ color: 0xc2c8d4, metalness: 0.88, roughness: 0.3 });  // titanio
  const matDark = new THREE.MeshStandardMaterial({ color: 0x2b2f38, metalness: 0.7, roughness: 0.45 });   // grafito (juntas)
  const matBolt = new THREE.MeshStandardMaterial({ color: 0x14171d, metalness: 0.85, roughness: 0.5 });   // tornillos / detalles
  const matBase = new THREE.MeshStandardMaterial({ color: 0x1b1f29, metalness: 0.75, roughness: 0.5 });   // base
  const matLed = new THREE.MeshBasicMaterial({ color: 0x00d4ff });                                        // LED cian
  const ledMeshes = []; // para el latido

  const root = new THREE.Group();
  scene.add(root);

  // --- Helpers de detalle mecánico ---
  // Corona de tornillos sobre una brida orientada en Z, a un radio dado.
  function boltCircleZ(parent, ringR, count, z, boltR = 0.016, boltLen = 0.05) {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      const b = new THREE.Mesh(new THREE.CylinderGeometry(boltR, boltR, boltLen, 6), matBolt);
      b.rotation.x = Math.PI / 2;
      b.position.set(Math.cos(a) * ringR, Math.sin(a) * ringR, z);
      parent.add(b);
    }
  }
  function led(mesh) { ledMeshes.push(mesh); return mesh; }

  // Motor de articulación: brida grafito (handle) + tambor titanio + anillos LED + tornillos.
  function motorJoint(id, radius) {
    const g = new THREE.Group();
    const flange = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 0.16, 36), matDark);
    flange.rotation.x = Math.PI / 2;
    flange.userData.entityId = id; // zona arrastrable
    g.add(flange);
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.8, radius * 0.8, 0.28, 36), matBody);
    drum.rotation.x = Math.PI / 2; g.add(drum);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.3, radius * 0.3, 0.32, 18), matBolt);
    hub.rotation.x = Math.PI / 2; g.add(hub);
    for (const z of [0.14, -0.14]) {
      const r = led(new THREE.Mesh(new THREE.TorusGeometry(radius * 0.86, 0.013, 10, 44), matLed));
      r.position.z = z; g.add(r);
    }
    boltCircleZ(g, radius * 0.58, 8, 0.085, 0.014, 0.04);
    return { group: g, handle: flange };
  }

  // Eslabón tipo viga: núcleo grafito + placas titanio atornilladas + nervios + banda LED.
  function link(len, w) {
    const g = new THREE.Group();
    const core = new THREE.Mesh(new THREE.BoxGeometry(w * 0.5, len * 0.98, w * 0.5), matDark);
    core.position.y = len / 2; g.add(core);
    const plateGeo = new THREE.BoxGeometry(0.045, len * 0.9, w);
    const pL = new THREE.Mesh(plateGeo, matBody); pL.position.set(w * 0.32, len / 2, 0); g.add(pL);
    const pR = pL.clone(); pR.position.x = -w * 0.32; g.add(pR);
    // Nervios de refuerzo sobre el núcleo.
    const ribGeo = new THREE.BoxGeometry(w * 0.54, 0.035, w * 0.54);
    for (let i = 1; i <= 3; i++) {
      const rib = new THREE.Mesh(ribGeo, matBolt);
      rib.position.y = (len / 4) * i; g.add(rib);
    }
    // Banda LED cian frontal.
    const band = led(new THREE.Mesh(new THREE.BoxGeometry(0.022, len * 0.78, 0.05), matLed));
    band.position.set(0, len / 2, w * 0.52); g.add(band);
    // Tornillos en las placas.
    for (const px of [w * 0.34, -w * 0.34]) {
      for (const py of [len * 0.12, len * 0.88]) {
        const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.017, 0.05, 6), matBolt);
        bolt.rotation.z = Math.PI / 2;
        bolt.position.set(px, py, 0); g.add(bolt);
      }
    }
    return g;
  }

  // --- Plataforma base ---
  const baseDisk = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.98, 0.12, 48), matBase);
  baseDisk.position.y = 0.06; root.add(baseDisk);
  const baseRing = led(new THREE.Mesh(new THREE.TorusGeometry(0.87, 0.013, 10, 64), matLed));
  baseRing.rotation.x = -Math.PI / 2; baseRing.position.y = 0.12; root.add(baseRing);
  const baseStep = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.66, 0.16, 48), matBody);
  baseStep.position.y = 0.18; root.add(baseStep);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.05, 6), matBolt);
    b.position.set(Math.cos(a) * 0.74, 0.12, Math.sin(a) * 0.74); root.add(b);
  }

  // --- Torreta giratoria (servo base) ---
  const baseGroup = new THREE.Group(); baseGroup.position.y = 0.26; root.add(baseGroup);
  const turret = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.42, 0.34, 36), matBody);
  turret.position.y = 0.17; baseGroup.add(turret);
  const turretLed = led(new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.011, 10, 48), matLed));
  turretLed.rotation.x = -Math.PI / 2; turretLed.position.y = 0.31; baseGroup.add(turretLed);
  const facing = led(new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.1, 0.14), matLed));
  facing.position.set(0, 0.17, 0.38); baseGroup.add(facing); // indicador de orientación
  // Cableado lateral (manguera grafito) de la base hacia el hombro.
  const cableCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.3, 0.05, 0.18),
    new THREE.Vector3(0.36, 0.45, 0.12),
    new THREE.Vector3(0.22, 0.85, 0.02),
    new THREE.Vector3(0.12, 1.2, 0.0)
  ]);
  const cable = new THREE.Mesh(new THREE.TubeGeometry(cableCurve, 28, 0.028, 8), matBolt);
  baseGroup.add(cable);
  // Handle plano para arrastrar la base.
  const baseHandle = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.05, 36),
    new THREE.MeshBasicMaterial({ color: 0x00d4ff, transparent: true, opacity: 0.16 }));
  baseHandle.position.y = 0.02; baseHandle.userData.entityId = 'base'; baseGroup.add(baseHandle);

  // --- Hombro ---
  const shoulderPivot = new THREE.Group(); shoulderPivot.position.y = 0.42; baseGroup.add(shoulderPivot);
  shoulderPivot.add(motorJoint('shoulder', 0.2).group);
  shoulderPivot.add(link(1.5, 0.3));

  // --- Codo ---
  const elbowPivot = new THREE.Group(); elbowPivot.position.y = 1.5; shoulderPivot.add(elbowPivot);
  elbowPivot.add(motorJoint('elbow', 0.17).group);
  elbowPivot.add(link(1.2, 0.24));

  // --- Muñeca + pinza ---
  const wristPivot = new THREE.Group(); wristPivot.position.y = 1.2; elbowPivot.add(wristPivot);
  wristPivot.add(motorJoint('wrist', 0.14).group);
  const wristLink = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.34, 24), matBody);
  wristLink.position.y = 0.18; wristPivot.add(wristLink);
  const palm = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.13, 0.24), matBody);
  palm.position.y = 0.41; wristPivot.add(palm);
  const palmLed = led(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.018, 0.04), matLed));
  palmLed.position.set(0, 0.41, 0.13); wristPivot.add(palmLed);

  // Dedos de la pinza (se abren/cierran según el servo 4), con almohadillas cian.
  const gripper = new THREE.Group(); gripper.position.y = 0.47; wristPivot.add(gripper);
  function finger() {
    const f = new THREE.Group();
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.28, 0.14), matBody);
    arm.position.y = 0.14; f.add(arm);
    const knuckle = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.06, 0.16), matDark);
    knuckle.position.y = 0.02; f.add(knuckle);
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.06, 0.14), matBody);
    tip.position.y = 0.27; f.add(tip);
    const pad = led(new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.2, 0.1), matLed));
    pad.position.set(0, 0.16, 0.05); f.add(pad);
    return f;
  }
  const fingerL = finger(); gripper.add(fingerL);
  const fingerR = finger(); fingerR.scale.x = -1; gripper.add(fingerR);

  const joints = { base: baseGroup, shoulder: shoulderPivot, elbow: elbowPivot };

  const handleMeshes = [];
  scene.traverse((o) => { if (o.userData && o.userData.entityId) handleMeshes.push(o); });

  // Ángulos suavizados
  const shown = { base: 90, shoulder: 90, elbow: 90, wrist: 90 };

  // --- Cámara orbital (esférica) ---
  const target = new THREE.Vector3(0, 1.65, 0);
  const cam = { radius: 6.8, theta: 0.7, phi: 1.1 };
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
    // Latido sincronizado de los LED y el anillo de plataforma.
    const pulse = 0.7 + Math.sin(Date.now() * 0.003) * 0.3;
    ring.material.opacity = 0.28 + Math.sin(Date.now() * 0.002) * 0.12;
    for (const m of ledMeshes) m.material.opacity = pulse;
    updateCamera();
    renderer.render(scene, camera);
  }
  // Los materiales LED comparten instancia; habilitar transparencia para el latido.
  matLed.transparent = true;
  updateCamera();
  animate();
}
