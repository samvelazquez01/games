# Sudoku Multijugador Online en Tiempo Real ⚡

Web moderna, profesional y ultra-rápida de **Sudoku Multijugador en Tiempo Real** construida con JavaScript Vanilla, CSS3 moderno y **Firebase Realtime Database**, optimizada para desplegarse directamente en **GitHub Pages**.

---

## 🚀 Características Principales

1. **Niveles de Dificultad Real (Sin Fácil ni Medio)**:
   - **EXPERTO**: Requiere técnicas lógicas avanzadas (*Pointing*, *Box-Line Reduction*, *Naked/Hidden Pairs*, *X-Wing*, *XY-Wing*).
   - **EXTREMO**: Requiere técnicas de alta complejidad (*Swordfish*, *XYZ-Wing*, *W-Wing*, *Skyscraper*, *Two-String Kite*, *Simple Coloring*).
   - **IMPOSIBLE**: Brutalmente exigente, requiriendo cadenas de inferencia profunda (*Jellyfish*, *Finned Fish*, *XY-Chains*, *Forcing Chains*, *Alternating Inference Chains*).

2. **Generador Matemático de Solución Única**:
   - Generación 100% aleatoria con transformaciones simétricas válidas (permutaciones de números, bandas, columnas y transposición).
   - Verificador estricto de solución única por Backtracking/Exact Cover con parada temprana.
   - Ejecución en **Web Worker** en segundo plano para evitar bloqueos del navegador.

3. **Multijugador en Tiempo Real con Firebase**:
   - Sistema de salas con código de 6 caracteres (ej. `X7K92P`) y enlaces directos (`?room=X7K92P`).
   - Sincronización continua de progreso (% completado y celdas restantes).
   - Detección de presencia en vivo (🟢 Conectado / 🔴 Desconectado) mediante `onDisconnect()`.
   - Cronómetro sincronizado con offset de servidor (`.info/serverTimeOffset`).

4. **Seguridad y Anti-Cheat**:
   - La solución completa **nunca** se transmite en texto plano durante la partida.
   - Validación mediante hash criptográfico `SHA-256(Solución + Salt)`.
   - Reglas de seguridad de base de datos incluidas en `database.rules.json`.

5. **Experiencia de Usuario**:
   - Interfaz oscura Cyber/Nordic responsive (móvil, tablet y escritorio).
   - Teclado virtual táctil grande y soporte completo de teclado físico (1-9, flechas, Espacio, Ctrl+Z, Ctrl+Y).
   - Modo de notas/candidatos (lápiz) con mini-cuadrícula 3x3 por celda y auto-eliminación de candidatos en pares/filas.
   - Modo Competitivo (sin pistas de error inmediato) y Modo Normal.
   - Efectos de sonido sintetizados con Web Audio API (cero dependencias externas).

---

## 📁 Estructura del Proyecto

```text
/
├── index.html              # Estructura principal, vistas y modales
├── style.css               # Diseño Cyber Dark, CSS Grid responsive y animaciones
├── app.js                  # Controlador de interfaz, eventos y audio
├── sudoku.js               # Motor lógico: solver humano, DLX y analizador de técnicas
├── sudoku-worker.js        # Web Worker para generación no bloqueante
├── multiplayer.js          # Sincronización en tiempo real con Firebase RTDB
├── firebase-config.js      # Configuración y conector de Firebase
├── database.rules.json     # Reglas de seguridad para Firebase Realtime Database
└── README.md               # Documentación y guía de despliegue
```

---

## ⚙️ Configuración de Firebase

1. Crea un proyecto en [Firebase Console](https://console.firebase.google.com/).
2. Ve a **Build > Realtime Database** y haz clic en **Create Database**.
3. En la pestaña **Rules**, copia y pega el contenido del archivo `database.rules.json`.
4. Ve a **Build > Authentication**, habilita **Anonymous sign-in**.
5. Ve a **Project Settings** y copia tu configuración de Firebase.
6. Puedes pegar tus claves directamente en `firebase-config.js` o introducirlas en la web pulsando el botón de ajustes ⚙️.

---

## 🌐 Despliegue en GitHub Pages

1. Sube los archivos a tu repositorio de GitHub.
2. Ve a **Settings > Pages** en tu repositorio.
3. En **Branch**, selecciona `main` o `master` y la carpeta `/ (root)`.
4. Haz clic en **Save**. En unos segundos tendrás tu web de Sudoku multijugador online lista para jugar desde cualquier parte del mundo.
