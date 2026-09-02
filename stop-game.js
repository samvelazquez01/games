/**
 * STOP GAME (TUTTI FRUTTI / BASTA) - MULTIPLAYER ENGINE & CONTROLLER
 *
 * Implements:
 * - Realtime multiplayer room for N players (2, 3, 5, 10+).
 * - Captain role (room creator) with full game controls.
 * - Automatic captaincy handoff if captain leaves/disconnects.
 * - 5 rounds with 100% random, non-repeating letters from the Spanish alphabet.
 * - 7 categories: Nombre, Apellido, Fruta, Color, Animal, Artista, País (sin placeholders de ejemplo).
 * - STOP button with synchronized 5-second countdown across all players.
 * - Real-time live scoring: Captain assigns points in live sync, and ALL players see points accumulating in real-time.
 * - Live round results and 5-round cumulative final leaderboard with rematching.
 */

(function (global) {
  'use strict';

  // Constants
  const CATEGORIES = [
    { key: 'nombre', label: '1. Nombre' },
    { key: 'apellido', label: '2. Apellido' },
    { key: 'fruta', label: '3. Fruta' },
    { key: 'color', label: '4. Color' },
    { key: 'animal', label: '5. Animal' },
    { key: 'artista', label: '6. Artista' },
    { key: 'pais', label: '7. País' }
  ];

  const ALPHABET = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'L', 'M', 'N', 'Ñ', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'Z'];

  // Audio synthesis
  const StopAudio = (function () {
    let ctx = null;
    function getCtx() {
      if (!ctx && (window.AudioContext || window.webkitAudioContext)) {
        const AC = window.AudioContext || window.webkitAudioContext;
        ctx = new AC();
      }
      if (ctx && ctx.state === 'suspended') ctx.resume();
      return ctx;
    }
    function tone(freq, type = 'sine', duration = 0.1, gainVal = 0.15) {
      try {
        const c = getCtx();
        if (!c) return;
        const osc = c.createOscillator();
        const gain = c.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, c.currentTime);
        gain.gain.setValueAtTime(gainVal, c.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + duration);
        osc.connect(gain);
        gain.connect(c.destination);
        osc.start();
        osc.stop(c.currentTime + duration);
      } catch (e) {}
    }
    return {
      click: () => tone(500, 'sine', 0.05, 0.08),
      tick: () => tone(750, 'triangle', 0.08, 0.15),
      stopBuzzer: () => {
        tone(300, 'sawtooth', 0.35, 0.3);
        setTimeout(() => tone(220, 'sawtooth', 0.45, 0.3), 100);
      },
      scorePing: () => tone(880, 'sine', 0.1, 0.15),
      roundSuccess: () => {
        [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
          setTimeout(() => tone(f, 'triangle', 0.2, 0.15), i * 100);
        });
      }
    };
  })();

  // State
  let currentRoomId = null;
  let currentRoomRef = null;
  let currentRoomData = null;
  let countdownTimerInterval = null;
  let serverOffset = 0;
  let lastCountdownSecond = -1;

  // Local state
  const State = {
    isCaptain: false,
    currentRound: 1,
    totalRounds: 5,
    currentLetter: '',
    myAnswers: {
      nombre: '',
      apellido: '',
      fruta: '',
      color: '',
      animal: '',
      artista: '',
      pais: ''
    },
    isRoundLocked: false
  };

  function getPlayerUid() {
    let uid = localStorage.getItem('sudoku_player_uid');
    if (!uid) {
      uid = 'usr_' + Math.random().toString(36).substring(2, 9) + Date.now().toString(36);
      localStorage.setItem('sudoku_player_uid', uid);
    }
    return uid;
  }

  function getPlayerName() {
    let name = localStorage.getItem('sudoku_player_name');
    if (!name) {
      const randNum = Math.floor(1000 + Math.random() * 9000);
      name = 'Jugador ' + randNum;
      localStorage.setItem('sudoku_player_name', name);
    }
    return name;
  }

  function generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 5; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }

  function getRandomLetter(usedLetters = []) {
    const available = ALPHABET.filter(ch => !usedLetters.includes(ch));
    if (available.length === 0) {
      return ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    }
    return available[Math.floor(Math.random() * available.length)];
  }

  function setupTimeSync(db) {
    db.ref('.info/serverTimeOffset').on('value', snap => {
      serverOffset = snap.val() || 0;
    });
  }

  function getSynchronizedServerTime() {
    return Date.now() + serverOffset;
  }

  async function ensureFirebase() {
    const service = global.FirebaseService;
    if (!service) throw new Error('Servicio de Firebase no encontrado.');
    const initRes = service.initFirebase();
    if (!initRes.initialized) {
      throw new Error(initRes.error || 'Firebase no está configurado aún.');
    }
    const auth = service.getAuth();
    if (!auth.currentUser) {
      try {
        await auth.signInAnonymously();
      } catch (err) {
        console.warn('Auth anónima fallback:', err);
      }
    }
    return {
      uid: (auth.currentUser && auth.currentUser.uid) || getPlayerUid(),
      db: service.getDb()
    };
  }

  function setupPresence(db, roomId, uid) {
    const connectedRef = db.ref('.info/connected');
    const userStatusRef = db.ref(`stop_rooms/${roomId}/players/${uid}/connected`);
    const lastActiveRef = db.ref(`stop_rooms/${roomId}/players/${uid}/lastActive`);

    connectedRef.on('value', snap => {
      if (snap.val() === true) {
        userStatusRef.onDisconnect().set(false);
        lastActiveRef.onDisconnect().set(global.firebase.database.ServerValue.TIMESTAMP);
        userStatusRef.set(true);
      }
    });
  }

  // --- DOM CACHING ---
  const DOM = {};

  function cacheDOM() {
    DOM.views = {
      lobby: document.getElementById('stop-view-lobby'),
      waiting: document.getElementById('stop-view-waiting'),
      game: document.getElementById('stop-view-game'),
      scoring: document.getElementById('stop-view-scoring'),
      roundResults: document.getElementById('stop-view-round-results'),
      finalResults: document.getElementById('stop-view-final-results')
    };

    DOM.inputNickname = document.getElementById('stop-nickname-input');
    DOM.btnCreateRoom = document.getElementById('stop-btn-create-room');
    DOM.inputJoinCode = document.getElementById('stop-input-join-code');
    DOM.btnJoinRoom = document.getElementById('stop-btn-join-room');

    DOM.displayRoomCode = document.getElementById('stop-display-room-code');
    DOM.btnCopyCode = document.getElementById('stop-btn-copy-code');
    DOM.btnShareRoom = document.getElementById('stop-btn-share-room');
    DOM.waitingPlayersList = document.getElementById('stop-waiting-players-list');
    DOM.waitingPlayersCount = document.getElementById('stop-waiting-players-count');
    DOM.btnCaptainStart = document.getElementById('stop-btn-captain-start');
    DOM.btnLeaveWaiting = document.getElementById('stop-btn-leave-waiting');

    DOM.roundIndicator = document.getElementById('stop-round-indicator');
    DOM.letterDisplay = document.getElementById('stop-letter-display');
    DOM.stopWarningBanner = document.getElementById('stop-warning-banner');
    DOM.stopWarningText = document.getElementById('stop-warning-text');
    DOM.stopCountdownNumber = document.getElementById('stop-countdown-number');
    DOM.btnStop = document.getElementById('stop-btn-stop');
    DOM.categoryInputs = {};
    CATEGORIES.forEach(cat => {
      DOM.categoryInputs[cat.key] = document.getElementById(`stop-input-${cat.key}`);
    });
    DOM.btnAbandonGame = document.getElementById('stop-btn-abandon-game');

    DOM.scoringRoundTitle = document.getElementById('stop-scoring-round-title');
    DOM.scoringLetterBadge = document.getElementById('stop-scoring-letter-badge');
    DOM.scoringLiveStrip = document.getElementById('stop-live-score-strip');
    DOM.scoringContainer = document.getElementById('stop-scoring-container');
    DOM.captainScoringActions = document.getElementById('stop-captain-scoring-actions');
    DOM.btnConfirmScores = document.getElementById('stop-btn-confirm-scores');
    DOM.playerScoringWaiting = document.getElementById('stop-player-scoring-waiting');

    DOM.roundResultsTitle = document.getElementById('stop-round-results-title');
    DOM.roundScoresTable = document.getElementById('stop-round-scores-table');
    DOM.btnNextRound = document.getElementById('stop-btn-next-round');
    DOM.waitingNextRoundNotice = document.getElementById('stop-waiting-next-round-notice');

    DOM.winnerPodium = document.getElementById('stop-winner-podium');
    DOM.finalScoresTable = document.getElementById('stop-final-scores-table');
    DOM.btnPlayAgain = document.getElementById('stop-btn-play-again');
    DOM.btnFinalExit = document.getElementById('stop-btn-final-exit');
  }

  function showView(viewKey) {
    Object.keys(DOM.views).forEach(key => {
      if (DOM.views[key]) {
        DOM.views[key].classList.toggle('active', key === viewKey);
      }
    });
  }

  function showToast(msg, icon = 'ℹ️') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `<span>${icon}</span><span>${msg}</span>`;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      setTimeout(() => toast.remove(), 300);
    }, 3200);
  }

  // --- ROOM MANAGEMENT ---

  async function createRoom() {
    const { uid, db } = await ensureFirebase();
    setupTimeSync(db);

    const roomId = generateRoomCode();
    const roomRef = db.ref('stop_rooms/' + roomId);

    const firstLetter = getRandomLetter([]);

    const initialPlayerState = {
      name: getPlayerName(),
      isCaptain: true,
      connected: true,
      totalScore: 0,
      roundScores: {},
      joinedAt: global.firebase.database.ServerValue.TIMESTAMP
    };

    const payload = {
      id: roomId,
      captainId: uid,
      status: 'WAITING',
      currentRound: 1,
      totalRounds: 5,
      currentLetter: firstLetter,
      usedLetters: [firstLetter],
      stopPlayerId: null,
      stopPlayerName: null,
      stopCountdownExpiresAt: null,
      createdAt: global.firebase.database.ServerValue.TIMESTAMP,
      players: {
        [uid]: initialPlayerState
      },
      rounds: {
        1: {
          letter: firstLetter,
          answers: {},
          scores: {}
        }
      }
    };

    await roomRef.set(payload);

    currentRoomId = roomId;
    currentRoomRef = roomRef;
    State.isCaptain = true;

    setupPresence(db, roomId, uid);
    attachRoomListener(roomRef, uid);

    return roomId;
  }

  async function joinRoom(roomCode) {
    const cleanCode = roomCode.trim().toUpperCase();
    if (cleanCode.length < 4 || cleanCode.length > 6) {
      throw new Error('El código de sala es inválido.');
    }

    const { uid, db } = await ensureFirebase();
    setupTimeSync(db);

    const roomRef = db.ref('stop_rooms/' + cleanCode);
    const snap = await roomRef.once('value');
    const room = snap.val();

    if (!room) {
      throw new Error('La sala de STOP no existe. Verifica el código e intenta nuevamente.');
    }

    const players = room.players || {};
    const isAlreadyIn = !!players[uid];

    const playerState = {
      name: getPlayerName(),
      isCaptain: isAlreadyIn ? !!players[uid].isCaptain : (room.captainId === uid),
      connected: true,
      totalScore: isAlreadyIn ? (players[uid].totalScore || 0) : 0,
      roundScores: isAlreadyIn ? (players[uid].roundScores || {}) : {},
      joinedAt: isAlreadyIn ? players[uid].joinedAt : global.firebase.database.ServerValue.TIMESTAMP
    };

    await db.ref(`stop_rooms/${cleanCode}/players/${uid}`).set(playerState);

    currentRoomId = cleanCode;
    currentRoomRef = roomRef;
    State.isCaptain = (room.captainId === uid);

    setupPresence(db, cleanCode, uid);
    attachRoomListener(roomRef, uid);

    return cleanCode;
  }

  function dbRef(path) {
    return global.FirebaseService.getDb().ref(path);
  }

  // --- REALTIME ROOM LISTENER & STATE ROUTING ---

  function attachRoomListener(roomRef, myUid) {
    roomRef.on('value', snap => {
      const room = snap.val();
      if (!room) {
        showToast('La sala fue cerrada o eliminada.', '🚪');
        leaveRoom();
        return;
      }

      currentRoomData = room;
      const players = room.players || {};
      const playerIds = Object.keys(players);

      // Captain handoff if disconnected
      let currentCaptainId = room.captainId;
      if (!players[currentCaptainId] || !players[currentCaptainId].connected) {
        const activeConnectedIds = playerIds.filter(id => players[id].connected);
        if (activeConnectedIds.length > 0) {
          activeConnectedIds.sort((a, b) => (players[a].joinedAt || 0) - (players[b].joinedAt || 0));
          const newCaptainId = activeConnectedIds[0];
          currentCaptainId = newCaptainId;
          if (myUid === newCaptainId) {
            roomRef.update({ captainId: newCaptainId });
            dbRef(`stop_rooms/${room.id}/players/${newCaptainId}`).update({ isCaptain: true });
            showToast('¡Ahora eres el Capitán de la sala!', '👑');
          }
        }
      }

      State.isCaptain = (currentCaptainId === myUid);
      State.currentRound = room.currentRound || 1;
      State.currentLetter = room.currentLetter || 'A';

      renderRoomState(room, myUid);
    });
  }

  function renderRoomState(room, myUid) {
    const status = room.status || 'WAITING';
    const players = room.players || {};
    const playerList = Object.keys(players).map(id => ({ id, ...players[id] }));

    // 1. WAITING LOBBY
    if (status === 'WAITING') {
      clearInterval(countdownTimerInterval);
      countdownTimerInterval = null;
      if (DOM.displayRoomCode) DOM.displayRoomCode.textContent = room.id;
      if (DOM.waitingPlayersCount) DOM.waitingPlayersCount.textContent = `${playerList.length} jugadores`;

      if (DOM.waitingPlayersList) {
        DOM.waitingPlayersList.innerHTML = '';
        playerList.forEach(p => {
          const item = document.createElement('div');
          item.className = `player-slot-card ${p.connected ? 'ready' : ''}`;
          item.style.padding = '10px 14px';
          item.innerHTML = `
            <div style="display: flex; align-items: center; gap: 10px; width: 100%;">
              <span class="status-dot ${p.connected ? 'online' : 'offline'}"></span>
              <span style="font-weight: 700; flex: 1; text-align: left;">${p.name} ${p.id === myUid ? '(Tú)' : ''}</span>
              ${p.isCaptain ? '<span class="player-badge badge-host">👑 Capitán</span>' : '<span class="player-badge badge-guest">Jugador</span>'}
            </div>
          `;
          DOM.waitingPlayersList.appendChild(item);
        });
      }

      if (DOM.btnCaptainStart) {
        DOM.btnCaptainStart.style.display = State.isCaptain ? 'flex' : 'none';
      }

      showView('waiting');
      return;
    }

    // 2. PLAYING / COUNTDOWN
    if (status === 'PLAYING' || status === 'COUNTDOWN') {
      if (DOM.roundIndicator) DOM.roundIndicator.textContent = `Ronda ${room.currentRound} de 5`;
      if (DOM.letterDisplay) DOM.letterDisplay.textContent = room.currentLetter;

      // Handle STOP Triggered & 5-Second Countdown
      if (status === 'COUNTDOWN') {
        if (DOM.stopWarningBanner) {
          DOM.stopWarningBanner.style.display = 'flex';
          DOM.stopWarningText.textContent = `¡${room.stopPlayerName || 'Un jugador'} presionó STOP!`;
        }

        if (!countdownTimerInterval) {
          startSynchronizedCountdown(room.stopCountdownExpiresAt);
        }
      } else {
        if (DOM.stopWarningBanner) DOM.stopWarningBanner.style.display = 'none';
        clearInterval(countdownTimerInterval);
        countdownTimerInterval = null;
        lastCountdownSecond = -1;
        unlockCategoryInputs();
      }

      showView('game');
      return;
    }

    // 3. SCORING PHASE (Real-time live scores for ALL players)
    if (status === 'SCORING') {
      clearInterval(countdownTimerInterval);
      countdownTimerInterval = null;
      renderScoringView(room, myUid);
      showView('scoring');
      return;
    }

    // 4. ROUND RESULTS
    if (status === 'ROUND_RESULTS') {
      clearInterval(countdownTimerInterval);
      renderRoundResultsView(room, myUid);
      showView('roundResults');
      return;
    }

    // 5. FINISHED
    if (status === 'FINISHED') {
      clearInterval(countdownTimerInterval);
      renderFinalResultsView(room, myUid);
      showView('finalResults');
      return;
    }
  }

  // --- GAMEPLAY: STOP & 5-SECOND COUNTDOWN ---

  function startSynchronizedCountdown(expiresAt) {
    if (countdownTimerInterval) clearInterval(countdownTimerInterval);
    StopAudio.stopBuzzer();
    lastCountdownSecond = -1;

    function update() {
      const now = getSynchronizedServerTime();
      const remainingMs = Math.max(0, (expiresAt || (now + 5000)) - now);
      const seconds = Math.ceil(remainingMs / 1000);

      if (seconds !== lastCountdownSecond && seconds > 0) {
        lastCountdownSecond = seconds;
        StopAudio.tick();
      }

      if (DOM.stopCountdownNumber) {
        DOM.stopCountdownNumber.textContent = seconds;
      }

      if (remainingMs <= 0) {
        clearInterval(countdownTimerInterval);
        countdownTimerInterval = null;
        StopAudio.stopBuzzer();
        lockCategoryInputsAndSubmit();
      }
    }

    update();
    countdownTimerInterval = setInterval(update, 100);
  }

  function unlockCategoryInputs() {
    CATEGORIES.forEach(cat => {
      const inp = DOM.categoryInputs[cat.key];
      if (inp) {
        inp.disabled = false;
      }
    });
    if (DOM.btnStop) DOM.btnStop.disabled = false;
    State.isRoundLocked = false;
  }

  function lockCategoryInputsAndSubmit() {
    if (State.isRoundLocked) return;
    State.isRoundLocked = true;

    // Lock all fields
    CATEGORIES.forEach(cat => {
      const inp = DOM.categoryInputs[cat.key];
      if (inp) {
        inp.disabled = true;
        State.myAnswers[cat.key] = inp.value.trim();
      }
    });
    if (DOM.btnStop) DOM.btnStop.disabled = true;

    // Auto-submit answers to Firebase
    submitMyAnswers();

    // Transition to SCORING
    if (State.isCaptain && currentRoomRef) {
      setTimeout(async () => {
        try {
          await currentRoomRef.update({
            status: 'SCORING'
          });
        } catch (e) {}
      }, 800);
    }
  }

  async function triggerStop() {
    if (!currentRoomRef || State.isRoundLocked) return;
    const myUid = getPlayerUid();
    const myName = getPlayerName();

    try {
      await currentRoomRef.update({
        status: 'COUNTDOWN',
        stopPlayerId: myUid,
        stopPlayerName: myName,
        stopCountdownExpiresAt: global.firebase.database.ServerValue.TIMESTAMP + 5000
      });
      showToast('¡Has gritado STOP! Se activa la cuenta de 5 segundos.', '🛑');
    } catch (e) {
      console.error('Error al presionar STOP:', e);
    }
  }

  async function submitMyAnswers() {
    if (!currentRoomRef || !currentRoomData) return;
    const myUid = getPlayerUid();
    const round = currentRoomData.currentRound || 1;

    try {
      await dbRef(`stop_rooms/${currentRoomId}/rounds/${round}/answers/${myUid}`).set(State.myAnswers);
    } catch (e) {
      console.warn('Error enviando respuestas:', e);
    }
  }

  // --- REAL-TIME SCORING VIEW (VISIBLE TO ALL PLAYERS LIVE) ---

  function renderScoringView(room, myUid) {
    const round = room.currentRound || 1;
    const letter = room.currentLetter || 'M';
    const roundData = (room.rounds && room.rounds[round]) || {};
    const answers = roundData.answers || {};
    const scores = roundData.scores || {};
    const players = room.players || {};
    const playerList = Object.keys(players).map(id => ({ id, ...players[id] }));

    if (DOM.scoringRoundTitle) DOM.scoringRoundTitle.textContent = `Evaluación Ronda ${round} de 5`;
    if (DOM.scoringLetterBadge) DOM.scoringLetterBadge.textContent = `Letra: ${letter}`;

    // 1. Render Top Live Score Strip (Accumulated Points in Real-Time)
    renderLiveScoreStrip(playerList, scores, round);

    // 2. Render Categories with Answers & Real-Time Score Buttons / Badges
    if (!DOM.scoringContainer) return;
    DOM.scoringContainer.innerHTML = '';

    CATEGORIES.forEach(cat => {
      const catBlock = document.createElement('div');
      catBlock.className = 'glass-card';
      catBlock.style.padding = '14px 16px';
      catBlock.style.gap = '8px';

      let catHtml = `
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border-color); padding-bottom: 6px;">
          <h4 style="font-size: 14px; font-weight: 800; color: var(--accent-cyan); text-transform: uppercase; margin: 0;">${cat.label}</h4>
          <span style="font-size: 11px; font-weight: 700; color: var(--text-muted);">Letra [${letter}]</span>
        </div>
        <div style="display: flex; flex-direction: column; gap: 6px; margin-top: 4px;">
      `;

      playerList.forEach(p => {
        const pAns = (answers[p.id] && answers[p.id][cat.key]) ? answers[p.id][cat.key].trim() : '';
        const currentScore = (scores[p.id] && scores[p.id][cat.key] !== undefined) ? scores[p.id][cat.key] : null;
        const startsCorrect = pAns && pAns.charAt(0).toUpperCase() === letter.toUpperCase();

        catHtml += `
          <div style="display: flex; justify-content: space-between; align-items: center; background: rgba(15, 23, 42, 0.7); padding: 8px 12px; border-radius: var(--radius-sm); border: 1px solid ${p.id === myUid ? 'rgba(56, 189, 248, 0.3)' : 'var(--border-color)'}; gap: 8px;">
            <div style="display: flex; flex-direction: column; flex: 1; overflow: hidden;">
              <span style="font-size: 11px; font-weight: 700; color: ${p.id === myUid ? 'var(--primary)' : 'var(--text-dim)'};">${p.name} ${p.id === myUid ? '(Tú)' : ''}</span>
              <span style="font-size: 14px; font-weight: 700; color: ${pAns ? (startsCorrect ? 'var(--text-main)' : 'var(--accent-rose)') : 'var(--text-dim)'}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                ${pAns || '<i style="color: var(--text-dim); font-size: 12px; font-weight: 400;">(Vacío)</i>'}
              </span>
            </div>
            
            ${State.isCaptain ? `
              <div style="display: flex; gap: 4px;" class="captain-score-buttons">
                ${[100, 50, 0].map(val => `
                  <button class="btn-score-select ${(currentScore === val || (currentScore === null && val === 0 && !pAns)) ? 'active' : ''}" 
                          data-pid="${p.id}" data-cat="${cat.key}" data-score="${val}"
                          style="padding: 4px 8px; font-size: 11px; font-weight: 800; min-width: 38px; border-radius: 4px; cursor: pointer;">
                    ${val}
                  </button>
                `).join('')}
              </div>
            ` : `
              <div style="display: flex; align-items: center; gap: 4px;">
                <span class="difficulty-badge ${currentScore === 100 ? 'diff-EXPERTO' : (currentScore === 50 ? 'diff-EXTREMO' : 'diff-IMPOSIBLE')}" style="font-size: 11px; min-width: 50px; text-align: center; padding: 4px 8px;">
                  ${currentScore !== null ? `${currentScore} pts` : '—'}
                </span>
              </div>
            `}
          </div>
        `;
      });

      catHtml += `</div>`;
      catBlock.innerHTML = catHtml;
      DOM.scoringContainer.appendChild(catBlock);
    });

    // Score button event bindings for Captain (writes in real-time to Firebase)
    if (State.isCaptain) {
      DOM.scoringContainer.querySelectorAll('.btn-score-select').forEach(btn => {
        btn.addEventListener('click', async () => {
          const pid = btn.dataset.pid;
          const cat = btn.dataset.cat;
          const score = parseInt(btn.dataset.score, 10);
          StopAudio.scorePing();

          // Immediately update Firebase Realtime Database
          if (currentRoomRef) {
            await dbRef(`stop_rooms/${currentRoomId}/rounds/${round}/scores/${pid}/${cat}`).set(score);
          }
        });
      });

      if (DOM.captainScoringActions) DOM.captainScoringActions.style.display = 'flex';
      if (DOM.playerScoringWaiting) DOM.playerScoringWaiting.style.display = 'none';
    } else {
      if (DOM.captainScoringActions) DOM.captainScoringActions.style.display = 'none';
      if (DOM.playerScoringWaiting) DOM.playerScoringWaiting.style.display = 'block';
    }
  }

  function renderLiveScoreStrip(playerList, scores, round) {
    if (!DOM.scoringLiveStrip) return;

    DOM.scoringLiveStrip.innerHTML = playerList.map(p => {
      const pScores = scores[p.id] || {};
      let roundLiveTotal = 0;
      CATEGORIES.forEach(c => {
        if (pScores[c.key] !== undefined) {
          roundLiveTotal += pScores[c.key];
        }
      });

      const prevTotal = p.totalScore || 0;
      const currentAccum = prevTotal + roundLiveTotal;

      return `
        <div style="display: flex; align-items: center; gap: 8px; background: var(--bg-surface); padding: 6px 12px; border-radius: var(--radius-sm); border: 1px solid var(--border-color); flex-shrink: 0;">
          <span style="font-size: 18px;">👤</span>
          <div style="display: flex; flex-direction: column;">
            <span style="font-size: 11px; font-weight: 700; color: var(--text-dim);">${p.name}</span>
            <div style="display: flex; align-items: center; gap: 6px;">
              <span style="font-family: var(--font-mono); font-size: 13px; font-weight: 900; color: var(--accent-emerald);">+${roundLiveTotal}</span>
              <span style="font-size: 11px; color: var(--text-muted);">(${currentAccum} total)</span>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  async function confirmScores() {
    if (!currentRoomRef || !currentRoomData || !State.isCaptain) return;
    const round = currentRoomData.currentRound || 1;
    const roundData = (currentRoomData.rounds && currentRoomData.rounds[round]) || {};
    const answers = roundData.answers || {};
    const scores = roundData.scores || {};
    const players = currentRoomData.players || {};

    const finalScoresPayload = {};
    const playerUpdates = {};

    Object.keys(players).forEach(pid => {
      let roundTotal = 0;
      finalScoresPayload[pid] = {};

      CATEGORIES.forEach(cat => {
        // If not explicitly scored -> auto 0 if empty or doesn't start with letter, else 100
        let pts = (scores[pid] && scores[pid][cat.key] !== undefined) ? scores[pid][cat.key] : null;
        if (pts === null) {
          const ans = (answers[pid] && answers[pid][cat.key]) ? answers[pid][cat.key].trim() : '';
          const starts = ans && ans.charAt(0).toUpperCase() === currentRoomData.currentLetter.toUpperCase();
          pts = (ans && starts) ? 100 : 0;
        }
        finalScoresPayload[pid][cat.key] = pts;
        roundTotal += pts;
      });

      finalScoresPayload[pid].total = roundTotal;

      const previousRoundScores = players[pid].roundScores || {};
      previousRoundScores[round] = roundTotal;

      let newTotal = 0;
      Object.keys(previousRoundScores).forEach(rKey => {
        newTotal += (previousRoundScores[rKey] || 0);
      });

      playerUpdates[`players/${pid}/totalScore`] = newTotal;
      playerUpdates[`players/${pid}/roundScores/${round}`] = roundTotal;
    });

    const roomUpdates = {
      ...playerUpdates,
      [`rounds/${round}/scores`]: finalScoresPayload,
      status: 'ROUND_RESULTS'
    };

    try {
      await currentRoomRef.update(roomUpdates);
      StopAudio.roundSuccess();
      showToast('¡Puntuación confirmada con éxito!', '✅');
    } catch (e) {
      console.error('Error guardando puntuaciones:', e);
      showToast('Error al confirmar puntuaciones.', '❌');
    }
  }

  // --- ROUND RESULTS & NEXT ROUND ---

  function renderRoundResultsView(room, myUid) {
    const round = room.currentRound || 1;
    const roundData = (room.rounds && room.rounds[round]) || {};
    const scores = roundData.scores || {};
    const players = room.players || {};
    const playerList = Object.keys(players).map(id => ({ id, ...players[id] }));

    if (DOM.roundResultsTitle) DOM.roundResultsTitle.textContent = `Resultados - Ronda ${round} de 5`;

    playerList.sort((a, b) => (b.totalScore || 0) - (a.totalScore || 0));

    if (DOM.roundScoresTable) {
      DOM.roundScoresTable.innerHTML = `
        <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
          <thead>
            <tr style="color: var(--text-dim); text-align: left; border-bottom: 1px solid var(--border-color);">
              <th style="padding: 8px 4px;">Jugador</th>
              <th style="padding: 8px 4px; text-align: right;">Ronda ${round}</th>
              <th style="padding: 8px 4px; text-align: right;">Total Acum.</th>
            </tr>
          </thead>
          <tbody>
            ${playerList.map((p, idx) => `
              <tr style="border-bottom: 1px solid rgba(51, 65, 85, 0.4);">
                <td style="padding: 10px 4px; font-weight: 700;">
                  ${idx === 0 ? '🥇 ' : idx === 1 ? '🥈 ' : idx === 2 ? '🥉 ' : ''}${p.name} ${p.id === myUid ? '(Tú)' : ''}
                </td>
                <td style="padding: 10px 4px; text-align: right; color: var(--accent-emerald); font-family: var(--font-mono); font-weight: 700;">
                  +${(scores[p.id] && scores[p.id].total) || 0}
                </td>
                <td style="padding: 10px 4px; text-align: right; color: var(--primary); font-family: var(--font-mono); font-weight: 800;">
                  ${p.totalScore || 0} pts
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    }

    if (State.isCaptain) {
      if (DOM.btnNextRound) {
        DOM.btnNextRound.style.display = 'flex';
        DOM.btnNextRound.textContent = round >= 5 ? '🏆 Ver Resultados Finales' : `Siguiente Ronda (${round + 1}/5) ➡️`;
      }
      if (DOM.waitingNextRoundNotice) DOM.waitingNextRoundNotice.style.display = 'none';
    } else {
      if (DOM.btnNextRound) DOM.btnNextRound.style.display = 'none';
      if (DOM.waitingNextRoundNotice) DOM.waitingNextRoundNotice.style.display = 'block';
    }
  }

  async function nextRound() {
    if (!currentRoomRef || !currentRoomData || !State.isCaptain) return;
    const currentRound = currentRoomData.currentRound || 1;

    if (currentRound >= 5) {
      await currentRoomRef.update({
        status: 'FINISHED'
      });
      return;
    }

    const nextRoundNum = currentRound + 1;
    const used = currentRoomData.usedLetters || [];
    const newLetter = getRandomLetter(used);

    // Reset input fields locally
    CATEGORIES.forEach(cat => {
      const inp = DOM.categoryInputs[cat.key];
      if (inp) {
        inp.value = '';
        inp.disabled = false;
      }
      State.myAnswers[cat.key] = '';
    });
    State.isRoundLocked = false;

    const updates = {
      status: 'PLAYING',
      currentRound: nextRoundNum,
      currentLetter: newLetter,
      usedLetters: [...used, newLetter],
      stopPlayerId: null,
      stopPlayerName: null,
      stopCountdownExpiresAt: null,
      [`rounds/${nextRoundNum}`]: {
        letter: newLetter,
        answers: {},
        scores: {}
      }
    };

    try {
      await currentRoomRef.update(updates);
    } catch (e) {
      console.error('Error pasando a siguiente ronda:', e);
    }
  }

  // --- FINAL RESULTS & REMATCH ---

  function renderFinalResultsView(room, myUid) {
    const players = room.players || {};
    const playerList = Object.keys(players).map(id => ({ id, ...players[id] }));

    playerList.sort((a, b) => (b.totalScore || 0) - (a.totalScore || 0));
    const winner = playerList[0];

    if (DOM.winnerPodium && winner) {
      DOM.winnerPodium.innerHTML = `
        <div style="font-size: 64px; filter: drop-shadow(0 0 20px rgba(245, 158, 11, 0.6));">👑</div>
        <h2 style="font-size: 24px; font-weight: 900; color: var(--accent-amber); margin: 0;">
          ¡${winner.name} es el Ganador!
        </h2>
        <span class="difficulty-badge diff-EXPERTO" style="font-size: 16px; padding: 6px 18px;">
          ${winner.totalScore || 0} Puntos Totales
        </span>
      `;
    }

    if (DOM.finalScoresTable) {
      DOM.finalScoresTable.innerHTML = `
        <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
          <thead>
            <tr style="color: var(--text-dim); text-align: left; border-bottom: 1px solid var(--border-color);">
              <th style="padding: 10px 6px;">Posición</th>
              <th style="padding: 10px 6px;">Jugador</th>
              <th style="padding: 10px 6px; text-align: right;">Puntos Totales</th>
            </tr>
          </thead>
          <tbody>
            ${playerList.map((p, idx) => `
              <tr style="border-bottom: 1px solid rgba(51, 65, 85, 0.4); ${idx === 0 ? 'background: rgba(245, 158, 11, 0.1);' : ''}">
                <td style="padding: 12px 6px; font-weight: 800;">
                  ${idx === 0 ? '🥇 1º' : idx === 1 ? '🥈 2º' : idx === 2 ? '🥉 3º' : `${idx + 1}º`}
                </td>
                <td style="padding: 12px 6px; font-weight: 700;">
                  ${p.name} ${p.id === myUid ? '(Tú)' : ''}
                </td>
                <td style="padding: 12px 6px; text-align: right; color: var(--primary); font-family: var(--font-mono); font-weight: 900; font-size: 16px;">
                  ${p.totalScore || 0}
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    }

    if (DOM.btnPlayAgain) {
      DOM.btnPlayAgain.style.display = State.isCaptain ? 'flex' : 'none';
    }
  }

  async function restartGame() {
    if (!currentRoomRef || !State.isCaptain) return;
    const firstLetter = getRandomLetter([]);
    const players = currentRoomData.players || {};

    const resetPlayers = {};
    Object.keys(players).forEach(pid => {
      resetPlayers[pid] = {
        ...players[pid],
        totalScore: 0,
        roundScores: {}
      };
    });

    const payload = {
      status: 'WAITING',
      currentRound: 1,
      totalRounds: 5,
      currentLetter: firstLetter,
      usedLetters: [firstLetter],
      stopPlayerId: null,
      stopPlayerName: null,
      stopCountdownExpiresAt: null,
      players: resetPlayers,
      rounds: {
        1: {
          letter: firstLetter,
          answers: {},
          scores: {}
        }
      }
    };

    await currentRoomRef.set(payload);
    showToast('¡Partida reiniciada para otra partida de STOP!', '🔄');
  }

  function leaveRoom() {
    clearInterval(countdownTimerInterval);
    countdownTimerInterval = null;

    if (currentRoomRef && currentRoomId) {
      const myUid = getPlayerUid();
      try {
        dbRef(`stop_rooms/${currentRoomId}/players/${myUid}/connected`).set(false);
      } catch (e) {}
      currentRoomRef.off();
      currentRoomRef = null;
    }
    currentRoomId = null;
    currentRoomData = null;
    State.isRoundLocked = false;

    showView('lobby');
  }

  // --- EVENTS & INITIALIZATION ---

  function initEvents() {
    if (DOM.inputNickname) {
      DOM.inputNickname.value = getPlayerName();
      DOM.inputNickname.addEventListener('change', () => {
        const clean = DOM.inputNickname.value.trim().substring(0, 20) || getPlayerName();
        localStorage.setItem('sudoku_player_name', clean);
        DOM.inputNickname.value = clean;
      });
    }

    if (DOM.btnCreateRoom) {
      DOM.btnCreateRoom.addEventListener('click', async () => {
        try {
          const roomId = await createRoom();
          showToast(`¡Sala de STOP creada! Código: ${roomId}`, '🚀');
        } catch (e) {
          showToast(e.message || 'Error creando sala.', '❌');
        }
      });
    }

    if (DOM.btnJoinRoom) {
      DOM.btnJoinRoom.addEventListener('click', async () => {
        const code = DOM.inputJoinCode ? DOM.inputJoinCode.value.trim() : '';
        if (!code) {
          showToast('Introduce el código de sala.', '⚠️');
          return;
        }
        try {
          await joinRoom(code);
          showToast(`¡Conectado a la sala ${code.toUpperCase()}!`, '🚀');
        } catch (e) {
          showToast(e.message || 'Error al unirse.', '❌');
        }
      });
    }

    if (DOM.btnCopyCode) {
      DOM.btnCopyCode.addEventListener('click', () => {
        const code = DOM.displayRoomCode ? DOM.displayRoomCode.textContent : '';
        if (navigator.clipboard) {
          navigator.clipboard.writeText(code).then(() => showToast('¡Código copiado al portapapeles!', '📋'));
        }
      });
    }

    if (DOM.btnShareRoom) {
      DOM.btnShareRoom.addEventListener('click', () => {
        const code = DOM.displayRoomCode ? DOM.displayRoomCode.textContent : '';
        const url = `${window.location.origin}${window.location.pathname}?game=stop&room=${code}`;
        if (navigator.share) {
          navigator.share({ title: 'STOP Online', text: `¡Únete a mi partida de STOP! Código: ${code}`, url }).catch(() => {});
        } else if (navigator.clipboard) {
          navigator.clipboard.writeText(url).then(() => showToast('¡Enlace de invitación copiado!', '🔗'));
        }
      });
    }

    if (DOM.btnCaptainStart) {
      DOM.btnCaptainStart.addEventListener('click', async () => {
        if (!currentRoomRef || !State.isCaptain) return;
        try {
          CATEGORIES.forEach(cat => {
            const inp = DOM.categoryInputs[cat.key];
            if (inp) inp.value = '';
          });
          await currentRoomRef.update({
            status: 'PLAYING',
            currentRound: 1
          });
        } catch (e) {
          showToast('Error al iniciar la partida.', '❌');
        }
      });
    }

    if (DOM.btnStop) {
      DOM.btnStop.addEventListener('click', triggerStop);
    }

    if (DOM.btnConfirmScores) {
      DOM.btnConfirmScores.addEventListener('click', confirmScores);
    }

    if (DOM.btnNextRound) {
      DOM.btnNextRound.addEventListener('click', nextRound);
    }

    if (DOM.btnPlayAgain) {
      DOM.btnPlayAgain.addEventListener('click', restartGame);
    }

    if (DOM.btnLeaveWaiting) DOM.btnLeaveWaiting.addEventListener('click', leaveRoom);
    if (DOM.btnAbandonGame) DOM.btnAbandonGame.addEventListener('click', () => {
      if (confirm('¿Deseas salir de la partida actual?')) leaveRoom();
    });
    if (DOM.btnFinalExit) DOM.btnFinalExit.addEventListener('click', leaveRoom);
  }

  function init() {
    cacheDOM();
    initEvents();
  }

  const StopGame = {
    init,
    createRoom,
    joinRoom,
    leaveRoom,
    showView
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = StopGame;
  } else {
    global.StopGame = StopGame;
  }

})(typeof window !== 'undefined' ? window : self);
