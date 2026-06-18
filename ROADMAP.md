# TADASHY — Roadmap y enfoque del proyecto

> **Objetivo:** uso personal real.
> **Alcance:** plataforma genérica IoT (cualquier hardware, no solo el brazo).
> **Inspiración:** Blynk (panel IoT), Home Assistant (cerebro del hogar), JARVIS/Stark (IA proactiva y multimodal).

---

## 1. Visión

Convertir TADASHY de un **controlador específico del brazo robótico** en una **plataforma personal de control IoT con IA**, donde:

- Cualquier dispositivo (brazo, luces, sensores, cámaras) se integra bajo un modelo común.
- Un asistente conversacional (voz + texto) entiende el estado del sistema, actúa con tu confirmación y te avisa de forma proactiva.
- El brazo robótico sigue siendo la pieza estrella, ahora como "un dispositivo más" dentro de un sistema mayor.

---

## 2. Principio rector: de "controlador de brazo" a "modelo de entidades"

**El problema de fondo de hoy:** la lógica está cableada al brazo. Ejemplos en el código actual:
- `src/robot.js` asume 4 servos y publica en `brazo/servo/N`.
- `src/mqtt.js` se suscribe a `brazo/#` y parsea `brazo/servo/feedback/N`.
- El dashboard (`index.html`) tiene tarjetas de servo fijas.

**El cambio clave (la base de toda la plataforma):** introducir un **modelo de entidades/capacidades**, como hace Home Assistant. Un *dispositivo* tiene *entidades*, y cada entidad tiene un *tipo de capacidad*:

| Capacidad | Ejemplos | Widget UI | Acción IA |
|---|---|---|---|
| `switch` | luz, relé | toggle | encender/apagar |
| `range` | servo, dimmer | slider + gauge | fijar valor 0–N |
| `sensor` | temperatura, humedad | gráfica/valor | leer/analizar |
| `button` | acción puntual | botón | disparar |
| `text/json` | estado libre | terminal | inspeccionar |

Así el brazo pasa a ser "un dispositivo con 4 entidades `range`", y el dashboard, las automatizaciones y la IA dejan de conocer "servos": conocen *capacidades*. Esto ya está medio insinuado en `tadashy_ai_core.js` (`DeviceRegistry`, `LocationRegistry`) — hay que llevarlo al frente.

> **Esta es la decisión arquitectónica #1.** Todo lo demás (gráficas, escenas, reglas, IA) se vuelve genérico y reutilizable si se construye sobre este modelo. Si se hace al revés, cada feature se cablea otra vez al brazo.

---

## 3. Hoja de ruta por fases

### Fase 0 — Fundaciones (modelo de entidades + estabilidad)
**Objetivo:** base genérica y un sistema en el que se pueda confiar a diario.
- Definir el esquema de dispositivo/entidad/capacidad (validado con `ajv`, que ya es dependencia).
- Persistir entidades y telemetría en `iot_store.js` (SQLite) con histórico.
- Generalizar `robot.js`/`mqtt.js` para que el brazo se describa como entidades, no como caso especial.
- Convención de tópicos MQTT genérica: `tadashy/{deviceId}/{entityId}/{state|set|feedback}`, manteniendo compatibilidad con `brazo/#`.
- Reconexión robusta y manejo de errores (clave para uso personal real).

**Entregable:** dar de alta un dispositivo nuevo (p. ej. una luz) sin tocar código de UI.

### Fase 1 — Visualización y escenas (estilo Blynk)
**Objetivo:** ver y controlar todo de un vistazo.
- **Gráficas de telemetría** con Chart.js (¡ya está cargado en `index.html` y sin usar!): series temporales por entidad `sensor`/`range`.
- **Dashboard configurable**: el usuario coloca widgets por entidad y se guarda el layout (reutiliza la idea del constructor visual de `automations.js`).
- **Escenas**: aplicar un set de estados a varios dispositivos de golpe ("Modo trabajo", "Reposo nocturno").

**Entregable:** un panel personalizable con históricos y escenas de un clic.

