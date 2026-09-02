/**
 * MULTIPLAYER SYNCHRONIZATION ENGINE WITH FIREBASE REALTIME DATABASE
 *
 * Manages:
 * - Room creation and joining with 6-char codes.
 * - Anonymous authentication & persistent player identity.
 * - Live state synchronization (Room, Players, Progress, Timer).
 * - Millisecond-accurate server time synchronization (.info/serverTimeOffset).
 * - Real-time presence detection (.info/connected & onDisconnect).
 * - Anti-cheat SHA-256 victory validation.
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

  // Room Code Generator (A-Z, 2-9 avoiding ambiguous characters 0/O, 1/I)
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
          console.error(`Error in multiplayer listener for "${event}":`, e);
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
   * CREATE ROOM
   */
  async function createRoom(difficulty, puzzleData) {
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
      lastActive: global.firebase.database.ServerValue.TIMESTAMP
    };

    const roomPayload = {
      id: roomId,
      difficulty: difficulty,
      puzzle: puzzleData.puzzle,
      solutionHash: solutionHash,
      solutionSalt: salt,
      cluesCount: puzzleData.cluesCount,
      difficultyScore: puzzleData.difficultyScore || 0,
      highestTechnique: puzzleData.highestTechnique || 'Naked Single',
      status: 'WAITING',
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

    setupPresence(db, roomId, uid);
    attachRoomListener(roomRef, uid);

    return {
      roomId,
      puzzleData
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

      // Check status transitions
      if (room.status === 'PLAYING') {
        emit('game_started', room);
      } else if (room.status === 'FINISHED') {
        emit('game_finished', {
          winner: room.winner,
          winnerName: room.winnerName,
          finishTime: room.finishTime,
          isWinner: room.winner === myUid,
          room
        });
      } else if (room.status === 'ABANDONED') {
        emit('room_abandoned', { reason: 'El otro jugador abandonó la partida.', room });
      }
    });
  }

  /**
   * UPDATE MY PLAYER PROGRESS
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

    const { solutionHash, solutionSalt } = currentRoomData;
    const computedHash = await global.SudokuEngine.hashSolutionWithSalt(completedBoardStr, solutionSalt);

    if (computedHash !== solutionHash) {
      throw new Error('El tablero no coincide con la solución válida.');
    }

    const myUid = getPlayerUid();
    const myName = getPlayerName();

    await currentRoomRef.update({
      status: 'FINISHED',
      winner: myUid,
      winnerName: myName,
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
        lastActive: global.firebase.database.ServerValue.TIMESTAMP
      };
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
