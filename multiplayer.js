/**
 * MULTIPLAYER SYNCHRONIZATION ENGINE WITH FIREBASE REALTIME DATABASE
 *
 * Supports:
 * - 🤝 MODO COOPERATIVO (En Parejas): Tablero compartido en vivo, errores compartidos (3 max),
 *   sincronización de celdas y notas en tiempo real.
 * - ⚔️ MODO DUELO (Versus): Tableros independientes, carrera por terminar primero, 3 errores = descalificación.
 * - Sincronización de presencia, cronómetro por offset de servidor y anticheat SHA-256.
 */

(function (global) {
  'use strict';

  // State
  let currentRoomId = null;
  let currentRoomRef = null;
  let playerRef = null;
  let serverOffset = 0;
  let currentRoomData = null;
  let isHost = false;
  let listeners = {};
  let lastProcessedMoveTimestamp = 0;

  // Local persistent player info
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

  function setPlayerName(name) {
    if (name && name.trim()) {
      const clean = name.trim().substring(0, 20);
      localStorage.setItem('sudoku_player_name', clean);
      if (playerRef && currentRoomId) {
        playerRef.update({ name: clean });
      }
      return clean;
    }
    return getPlayerName();
  }

  // Room Code Generator (6 uppercase chars, unambiguous)
  function generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }

  // Event dispatching
  function emit(event, data) {
    if (listeners[event]) {
      listeners[event].forEach(fn => {
        try {
          fn(data);
        } catch (e) {
          console.error(`Error en listener multijugador "${event}":`, e);
        }
      });
    }
  }

  function on(event, callback) {
    if (!listeners[event]) listeners[event] = [];
    listeners[event].push(callback);
    return () => off(event, callback);
  }

  function off(event, callback) {
    if (!listeners[event]) return;
    listeners[event] = listeners[event].filter(fn => fn !== callback);
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

  function getElapsedTimeSeconds(startedAt) {
    if (!startedAt) return 0;
    const now = getSynchronizedServerTime();
    return Math.max(0, Math.floor((now - startedAt) / 1000));
  }

  // Setup presence for current user in room
  function setupPresence(db, roomId, uid) {
    const connectedRef = db.ref('.info/connected');
    const userStatusRef = db.ref(`rooms/${roomId}/players/${uid}/connected`);
    const lastActiveRef = db.ref(`rooms/${roomId}/players/${uid}/lastActive`);

    connectedRef.on('value', snap => {
      if (snap.val() === true) {
        userStatusRef.onDisconnect().set(false);
        lastActiveRef.onDisconnect().set(global.firebase.database.ServerValue.TIMESTAMP);
        userStatusRef.set(true);
      }
    });
  }

  // Authenticate anonymously
  async function ensureAuth() {
    const service = global.FirebaseService;
    const initRes = service.initFirebase();
    if (!initRes.initialized) {
      throw new Error(initRes.error || 'Firebase no inicializado');
    }

    const auth = service.getAuth();
    if (!auth.currentUser) {
      try {
        await auth.signInAnonymously();
      } catch (err) {
        console.warn('Fallo auth anónima, continuando con identificador local:', err);
      }
    }

    return {
      uid: (auth.currentUser && auth.currentUser.uid) || getPlayerUid(),
      db: service.getDb()
    };
  }

  /**
   * CREATE ROOM (Supports COOP or VERSUS)
   */
  async function createRoom(difficulty, puzzleData, gameMode = 'COOP') {
    const { uid, db } = await ensureAuth();
    setupTimeSync(db);

    const roomId = generateRoomCode();
    const roomRef = db.ref('rooms/' + roomId);

    // Compute anti-cheat solution hash
    const salt = global.SudokuEngine.generateSalt(16);
    const solutionHash = await global.SudokuEngine.hashSolutionWithSalt(puzzleData.solution, salt);

    const name = getPlayerName();
    const initialPlayerState = {
      name,
      isHost: true,
      connected: true,
      progress: 0,
      filledCount: 0,
      errors: 0,
      eliminated: false,
      lastActive: global.firebase.database.ServerValue.TIMESTAMP
    };

    // Shared board representation for COOP mode
    const initialSharedBoard = {};
    for (let i = 0; i < 81; i++) {
      const ch = puzzleData.puzzle[i];
      initialSharedBoard[i] = ch !== '.' && ch !== '0' ? parseInt(ch, 10) : 0;
    }

    const roomPayload = {
      id: roomId,
      gameMode: gameMode, // 'COOP' | 'VERSUS'
      difficulty: difficulty,
      puzzle: puzzleData.puzzle,
      solutionHash: solutionHash,
      solutionSalt: salt,
      cluesCount: puzzleData.cluesCount,
      difficultyScore: puzzleData.difficultyScore || 0,
      highestTechnique: puzzleData.highestTechnique || 'Naked Single',
      status: 'WAITING',
      sharedErrors: 0,
      maxErrors: 3,
      sharedBoard: initialSharedBoard,
      lastMove: null,
      createdAt: global.firebase.database.ServerValue.TIMESTAMP,
      startedAt: null,
      hostId: uid,
      winner: null,
      winnerName: null,
      finishTime: null,
      players: {
        [uid]: initialPlayerState
      }
    };

    await roomRef.set(roomPayload);

    currentRoomId = roomId;
    currentRoomRef = roomRef;
    playerRef = db.ref(`rooms/${roomId}/players/${uid}`);
    isHost = true;
    lastProcessedMoveTimestamp = 0;

    setupPresence(db, roomId, uid);
    attachRoomListener(roomRef, uid);

    return {
      roomId,
      puzzleData,
      gameMode
    };
  }

  /**
   * JOIN ROOM
   */
  async function joinRoom(roomCode) {
    const cleanCode = roomCode.trim().toUpperCase();
    if (cleanCode.length !== 6) {
      throw new Error('El código de sala debe tener exactamente 6 caracteres.');
    }

    const { uid, db } = await ensureAuth();
    setupTimeSync(db);

    const roomRef = db.ref('rooms/' + cleanCode);
    const snapshot = await roomRef.once('value');
    const roomData = snapshot.val();

    if (!roomData) {
      throw new Error('La sala no existe. Verifica el código e intenta nuevamente.');
    }

    const players = roomData.players || {};
    const playerKeys = Object.keys(players);
    const isAlreadyIn = playerKeys.includes(uid);

    if (!isAlreadyIn && playerKeys.length >= 2 && roomData.status !== 'WAITING') {
      throw new Error('La sala ya está completa.');
    }

    const name = getPlayerName();
    const guestPlayerState = {
      name,
      isHost: isAlreadyIn ? !!players[uid].isHost : false,
      connected: true,
      progress: isAlreadyIn ? (players[uid].progress || 0) : 0,
      filledCount: isAlreadyIn ? (players[uid].filledCount || 0) : 0,
      errors: isAlreadyIn ? (players[uid].errors || 0) : 0,
      eliminated: isAlreadyIn ? (players[uid].eliminated || false) : false,
      lastActive: global.firebase.database.ServerValue.TIMESTAMP
    };

    // Add/Update player
    await db.ref(`rooms/${cleanCode}/players/${uid}`).set(guestPlayerState);

    // If 2 players now in WAITING room, automatically start the game!
    if (!isAlreadyIn && playerKeys.length === 1 && roomData.status === 'WAITING') {
      await roomRef.update({
        status: 'PLAYING',
        startedAt: global.firebase.database.ServerValue.TIMESTAMP
      });
    }

    currentRoomId = cleanCode;
    currentRoomRef = roomRef;
    playerRef = db.ref(`rooms/${cleanCode}/players/${uid}`);
    isHost = isAlreadyIn ? !!players[uid].isHost : false;
    lastProcessedMoveTimestamp = 0;

    setupPresence(db, cleanCode, uid);
    attachRoomListener(roomRef, uid);

    return {
      roomId: cleanCode,
      roomData
    };
  }

  /**
   * ATTACH ROOM VALUE LISTENER
   */
  function attachRoomListener(roomRef, myUid) {
    roomRef.on('value', snap => {
      const room = snap.val();
      if (!room) {
        emit('room_abandoned', { reason: 'La sala fue eliminada.' });
        cleanup();
        return;
      }

      currentRoomData = room;
      emit('room_update', room);

      const players = room.players || {};
      const opponentUid = Object.keys(players).find(id => id !== myUid);
      const myData = players[myUid];
      const opponentData = opponentUid ? players[opponentUid] : null;

      if (myData) {
        emit('my_player_update', myData);
      }

      if (opponentData) {
        emit('opponent_update', opponentData);
      } else {
        emit('opponent_update', null);
      }

      // COOP Move Detection
      if (room.gameMode === 'COOP' && room.lastMove && room.lastMove.playerId !== myUid) {
        if (room.lastMove.timestamp && room.lastMove.timestamp > lastProcessedMoveTimestamp) {
          lastProcessedMoveTimestamp = room.lastMove.timestamp;
          emit('coop_move_received', room.lastMove);
        }
      }

      // COOP Shared Errors update
      if (room.gameMode === 'COOP') {
        emit('coop_errors_update', {
          errors: room.sharedErrors || 0,
          maxErrors: room.maxErrors || 3
        });
      }

      // Check status transitions
      if (room.status === 'PLAYING') {
        emit('game_started', room);
      } else if (room.status === 'FINISHED') {
        emit('game_finished', {
          winner: room.winner,
          winnerName: room.winnerName,
          finishTime: room.finishTime,
          isWinner: room.winner === myUid || room.winner === 'COOP_VICTORY',
          isDefeatByErrors: room.winner === 'DEFEAT',
          gameMode: room.gameMode,
          room
        });
      } else if (room.status === 'ABANDONED') {
        emit('room_abandoned', { reason: 'El otro jugador abandonó la partida.', room });
      }
    });
  }

  /**
   * COOP: MAKE SHARED MOVE
   */
  async function makeCoopMove(cellIndex, digit) {
    if (!currentRoomRef || !currentRoomId) return;
    const myUid = getPlayerUid();
    const myName = getPlayerName();

    try {
      const updates = {};
      updates[`sharedBoard/${cellIndex}`] = digit;
      updates['lastMove'] = {
        cellIndex,
        digit,
        playerId: myUid,
        playerName: myName,
        timestamp: global.firebase.database.ServerValue.TIMESTAMP
      };
      await currentRoomRef.update(updates);
    } catch (e) {
      console.warn('Error enviando jugada cooperativa:', e);
    }
  }

  /**
   * COOP: REPORT SHARED ERROR
   */
  async function reportCoopError() {
    if (!currentRoomRef || !currentRoomData) return;
    const currentErrors = (currentRoomData.sharedErrors || 0) + 1;

    try {
      if (currentErrors >= 3) {
        // Shared 3-strike defeat!
        await currentRoomRef.update({
          sharedErrors: 3,
          status: 'FINISHED',
          winner: 'DEFEAT',
          winnerName: 'Límite de 3 errores alcanzado'
        });
      } else {
        await currentRoomRef.update({
          sharedErrors: currentErrors
        });
      }
    } catch (e) {
      console.warn('Error reportando error cooperativo:', e);
    }
  }

  /**
   * VERSUS: REPORT PLAYER ERROR
   */
  async function reportVersusError(errorsCount) {
    if (!playerRef || !currentRoomData) return;
    try {
      if (errorsCount >= 3) {
        await playerRef.update({
          errors: 3,
          eliminated: true,
          lastActive: global.firebase.database.ServerValue.TIMESTAMP
        });

        // If in versus, opponent wins!
        const players = currentRoomData.players || {};
        const myUid = getPlayerUid();
        const opponentUid = Object.keys(players).find(id => id !== myUid);
        const opponent = opponentUid ? players[opponentUid] : null;

        if (opponent && !opponent.eliminated) {
          await currentRoomRef.update({
            status: 'FINISHED',
            winner: opponentUid,
            winnerName: opponent.name || 'Rival',
            finishTime: getElapsedTimeSeconds(currentRoomData.startedAt)
          });
        }
      } else {
        await playerRef.update({
          errors: errorsCount,
          lastActive: global.firebase.database.ServerValue.TIMESTAMP
        });
      }
    } catch (e) {
      console.warn('Error reportando error versus:', e);
    }
  }

  /**
   * UPDATE MY PLAYER PROGRESS (VERSUS)
   */
  async function updateProgress(filledCount, totalEmptyToFill, errorsCount = 0) {
    if (!playerRef || !currentRoomId) return;
    const progress = totalEmptyToFill > 0
      ? Math.min(100, Math.round((filledCount / totalEmptyToFill) * 100))
      : 0;

    try {
      await playerRef.update({
        progress,
        filledCount,
        errors: errorsCount,
        lastActive: global.firebase.database.ServerValue.TIMESTAMP
      });
    } catch (e) {
      console.warn('Error al sincronizar progreso:', e);
    }
  }

  /**
   * SUBMIT VICTORY WITH ANTI-CHEAT HASH VALIDATION
   */
  async function submitVictory(completedBoardStr, elapsedTimeSeconds) {
    if (!currentRoomRef || !currentRoomData) {
      throw new Error('No hay una partida activa.');
    }

    const { solutionHash, solutionSalt, gameMode } = currentRoomData;
    const computedHash = await global.SudokuEngine.hashSolutionWithSalt(completedBoardStr, solutionSalt);

    if (computedHash !== solutionHash) {
      throw new Error('El tablero no coincide con la solución válida.');
    }

    const myUid = getPlayerUid();
    const myName = getPlayerName();

    const isCoop = gameMode === 'COOP';
    await currentRoomRef.update({
      status: 'FINISHED',
      winner: isCoop ? 'COOP_VICTORY' : myUid,
      winnerName: isCoop ? '¡Equipo!' : myName,
      finishTime: elapsedTimeSeconds
    });

    if (playerRef) {
      await playerRef.update({
        progress: 100,
        filledCount: 81
      });
    }

    return true;
  }

  /**
   * RESTART / REMATCH NEW GAME IN SAME ROOM
   */
  async function restartGame(newPuzzleData) {
    if (!currentRoomRef || !currentRoomData) return;
    const { uid } = await ensureAuth();

    const salt = global.SudokuEngine.generateSalt(16);
    const solutionHash = await global.SudokuEngine.hashSolutionWithSalt(newPuzzleData.solution, salt);

    const players = currentRoomData.players || {};
    const resetPlayers = {};
    for (const pid of Object.keys(players)) {
      resetPlayers[pid] = {
        ...players[pid],
        progress: 0,
        filledCount: 0,
        errors: 0,
        eliminated: false,
        lastActive: global.firebase.database.ServerValue.TIMESTAMP
      };
    }

    const initialSharedBoard = {};
    for (let i = 0; i < 81; i++) {
      const ch = newPuzzleData.puzzle[i];
      initialSharedBoard[i] = ch !== '.' && ch !== '0' ? parseInt(ch, 10) : 0;
    }

    await currentRoomRef.update({
      puzzle: newPuzzleData.puzzle,
      solutionHash: solutionHash,
      solutionSalt: salt,
      cluesCount: newPuzzleData.cluesCount,
      difficulty: newPuzzleData.difficulty,
      difficultyScore: newPuzzleData.difficultyScore || 0,
      highestTechnique: newPuzzleData.highestTechnique || 'Naked Single',
      status: 'PLAYING',
      sharedErrors: 0,
      sharedBoard: initialSharedBoard,
      lastMove: null,
      startedAt: global.firebase.database.ServerValue.TIMESTAMP,
      winner: null,
      winnerName: null,
      finishTime: null,
      players: resetPlayers
    });
  }

  /**
   * LEAVE / ABANDON ROOM
   */
  async function leaveRoom() {
    if (currentRoomRef && currentRoomId) {
      const myUid = getPlayerUid();
      try {
        if (currentRoomData && currentRoomData.status === 'PLAYING') {
          await currentRoomRef.update({
            status: 'ABANDONED'
          });
        }
        if (playerRef) {
          await playerRef.update({
            connected: false,
            lastActive: global.firebase.database.ServerValue.TIMESTAMP
          });
        }
      } catch (e) {
        console.warn('Error saliendo de la sala:', e);
      }
    }
    cleanup();
  }

  function cleanup() {
    if (currentRoomRef) {
      currentRoomRef.off();
      currentRoomRef = null;
    }
    currentRoomId = null;
    playerRef = null;
    currentRoomData = null;
    isHost = false;
    lastProcessedMoveTimestamp = 0;
  }

  const MultiplayerService = {
    getPlayerUid,
    getPlayerName,
    setPlayerName,
    createRoom,
    joinRoom,
    leaveRoom,
    restartGame,
    updateProgress,
    makeCoopMove,
    reportCoopError,
    reportVersusError,
    submitVictory,
    getSynchronizedServerTime,
    getElapsedTimeSeconds,
    getRoomId: () => currentRoomId,
    getRoomData: () => currentRoomData,
    isHost: () => isHost,
    on,
    off
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = MultiplayerService;
  } else {
    global.MultiplayerService = MultiplayerService;
  }

})(typeof window !== 'undefined' ? window : self);
