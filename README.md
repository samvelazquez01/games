# GAMES ONLINE - Plataforma de Juegos Multijugador en Tiempo Real 🎮

Plataforma web modular, moderna, rápida y responsive de **juegos multijugador online en tiempo real** construida con **JavaScript Vanilla**, **CSS3 (Cyber Dark)** y **Firebase Realtime Database**, lista para desplegarse directamente en **GitHub Pages**.

---

## 🕹️ Juegos Disponibles

### 1. 🃏 Guerra / Shithead / Palace (1 a 4 Jugadores)
- **1 Jugador**: Modo en solitario contra **3 bots inteligentes de IA** (*Bot Alfa*, *Bot Beta*, *Bot Gamma*).
- **2 a 4 Jugadores**: Partida multijugador exclusivamente entre personas reales.
- **Mesa Cuadrada de Casino**: Tapete verde con posiciones relativas (Sur, Oeste, Norte, Este) y animación de reparto.
- **Reglas Especiales**:
  - Carta 2 (Reset / Comodín), Carta 7 (Menor o Igual), Carta 10 (Quema de montón + Turno extra), 4 iguales consecutivas (Quema).
  - 3 Fases de juego: Mano $\rightarrow$ Cartas Boca Arriba $\rightarrow$ Cartas Boca Abajo (a ciegas).

---

### 2. 🛑 STOP Online / Tutti Frutti / Basta (N Jugadores)
- **Multijugador Masivo**: Juega con cualquier cantidad de participantes simultáneos.
- **Rol de Capitán 👑**: Inicia rondas, evalúa respuestas y asigna puntuaciones (100, 50, 25, 0).
- **5 Rondas con Letras 100% Aleatorias**: 7 categorías sincronizadas con botón STOP y cuenta regresiva de 5 segundos.

---

### 3. 🧩 Sudoku Online (1 o 2 Jugadores)
- **Modos**: Solitario, En Pareja (cooperativo en tablero compartido con 3 vidas) y Duelo (versus).
- **Niveles Reales**: Experto, Extremo e Imposible con 17-22 pistas y técnicas avanzadas.

---

## 📁 Estructura del Proyecto

```text
/
├── index.html          # Portal principal y vistas de los 3 juegos
├── style.css           # Tema Cyber Dark, estilos responsive y mesa de casino
├── platform.js         # Coordinador y enrutador del portal de juegos
├── firebase-config.js  # Configuración y credenciales de Firebase
├── database.rules.json # Reglas de seguridad de Firebase RTDB
│
├── guerra-game.js      # Motor y lógica completa del juego de cartas Guerra
├── stop-game.js        # Motor y sincronización en tiempo real de STOP
├── sudoku.js           # Generador lógico y solucionador DLX de Sudoku
├── multiplayer.js      # Sincronización multijugador de Sudoku
└── app.js              # Controlador de interfaz de Sudoku
```

---

## 🌐 Despliegue en GitHub Pages

1. Sube los archivos a tu repositorio de GitHub.
2. En GitHub, ve a **Settings > Pages**.
3. Selecciona la rama `main` y la carpeta `/ (root)`.
4. Pulsa **Save**. La plataforma estará lista en segundos.
