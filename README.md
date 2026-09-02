# GAMES ONLINE - Plataforma de Juegos Multijugador en Tiempo Real 🎮

Plataforma web modular, moderna, rápida y responsive de **juegos multijugador online en tiempo real** construida con **JavaScript Vanilla**, **Canvas 2D**, **CSS3 (Cyber Dark)** y **Firebase Realtime Database**, lista para desplegarse directamente en **GitHub Pages**.

---

## 🕹️ Juegos Disponibles

### 1. 🌲 Sombras del Bosque (Campamento Sombrío) — 2D Top-Down (4 a 10 Jugadores)
- **Concepto**: Juego de supervivencia y deducción social en un campamento nocturno 2D.
- **Roles y Asignación Secreta**:
  - **Supervivientes**: Realizan actividades en las 7 cabañas y buscan expulsar a los asesinos.
  - **Asesinos (1 o 2 configurables por el Anfitrión)**: Cazan supervivientes durante los apagones con 15s de cooldown.
- **Ciclos de Luz Sincronizados**:
  - **5 segundos de LUZ**: Visión normal mediante antorcha/linterna y realización de tareas.
  - **3 segundos de APAGÓN**: Supervivientes a oscuras (visión mínima); asesinos conservan visión nocturna.
- **6 Minijuegos / Tareas Interactivas**:
  - ⚡ *Generador*: Conectar cables de colores.
  - 📻 *Radio*: Calibrar frecuencia en onda senoidal.
  - 🌿 *Invernadero*: Dispensar agua a los cultivos.
  - 💊 *Clínica*: Ordenar botiquín de primeros auxilios.
  - 🪵 *Leña*: Apilar leños para la hoguera.
  - 💧 *Filtro*: Limpiar impurezas del agua.
- **Cadáveres, Reportes y Reuniones**:
  - Reportar cadáveres o convocar reunión de emergencia en la hoguera central.
  - Votación y expulsión secreta (la identidad del expulsado se revela solo al final).
- **10 Personajes Jugables**: Sprites extraídos directamente de la hoja de personajes con animación de movimiento.

---

### 2. 🃏 Guerra / Shithead / Palace (1 a 4 Jugadores)
- **1 Jugador**: Modo en solitario contra **3 bots inteligentes de IA** (*Bot Alfa*, *Bot Beta*, *Bot Gamma*).
- **2 a 4 Jugadores**: Partida multijugador exclusivamente entre personas reales.
- **Mesa Cuadrada de Casino**: Tapete verde con posiciones relativas (Sur, Oeste, Norte, Este) y animación de reparto.
- **Reglas Especiales**:
  - Carta 2 (Reset / Comodín), Carta 7 (Menor o Igual), Carta 10 (Quema de montón + Turno extra), 4 iguales consecutivas (Quema).
  - 3 Fases de juego: Mano $\rightarrow$ Cartas Boca Arriba $\rightarrow$ Cartas Boca Abajo (a ciegas).

---

### 3. 🛑 STOP Online / Tutti Frutti / Basta (N Jugadores)
- **Multijugador Masivo**: Juega con cualquier cantidad de participantes simultáneos.
- **Rol de Capitán 👑**: Inicia rondas, evalúa respuestas y asigna puntuaciones (100, 50, 25, 0).
- **5 Rondas con Letras 100% Aleatorias**: 7 categorías sincronizadas con botón STOP y cuenta regresiva de 5 segundos.

---

### 4. 🧩 Sudoku Online (1 o 2 Jugadores)
- **Modos**: Solitario, En Pareja (cooperativo en tablero compartido con 3 vidas) y Duelo (versus).
- **Niveles Reales**: Experto, Extremo e Imposible con 17-22 pistas y técnicas avanzadas.

---

## 📁 Estructura del Proyecto

```text
/
├── assets/
│   ├── characters_sheet.jpg  # Hoja de 10 personajes para Sombras del Bosque
│   └── map_camp.jpg          # Mapa del campamento nocturno 1024x1024
│
├── index.html                # Catálogo de 4 juegos y contenedores de UI
├── style.css                 # Estilos Cyber Dark, mesa de cartas, canvas 2D y joystick
├── firebase-config.js        # Configuración y credenciales de Firebase
├── database.rules.json       # Reglas de seguridad para los 4 juegos
├── platform.js               # Coordinador de navegación y catálogo de juegos
│
├── sombras-assets.js         # Extractor & Chroma-Key de sprites de personajes
├── sombras-tasks.js          # Motor de minijuegos y tareas interactivas
├── sombras-game.js           # Motor Canvas 2D, cámara, colisiones, luces y Firebase
│
├── guerra-game.js            # Motor de cartas Guerra con IA y mesa de casino
├── stop-game.js              # Motor y sincronización en tiempo real de STOP
├── sudoku.js                 # Generador lógico y solucionador DLX de Sudoku
├── multiplayer.js            # Sincronización multijugador de Sudoku
└── app.js                    # Controlador de interfaz de Sudoku
```

---

## 🌐 Despliegue en GitHub Pages

1. Sube los archivos a tu repositorio de GitHub.
2. En GitHub, ve a **Settings > Pages**.
3. Selecciona la rama `main` y la carpeta `/ (root)`.
4. Pulsa **Save**. La plataforma con los 4 juegos estará lista en segundos.
