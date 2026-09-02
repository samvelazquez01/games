# GAMES ONLINE - Plataforma de Juegos Multijugador en Tiempo Real 🎮

Plataforma web modular, rápida y responsive de **juegos multijugador online en tiempo real** construida con **JavaScript Vanilla**, **CSS3 moderno (Cyber Dark)** y **Firebase Realtime Database**, lista para desplegarse directamente en **GitHub Pages**.

---

## 🕹️ Juegos Disponibles

### 1. 🧩 Sudoku Online (1 o 2 Jugadores)
- **Modos de Juego**:
  - **🎯 En Solitario**: Práctica individual.
  - **🤝 En Pareja (Cooperativo)**: Dos jugadores resuelven **el mismo tablero juntos en tiempo real** con 3 vidas compartidas.
  - **⚔️ Duelo (Versus)**: Tableros independientes compitiendo por terminar primero.
- **Niveles de Dificultad Real**:
  - **EXPERTO**: Requiere técnicas como *Pointing*, *Box-Line Reduction*, *Naked/Hidden Pairs/Triples*, *X-Wing*, *XY-Wing*.
  - **EXTREMO**: Requiere *Swordfish*, *XYZ-Wing*, *W-Wing*, *Skyscraper*, *Two-String Kite*, *Simple Coloring*.
  - **IMPOSIBLE**: Reducido a 17-22 pistas matemáticas exigiendo cadenas de inferencia complejas (*XY-Chains*, *Forcing Chains*, *AIC*, *Jellyfish*, *Finned Swordfish*).
- **Sistema de 3 Vidas**: Cada casilla admite únicamente el número correcto. Al acumular 3 errores se pierde la partida.

---

### 2. 🛑 STOP Online / Tutti Frutti / Basta (N Jugadores)
- **Multijugador Masivo**: Juega con cualquier cantidad de participantes (2, 3, 5, 10 o más jugadores) en una misma sala.
- **Rol de Capitán 👑**: Quien crea la sala inicia la partida, evalúa y asigna puntos (100, 50, 25, 0) y avanza de ronda.
- **5 Rondas con Letras 100% Aleatorias**: Selección aleatoria sin repeticiones de la A a la Z (incluyendo Ñ) sincronizadas para todos.
- **7 Categorías**: Nombre, Apellido, Fruta, Color, Animal, Artista, País.
- **Botón STOP con Cuenta Regresiva de 5s**: Aviso en tiempo real con cuenta regresiva sincronizada (`5, 4, 3, 2, 1`), tras la cual se bloquean los campos.

---

### 3. 🃏 Guerra / Shithead / Palace (1 a 4 Jugadores)
- **1 Jugador**: Juega en solitario contra **3 bots inteligentes de IA** (Alfa, Beta, Gamma) con demoras naturales (800-1400ms).
- **2 a 4 Jugadores**: Partida online exclusivamente entre personas reales conectadas (sin bots).
- **Mecánicas y Reglas**:
  - **Baraja de 52 cartas**: `3 < 4 < 5 < 6 < 7 < 8 < 9 < 10 < J < Q < K < A`.
  - **Carta 2 (Reset)**: Se juega sobre cualquier carta y reinicia el valor para el siguiente jugador.
  - **Carta 7 (Menor o Igual)**: Obliga al siguiente jugador a colocar una carta $\le 7$ (o un 2).
  - **Carta 10 (Quema)**: Quema todo el montón central inmediatamente y otorga turno extra al jugador.
  - **4 Cartas Iguales Consecutivas**: Queman el montón y dan turno extra.
  - **Jugadas Múltiples**: Puedes lanzar varias cartas del mismo número juntas (ej: tres 8s).
  - **Recoger el Montón**: Si no tienes jugada válida, recoges el montón central a tu mano privada.
- **Estructura de Cartas**:
  - **Fase de Preparación**: Recibes 3 cartas boca abajo + 6 cartas visibles. Eliges exactamente 3 para colocarlas boca arriba; las otras 3 quedan en tu mano privada.
  - **Fase 1 (Mano y Robo)**: Juegas desde tu mano privada mientras robas del mazo hasta tener 3 cartas.
  - **Fase 2 (Boca Arriba)**: Cuando se acaba el mazo y tu mano está vacía, juegas desde tus 3 cartas boca arriba.
  - **Fase 3 (Boca Abajo a Ciegas)**: Cuando no te quedan cartas boca arriba, juegas a ciegas tus cartas boca abajo.
  - **Victoria**: El primer jugador en quedarse sin cartas gana (🥇 1º, 🥈 2º, 🥉 3º, 4º).
- **Privacidad Total**: Las manos privadas y las cartas boca abajo se mantienen en rutas protegidas en Firebase (`/guerra_private`), impidiendo que otros jugadores las espíen.

---

## 📁 Estructura del Proyecto

```text
/
├── index.html              # Portal de juegos, contenedor de Sudoku, STOP y Guerra
├── style.css               # Estilos Cyber Dark responsive para toda la plataforma y cartas
├── firebase-config.js      # Conexión y credenciales de Firebase
├── database.rules.json     # Reglas de seguridad para Sudoku, STOP y Guerra
├── platform.js             # Coordinador de navegación y catálogo de juegos
│
├── sudoku.js               # Motor de Sudoku (solución única DLX y analizador lógico)
├── sudoku-worker.js        # Web Worker no bloqueante para Sudoku
├── multiplayer.js          # Sincronización multijugador de Sudoku
├── app.js                  # Controlador de interfaz de Sudoku
│
├── stop-game.js            # Motor y sincronización en tiempo real de STOP
├── guerra-game.js          # Motor, reglas y sincronización de Guerra (1-4 jugadores con IA)
└── README.md               # Documentación y guía de despliegue
```

---

## 🌐 Despliegue en GitHub Pages

1. Sube los archivos a tu repositorio de GitHub.
2. En GitHub, ve a **Settings > Pages**.
3. Selecciona la rama `main` y la carpeta `/ (root)`.
4. Pulsa **Save**. En segundos tu plataforma estará online.
