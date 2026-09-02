/**
 * APP CONTROLLER & UI INTERACTION MANAGER
 * Handles views, user inputs, sound synthesis, undo/redo, pencil notes,
 * 3-strike error system, and COOPERATIVE / VERSUS multiplayer modes.
 */

(function () {
  'use strict';

  // --- AUDIO SYNTHESIZER (WEB AUDIO API) ---
  const SoundFX = (function () {
    let audioCtx = null;
    let enabled = true;

    function getContext() {
      if (!audioCtx && (window.AudioContext || window.webkitAudioContext)) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        audioCtx = new AudioContextClass();
      }
      if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume();
      }
      return audioCtx;
    }

    function playTone(freq, type = 'sine', duration = 0.08, gainVal = 0.15) {
      if (!enabled) return;
      try {
        const ctx = getContext();
        if (!ctx) return;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, ctx.currentTime);
        gain.gain.setValueAtTime(gainVal, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + duration);
      } catch (e) {
        // Audio error silently ignored
      }
    }

    return {
      toggleSound: () => {
        enabled = !enabled;
        return enabled;
      },
      isEnabled: () => enabled,
      select: () => playTone(600, 'sine', 0.04, 0.08),
      place: () => playTone(880, 'triangle', 0.09, 0.12),
      partnerPlace: () => playTone(1046.5, 'sine', 0.12, 0.15),
      erase: () => playTone(300, 'sine', 0.05, 0.08),
      pencil: () => playTone(520, 'sine', 0.03, 0.05),
      error: () => playTone(180, 'sawtooth', 0.22, 0.25),
      victory: () => {
        if (!enabled) return;
        const notes = [523.25, 659.25, 783.99, 1046.5];
        notes.forEach((freq, i) => {
          setTimeout(() => playTone(freq, 'triangle', 0.25, 0.2), i * 120);
        });
      },
      defeat: () => {
        if (!enabled) return;
        const notes = [587.33, 523.25, 466.16, 415.3];
        notes.forEach((freq, i) => {
          setTimeout(() => playTone(freq, 'sawtooth', 0.3, 0.15), i * 150);
        });
      }
    };
  })();

  // --- APPLICATION STATE ---
  const State = {
    mode: 'SOLO', // 'SOLO' | 'MULTIPLAYER'
    multiplayerGameMode: 'COOP', // 'COOP' | 'VERSUS'
    difficulty: 'EXPERTO', // 'EXPERTO' | 'EXTREMO' | 'IMPOSIBLE'
    initialBoard: new Uint8Array(81),
    currentBoard: new Uint8Array(81),
    solutionBoard: new Uint8Array(81),
    candidatesGrid: Array.from({ length: 81 }, () => new Set()),
    selectedCell: null,
    pencilMode: false,
    undoStack: [],
    redoStack: [],
    timerInterval: null,
    startedAt: null,
    elapsedSeconds: 0,
    errorsCount: 0,
    maxErrors: 3,
    isGameActive: false,
    emptyCellsToFill: 0,
    worker: null,
    metadata: {}
  };

  // --- DOM ELEMENTS ---
  const DOM = {};

  function cacheDOM() {
    DOM.views = {
      lobby: document.getElementById('view-lobby'),
      waiting: document.getElementById('view-waiting'),
      game: document.getElementById('view-game')
    };

    // Header
    DOM.btnSound = document.getElementById('btn-sound');
    DOM.btnSettings = document.getElementById('btn-settings');

    // Lobby
    DOM.inputNickname = document.getElementById('input-nickname');
    DOM.modeCards = document.querySelectorAll('.mode-card');
    DOM.diffCards = document.querySelectorAll('.diff-card');
    DOM.btnSoloPlay = document.getElementById('btn-solo-play');
    DOM.btnCreateRoom = document.getElementById('btn-create-room');
    DOM.btnCreateIcon = document.getElementById('btn-create-icon');
    DOM.btnCreateText = document.getElementById('btn-create-text');
    DOM.inputJoinCode = document.getElementById('input-join-code');
    DOM.btnJoinRoom = document.getElementById('btn-join-room');

    // Waiting Room
    DOM.displayRoomCode = document.getElementById('display-room-code');
    DOM.btnCopyCode = document.getElementById('btn-copy-code');
    DOM.btnShareRoom = document.getElementById('btn-share-room');
    DOM.waitingDiffBadge = document.getElementById('waiting-diff-badge');
    DOM.waitingModeBadge = document.getElementById('waiting-mode-badge');
    DOM.slotHostName = document.getElementById('slot-host-name');
    DOM.slotGuestName = document.getElementById('slot-guest-name');
    DOM.slotGuestCard = document.getElementById('slot-guest-card');
    DOM.btnStartMultiplayer = document.getElementById('btn-start-multiplayer');
    DOM.btnLeaveWaiting = document.getElementById('btn-leave-waiting');

    // Game HUD
    DOM.gameDiffBadge = document.getElementById('game-diff-badge');
    DOM.gameModeBadge = document.getElementById('game-mode-badge');
    DOM.gameTimer = document.getElementById('game-timer');
    DOM.hudErrorsBox = document.getElementById('hud-errors-box');
    DOM.hudErrorsCount = document.getElementById('hud-errors-count');
    DOM.myProgressFill = document.getElementById('my-progress-fill');
    DOM.myProgressText = document.getElementById('my-progress-text');
    DOM.myNameTag = document.getElementById('my-name-tag');
    DOM.opponentProgressContainer = document.getElementById('opponent-progress-container');
    DOM.opponentProgressFill = document.getElementById('opponent-progress-fill');
    DOM.opponentProgressText = document.getElementById('opponent-progress-text');
    DOM.opponentNameTag = document.getElementById('opponent-name-tag');
    DOM.opponentStatusDot = document.getElementById('opponent-status-dot');

    // Board & Controls
    DOM.sudokuGrid = document.getElementById('sudoku-grid');
    DOM.btnUndo = document.getElementById('btn-undo');
    DOM.btnRedo = document.getElementById('btn-redo');
    DOM.btnErase = document.getElementById('btn-erase');
    DOM.btnPencil = document.getElementById('btn-pencil');
    DOM.btnAbandonGame = document.getElementById('btn-abandon-game');
    DOM.numpadButtons = document.querySelectorAll('.num-btn');

    // Modals
    DOM.modalGameOver = document.getElementById('modal-game-over');
    DOM.modalGameOverIcon = document.getElementById('game-over-icon');
    DOM.modalGameOverTitle = document.getElementById('game-over-title');
    DOM.modalGameOverSub = document.getElementById('game-over-subtitle');
    DOM.modalStatTime = document.getElementById('stat-time');
    DOM.modalStatDiff = document.getElementById('stat-diff');
    DOM.modalStatTech = document.getElementById('stat-tech');
    DOM.modalStatScore = document.getElementById('stat-score');
    DOM.btnRematch = document.getElementById('btn-rematch');
    DOM.btnGameOverMenu = document.getElementById('btn-game-over-menu');

    DOM.modalLoading = document.getElementById('modal-loading');
    DOM.loadingText = document.getElementById('loading-text');
    DOM.loadingProgressBar = document.getElementById('loading-progress-bar');

    DOM.modalSettings = document.getElementById('modal-settings');
    DOM.inputApiKey = document.getElementById('setting-api-key');
    DOM.inputDbUrl = document.getElementById('setting-db-url');
    DOM.inputProjectId = document.getElementById('setting-project-id');
    DOM.btnSaveSettings = document.getElementById('btn-save-settings');
    DOM.btnCloseSettings = document.getElementById('btn-close-settings');
    DOM.toastContainer = document.getElementById('toast-container');
  }

  // --- VIEW SWITCHER ---
  function showView(viewName) {
    Object.keys(DOM.views).forEach(key => {
      if (DOM.views[key]) {
        DOM.views[key].classList.toggle('active', key === viewName);
      }
    });
  }

  // --- TOAST NOTIFICATIONS ---
  function showToast(msg, icon = 'ℹ️') {
    if (!DOM.toastContainer) return;
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `<span>${icon}</span><span>${msg}</span>`;
    DOM.toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      setTimeout(() => toast.remove(), 300);
    }, 3200);
  }

  // --- WORKER / GENERATOR SETUP ---
  function initWorker() {
    if (window.Worker) {
      try {
        State.worker = new Worker('sudoku-worker.js');
        State.worker.onmessage = handleWorkerMessage;
      } catch (e) {
        console.warn('Worker no disponible, usando generador síncrono:', e);
        State.worker = null;
      }
    }
  }

  let activeWorkerCallback = null;

  function handleWorkerMessage(e) {
    const { type, status, percent, result, error } = e.data;
    if (type === 'PROGRESS') {
      if (DOM.loadingText) DOM.loadingText.textContent = status || 'Generando Sudoku...';
      if (DOM.loadingProgressBar) DOM.loadingProgressBar.style.width = (percent || 10) + '%';
    } else if (type === 'PUZZLE_GENERATED') {
      hideLoadingModal();
      if (activeWorkerCallback) {
        activeWorkerCallback(null, result);
        activeWorkerCallback = null;
      }
    } else if (type === 'ERROR') {
      hideLoadingModal();
      if (activeWorkerCallback) {
        activeWorkerCallback(error || 'Error de generación');
        activeWorkerCallback = null;
      }
    }
  }

  function showLoadingModal(title = 'Generando Sudoku...') {
    if (DOM.loadingText) DOM.loadingText.textContent = title;
    if (DOM.loadingProgressBar) DOM.loadingProgressBar.style.width = '10%';
    if (DOM.modalLoading) DOM.modalLoading.classList.add('active');
  }

  function hideLoadingModal() {
    if (DOM.modalLoading) DOM.modalLoading.classList.remove('active');
  }

  function requestPuzzleGeneration(difficulty, callback) {
    showLoadingModal(`Generando Sudoku ${difficulty}...`);

    if (State.worker) {
      activeWorkerCallback = callback;
      State.worker.postMessage({
        type: 'GENERATE_PUZZLE',
        targetDifficulty: difficulty,
        id: Date.now()
      });
    } else {
      setTimeout(() => {
        try {
          const result = window.SudokuEngine.generatePuzzle(difficulty);
          hideLoadingModal();
          callback(null, result);
        } catch (err) {
          hideLoadingModal();
          callback(err.message || 'Error generando Sudoku');
        }
      }, 50);
    }
  }

  // --- SUDOKU BOARD RENDERING ---
  function buildBoardGrid() {
    if (!DOM.sudokuGrid) return;
    DOM.sudokuGrid.innerHTML = '';

    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        const index = r * 9 + c;
        const cell = document.createElement('div');
        cell.className = 'cell';
        cell.dataset.index = index;
        cell.dataset.row = r;
        cell.dataset.col = c;
        cell.dataset.box = Math.floor(r / 3) * 3 + Math.floor(c / 3);

        // Candidates Mini-Grid
        const candGrid = document.createElement('div');
        candGrid.className = 'candidates-grid';
        for (let d = 1; d <= 9; d++) {
          const digitSpan = document.createElement('span');
          digitSpan.className = 'candidate-digit';
          digitSpan.dataset.digit = d;
          digitSpan.textContent = d;
          candGrid.appendChild(digitSpan);
        }
        cell.appendChild(candGrid);

        cell.addEventListener('click', () => handleCellClick(index));
        DOM.sudokuGrid.appendChild(cell);
      }
    }
  }

  function updateBoardUI() {
    const cells = DOM.sudokuGrid.querySelectorAll('.cell');
    const selectedIdx = State.selectedCell;
    const selectedVal = selectedIdx !== null ? State.currentBoard[selectedIdx] : 0;
    const selRow = selectedIdx !== null ? Math.floor(selectedIdx / 9) : -1;
    const selCol = selectedIdx !== null ? (selectedIdx % 9) : -1;
    const selBox = selectedIdx !== null ? Math.floor(selRow / 3) * 3 + Math.floor(selCol / 3) : -1;

    for (let i = 0; i < 81; i++) {
      const cell = cells[i];
      const val = State.currentBoard[i];
      const isInitial = State.initialBoard[i] !== 0;
      const r = Math.floor(i / 9);
      const c = i % 9;
      const b = Math.floor(r / 3) * 3 + Math.floor(c / 3);

      cell.classList.remove('selected', 'highlighted', 'same-digit', 'initial');

      if (isInitial) {
        cell.classList.add('initial');
      }

      if (i === selectedIdx) {
        cell.classList.add('selected');
      } else if (selectedIdx !== null) {
        if (r === selRow || c === selCol || b === selBox) {
          cell.classList.add('highlighted');
        }
        if (selectedVal !== 0 && val === selectedVal) {
          cell.classList.add('same-digit');
        }
      }

      // Cell text or candidates
      const candGrid = cell.querySelector('.candidates-grid');
      let textNode = null;
      for (let n = 0; n < cell.childNodes.length; n++) {
        if (cell.childNodes[n].nodeType === Node.TEXT_NODE) {
          textNode = cell.childNodes[n];
          break;
        }
      }

      if (val !== 0) {
        candGrid.style.display = 'none';
        if (textNode) {
          textNode.textContent = val;
        } else {
          cell.appendChild(document.createTextNode(val));
        }
      } else {
        if (textNode) textNode.textContent = '';
        candGrid.style.display = 'grid';
        const candSpans = candGrid.querySelectorAll('.candidate-digit');
        const cands = State.candidatesGrid[i];
        for (let d = 1; d <= 9; d++) {
          candSpans[d - 1].classList.toggle('visible', cands && cands.has(d));
        }
      }
    }

    updateNumpadState();
    updateProgressUI();
    updateErrorsUI();
  }

  function updateNumpadState() {
    const counts = new Array(10).fill(0);
    for (let i = 0; i < 81; i++) {
      const val = State.currentBoard[i];
      if (val >= 1 && val <= 9) counts[val]++;
    }

    DOM.numpadButtons.forEach(btn => {
      const digit = parseInt(btn.dataset.num, 10);
      btn.classList.toggle('completed', counts[digit] >= 9);
    });
  }

  function updateErrorsUI() {
    if (DOM.hudErrorsCount) {
      DOM.hudErrorsCount.textContent = `${State.errorsCount} / ${State.maxErrors}`;
    }
  }

  function handleCellClick(index) {
    if (!State.isGameActive) return;
    State.selectedCell = index;
    SoundFX.select();
    updateBoardUI();
  }

  // --- DIGIT INPUT & STRICT 3-STRIKE ERROR VALIDATION ---
  function placeDigit(digit) {
    if (!State.isGameActive || State.selectedCell === null) return;
    const idx = State.selectedCell;

    // Initial clues or already filled cells cannot be edited
    if (State.initialBoard[idx] !== 0 || State.currentBoard[idx] !== 0) return;

    if (State.pencilMode) {
      // Toggle note / candidate
      pushUndoState();
      if (State.candidatesGrid[idx].has(digit)) {
        State.candidatesGrid[idx].delete(digit);
      } else {
        State.candidatesGrid[idx].add(digit);
      }
      SoundFX.pencil();
      updateBoardUI();
      return;
    }

    // STRICT VALIDATION AGAINST SOLUTION
    const correctVal = State.solutionBoard[idx];

    if (correctVal !== 0 && digit !== correctVal) {
      // INCORRECT DIGIT -> STRIKE ERROR!
      State.errorsCount++;
      SoundFX.error();

      // Visual feedback on cell
      const cells = DOM.sudokuGrid.querySelectorAll('.cell');
      if (cells[idx]) {
        cells[idx].classList.add('conflict');
        setTimeout(() => cells[idx].classList.remove('conflict'), 500);
      }

      // Shake error HUD
      if (DOM.hudErrorsBox) {
        DOM.hudErrorsBox.classList.add('shake');
        setTimeout(() => DOM.hudErrorsBox.classList.remove('shake'), 400);
      }

      updateErrorsUI();
      showToast(`¡Número incorrecto para esta casilla! (${State.errorsCount}/${State.maxErrors})`, '❌');

      // Sync error across multiplayer
      if (State.mode === 'MULTIPLAYER') {
        if (State.multiplayerGameMode === 'COOP') {
          window.MultiplayerService.reportCoopError();
        } else {
          window.MultiplayerService.reportVersusError(State.errorsCount);
        }
      }

      // Check if 3 strikes reached -> DEFEAT
      if (State.errorsCount >= State.maxErrors) {
        State.isGameActive = false;
        stopTimer();
        showGameOverModal({
          isWinner: false,
          isDefeatByErrors: true,
          finishTime: State.elapsedSeconds
        });
      }

      return;
    }

    // CORRECT DIGIT PLACEMENT!
    pushUndoState();
    State.currentBoard[idx] = digit;
    State.candidatesGrid[idx].clear();

    // Auto candidate elimination from peers
    const r = Math.floor(idx / 9);
    const c = idx % 9;
    const b = Math.floor(r / 3) * 3 + Math.floor(c / 3);

    for (let i = 0; i < 81; i++) {
      if (i !== idx && State.currentBoard[i] === 0) {
        const pr = Math.floor(i / 9);
        const pc = i % 9;
        const pb = Math.floor(pr / 3) * 3 + Math.floor(pc / 3);
        if (pr === r || pc === c || pb === b) {
          State.candidatesGrid[i].delete(digit);
        }
      }
    }

    SoundFX.place();
    updateBoardUI();

    // If in Coop mode, broadcast move to partner
    if (State.mode === 'MULTIPLAYER' && State.multiplayerGameMode === 'COOP') {
      window.MultiplayerService.makeCoopMove(idx, digit);
    } else {
      broadcastProgress();
    }

    checkWinCondition();
  }

  function eraseSelectedCell() {
    if (!State.isGameActive || State.selectedCell === null) return;
    const idx = State.selectedCell;
    if (State.initialBoard[idx] !== 0) return;

    // In strict mode, correct numbers once placed are locked, but pencil notes can be erased
    if (State.candidatesGrid[idx].size > 0) {
      pushUndoState();
      State.candidatesGrid[idx].clear();
      SoundFX.erase();
      updateBoardUI();
    }
  }

  // --- UNDO / REDO ---
  function pushUndoState() {
    State.undoStack.push({
      board: new Uint8Array(State.currentBoard),
      candidates: State.candidatesGrid.map(set => new Set(set)),
      selectedCell: State.selectedCell
    });
    State.redoStack = [];
    if (State.undoStack.length > 50) State.undoStack.shift();
  }

  function undo() {
    if (!State.isGameActive || State.undoStack.length === 0) return;
    const snapshot = State.undoStack.pop();
    State.redoStack.push({
      board: new Uint8Array(State.currentBoard),
      candidates: State.candidatesGrid.map(set => new Set(set)),
      selectedCell: State.selectedCell
    });
    State.currentBoard = new Uint8Array(snapshot.board);
    State.candidatesGrid = snapshot.candidates.map(set => new Set(set));
    State.selectedCell = snapshot.selectedCell;
    SoundFX.select();
    updateBoardUI();
    broadcastProgress();
  }

  function redo() {
    if (!State.isGameActive || State.redoStack.length === 0) return;
    const snapshot = State.redoStack.pop();
    State.undoStack.push({
      board: new Uint8Array(State.currentBoard),
      candidates: State.candidatesGrid.map(set => new Set(set)),
      selectedCell: State.selectedCell
    });
    State.currentBoard = new Uint8Array(snapshot.board);
    State.candidatesGrid = snapshot.candidates.map(set => new Set(set));
    State.selectedCell = snapshot.selectedCell;
    SoundFX.select();
    updateBoardUI();
    broadcastProgress();
  }

  // --- TIMER & PROGRESS ---
  function startTimer(customStartTime = null) {
    stopTimer();
    State.startedAt = customStartTime || (window.MultiplayerService ? window.MultiplayerService.getSynchronizedServerTime() : Date.now());
    State.timerInterval = setInterval(() => {
      const now = window.MultiplayerService ? window.MultiplayerService.getSynchronizedServerTime() : Date.now();
      State.elapsedSeconds = Math.max(0, Math.floor((now - State.startedAt) / 1000));
      updateTimerDisplay();
    }, 500);
    updateTimerDisplay();
  }

  function stopTimer() {
    if (State.timerInterval) {
      clearInterval(State.timerInterval);
      State.timerInterval = null;
    }
  }

  function formatTime(totalSec) {
    const mins = Math.floor(totalSec / 60).toString().padStart(2, '0');
    const secs = (totalSec % 60).toString().padStart(2, '0');
    return `${mins}:${secs}`;
  }

  function updateTimerDisplay() {
    if (DOM.gameTimer) {
      DOM.gameTimer.textContent = formatTime(State.elapsedSeconds);
    }
  }

  function updateProgressUI() {
    let filled = 0;
    for (let i = 0; i < 81; i++) {
      if (State.initialBoard[i] === 0 && State.currentBoard[i] !== 0) {
        filled++;
      }
    }

    const totalEmpty = State.emptyCellsToFill || 55;
    const percent = totalEmpty > 0 ? Math.min(100, Math.round((filled / totalEmpty) * 100)) : 0;

    if (DOM.myProgressFill) DOM.myProgressFill.style.width = percent + '%';
    if (DOM.myProgressText) {
      const label = State.multiplayerGameMode === 'COOP' ? 'Equipo' : 'Progreso';
      DOM.myProgressText.textContent = `${percent}% (${filled}/${totalEmpty})`;
    }
  }

  function broadcastProgress() {
    if (State.mode !== 'MULTIPLAYER' || State.multiplayerGameMode !== 'VERSUS') return;
    let filled = 0;
    for (let i = 0; i < 81; i++) {
      if (State.initialBoard[i] === 0 && State.currentBoard[i] !== 0) {
        filled++;
      }
    }
    if (window.MultiplayerService) {
      window.MultiplayerService.updateProgress(filled, State.emptyCellsToFill, State.errorsCount);
    }
  }

  // --- VICTORY & GAME OVER ---
  async function checkWinCondition() {
    for (let i = 0; i < 81; i++) {
      if (State.currentBoard[i] === 0) return;
    }

    State.isGameActive = false;
    stopTimer();

    const boardStr = window.SudokuEngine.boardToString(State.currentBoard);

    if (State.mode === 'MULTIPLAYER') {
      try {
        await window.MultiplayerService.submitVictory(boardStr, State.elapsedSeconds);
      } catch (err) {
        showToast(err.message || 'Error validando victoria.', '❌');
      }
    } else {
      SoundFX.victory();
      showGameOverModal({
        isWinner: true,
        winnerName: window.MultiplayerService.getPlayerName(),
        finishTime: State.elapsedSeconds
      });
    }
  }

  function showGameOverModal(data) {
    if (!DOM.modalGameOver) return;
    const isWinner = data.isWinner;
    const isDefeatByErrors = data.isDefeatByErrors;
    const isCoop = State.mode === 'MULTIPLAYER' && State.multiplayerGameMode === 'COOP';

    if (isDefeatByErrors) {
      DOM.modalGameOverIcon.textContent = '💀';
      DOM.modalGameOverTitle.textContent = isCoop ? '¡DERROTA EN EQUIPO!' : 'PARTIDA PERDIDA';
      DOM.modalGameOverSub.textContent = isCoop
        ? 'Han alcanzado el límite de 3 errores compartidos.'
        : 'Has cometido 3 errores. ¡Más suerte en la próxima!';
      SoundFX.defeat();
    } else if (isWinner) {
      DOM.modalGameOverIcon.textContent = '🏆';
      DOM.modalGameOverTitle.textContent = isCoop ? '¡VICTORIA EN EQUIPO!' : '¡HAS GANADO!';
      DOM.modalGameOverSub.textContent = isCoop
        ? '¡Increíble trabajo en pareja! Han completado el Sudoku juntos.'
        : '¡Felicitaciones! Has resuelto el Sudoku con maestría.';
      SoundFX.victory();
    } else {
      DOM.modalGameOverIcon.textContent = '🥈';
      DOM.modalGameOverTitle.textContent = 'PARTIDA TERMINADA';
      DOM.modalGameOverSub.textContent = `${data.winnerName || 'El rival'} terminó el Sudoku primero.`;
      SoundFX.defeat();
    }

    DOM.modalStatTime.textContent = formatTime(data.finishTime || State.elapsedSeconds);
    DOM.modalStatDiff.textContent = State.difficulty;
    DOM.modalStatTech.textContent = State.metadata.highestTechnique || 'Avanzada';
    DOM.modalStatScore.textContent = State.metadata.difficultyScore || '—';

    DOM.modalGameOver.classList.add('active');
  }

  function hideGameOverModal() {
    if (DOM.modalGameOver) DOM.modalGameOver.classList.remove('active');
  }

  // --- START GAME WORKFLOW ---
  function startNewGame(puzzleData, mode = 'SOLO', roomData = null) {
    State.mode = mode;
    State.multiplayerGameMode = (roomData && roomData.gameMode) ? roomData.gameMode : State.multiplayerGameMode;
    State.difficulty = puzzleData.difficulty || 'EXPERTO';
    State.initialBoard = window.SudokuEngine.parseBoard(puzzleData.puzzle);
    State.currentBoard = new Uint8Array(State.initialBoard);

    // Compute canonical solution locally if not provided
    if (puzzleData.solution) {
      State.solutionBoard = window.SudokuEngine.parseBoard(puzzleData.solution);
    } else {
      const solRes = window.SudokuEngine.solveUnique(State.initialBoard);
      State.solutionBoard = solRes.solution ? solRes.solution : new Uint8Array(81);
    }

    // In COOP mode, if room already has shared board with filled cells, initialize with it
    if (roomData && roomData.gameMode === 'COOP' && roomData.sharedBoard) {
      for (let i = 0; i < 81; i++) {
        if (roomData.sharedBoard[i] && roomData.sharedBoard[i] !== 0) {
          State.currentBoard[i] = roomData.sharedBoard[i];
        }
      }
    }

    State.candidatesGrid = Array.from({ length: 81 }, () => new Set());
    State.selectedCell = null;
    State.pencilMode = false;
    State.undoStack = [];
    State.redoStack = [];
    State.errorsCount = (roomData && roomData.gameMode === 'COOP' && roomData.sharedErrors) ? roomData.sharedErrors : 0;
    State.isGameActive = true;
    State.metadata = {
      difficultyScore: puzzleData.difficultyScore || 0,
      highestTechnique: puzzleData.highestTechnique || 'Naked Single'
    };

    let emptyCount = 0;
    for (let i = 0; i < 81; i++) {
      if (State.initialBoard[i] === 0) emptyCount++;
    }
    State.emptyCellsToFill = emptyCount;

    // Update HUD Badges
    if (DOM.gameDiffBadge) {
      DOM.gameDiffBadge.textContent = State.difficulty;
      DOM.gameDiffBadge.className = `difficulty-badge diff-${State.difficulty}`;
    }

    if (DOM.gameModeBadge) {
      if (mode === 'MULTIPLAYER') {
        DOM.gameModeBadge.style.display = 'inline-block';
        if (State.multiplayerGameMode === 'COOP') {
          DOM.gameModeBadge.textContent = '🤝 COOP';
          DOM.gameModeBadge.style.borderColor = 'var(--accent-emerald)';
          DOM.gameModeBadge.style.color = 'var(--accent-emerald)';
        } else {
          DOM.gameModeBadge.textContent = '⚔️ DUELO';
          DOM.gameModeBadge.style.borderColor = 'var(--primary)';
          DOM.gameModeBadge.style.color = 'var(--primary)';
        }
      } else {
        DOM.gameModeBadge.style.display = 'none';
      }
    }

    if (DOM.myNameTag) {
      DOM.myNameTag.textContent = State.multiplayerGameMode === 'COOP' ? 'Tablero Compartido' : window.MultiplayerService.getPlayerName();
    }

    if (mode === 'MULTIPLAYER' && State.multiplayerGameMode === 'VERSUS') {
      DOM.opponentProgressContainer.style.display = 'flex';
      DOM.btnAbandonGame.textContent = 'Abandonar partida';
    } else {
      DOM.opponentProgressContainer.style.display = 'none';
      DOM.btnAbandonGame.textContent = mode === 'MULTIPLAYER' ? 'Salir de la sala' : 'Salir al menú';
    }

    buildBoardGrid();
    updateBoardUI();
    hideGameOverModal();
    showView('game');

    const startTime = (roomData && roomData.startedAt) ? roomData.startedAt : Date.now();
    startTimer(startTime);
  }

  // --- MULTIPLAYER EVENT BINDINGS ---
  function setupMultiplayerListeners() {
    const MP = window.MultiplayerService;
    if (!MP) return;

    MP.on('room_update', room => {
      if (DOM.displayRoomCode) DOM.displayRoomCode.textContent = room.id;
      if (DOM.waitingDiffBadge) {
        DOM.waitingDiffBadge.textContent = room.difficulty;
        DOM.waitingDiffBadge.className = `difficulty-badge diff-${room.difficulty}`;
      }
      if (DOM.waitingModeBadge) {
        DOM.waitingModeBadge.textContent = room.gameMode === 'COOP' ? '🤝 COOP' : '⚔️ DUELO';
      }

      const players = room.players || {};
      const pKeys = Object.keys(players);
      const hostUid = room.hostId;
      const guestUid = pKeys.find(id => id !== hostUid);

      if (DOM.slotHostName) {
        DOM.slotHostName.textContent = players[hostUid] ? players[hostUid].name : 'Anfitrión';
      }

      if (guestUid && players[guestUid]) {
        if (DOM.slotGuestName) DOM.slotGuestName.textContent = players[guestUid].name;
        if (DOM.slotGuestCard) DOM.slotGuestCard.classList.add('ready');
        if (DOM.btnStartMultiplayer && MP.isHost()) {
          DOM.btnStartMultiplayer.style.display = 'flex';
        }
      } else {
        if (DOM.slotGuestName) {
          DOM.slotGuestName.textContent = room.gameMode === 'COOP' ? 'Esperando pareja...' : 'Esperando rival...';
        }
        if (DOM.slotGuestCard) DOM.slotGuestCard.classList.remove('ready');
        if (DOM.btnStartMultiplayer) DOM.btnStartMultiplayer.style.display = 'none';
      }
    });

    // COOP: Partner made a move!
    MP.on('coop_move_received', move => {
      if (State.mode === 'MULTIPLAYER' && State.multiplayerGameMode === 'COOP') {
        const { cellIndex, digit, playerName } = move;
        if (State.currentBoard[cellIndex] !== digit) {
          State.currentBoard[cellIndex] = digit;
          State.candidatesGrid[cellIndex].clear();

          // Auto candidate elimination from peers
          const r = Math.floor(cellIndex / 9);
          const c = cellIndex % 9;
          const b = Math.floor(r / 3) * 3 + Math.floor(c / 3);
          for (let i = 0; i < 81; i++) {
            if (i !== cellIndex && State.currentBoard[i] === 0) {
              const pr = Math.floor(i / 9);
              const pc = i % 9;
              const pb = Math.floor(pr / 3) * 3 + Math.floor(pc / 3);
              if (pr === r || pc === c || pb === b) {
                State.candidatesGrid[i].delete(digit);
              }
            }
          }

          SoundFX.partnerPlace();
          updateBoardUI();

          // Partner flash animation
          const cells = DOM.sudokuGrid.querySelectorAll('.cell');
          if (cells[cellIndex]) {
            cells[cellIndex].classList.add('partner-action');
            setTimeout(() => cells[cellIndex].classList.remove('partner-action'), 1200);
          }

          showToast(`🤝 ${playerName || 'Tu pareja'} colocó el ${digit}`, '✨');
          checkWinCondition();
        }
      }
    });

    // COOP: Shared errors update
    MP.on('coop_errors_update', data => {
      if (State.mode === 'MULTIPLAYER' && State.multiplayerGameMode === 'COOP') {
        if (data.errors > State.errorsCount) {
          SoundFX.error();
          if (DOM.hudErrorsBox) {
            DOM.hudErrorsBox.classList.add('shake');
            setTimeout(() => DOM.hudErrorsBox.classList.remove('shake'), 400);
          }
          showToast(`Error de equipo cometido (${data.errors}/${data.maxErrors})`, '⚠️');
        }
        State.errorsCount = data.errors;
        updateErrorsUI();
      }
    });

    // VERSUS: Opponent update
    MP.on('opponent_update', opp => {
      if (!opp) return;
      if (DOM.opponentNameTag) DOM.opponentNameTag.textContent = opp.name || 'Rival';
      if (DOM.opponentProgressFill) DOM.opponentProgressFill.style.width = (opp.progress || 0) + '%';
      if (DOM.opponentProgressText) DOM.opponentProgressText.textContent = `${opp.progress || 0}% (${opp.filledCount || 0}/${State.emptyCellsToFill})`;
      if (DOM.opponentStatusDot) {
        DOM.opponentStatusDot.className = `status-dot ${opp.connected ? 'online' : 'offline'}`;
      }
    });

    MP.on('game_started', room => {
      if (!State.isGameActive || State.mode !== 'MULTIPLAYER') {
        const puzzleData = {
          puzzle: room.puzzle,
          solution: null,
          difficulty: room.difficulty,
          cluesCount: room.cluesCount,
          difficultyScore: room.difficultyScore,
          highestTechnique: room.highestTechnique
        };
        startNewGame(puzzleData, 'MULTIPLAYER', room);
        showToast(room.gameMode === 'COOP' ? '¡Partida en pareja iniciada!' : '¡Duelo iniciado!', '⚔️');
      }
    });

    MP.on('game_finished', data => {
      State.isGameActive = false;
      stopTimer();
      showGameOverModal(data);
    });

    MP.on('room_abandoned', data => {
      showToast(data.reason || 'Partida abandonada.', '🚪');
      State.isGameActive = false;
      stopTimer();
      showView('lobby');
    });
  }

  // --- SETTINGS / FIREBASE MODAL ---
  function openSettingsModal() {
    const cfg = window.FirebaseService.getActiveConfig();
    if (DOM.inputApiKey) DOM.inputApiKey.value = cfg.apiKey || '';
    if (DOM.inputDbUrl) DOM.inputDbUrl.value = cfg.databaseURL || '';
    if (DOM.inputProjectId) DOM.inputProjectId.value = cfg.projectId || '';
    if (DOM.modalSettings) DOM.modalSettings.classList.add('active');
  }

  function closeSettingsModal() {
    if (DOM.modalSettings) DOM.modalSettings.classList.remove('active');
  }

  function saveSettings() {
    const config = {
      apiKey: DOM.inputApiKey.value.trim(),
      databaseURL: DOM.inputDbUrl.value.trim(),
      projectId: DOM.inputProjectId.value.trim()
    };

    if (window.FirebaseService.saveCustomConfig(config)) {
      window.FirebaseService.initFirebase();
      showToast('Configuración de Firebase guardada.', '✅');
      closeSettingsModal();
    }
  }

  // --- EVENT LISTENERS INITIALIZATION ---
  function initEvents() {
    // Nickname change
    if (DOM.inputNickname) {
      DOM.inputNickname.value = window.MultiplayerService.getPlayerName();
      DOM.inputNickname.addEventListener('change', () => {
        const updated = window.MultiplayerService.setPlayerName(DOM.inputNickname.value);
        DOM.inputNickname.value = updated;
        showToast(`Nombre actualizado: ${updated}`, '👤');
      });
    }

    // Multiplayer Mode selection (COOP vs VERSUS)
    DOM.modeCards.forEach(card => {
      card.addEventListener('click', () => {
        DOM.modeCards.forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        State.multiplayerGameMode = card.dataset.mode;
        SoundFX.select();

        if (State.multiplayerGameMode === 'COOP') {
          if (DOM.btnCreateIcon) DOM.btnCreateIcon.textContent = '🤝';
          if (DOM.btnCreateText) DOM.btnCreateText.textContent = 'CREAR SALA EN PAREJA';
        } else {
          if (DOM.btnCreateIcon) DOM.btnCreateIcon.textContent = '⚔️';
          if (DOM.btnCreateText) DOM.btnCreateText.textContent = 'CREAR SALA DUELO';
        }
      });
    });

    // Difficulty selection
    DOM.diffCards.forEach(card => {
      card.addEventListener('click', () => {
        DOM.diffCards.forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        State.difficulty = card.dataset.diff;
        SoundFX.select();
      });
    });

    // Sound toggle
    if (DOM.btnSound) {
      DOM.btnSound.addEventListener('click', () => {
        const enabled = SoundFX.toggleSound();
        DOM.btnSound.textContent = enabled ? '🔊' : '🔇';
        showToast(enabled ? 'Sonido activado' : 'Sonido desactivado');
      });
    }

    // Settings
    if (DOM.btnSettings) DOM.btnSettings.addEventListener('click', openSettingsModal);
    if (DOM.btnCloseSettings) DOM.btnCloseSettings.addEventListener('click', closeSettingsModal);
    if (DOM.btnSaveSettings) DOM.btnSaveSettings.addEventListener('click', saveSettings);

    // Solo Play Button
    if (DOM.btnSoloPlay) {
      DOM.btnSoloPlay.addEventListener('click', () => {
        SoundFX.select();
        requestPuzzleGeneration(State.difficulty, (err, puzzleData) => {
          if (err) {
            showToast(err, '❌');
            return;
          }
          startNewGame(puzzleData, 'SOLO');
        });
      });
    }

    // Create Multiplayer Room
    if (DOM.btnCreateRoom) {
      DOM.btnCreateRoom.addEventListener('click', () => {
        if (!window.FirebaseService.isConfigured()) {
          openSettingsModal();
          showToast('Por favor introduce tu configuración de Firebase para multijugador.', '⚙️');
          return;
        }

        SoundFX.select();
        requestPuzzleGeneration(State.difficulty, async (err, puzzleData) => {
          if (err) {
            showToast(err, '❌');
            return;
          }
          try {
            const { roomId } = await window.MultiplayerService.createRoom(State.difficulty, puzzleData, State.multiplayerGameMode);
            DOM.displayRoomCode.textContent = roomId;
            DOM.waitingDiffBadge.textContent = State.difficulty;
            DOM.waitingDiffBadge.className = `difficulty-badge diff-${State.difficulty}`;
            DOM.waitingModeBadge.textContent = State.multiplayerGameMode === 'COOP' ? '🤝 COOP' : '⚔️ DUELO';
            DOM.slotHostName.textContent = window.MultiplayerService.getPlayerName();
            DOM.slotGuestName.textContent = State.multiplayerGameMode === 'COOP' ? 'Esperando pareja...' : 'Esperando rival...';
            DOM.slotGuestCard.classList.remove('ready');
            DOM.btnStartMultiplayer.style.display = 'none';
            showView('waiting');
          } catch (e) {
            showToast(e.message || 'Error al crear la sala.', '❌');
          }
        });
      });
    }

    // Join Room Button
    if (DOM.btnJoinRoom) {
      DOM.btnJoinRoom.addEventListener('click', async () => {
        if (!window.FirebaseService.isConfigured()) {
          openSettingsModal();
          showToast('Por favor introduce tu configuración de Firebase para multijugador.', '⚙️');
          return;
        }

        const code = DOM.inputJoinCode ? DOM.inputJoinCode.value.trim() : '';
        if (code.length !== 6) {
          showToast('Introduce un código de 6 caracteres.', '⚠️');
          return;
        }

        SoundFX.select();
        try {
          showLoadingModal('Uniéndose a la sala...');
          const { roomId, roomData } = await window.MultiplayerService.joinRoom(code);
          hideLoadingModal();
          showToast(`¡Conectado a la sala ${roomId}!`, '🚀');

          if (roomData.status === 'PLAYING') {
            const puzzleData = {
              puzzle: roomData.puzzle,
              solution: null,
              difficulty: roomData.difficulty,
              cluesCount: roomData.cluesCount,
              difficultyScore: roomData.difficultyScore,
              highestTechnique: roomData.highestTechnique
            };
            startNewGame(puzzleData, 'MULTIPLAYER', roomData);
          } else {
            DOM.displayRoomCode.textContent = roomId;
            DOM.waitingDiffBadge.textContent = roomData.difficulty;
            DOM.waitingDiffBadge.className = `difficulty-badge diff-${roomData.difficulty}`;
            DOM.waitingModeBadge.textContent = roomData.gameMode === 'COOP' ? '🤝 COOP' : '⚔️ DUELO';
            showView('waiting');
          }
        } catch (e) {
          hideLoadingModal();
          showToast(e.message || 'Error al unirse.', '❌');
        }
      });
    }

    // Copy Room Code
    if (DOM.btnCopyCode) {
      DOM.btnCopyCode.addEventListener('click', () => {
        const code = DOM.displayRoomCode.textContent;
        if (navigator.clipboard) {
          navigator.clipboard.writeText(code).then(() => {
            showToast('¡Código de sala copiado!', '📋');
          });
        }
      });
    }

    // Share Room Link
    if (DOM.btnShareRoom) {
      DOM.btnShareRoom.addEventListener('click', () => {
        const code = DOM.displayRoomCode.textContent;
        const shareUrl = `${window.location.origin}${window.location.pathname}?room=${code}`;
        if (navigator.share) {
          navigator.share({
            title: 'Sudoku Online Multijugador',
            text: `¡Únete a mi partida de Sudoku multijugador! Código: ${code}`,
            url: shareUrl
          }).catch(() => {});
        } else if (navigator.clipboard) {
          navigator.clipboard.writeText(shareUrl).then(() => {
            showToast('¡Enlace de invitación copiado!', '🔗');
          });
        }
      });
    }

    // Start Multiplayer Button (Host manual force start)
    if (DOM.btnStartMultiplayer) {
      DOM.btnStartMultiplayer.addEventListener('click', async () => {
        const room = window.MultiplayerService.getRoomData();
        if (room) {
          const puzzleData = {
            puzzle: room.puzzle,
            solution: null,
            difficulty: room.difficulty,
            cluesCount: room.cluesCount,
            difficultyScore: room.difficultyScore,
            highestTechnique: room.highestTechnique
          };
          startNewGame(puzzleData, 'MULTIPLAYER', room);
        }
      });
    }

    // Leave Waiting Room
    if (DOM.btnLeaveWaiting) {
      DOM.btnLeaveWaiting.addEventListener('click', () => {
        window.MultiplayerService.leaveRoom();
        showView('lobby');
      });
    }

    // In-game Action Buttons
    if (DOM.btnUndo) DOM.btnUndo.addEventListener('click', undo);
    if (DOM.btnRedo) DOM.btnRedo.addEventListener('click', redo);
    if (DOM.btnErase) DOM.btnErase.addEventListener('click', eraseSelectedCell);

    if (DOM.btnPencil) {
      DOM.btnPencil.addEventListener('click', () => {
        State.pencilMode = !State.pencilMode;
        DOM.btnPencil.classList.toggle('active', State.pencilMode);
        SoundFX.pencil();
        showToast(State.pencilMode ? 'Modo Notas (Lápiz) activado' : 'Modo Números activado', '✏️');
      });
    }

    if (DOM.btnAbandonGame) {
      DOM.btnAbandonGame.addEventListener('click', () => {
        if (confirm('¿Estás seguro de que deseas salir de la partida?')) {
          if (State.mode === 'MULTIPLAYER') {
            window.MultiplayerService.leaveRoom();
          }
          State.isGameActive = false;
          stopTimer();
          showView('lobby');
        }
      });
    }

    // Numpad Digits
    DOM.numpadButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const digit = parseInt(btn.dataset.num, 10);
        placeDigit(digit);
      });
    });

    // Game Over Rematch
    if (DOM.btnRematch) {
      DOM.btnRematch.addEventListener('click', () => {
        hideGameOverModal();
        if (State.mode === 'MULTIPLAYER') {
          requestPuzzleGeneration(State.difficulty, async (err, puzzleData) => {
            if (!err) {
              await window.MultiplayerService.restartGame(puzzleData);
            }
          });
        } else {
          requestPuzzleGeneration(State.difficulty, (err, puzzleData) => {
            if (!err) startNewGame(puzzleData, 'SOLO');
          });
        }
      });
    }

    if (DOM.btnGameOverMenu) {
      DOM.btnGameOverMenu.addEventListener('click', () => {
        hideGameOverModal();
        if (State.mode === 'MULTIPLAYER') {
          window.MultiplayerService.leaveRoom();
        }
        showView('lobby');
      });
    }

    // Physical Keyboard Support
    window.addEventListener('keydown', e => {
      if (!State.isGameActive) return;

      if (e.key >= '1' && e.key <= '9') {
        placeDigit(parseInt(e.key, 10));
      } else if (e.key === 'Backspace' || e.key === 'Delete' || e.key === '0') {
        eraseSelectedCell();
      } else if (e.key === ' ' || e.key.toLowerCase() === 'n') {
        DOM.btnPencil.click();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      } else if (e.key.startsWith('Arrow') && State.selectedCell !== null) {
        e.preventDefault();
        let r = Math.floor(State.selectedCell / 9);
        let c = State.selectedCell % 9;
        if (e.key === 'ArrowUp') r = (r + 8) % 9;
        if (e.key === 'ArrowDown') r = (r + 1) % 9;
        if (e.key === 'ArrowLeft') c = (c + 8) % 9;
        if (e.key === 'ArrowRight') c = (c + 1) % 9;
        State.selectedCell = r * 9 + c;
        SoundFX.select();
        updateBoardUI();
      }
    });

    // Check URL parameters for direct room joining (e.g. ?room=X7K92P)
    const urlParams = new URLSearchParams(window.location.search);
    const roomParam = urlParams.get('room');
    if (roomParam && DOM.inputJoinCode) {
      DOM.inputJoinCode.value = roomParam.trim().toUpperCase();
      setTimeout(() => {
        if (DOM.btnJoinRoom) DOM.btnJoinRoom.click();
      }, 300);
    }
  }

  // --- INITIALIZATION ---
  function init() {
    cacheDOM();
    initWorker();
    setupMultiplayerListeners();
    initEvents();

    window.FirebaseService.initFirebase();
    showView('lobby');
  }

  document.addEventListener('DOMContentLoaded', init);

})();
