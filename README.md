# GUERRA ONLINE - Juego de Cartas Multijugador en Tiempo Real 🃏

Juego de cartas online rápido, táctico y adictivo (**Guerra / Palace / Shithead**) para **1 a 4 jugadores** en tiempo real con **Firebase Realtime Database**, Web Audio sintetizado y diseño Casino Cyber Dark.

---

## 🕹️ Modos de Juego

### 🤖 Modo Solitario (1 Jugador vs 3 Bots de IA)
- Juegas contra **3 bots inteligentes** (*Bot Alfa 🤖*, *Bot Beta 🤖*, *Bot Gamma 🤖*).
- Los bots **aceptan e igualan automáticamente cualquier apuesta** seleccionada.
- Tienen reacciones automáticas, burbujas de diálogo y toma de decisiones táctica.

### 🌐 Modo Multijugador (2 a 4 Jugadores Reales)
- **Salas Públicas**: Descubrimiento y listado en vivo de partidas abiertas a las que cualquiera puede entrar de inmediato.
- **Salas Privadas**: Acceso protegido mediante código alfanumérico de 5-6 caracteres o enlace directo para compartir con amigos (`?room=CODIGO`).

---

## 🪙 Sistema de Apuestas y Monedas

- **Saldo Inicial**: Cada jugador inicia con **1,000 monedas (🪙)**.
- **Selector de Apuesta**: 50, 100, 250, 500, 1,000, 5,000, 10,000, 20,000 y 50,000 🪙.
- **Bote Acumulado**: El 1er lugar se lleva el **100% del bote acumulado** de la partida.
- **Recarga de Emergencia**: Botón de regalo 🎁 con **+5,000 monedas gratis** si el saldo baja de 1,000.

---

## 🎴 Reglas y Dinámica de Juego

1. **Objetivo**: Sé el primero en quedarte sin cartas (en mano, boca arriba y boca abajo).
2. **Jerarquía**: `3 < 4 < 5 < 6 < 7 < 8 < 9 < 10 < J < Q < K < A`.
3. **Cartas Especiales**:
   - **Carta 2 (Reinicio / Comodín)**: Se tira sobre cualquier carta y reinicia el montón.
   - **Carta 7 (Menor o Igual)**: Obliga al rival a tirar 7 o menor (o un 2).
   - **Carta 10 (Quema)**: Quema todo el montón y otorga turno extra.
   - **4 Iguales Consecutivas**: Queman el montón y dan turno extra.
4. **Las 3 Fases**:
   - **Fase 1 (Mano y Mazo)**: Juegas de tu mano privada y robas hasta tener siempre al menos 3 cartas.
   - **Fase 2 (Cartas Boca Arriba)**: Se juegan al agotarse el mazo y la mano.
   - **Fase 3 (Cartas Boca Abajo)**: Se juegan a ciegas una a una. Si fallas, recoges todo el montón.

---

## 📁 Estructura del Proyecto

```text
/
├── index.html          # Interfaz completa del juego de Guerra, mesa de casino y modales
├── style.css           # Tema Casino Cyber Dark, cartas 3D y diseño responsive
├── guerra-game.js      # Motor completo de cartas, IA de bots, apuestas, chat y sincronización
├── firebase-config.js  # Configuración y credenciales de Firebase RTDB y Auth Anónima
├── database.rules.json # Reglas de seguridad para las salas aisladas (guerra_v2_*)
└── README.md           # Documentación del proyecto
```

---

## 🔒 Aislamiento en Firebase Realtime Database

Para no interferir con otras versiones o salas activas, este juego utiliza un espacio de nombres dedicado e independiente:
- `guerra_v2_rooms/$roomId`: Estado de sala, jugadores, bote y turnos.
- `guerra_v2_public_rooms`: Catálogo público de salas activas para emparejamiento.
- `guerra_v2_private/$roomId/$uid`: Cartas privadas protegidas por reglas de seguridad.

---

## 🌐 Despliegue en GitHub Pages

1. Sube los archivos a tu repositorio de GitHub.
2. En GitHub, ve a **Settings > Pages**.
3. Selecciona la rama `main` y la carpeta `/ (root)`.
4. Pulsa **Save**. La plataforma estará lista en segundos.
