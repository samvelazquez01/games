/**
 * STOP GAME (TUTTI FRUTTI / BASTA) - MULTIPLAYER ENGINE & CONTROLLER
 *
 * Implements:
 * - Realtime multiplayer room for N players (2, 3, 5, 10+).
 * - Captain role (room creator) with full game controls.
 * - Automatic captaincy handoff if captain leaves/disconnects.
 * - 5 rounds with 100% random, non-repeating letters from the Spanish alphabet.
 * - 7 categories: Nombre, Apellido, Fruta, Color, Animal, Artista, País.
 * - STOP button with synchronized 5-second countdown across all players.
 * - Interactive captain scoring panel (100, 50, 25, 0) with category-grouped comparisons.
 * - Live round results and 5-round cumulative final leaderboard with rematching.
 */

(function (global) {
  'use strict';

  // Constants
  const CATEGORIES = [
    { key: 'nombre', label: 'Nombre' },
    { key: 'apellido', label: 'Apellido' },
    { key: 'fruta', label: 'Fruta' },
    { key: 'color', label: 'Color' },
    { key: 'animal', label: 'Animal' },
    { key: 'artista', label: 'Artista' },
    { key: 'pais', label: 'País' }
  ];

  // Spanish alphabet excluding rarely usable letters if any, or full Spanish set:
  const ALPHABET = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'L', 'M', 'N', 'Ñ', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'Z'];

  // State
  let currentRoomId = null;
  let currentRoomRef = null;
  let playerRef = null;
  let currentRoomData = null;
  let countdownTimerInterval = null;
  let serverOffset = 0;

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
    scoringDraft: {}, // For captain during scoring phase: { [uid]: { [catKey]: score } }
    countdownSeconds: 5,
    isStopActive: false,
    isRoundLocked: false
  };

  // Helper: persistent player ID & Name
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

  // Time Sync with Firebase
  function setupTimeSync(db) {
    db.ref('.info/serverTimeOffset').on('value', snap => {
      serverOffset = snap.val() || 0;
    });
  }

  function getSynchronizedServerTime() {
    return Date.now() + serverOffset;
  }

  // Ensure Firebase Auth & DB
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

  // Presence system for STOP room
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

  // DOM Caching for STOP game
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

    // Lobby
    DOM.inputNickname = document.getElementById('stop-nickname-input');
    DOM.btnCreateRoom = document.getElementById('stop-btn-create-room');
    DOM.inputJoinCode = document.getElementById('stop-input-join-code');
    DOM.btnJoinRoom = document.getElementById('stop-btn-join-room');
    DOM.scoringOptionCards = document.querySelectorAll('.stop-scoring-option');

    // Waiting Room
    DOM.displayRoomCode = document.getElementById('stop-display-room-code');
    DOM.btnCopyCode = document.getElementById('stop-btn-copy-code');
    DOM.btnShareRoom = document.getElementById('stop-btn-share-room');
    DOM.waitingPlayersList = document.getElementById('stop-waiting-players-list');
    DOM.waitingPlayersCount = document.getElementById('stop-waiting-players-count');
    DOM.btnCaptainStart = document.getElementById('stop-btn-captain-start');
    DOM.captainConfigBadge = document.getElementById('stop-captain-config-badge');
    DOM.btnLeaveWaiting = document.getElementById('stop-btn-leave-waiting');

    // Game Board
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

    // Scoring View
    DOM.scoringRoundTitle = document.getElementById('stop-scoring-round-title');
    DOM.scoringLetterBadge = document.getElementById('stop-scoring-letter-badge');
    DOM.scoringContainer = document.getElementById('stop-scoring-container');
    DOM.captainScoringActions = document.getElementById('stop-captain-scoring-actions');
    DOM.btnConfirmScores = document.getElementById('stop-btn-confirm-scores');
    DOM.playerScoringWaiting = document.getElementById('stop-player-scoring-waiting');

    // Round Results View
    DOM.roundResultsTitle = document.getElementById('stop-round-results-title');
    DOM.roundScoresTable = document.getElementById('stop-round-scores-table');
    DOM.cumulativeScoresList = document.getElementById('stop-cumulative-scores-list');
    DOM.btnNextRound = document.getElementById('stop-btn-next-round');
    DOM.waitingNextRoundNotice = document.getElementById('stop-waiting-next-round-notice');

    // Final Results View
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

  async function createRoom(scoringConfigType = 'standard') {
    const { uid, db } = await ensureFirebase();
    setupTimeSync(db);

    const roomId = generateRoomCode();
    const roomRef = db.ref('stop_rooms/' + roomId);

    const scoringConfig = scoringConfigType === 'custom'
      ? { unique: 100, repeatedTwo: 50, repeatedThreePlus: 25, invalidOrEmpty: 0 }
      : { unique: 100, repeatedTwo: 50, repeatedThreePlus: 25, invalidOrEmpty: 0 };

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
      scoringConfig,
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
    playerRef = db.ref(`stop_rooms/${roomId}/players/${uid}`);
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
    playerRef = db.ref(`stop_rooms/${cleanCode}/players/${uid}`);
    State.isCaptain = (room.captainId === uid);

    setupPresence(db, cleanCode, uid);
    attachRoomListener(roomRef, uid);

    return cleanCode;
  }

  // --- REALTIME ROOM LISTENER & STATE MACHINE ---

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

      // Check / Handle Captaincy (automatic handoff if captain is gone/disconnected)
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

      // Route views based on room status
      renderRoomState(room, myUid);
    });
  }

  function dbRef(path) {
    return global.FirebaseService.getDb().ref(path);
  }

  function renderRoomState(room, myUid) {
    const status = room.status || 'WAITING';
    const players = room.players || {};
    const playerList = Object.keys(players).map(id => ({ id, ...players[id] }));

    // 1. WAITING LOBBY
    if (status === 'WAITING') {
      clearInterval(countdownTimerInterval);
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

      // Handle STOP Triggered & 5s Countdown
      if (status === 'COUNTDOWN') {
        DOM.stopWarningBanner.style.display = 'flex';
        DOM.stopWarningText.textContent = `¡${room.stopPlayerName || 'Alguien'} gritó STOP!`;

        if (!countdownTimerInterval) {
          startSynchronizedCountdown(room.stopCountdownExpiresAt);
        }
      } else {
        DOM.stopWarningBanner.style.display = 'none';
        clearInterval(countdownTimerInterval);
        countdownTimerInterval = null;
        unlockCategoryInputs();
      }

      showView('game');
      return;
    }

    // 3. SCORING PHASE (Captain assigns points)
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

    // 5. FINISHED (5 Rounds Complete)
    if (status === 'FINISHED') {
      clearInterval(countdownTimerInterval);
      renderFinalResultsView(room, myUid);
      showView('finalResults');
      return;
    }
  }

  // --- GAMEPLAY: STOP & COUNTDOWN ---

  function startSynchronizedCountdown(expiresAt) {
    if (countdownTimerInterval) clearInterval(countdownTimerInterval);

    function update() {
      const now = getSynchronizedServerTime();
      const remainingMs = Math.max(0, (expiresAt || (now + 5000)) - now);
      const seconds = Math.ceil(remainingMs / 1000);

      if (DOM.stopCountdownNumber) {
        DOM.stopCountdownNumber.textContent = seconds;
      }

      if (remainingMs <= 0) {
        clearInterval(countdownTimerInterval);
        countdownTimerInterval = null;
        lockCategoryInputsAndSubmit();
      }
    }

    update();
    countdownTimerInterval = setInterval(update, 200);
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

    CATEGORIES.forEach(cat => {
      const inp = DOM.categoryInputs[cat.key];
      if (inp) {
        inp.disabled = true;
        State.myAnswers[cat.key] = inp.value.trim();
      }
    });
    if (DOM.btnStop) DOM.btnStop.disabled = true;

    // Send my answers to Firebase
    submitMyAnswers();

    // If Captain, transition room status to SCORING
    if (State.isCaptain && currentRoomRef) {
      setTimeout(() => {
        currentRoomRef.update({
          status: 'SCORING'
        });
      }, 1000);
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
      showToast('¡Has presionado STOP! 🛑', '⏱️');
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

  // --- SCORING VIEW (CAPTAIN REVIEW) ---

  function renderScoringView(room, myUid) {
    const round = room.currentRound || 1;
    const letter = room.currentLetter || 'M';
    const roundData = (room.rounds && room.rounds[round]) || {};
    const answers = roundData.answers || {};
    const existingScores = roundData.scores || {};
    const players = room.players || {};
    const playerList = Object.keys(players).map(id => ({ id, ...players[id] }));

    if (DOM.scoringRoundTitle) DOM.scoringRoundTitle.textContent = `Evaluación Ronda ${round} de 5`;
    if (DOM.scoringLetterBadge) DOM.scoringLetterBadge.textContent = `Letra: ${letter}`;

    if (!DOM.scoringContainer) return;
    DOM.scoringContainer.innerHTML = '';

    // Initialize scoring draft
    if (!State.scoringDraft[round]) {
      State.scoringDraft[round] = {};
      playerList.forEach(p => {
        State.scoringDraft[round][p.id] = {};
        const pAnswers = answers[p.id] || {};
        CATEGORIES.forEach(cat => {
          const ans = (pAnswers[cat.key] || '').trim();
          if (existingScores[p.id] && existingScores[p.id][cat.key] !== undefined) {
            State.scoringDraft[round][p.id][cat.key] = existingScores[p.id][cat.key];
          } else {
            // Auto-suggestion: if empty or doesn't start with letter -> 0; otherwise default 100
            if (!ans || ans.charAt(0).toUpperCase() !== letter.toUpperCase()) {
              State.scoringDraft[round][p.id][cat.key] = 0;
            } else {
              State.scoringDraft[round][p.id][cat.key] = 100;
            }
          }
        });
      });
    }

    // Render grouped by category so Captain can easily compare answers!
    CATEGORIES.forEach(cat => {
      const catBlock = document.createElement('div');
      catBlock.className = 'glass-card';
      catBlock.style.padding = '16px';
      catBlock.style.gap = '10px';

      let catHtml = `
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border-color); padding-bottom: 6px;">
          <h4 style="font-size: 15px; font-weight: 800; color: var(--accent-cyan); text-transform: uppercase;">${cat.label}</h4>
          <span style="font-size: 11px; color: var(--text-muted);">Letra [${letter}]</span>
        </div>
        <div style="display: flex; flex-direction: column; gap: 8px;">
      `;

      playerList.forEach(p => {
        const pAns = (answers[p.id] && answers[p.id][cat.key]) ? answers[p.id][cat.key].trim() : '';
        const currentScore = State.scoringDraft[round][p.id] ? State.scoringDraft[round][p.id][cat.key] : 0;
        const startsCorrect = pAns && pAns.charAt(0).toUpperCase() === letter.toUpperCase();

        catHtml += `
          <div style="display: flex; justify-content: space-between; align-items: center; background: var(--bg-surface); padding: 8px 12px; border-radius: var(--radius-sm); gap: 10px;">
            <div style="display: flex; flex-direction: column; flex: 1; overflow: hidden;">
              <span style="font-size: 12px; font-weight: 700; color: var(--text-dim);">${p.name}</span>
              <span style="font-size: 14px; font-weight: 600; color: ${pAns ? (startsCorrect ? 'var(--text-main)' : 'var(--accent-rose)') : 'var(--text-dim)'}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                ${pAns || '<i style="color: var(--text-dim); font-size: 12px;">(Vacío)</i>'}
              </span>
            </div>
            ${State.isCaptain ? `
              <div style="display: flex; gap: 4px;">
                ${[100, 50, 25, 0].map(val => `
                  <button class="btn-score-select ${currentScore === val ? 'active' : ''}" 
                          data-pid="${p.id}" data-cat="${cat.key}" data-score="${val}">
                    ${val}
                  </button>
                `).join('')}
              </div>
            ` : `
              <span class="difficulty-badge" style="font-size: 12px; min-width: 45px; text-align: center;">
                ${currentScore} pts
              </span>
            `}
          </div>
        `;
      });

      catHtml += `</div>`;
      catBlock.innerHTML = catHtml;
      DOM.scoringContainer.appendChild(catBlock);
    });

    // Score button event bindings for captain
    if (State.isCaptain) {
      DOM.scoringContainer.querySelectorAll('.btn-score-select').forEach(btn => {
        btn.addEventListener('click', () => {
          const pid = btn.dataset.pid;
          const cat = btn.dataset.cat;
          const score = parseInt(btn.dataset.score, 10);
          State.scoringDraft[round][pid][cat] = score;

          // Update UI state in block
          btn.parentElement.querySelectorAll('.btn-score-select').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
        });
      });

      if (DOM.captainScoringActions) DOM.captainScoringActions.style.display = 'flex';
      if (DOM.playerScoringWaiting) DOM.playerScoringWaiting.style.display = 'none';
    } else {
      if (DOM.captainScoringActions) DOM.captainScoringActions.style.display = 'none';
      if (DOM.playerScoringWaiting) DOM.playerScoringWaiting.style.display = 'block';
    }
  }

  async function confirmScores() {
    if (!currentRoomRef || !currentRoomData || !State.isCaptain) return;
    const round = currentRoomData.currentRound || 1;
    const roundScores = State.scoringDraft[round] || {};
    const players = currentRoomData.players || {};

    const finalScoresPayload = {};
    const playerUpdates = {};

    Object.keys(players).forEach(pid => {
      let roundTotal = 0;
      finalScoresPayload[pid] = {};

      CATEGORIES.forEach(cat => {
        const pts = (roundScores[pid] && roundScores[pid][cat.key]) ? roundScores[pid][cat.key] : 0;
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
      showToast('¡Puntuaciones de la ronda confirmadas!', '✅');
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

    // Sort round scores
    playerList.sort((a, b) => {
      const scoreA = (scores[a.id] && scores[a.id].total) || 0;
      const scoreB = (scores[b.id] && scores[b.id].total) || 0;
      return scoreB - scoreA;
    });

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

    // Captain Next Round Button
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
      // Game Over -> Final Results
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

    await currentRoomRef.update(updates);
  }

  // --- FINAL RESULTS & REMATCH ---

  function renderFinalResultsView(room, myUid) {
    const players = room.players || {};
    const playerList = Object.keys(players).map(id => ({ id, ...players[id] }));

    playerList.sort((a, b) => (b.totalScore || 0) - (a.totalScore || 0));
    const winner = playerList[0] || { name: 'Jugador', totalScore: 0 };

    if (DOM.winnerPodium) {
      DOM.winnerPodium.innerHTML = `
        <div style="font-size: 54px; filter: drop-shadow(0 0 15px var(--accent-amber-glow));">🏆</div>
        <h2 style="font-size: 26px; font-weight: 800; color: #fff; margin-top: -6px;">¡${winner.name.toUpperCase()} HA GANADO!</h2>
        <p style="color: var(--accent-amber); font-family: var(--font-mono); font-size: 22px; font-weight: 800;">
          ${winner.totalScore} PUNTOS
        </p>
      `;
    }

    if (DOM.finalScoresTable) {
      DOM.finalScoresTable.innerHTML = `
        <div style="overflow-x: auto; width: 100%;">
          <table style="width: 100%; border-collapse: collapse; font-size: 12px; text-align: center;">
            <thead>
              <tr style="color: var(--text-dim); border-bottom: 1px solid var(--border-color);">
                <th style="padding: 8px 4px; text-align: left;">Jugador</th>
                <th style="padding: 8px 2px;">R1</th>
                <th style="padding: 8px 2px;">R2</th>
                <th style="padding: 8px 2px;">R3</th>
                <th style="padding: 8px 2px;">R4</th>
                <th style="padding: 8px 2px;">R5</th>
                <th style="padding: 8px 4px; text-align: right; color: var(--primary);">TOTAL</th>
              </tr>
            </thead>
            <tbody>
              ${playerList.map((p, idx) => {
                const rScores = p.roundScores || {};
                return `
                  <tr style="border-bottom: 1px solid rgba(51, 65, 85, 0.4);">
                    <td style="padding: 10px 4px; text-align: left; font-weight: 700;">
                      ${idx === 0 ? '🥇 ' : idx === 1 ? '🥈 ' : idx === 2 ? '🥉 ' : ''}${p.name}
                    </td>
                    <td style="padding: 10px 2px; color: var(--text-muted);">${rScores[1] || 0}</td>
                    <td style="padding: 10px 2px; color: var(--text-muted);">${rScores[2] || 0}</td>
                    <td style="padding: 10px 2px; color: var(--text-muted);">${rScores[3] || 0}</td>
                    <td style="padding: 10px 2px; color: var(--text-muted);">${rScores[4] || 0}</td>
                    <td style="padding: 10px 2px; color: var(--text-muted);">${rScores[5] || 0}</td>
                    <td style="padding: 10px 4px; text-align: right; color: var(--accent-emerald); font-family: var(--font-mono); font-weight: 800; font-size: 14px;">
                      ${p.totalScore || 0}
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      `;
    }

    if (State.isCaptain) {
      if (DOM.btnPlayAgain) DOM.btnPlayAgain.style.display = 'flex';
    } else {
      if (DOM.btnPlayAgain) DOM.btnPlayAgain.style.display = 'none';
    }
  }

  async function restartGame() {
    if (!currentRoomRef || !currentRoomData || !State.isCaptain) return;
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

    // Clear inputs
    CATEGORIES.forEach(cat => {
      const inp = DOM.categoryInputs[cat.key];
      if (inp) {
        inp.value = '';
        inp.disabled = false;
      }
      State.myAnswers[cat.key] = '';
    });
    State.isRoundLocked = false;
    State.scoringDraft = {};

    const updates = {
      status: 'PLAYING',
      currentRound: 1,
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

    await currentRoomRef.update(updates);
    showToast('¡Nueva partida de STOP iniciada!', '🔄');
  }

  function leaveRoom() {
    if (currentRoomRef && currentRoomId) {
      const myUid = getPlayerUid();
      try {
        dbRef(`stop_rooms/${currentRoomId}/players/${myUid}`).update({
          connected: false,
          lastActive: global.firebase.database.ServerValue.TIMESTAMP
        });
      } catch (e) {
        console.warn('Error saliendo de STOP:', e);
      }
      currentRoomRef.off();
      currentRoomRef = null;
    }
    currentRoomId = null;
    playerRef = null;
    currentRoomData = null;
    State.isCaptain = false;
    State.isRoundLocked = false;
    if (countdownTimerInterval) clearInterval(countdownTimerInterval);

    showView('lobby');
  }

  // --- INITIALIZATION & EVENT LISTENERS ---

  function initEvents() {
    // Nickname
    if (DOM.inputNickname) {
      DOM.inputNickname.value = getPlayerName();
      DOM.inputNickname.addEventListener('change', () => {
        const clean = DOM.inputNickname.value.trim().substring(0, 20) || getPlayerName();
        localStorage.setItem('sudoku_player_name', clean);
        DOM.inputNickname.value = clean;
        if (playerRef) playerRef.update({ name: clean });
        showToast(`Nombre actualizado: ${clean}`, '👤');
      });
    }

    // Scoring option cards
    DOM.scoringOptionCards.forEach(card => {
      card.addEventListener('click', () => {
        DOM.scoringOptionCards.forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
      });
    });

    // Create Room
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

    // Join Room
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
          showToast(e.message || 'Error uniéndose a la sala.', '❌');
        }
      });
    }

    // Copy & Share Code
    if (DOM.btnCopyCode) {
      DOM.btnCopyCode.addEventListener('click', () => {
        const code = DOM.displayRoomCode ? DOM.displayRoomCode.textContent : '';
        if (navigator.clipboard) {
          navigator.clipboard.writeText(code).then(() => showToast('¡Código copiado!', '📋'));
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
          navigator.clipboard.writeText(url).then(() => showToast('¡Enlace copiado!', '🔗'));
        }
      });
    }

    // Captain Start
    if (DOM.btnCaptainStart) {
      DOM.btnCaptainStart.addEventListener('click', async () => {
        if (!currentRoomRef || !State.isCaptain) return;
        CATEGORIES.forEach(cat => {
          const inp = DOM.categoryInputs[cat.key];
          if (inp) {
            inp.value = '';
            inp.disabled = false;
          }
          State.myAnswers[cat.key] = '';
        });
        State.isRoundLocked = false;
        await currentRoomRef.update({
          status: 'PLAYING',
          currentRound: 1
        });
      });
    }

    if (DOM.btnLeaveWaiting) DOM.btnLeaveWaiting.addEventListener('click', leaveRoom);
    if (DOM.btnAbandonGame) {
      DOM.btnAbandonGame.addEventListener('click', () => {
        if (confirm('¿Deseas salir de la partida de STOP?')) {
          leaveRoom();
        }
      });
    }

    // STOP Button Click
    if (DOM.btnStop) {
      DOM.btnStop.addEventListener('click', triggerStop);
    }

    // Inputs Live Update
    CATEGORIES.forEach(cat => {
      const inp = DOM.categoryInputs[cat.key];
      if (inp) {
        inp.addEventListener('input', () => {
          State.myAnswers[cat.key] = inp.value;
        });
      }
    });

    // Captain Confirm Scores
    if (DOM.btnConfirmScores) {
      DOM.btnConfirmScores.addEventListener('click', confirmScores);
    }

    // Captain Next Round
    if (DOM.btnNextRound) {
      DOM.btnNextRound.addEventListener('click', nextRound);
    }

    // Captain Play Again
    if (DOM.btnPlayAgain) {
      DOM.btnPlayAgain.addEventListener('click', restartGame);
    }

    if (DOM.btnFinalExit) {
      DOM.btnFinalExit.addEventListener('click', leaveRoom);
    }
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