### Fase 2 — Inteligencia proactiva (estilo JARVIS)
**Objetivo:** que el sistema trabaje *por* ti, no solo cuando preguntas.
- **IA proactiva**: vigilar telemetría vía `EventBus` y avisar de anomalías ("temperatura alta", "servo con fallos"). Se apoya en `ai_service.js`.
- **Notificaciones push (PWA)**: ya eres PWA con service worker → Web Push para alertas con la app cerrada.
- **Memoria y personalización**: usar `MemoryManager` para recordar rutinas/preferencias y sugerirlas.

**Entregable:** recibir un aviso útil sin haberlo pedido.

### Fase 3 — Motor de reglas + áreas (estilo Home Assistant)
**Objetivo:** automatización de verdad.
- Pasar de "secuencias manuales" a reglas **trigger → condición → acción** (disparador: telemetría/MQTT/hora; condición: estado; acción: comando o escena).
- **Áreas/zonas**: agrupar dispositivos por sala usando `LocationRegistry` y filtrar el dashboard.
- **Logbook**: tu `history.js` como línea de tiempo visual filtrable.
- **Backup/export-import** de config (dispositivos, escenas, reglas) a JSON.

**Entregable:** "cuando el sensor X supere Y, ejecuta la escena Z" sin intervención.

### Fase 4 — Factor wow (estilo Stark)
**Objetivo:** la experiencia que da orgullo usar.
- **HUD 3D del brazo** con Three.js que se mueve en tiempo real con la telemetría.
- **Visión con detección de objetos** sobre `Brazo_vision.html` (ya usas MediaPipe): que el brazo agarre lo que señalas, o que la IA "vea" la escena.

**Entregable:** control gestual + visualización 3D en vivo.

---

## 4. Ventajas de hacer todas estas implementaciones

### Ventajas técnicas
- **Extensibilidad real:** con el modelo de entidades, añadir hardware nuevo es configurar, no programar. El proyecto deja de crecer en complejidad lineal.
- **Reutilización:** un solo motor de widgets, reglas e IA sirve para todos los dispositivos. Menos código duplicado, menos bugs.
- **Mantenibilidad:** sumado al refactor modular ya hecho (`src/*.js`), cada capa tiene una responsabilidad clara.
- **Local-first y privado:** todo corre en tu Node + SQLite + MQTT, sin depender de la nube de terceros (ventaja directa sobre Blynk).

### Ventajas de uso diario (lo que importa para uso personal)
- **Un solo panel para todo** tu hardware, en vez de apps separadas.
- **Menos fricción:** escenas y reglas eliminan tareas repetitivas; la voz permite control con manos ocupadas.
- **Tranquilidad:** las notificaciones push y la IA proactiva te avisan de problemas antes de que escalen.
- **Confianza:** estabilidad y reconexión robusta hacen que de verdad lo uses, no que lo abandones.

### Ventajas a futuro
- **Base para cualquier idea:** domótica, robótica, monitoreo de un taller… todo encaja en la misma plataforma.
- **Crecimiento sin reescrituras:** cada fase se apoya en la anterior; no hay callejones sin salida arquitectónicos.
- **Diferenciación:** la combinación IA conversacional + visión + control físico es poco común; te queda un sistema genuinamente potente.

---

## 5. Riesgos y consideraciones

- **No saltarse la Fase 0.** Construir features sobre el brazo cableado obliga a rehacerlas. El modelo de entidades es la inversión que se paga sola.
- **Alcance:** es un proyecto grande para un solo dev. Avanzar por fases con entregables usables evita el "todo a medias".
- **Seguridad (pendiente del backlog):** auth/JWT, credenciales MQTT en `localStorage`, validación de entradas. Conviene endurecerlo antes de exponer el sistema fuera de la red local.
- **Migración de datos:** mantener compatibilidad con los tópicos `brazo/#` actuales durante la transición.

---

## 6. Cómo empezar (primer sprint sugerido)

1. Diseñar el esquema `device → entities[] → capability` y validarlo con `ajv`.
2. Migrar el brazo a ese esquema (4 entidades `range`) **sin romper** lo actual.
3. Renderizar el dashboard a partir de entidades genéricas (adiós a las tarjetas de servo hardcodeadas).
4. Dar de alta un segundo dispositivo de prueba (una luz `switch`) para validar que la plataforma es genérica.

> Cuando arranquemos la implementación, lo haremos en **modo plan** fase por fase, con verificación en cada paso.
