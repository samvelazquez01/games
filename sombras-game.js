/**
 * SOMBRAS DEL BOSQUE (CAMPAMENTO SOMBRÍO) - 2D MULTIPLAYER ENGINE
 * 
 * Top-down social deduction game:
 * - 4 to 10 players (or 1 player + 3 AI bots in solo mode).
 * - 1 or 2 Killers (Asesinos) configured by host.
 * - Visible, atmospheric night camp map with soft lighting mask & torchlight.
 * - Synchronized 5s Light / 3s Blackout cycles.
 * - Sliced character sprites with walking animations and corpse sprites.
 * - Collisions with 8 camp cabins, palisade perimeter & campfire.
 * - 6 interactive tasks with global progress tracking.
 * - Assassinations with 15s cooldown, dead body reporting, emergency meetings & voting exiles.
 * - Dramatic victory screens and final secret role reveals.
 */

(function (global) {
  'use strict';

  // --- AUDIO SYNTHESIS ENGINE ---
  const SombrasAudio = (function () {
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
      click: () => tone(520, 'sine', 0.05, 0.08),
      step: () => tone(120, 'triangle', 0.04, 0.04),
      lightOn: () => tone(880, 'sine', 0.15, 0.15),
      blackout: () => {
        tone(90, 'sawtooth', 0.4, 0.25);
        setTimeout(() => tone(60, 'sawtooth', 0.5, 0.2), 100);
      },
      kill: () => {
        tone(140, 'sawtooth', 0.3, 0.3);
        setTimeout(() => tone(70, 'sawtooth', 0.4, 0.3), 80);
      },
      alarm: () => {
        [440, 880, 440, 880].forEach((f, i) => {
          setTimeout(() => tone(f, 'sawtooth', 0.18, 0.25), i * 200);
        });
      },
      vote: () => tone(660, 'sine', 0.08, 0.12),
      win: () => {
        [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
          setTimeout(() => tone(f, 'triangle', 0.3, 0.2), i * 120);
        });
      },
      lose: () => {
        [400, 320, 250, 180].forEach((f, i) => {
          setTimeout(() => tone(f, 'sawtooth', 0.35, 0.25), i * 140);
        });
      }
    };
  })();

  // --- MAP & COLLISION GEOMETRY (1024 x 1024) ---
  const MAP_SIZE = 1024;
  const CAMPFIRE = { x: 512, y: 512, radius: 45 };

  // Cabin door lanterns for ambient lighting
  const LANTERNS = [
    { x: 512, y: 512, radius: 150, color: 'rgba(245, 158, 11, 0.8)' }, // Campfire
    { x: 512, y: 295, radius: 70, color: 'rgba(56, 189, 248, 0.5)' },  // North Clinic
    { x: 512, y: 690, radius: 70, color: 'rgba(245, 158, 11, 0.5)' },  // South Comms
    { x: 690, y: 495, radius: 70, color: 'rgba(245, 158, 11, 0.5)' },  // East Stables
    { x: 310, y: 495, radius: 70, color: 'rgba(245, 158, 11, 0.5)' },  // West Mess Hall
    { x: 640, y: 320, radius: 60, color: 'rgba(245, 158, 11, 0.5)' },  // NE Workshop
    { x: 360, y: 320, radius: 60, color: 'rgba(245, 158, 11, 0.5)' },  // NW Storage
    { x: 630, y: 680, radius: 60, color: 'rgba(16, 185, 129, 0.5)' },  // SE Greenhouse
    { x: 370, y: 680, radius: 60, color: 'rgba(245, 158, 11, 0.5)' }   // SW Dorm
  ];

  // 8 Cabins collision bounding boxes with open doorways
  const CABIN_WALLS = [
    // North Clinic (x: 410-614, y: 115-300) - Door at bottom center (x: 490-534)
    { x: 410, y: 115, w: 204, h: 16 },
    { x: 410, y: 115, w: 16, h: 185 },
    { x: 598, y: 115, w: 16, h: 185 },
    { x: 410, y: 284, w: 80, h: 16 },
    { x: 534, y: 284, w: 80, h: 16 },

    // South Comms (x: 410-614, y: 700-885) - Door at top center (x: 490-534)
    { x: 410, y: 869, w: 204, h: 16 },
    { x: 410, y: 700, w: 16, h: 185 },
    { x: 598, y: 700, w: 16, h: 185 },
    { x: 410, y: 700, w: 80, h: 16 },
    { x: 534, y: 700, w: 80, h: 16 },

    // East Stables (x: 700-885, y: 390-595) - Door at left center (y: 470-515)
    { x: 869, y: 390, w: 16, h: 205 },
    { x: 700, y: 390, w: 185, h: 16 },
    { x: 700, y: 579, w: 185, h: 16 },
    { x: 700, y: 390, w: 16, h: 80 },
    { x: 700, y: 515, w: 16, h: 80 },

    // West Mess Hall (x: 115-300, y: 390-595) - Door at right center (y: 470-515)
    { x: 115, y: 390, w: 16, h: 205 },
    { x: 115, y: 390, w: 185, h: 16 },
    { x: 115, y: 579, w: 185, h: 16 },
    { x: 284, y: 390, w: 16, h: 80 },
    { x: 284, y: 515, w: 16, h: 80 },

    // NE Workshop (x: 635-885, y: 115-360)
    { x: 635, y: 115, w: 250, h: 16 },
    { x: 869, y: 115, w: 16, h: 245 },
    { x: 635, y: 344, w: 250, h: 16 },

    // NW Storage (x: 135-385, y: 130-360)
    { x: 135, y: 130, w: 250, h: 16 },
    { x: 135, y: 130, w: 16, h: 230 },
    { x: 135, y: 344, w: 250, h: 16 },

    // SE Greenhouse (x: 610-870, y: 650-890)
    { x: 610, y: 874, w: 260, h: 16 },
    { x: 854, y: 650, w: 16, h: 240 },
    { x: 610, y: 650, w: 260, h: 16 },

    // SW Dormitory (x: 135-390, y: 620-880)
    { x: 135, y: 864, w: 255, h: 16 },
    { x: 135, y: 620, w: 16, h: 260 },
    { x: 135, y: 620, w: 255, h: 16 }
  ];

  // Spawn points around the campfire
  const SPAWN_POINTS = [
    { x: 512, y: 440 },
    { x: 580, y: 470 },
    { x: 580, y: 554 },
    { x: 512, y: 584 },
    { x: 444, y: 554 },
    { x: 444, y: 470 },
    { x: 512, y: 380 },
    { x: 640, y: 512 },
    { x: 512, y: 644 },
    { x: 384, y: 512 }
  ];

  // --- GAME STATE ---
  let currentRoomId = null;
  let currentRoomRef = null;
  let currentPrivateRef = null;
  let isSinglePlayerMode = false;
  let singlePlayerState = null;

  let animFrameId = null;
  let lastFrameTime = performance.now();
  let syncThrottleTimer = 0;
  let stepAudioTimer = 0;

  const State = {
    myUid: null,
    isCreator: false,
    selectedCharId: 'char_red',
    killerCountSetting: 1, // 1 or 2
    mySecretRole: 'SURVIVOR', // 'SURVIVOR' | 'KILLER'
    partnerKillerName: null,
    isAlive: true,
    killCooldown: 0,
    myCompletedTasks: new Set(),
    votedFor: null,
    chatMessages: [],
    room: null
  };

  // Local Player Controller State
  const LocalPlayer = {
    x: 512,
    y: 440,
    vx: 0,
    vy: 0,
    speed: 175,
    facing: 1, // 1 = right, -1 = left
    isMoving: false,
    walkCycle: 0
  };

  // Virtual Joystick State
  const Joystick = {
    active: false,
    startX: 0,
    startY: 0,
    currX: 0,
    currY: 0,
    dirX: 0,
    dirY: 0
  };

  // Keyboard State
  const Keys = {
    w: false, a: false, s: false, d: false,
    ArrowUp: false, ArrowLeft: false, ArrowDown: false, ArrowRight: false
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
      name = 'Jugador ' + Math.floor(1000 + Math.random() * 9000);
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

  // --- DOM CACHING ---
  const DOM = {};

  function cacheDOM() {
    DOM.views = {
      lobby: document.getElementById('sombras-view-lobby'),
      waiting: document.getElementById('sombras-view-waiting'),
      roleReveal: document.getElementById('sombras-view-role-reveal'),
      game: document.getElementById('sombras-view-game'),
      meeting: document.getElementById('sombras-view-meeting'),
      results: document.getElementById('sombras-view-results')
    };

    // Lobby Inputs
    DOM.inputNickname = document.getElementById('sombras-nickname-input');
    DOM.charSelectGrid = document.getElementById('sombras-char-select-grid');
    DOM.killerCountSelector = document.getElementById('sombras-killer-count-selector');
    DOM.btnCreateRoom = document.getElementById('sombras-btn-create-room');
    DOM.inputJoinCode = document.getElementById('sombras-input-join-code');
    DOM.btnJoinRoom = document.getElementById('sombras-btn-join-room');

    // Waiting Room
    DOM.displayRoomCode = document.getElementById('sombras-display-room-code');
    DOM.btnCopyCode = document.getElementById('sombras-btn-copy-code');
    DOM.btnShareRoom = document.getElementById('sombras-btn-share-room');
    DOM.waitingPlayersList = document.getElementById('sombras-waiting-players-list');
    DOM.waitingPlayersCount = document.getElementById('sombras-waiting-players-count');
    DOM.waitingKillerBadge = document.getElementById('sombras-waiting-killer-badge');
    DOM.btnHostStart = document.getElementById('sombras-btn-host-start');
    DOM.btnLeaveWaiting = document.getElementById('sombras-btn-leave-waiting');

    // Role Reveal
    DOM.roleCard = document.getElementById('sombras-role-card');
    DOM.roleIcon = document.getElementById('sombras-role-icon');
    DOM.roleTitle = document.getElementById('sombras-role-title');
    DOM.roleDesc = document.getElementById('sombras-role-desc');
    DOM.rolePartner = document.getElementById('sombras-role-partner');

    // Game Canvas & HUD
    DOM.canvas = document.getElementById('sombras-canvas');
    DOM.ctx = DOM.canvas ? DOM.canvas.getContext('2d') : null;
    DOM.taskProgressBar = document.getElementById('sombras-task-progress-bar');
    DOM.taskProgressText = document.getElementById('sombras-task-progress-text');
    DOM.lightsBadge = document.getElementById('sombras-lights-badge');
    DOM.lightsTimer = document.getElementById('sombras-lights-timer');
    DOM.myRoleTag = document.getElementById('sombras-my-role-tag');

    // Action Buttons
    DOM.btnInteract = document.getElementById('sombras-btn-interact');
    DOM.btnReport = document.getElementById('sombras-btn-report');
    DOM.btnMeeting = document.getElementById('sombras-btn-meeting');
    DOM.btnKill = document.getElementById('sombras-btn-kill');

    // Virtual Joystick
    DOM.joystickArea = document.getElementById('sombras-joystick-area');
    DOM.joystickKnob = document.getElementById('sombras-joystick-knob');

    // Meeting View
    DOM.meetingTitle = document.getElementById('sombras-meeting-title');
    DOM.meetingSubtitle = document.getElementById('sombras-meeting-subtitle');
    DOM.meetingTimer = document.getElementById('sombras-meeting-timer');
    DOM.meetingPlayersGrid = document.getElementById('sombras-meeting-players-grid');
    DOM.btnSkipVote = document.getElementById('sombras-btn-skip-vote');

    // Results View
    DOM.podiumTitle = document.getElementById('sombras-podium-title');
    DOM.podiumSubtitle = document.getElementById('sombras-podium-subtitle');
    DOM.podiumRoleList = document.getElementById('sombras-podium-role-list');
    DOM.btnPlayAgain = document.getElementById('sombras-btn-play-again');
    DOM.btnReturnMenu = document.getElementById('sombras-btn-return-menu');
  }

  function showView(viewKey) {
    Object.keys(DOM.views).forEach(key => {
      if (DOM.views[key]) {
        DOM.views[key].classList.toggle('active', key === viewKey);
      }
    });

    if (viewKey === 'game') {
      startCanvasLoop();
    } else {
      stopCanvasLoop();
    }
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

  // --- CHARACTER PICKER RENDERING ---

  function renderCharacterPicker() {
    if (!DOM.charSelectGrid) return;
    const chars = global.SombrasAssets.CHARACTERS;
    const sprites = global.SombrasAssets.Assets.characterSprites;

    DOM.charSelectGrid.innerHTML = chars.map(c => {
      const spriteObj = sprites[c.id];
      const iconUrl = (spriteObj && spriteObj.iconDataUrl) || '';
      const isSelected = (c.id === State.selectedCharId);

      return `
        <div class="char-picker-card ${isSelected ? 'selected' : ''}" data-char-id="${c.id}" style="display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 6px; background: rgba(15, 23, 42, 0.7); border: 2px solid ${isSelected ? c.color : 'transparent'}; border-radius: var(--radius-md); cursor: pointer; transition: all 0.2s;">
          <div style="width: 50px; height: 50px; border-radius: 50%; overflow: hidden; display: flex; align-items: center; justify-content: center; background: #0f172a; border: 2px solid ${c.color};">
            ${iconUrl ? `<img src="${iconUrl}" style="width: 100%; height: 100%; object-fit: contain;">` : `<span style="color: ${c.color}; font-size: 20px;">👤</span>`}
          </div>
          <span style="font-size: 10px; font-weight: 800; color: var(--text-main); text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 60px;">${c.name}</span>
        </div>
      `;
    }).join('');

    DOM.charSelectGrid.querySelectorAll('.char-picker-card').forEach(card => {
      card.addEventListener('click', () => {
        const charId = card.dataset.charId;
        State.selectedCharId = charId;
        const meta = chars.find(c => c.id === charId);
        DOM.charSelectGrid.querySelectorAll('.char-picker-card').forEach(b => {
          b.style.borderColor = (b.dataset.charId === charId) ? (meta ? meta.color : 'var(--primary)') : 'transparent';
          b.classList.toggle('selected', b.dataset.charId === charId);
        });
        SombrasAudio.click();
      });
    });
  }

  // --- ROOM CREATION & LOBBY ---

  async function createRoom() {
    await global.SombrasAssets.Assets.load();

    const uid = getPlayerUid();
    const name = getPlayerName();
    const roomId = generateRoomCode();
    const killerCount = State.killerCountSetting || 1;
    const charId = State.selectedCharId || 'char_red';

    currentRoomId = roomId;
    State.myUid = uid;
    State.isCreator = true;

    const service = global.FirebaseService;
    let db = null;
    if (service && service.isConfigured()) {
      service.initFirebase();
      db = service.getDb();
    }

    if (!db) {
      isSinglePlayerMode = true;
      singlePlayerState = createLocalRoomState(roomId, uid, name, killerCount, charId);
      renderWaitingRoom(singlePlayerState);
      return roomId;
    }

    isSinglePlayerMode = false;
    const roomRef = db.ref('sombras_rooms/' + roomId);
    currentRoomRef = roomRef;

    const initialPayload = {
      id: roomId,
      creatorId: uid,
      status: 'WAITING',
      killerCount: killerCount,
      totalTasks: 12,
      completedTasksCount: 0,
      lights: {
        phase: 'LIGHT',
        nextSwitch: Date.now() + 5000
      },
      deadBodies: {},
      players: {
        [uid]: {
          id: uid,
          name: name,
          charId: charId,
          x: 512,
          y: 440,
          alive: true,
          connected: true,
          isHost: true,
          joinedAt: global.firebase.database.ServerValue.TIMESTAMP
        }
      }
    };

    await roomRef.set(initialPayload);
    attachRoomListeners(roomRef, uid);
    return roomId;
  }

  async function joinRoom(roomCode) {
    await global.SombrasAssets.Assets.load();

    const cleanCode = roomCode.trim().toUpperCase();
    const uid = getPlayerUid();
    const name = getPlayerName();
    const charId = State.selectedCharId || 'char_blue';

    const service = global.FirebaseService;
    if (!service || !service.isConfigured()) {
      throw new Error('Configura Firebase para unirte a salas multijugador.');
    }

    service.initFirebase();
    const db = service.getDb();
    const roomRef = db.ref('sombras_rooms/' + cleanCode);
    const snap = await roomRef.once('value');
    const room = snap.val();

    if (!room) {
      throw new Error('La sala de Sombras del Bosque no existe.');
    }

    if (room.status !== 'WAITING') {
      if (room.players && room.players[uid]) {
        currentRoomId = cleanCode;
        currentRoomRef = roomRef;
        State.myUid = uid;
        State.isCreator = (room.creatorId === uid);
        attachRoomListeners(roomRef, uid);
        return cleanCode;
      }
      throw new Error('La partida ya ha comenzado.');
    }

    const currentPlayers = room.players || {};
    const count = Object.keys(currentPlayers).length;
    if (count >= 10) {
      throw new Error('La sala ya tiene el límite máximo de 10 jugadores.');
    }

    const playerPayload = {
      id: uid,
      name: name,
      charId: charId,
      x: SPAWN_POINTS[count % SPAWN_POINTS.length].x,
      y: SPAWN_POINTS[count % SPAWN_POINTS.length].y,
      alive: true,
      connected: true,
      isHost: false,
      joinedAt: global.firebase.database.ServerValue.TIMESTAMP
    };

    await roomRef.child(`players/${uid}`).set(playerPayload);

    currentRoomId = cleanCode;
    currentRoomRef = roomRef;
    State.myUid = uid;
    State.isCreator = (room.creatorId === uid);

    attachRoomListeners(roomRef, uid);
    return cleanCode;
  }

  function createLocalRoomState(roomId, uid, name, killerCount, charId) {
    return {
      id: roomId,
      creatorId: uid,
      status: 'WAITING',
      killerCount: killerCount,
      totalTasks: 6,
      completedTasksCount: 0,
      lights: {
        phase: 'LIGHT',
        nextSwitch: Date.now() + 5000
      },
      deadBodies: {},
      players: {
        [uid]: {
          id: uid,
          name: name,
          charId: charId,
          x: 512,
          y: 440,
          alive: true,
          connected: true,
          isHost: true
        }
      }
    };
  }

  // --- START GAME WORKFLOW ---

  async function startGame() {
    await global.SombrasAssets.Assets.load();

    if (isSinglePlayerMode) {
      startLocalGame();
      return;
    }

    if (!currentRoomRef || !State.isCreator) return;
    const snap = await currentRoomRef.once('value');
    const room = snap.val();
    if (!room) return;

    const players = room.players || {};
    let pids = Object.keys(players);
    const killerCountReq = room.killerCount || 1;

    // If only 1 player starts -> create 3 friendly AI bots so game is 100% playable!
    if (pids.length === 1) {
      const botConfigs = [
        { id: 'bot_blue', name: 'Mecánico Azul 🤖', charId: 'char_blue', x: 580, y: 470 },
        { id: 'bot_green', name: 'Guardabosques 🤖', charId: 'char_green', x: 444, y: 554 },
        { id: 'bot_yellow', name: 'Constructor 🤖', charId: 'char_yellow', x: 580, y: 554 }
      ];
      botConfigs.forEach(b => {
        players[b.id] = {
          id: b.id,
          name: b.name,
          charId: b.charId,
          x: b.x,
          y: b.y,
          alive: true,
          connected: true,
          isAI: true
        };
      });
      pids = Object.keys(players);
    }

    // Assign exactly N killers
    const shuffled = [...pids].sort(() => Math.random() - 0.5);
    const actualKillerCount = Math.min(killerCountReq, Math.max(1, pids.length - 1));
    const killerIds = shuffled.slice(0, actualKillerCount);

    const db = global.FirebaseService.getDb();
    const privateUpdates = {};
    const killerNames = killerIds.map(id => players[id].name);

    pids.forEach((pid, idx) => {
      const isKiller = killerIds.includes(pid);
      const partner = isKiller && killerIds.length > 1
        ? killerNames.find(n => n !== players[pid].name) || null
        : null;

      privateUpdates[`sombras_private/${currentRoomId}/${pid}`] = {
        role: isKiller ? 'KILLER' : 'SURVIVOR',
        partnerKillerName: partner
      };

      players[pid].x = SPAWN_POINTS[idx % SPAWN_POINTS.length].x;
      players[pid].y = SPAWN_POINTS[idx % SPAWN_POINTS.length].y;
      players[pid].alive = true;
    });

    try {
      await db.ref().update(privateUpdates);
    } catch (e) {}

    await currentRoomRef.update({
      status: 'ROLE_REVEAL',
      totalTasks: pids.length * 2,
      completedTasksCount: 0,
      lights: {
        phase: 'LIGHT',
        nextSwitch: Date.now() + 5000
      },
      deadBodies: {},
      players: players
    });

    setTimeout(async () => {
      if (currentRoomRef) {
        await currentRoomRef.update({ status: 'PLAYING' });
      }
    }, 3800);
  }

  function startLocalGame() {
    const uid = State.myUid;
    State.mySecretRole = 'KILLER';
    singlePlayerState.status = 'ROLE_REVEAL';
    singlePlayerState.players[uid].x = 512;
    singlePlayerState.players[uid].y = 440;

    // Add 3 AI Campers
    singlePlayerState.players['bot_1'] = { id: 'bot_1', name: 'Mecánico Azul 🤖', charId: 'char_blue', x: 580, y: 470, alive: true, connected: true, isAI: true };
    singlePlayerState.players['bot_2'] = { id: 'bot_2', name: 'Guardabosques 🤖', charId: 'char_green', x: 444, y: 554, alive: true, connected: true, isAI: true };
    singlePlayerState.players['bot_3'] = { id: 'bot_3', name: 'Constructor 🤖', charId: 'char_yellow', x: 580, y: 554, alive: true, connected: true, isAI: true };

    renderRoleRevealView(singlePlayerState);

    setTimeout(() => {
      singlePlayerState.status = 'PLAYING';
      renderGameView(singlePlayerState);
    }, 3500);
  }

  // --- VIEWS RENDERING ---

  function renderRoleRevealView(room) {
    const isKiller = State.mySecretRole === 'KILLER';
    if (DOM.roleIcon) DOM.roleIcon.textContent = isKiller ? '🔪' : '🛡️';
    if (DOM.roleTitle) {
      DOM.roleTitle.textContent = isKiller ? 'ERES ASESINO' : 'ERES SUPERVIVIENTE';
      DOM.roleTitle.style.color = isKiller ? 'var(--accent-rose)' : 'var(--accent-cyan)';
    }
    if (DOM.roleDesc) {
      DOM.roleDesc.textContent = isKiller
        ? 'Elimina a los supervivientes durante los apagones sin ser descubierto.'
        : 'Completa las actividades del campamento o descubre y expulsa a los asesinos.';
    }
    if (DOM.rolePartner) {
      if (isKiller && State.partnerKillerName) {
        DOM.rolePartner.textContent = `Tu compañero asesino es: ${State.partnerKillerName}`;
        DOM.rolePartner.style.display = 'block';
      } else {
        DOM.rolePartner.style.display = 'none';
      }
    }

    if (isKiller) SombrasAudio.blackout();
    else SombrasAudio.lightOn();

    showView('roleReveal');
  }

  function renderGameView(room) {
    const isKiller = State.mySecretRole === 'KILLER';
    if (DOM.myRoleTag) {
      DOM.myRoleTag.textContent = isKiller ? '🔪 Asesino' : '🛡️ Superviviente';
      DOM.myRoleTag.className = `difficulty-badge ${isKiller ? 'diff-EXTREMO' : 'diff-EXPERTO'}`;
    }
    if (DOM.btnKill) {
      DOM.btnKill.style.display = isKiller ? 'flex' : 'none';
    }

    const myP = room.players && room.players[State.myUid];
    if (myP) {
      LocalPlayer.x = myP.x || 512;
      LocalPlayer.y = myP.y || 440;
      State.isAlive = (myP.alive !== false);
    }

    showView('game');
  }

  // --- CANVAS LOOP & RENDER ---

  function startCanvasLoop() {
    if (animFrameId) cancelAnimationFrame(animFrameId);
    lastFrameTime = performance.now();
    animFrameId = requestAnimationFrame(gameLoop);
  }

  function stopCanvasLoop() {
    if (animFrameId) {
      cancelAnimationFrame(animFrameId);
      animFrameId = null;
    }
  }

  function gameLoop(timestamp) {
    const dt = Math.min((timestamp - lastFrameTime) / 1000, 0.1);
    lastFrameTime = timestamp;

    update(dt);
    render();

    animFrameId = requestAnimationFrame(gameLoop);
  }

  function update(dt) {
    const room = isSinglePlayerMode ? singlePlayerState : State.room;
    if (!room || room.status !== 'PLAYING') return;

    // 1. Update Lights Cycle
    updateLightsCycle(room);

    // 2. Update Kill Cooldown
    if (State.killCooldown > 0) {
      State.killCooldown = Math.max(0, State.killCooldown - dt);
      if (DOM.btnKill) {
        DOM.btnKill.disabled = (State.killCooldown > 0 || !State.isAlive);
        DOM.btnKill.innerHTML = State.killCooldown > 0
          ? `<span>🔪</span> ${Math.ceil(State.killCooldown)}s`
          : `<span>🔪</span> ELIMINAR`;
      }
    } else if (DOM.btnKill) {
      DOM.btnKill.disabled = !State.isAlive;
      DOM.btnKill.innerHTML = `<span>🔪</span> ELIMINAR`;
    }

    // 3. Movement input
    if (State.isAlive) {
      let dx = 0;
      let dy = 0;

      if (Keys.w || Keys.ArrowUp) dy -= 1;
      if (Keys.s || Keys.ArrowDown) dy += 1;
      if (Keys.a || Keys.ArrowLeft) dx -= 1;
      if (Keys.d || Keys.ArrowRight) dx += 1;

      if (Joystick.active) {
        dx = Joystick.dirX;
        dy = Joystick.dirY;
      }

      const len = Math.hypot(dx, dy);
      if (len > 0.1) {
        LocalPlayer.isMoving = true;
        const norm = len > 1 ? 1 / len : 1;
        LocalPlayer.vx = (dx * norm) * LocalPlayer.speed;
        LocalPlayer.vy = (dy * norm) * LocalPlayer.speed;
        LocalPlayer.facing = dx >= 0 ? 1 : -1;
        LocalPlayer.walkCycle += dt * 12;

        stepAudioTimer += dt;
        if (stepAudioTimer > 0.35) {
          SombrasAudio.step();
          stepAudioTimer = 0;
        }
      } else {
        LocalPlayer.isMoving = false;
        LocalPlayer.vx = 0;
        LocalPlayer.vy = 0;
      }

      const nextX = LocalPlayer.x + LocalPlayer.vx * dt;
      const nextY = LocalPlayer.y + LocalPlayer.vy * dt;

      resolveMovementWithCollisions(nextX, nextY);

      syncThrottleTimer += dt;
      if (syncThrottleTimer >= 0.066) {
        syncThrottleTimer = 0;
        syncMyPosition();
      }
    }

    // 4. Proximity Checks
    checkProximityActions(room);
  }

  function resolveMovementWithCollisions(newX, newY) {
    const playerRadius = 14;

    // Palisade circle boundary
    const distCenter = Math.hypot(newX - 512, newY - 512);
    if (distCenter + playerRadius > 440) {
      const angle = Math.atan2(newY - 512, newX - 512);
      newX = 512 + Math.cos(angle) * (440 - playerRadius);
      newY = 512 + Math.sin(angle) * (440 - playerRadius);
    }

    // Campfire obstacle
    const distFire = Math.hypot(newX - CAMPFIRE.x, newY - CAMPFIRE.y);
    if (distFire < CAMPFIRE.radius + playerRadius) {
      const angle = Math.atan2(newY - CAMPFIRE.y, newX - CAMPFIRE.x);
      newX = CAMPFIRE.x + Math.cos(angle) * (CAMPFIRE.radius + playerRadius);
      newY = CAMPFIRE.y + Math.sin(angle) * (CAMPFIRE.radius + playerRadius);
    }

    // Cabin walls
    CABIN_WALLS.forEach(wall => {
      const closestX = Math.max(wall.x, Math.min(newX, wall.x + wall.w));
      const closestY = Math.max(wall.y, Math.min(newY, wall.y + wall.h));
      const distX = newX - closestX;
      const distY = newY - closestY;
      const distSq = (distX * distX) + (distY * distY);

      if (distSq < (playerRadius * playerRadius)) {
        const d = Math.sqrt(distSq);
        if (d > 0.001) {
          const overlap = playerRadius - d;
          newX += (distX / d) * overlap;
          newY += (distY / d) * overlap;
        } else {
          newX += playerRadius;
        }
      }
    });

    LocalPlayer.x = Math.max(70, Math.min(MAP_SIZE - 70, newX));
    LocalPlayer.y = Math.max(70, Math.min(MAP_SIZE - 70, newY));
  }

  function updateLightsCycle(room) {
    const lights = room.lights || { phase: 'LIGHT', nextSwitch: Date.now() + 5000 };
    const now = Date.now();
    const remaining = Math.max(0, Math.ceil((lights.nextSwitch - now) / 1000));

    if (DOM.lightsBadge && DOM.lightsTimer) {
      if (lights.phase === 'LIGHT') {
        DOM.lightsBadge.textContent = '☀️ LUZ';
        DOM.lightsBadge.className = 'difficulty-badge diff-EXPERTO';
      } else {
        DOM.lightsBadge.textContent = '🌑 APAGÓN';
        DOM.lightsBadge.className = 'difficulty-badge diff-EXTREMO pulse';
      }
      DOM.lightsTimer.textContent = `${remaining}s`;
    }

    if (State.isCreator && now >= lights.nextSwitch) {
      const nextPhase = lights.phase === 'LIGHT' ? 'BLACKOUT' : 'LIGHT';
      const duration = nextPhase === 'LIGHT' ? 5000 : 3000;
      const newLights = {
        phase: nextPhase,
        nextSwitch: now + duration
      };

      if (nextPhase === 'BLACKOUT') SombrasAudio.blackout();
      else SombrasAudio.lightOn();

      if (isSinglePlayerMode) {
        singlePlayerState.lights = newLights;
      } else if (currentRoomRef) {
        currentRoomRef.child('lights').set(newLights).catch(() => {});
      }
    }
  }

  function checkProximityActions(room) {
    if (!State.isAlive) {
      if (DOM.btnInteract) DOM.btnInteract.style.display = 'none';
      if (DOM.btnReport) DOM.btnReport.style.display = 'none';
      if (DOM.btnMeeting) DOM.btnMeeting.style.display = 'none';
      if (DOM.btnKill) DOM.btnKill.style.display = 'none';
      return;
    }

    const myX = LocalPlayer.x;
    const myY = LocalPlayer.y;

    // 1. Task Proximity
    let nearbyTask = null;
    global.SombrasTasks.TASKS.forEach(t => {
      const dist = Math.hypot(myX - t.x, myY - t.y);
      if (dist < t.radius && !State.myCompletedTasks.has(t.id)) {
        nearbyTask = t;
      }
    });

    if (DOM.btnInteract) {
      DOM.btnInteract.style.display = nearbyTask ? 'flex' : 'none';
      if (nearbyTask) {
        DOM.btnInteract.onclick = () => {
          global.SombrasTasks.openTask(nearbyTask.id, onLocalTaskCompleted);
        };
      }
    }

    // 2. Dead Body Proximity
    const bodies = Object.values(room.deadBodies || {});
    let nearbyBody = null;
    bodies.forEach(b => {
      const dist = Math.hypot(myX - b.x, myY - b.y);
      if (dist < 60) nearbyBody = b;
    });

    if (DOM.btnReport) {
      DOM.btnReport.style.display = nearbyBody ? 'flex' : 'none';
      if (nearbyBody) {
        DOM.btnReport.onclick = () => reportDeadBody(nearbyBody);
      }
    }

    // 3. Campfire Meeting Button
    const distCampfire = Math.hypot(myX - CAMPFIRE.x, myY - CAMPFIRE.y);
    if (DOM.btnMeeting) {
      DOM.btnMeeting.style.display = (distCampfire < 80) ? 'flex' : 'none';
      if (distCampfire < 80) {
        DOM.btnMeeting.onclick = () => callEmergencyMeeting(getPlayerName());
      }
    }

    // 4. Kill Target Proximity
    if (State.mySecretRole === 'KILLER' && DOM.btnKill) {
      let nearbyVictim = null;
      const players = Object.values(room.players || {});
      players.forEach(p => {
        if (p.id !== State.myUid && p.alive !== false) {
          const dist = Math.hypot(myX - p.x, myY - p.y);
          if (dist < 55) nearbyVictim = p;
        }
      });

      if (nearbyVictim && State.killCooldown <= 0) {
        DOM.btnKill.classList.add('pulse');
        DOM.btnKill.onclick = () => executeAssassination(nearbyVictim);
      } else {
        DOM.btnKill.classList.remove('pulse');
      }
    }
  }

  // --- ACTIONS ---

  function onLocalTaskCompleted(taskId) {
    State.myCompletedTasks.add(taskId);
    showToast('¡Objetivo completado con éxito!', '✅');

    const room = isSinglePlayerMode ? singlePlayerState : State.room;
    if (!room) return;

    const newCompleted = (room.completedTasksCount || 0) + 1;
    const total = room.totalTasks || 12;

    if (DOM.taskProgressBar) {
      const pct = Math.min(100, Math.round((newCompleted / total) * 100));
      DOM.taskProgressBar.style.width = `${pct}%`;
    }
    if (DOM.taskProgressText) {
      DOM.taskProgressText.textContent = `OBJETIVOS: ${newCompleted} / ${total}`;
    }

    if (newCompleted >= total) {
      handleGameOver('SURVIVORS_TASKS');
      return;
    }

    if (isSinglePlayerMode) {
      singlePlayerState.completedTasksCount = newCompleted;
    } else if (currentRoomRef) {
      currentRoomRef.child('completedTasksCount').set(newCompleted).catch(() => {});
    }
  }

  async function executeAssassination(victim) {
    if (State.mySecretRole !== 'KILLER' || State.killCooldown > 0 || !State.isAlive) return;

    SombrasAudio.kill();
    State.killCooldown = 15;

    const bodyId = `body_${victim.id}_${Date.now()}`;
    const newBody = {
      id: bodyId,
      victimUid: victim.id,
      victimName: victim.name,
      charId: victim.charId,
      x: victim.x,
      y: victim.y
    };

    if (isSinglePlayerMode) {
      singlePlayerState.players[victim.id].alive = false;
      singlePlayerState.deadBodies[bodyId] = newBody;
      return;
    }

    if (!currentRoomRef) return;
    await currentRoomRef.child(`players/${victim.id}/alive`).set(false);
    await currentRoomRef.child(`deadBodies/${bodyId}`).set(newBody);
  }

  async function reportDeadBody(body) {
    SombrasAudio.alarm();
    const reporterName = getPlayerName();
    startMeetingPhase(`¡${reporterName} encontró el cadáver de ${body.victimName}!`, reporterName);
  }

  async function callEmergencyMeeting(callerName) {
    SombrasAudio.alarm();
    startMeetingPhase(`¡Reunión de Emergencia convocada por ${callerName}!`, callerName);
  }

  async function startMeetingPhase(title, callerName) {
    const room = isSinglePlayerMode ? singlePlayerState : State.room;
    if (!room || room.status === 'MEETING') return;

    const meetingPayload = {
      status: 'MEETING',
      meetingInfo: {
        title: title,
        caller: callerName,
        timerEnd: Date.now() + 30000
      },
      votes: {}
    };

    State.votedFor = null;

    if (isSinglePlayerMode) {
      Object.assign(singlePlayerState, meetingPayload);
      renderMeetingView(singlePlayerState);
      return;
    }

    if (currentRoomRef) {
      await currentRoomRef.update(meetingPayload);
    }
  }

  // --- MEETING & VOTING ---

  function renderMeetingView(room) {
    const info = room.meetingInfo || { title: 'Reunión de Emergencia', caller: 'Campamento' };
    if (DOM.meetingTitle) DOM.meetingTitle.textContent = info.title;
    if (DOM.meetingSubtitle) DOM.meetingSubtitle.textContent = `Convocada por: ${info.caller}`;

    const players = Object.values(room.players || {});
    const votes = room.votes || {};

    if (DOM.meetingPlayersGrid) {
      DOM.meetingPlayersGrid.innerHTML = players.map(p => {
        const isDead = (p.alive === false);
        const hasVotedForThis = Object.values(votes).filter(v => v === p.id).length;
        const myVoteThis = State.votedFor === p.id;
        const spriteObj = global.SombrasAssets.Assets.characterSprites[p.charId || 'char_red'];
        const iconUrl = spriteObj ? spriteObj.iconDataUrl : '';

        return `
          <div class="meeting-player-card ${isDead ? 'dead' : ''} ${myVoteThis ? 'voted' : ''}" data-uid="${p.id}" style="background: rgba(15, 23, 42, 0.85); border: 2px solid ${myVoteThis ? 'var(--accent-amber)' : 'var(--border-color)'}; border-radius: var(--radius-md); padding: 10px 14px; display: flex; align-items: center; gap: 10px; cursor: ${isDead || !State.isAlive ? 'default' : 'pointer'};">
            <div style="width: 44px; height: 44px; border-radius: 50%; overflow: hidden; background: #0f172a; border: 2px solid #fff; flex-shrink: 0;">
              ${iconUrl ? `<img src="${iconUrl}" style="width: 100%; height: 100%; object-fit: contain;">` : `👤`}
            </div>
            <div style="flex: 1; overflow: hidden;">
              <div style="font-weight: 800; font-size: 14px; color: ${isDead ? 'var(--text-dim)' : 'var(--text-main)'}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                ${p.name} ${p.id === State.myUid ? '(Tú)' : ''}
              </div>
              <div style="font-size: 11px; font-weight: 700; color: ${isDead ? 'var(--accent-rose)' : 'var(--accent-emerald)'};">
                ${isDead ? '💀 FALLECIDO' : '💚 VIVO'}
              </div>
            </div>
            ${hasVotedForThis > 0 ? `<span class="difficulty-badge diff-EXTREMO">🗳️ ${hasVotedForThis}</span>` : ''}
            ${!isDead && State.isAlive && !State.votedFor ? `<button class="btn" style="font-size: 12px; padding: 6px 12px; background: rgba(56, 189, 248, 0.15); border-color: var(--primary);">Votar</button>` : ''}
          </div>
        `;
      }).join('');

      DOM.meetingPlayersGrid.querySelectorAll('.meeting-player-card').forEach(card => {
        card.addEventListener('click', () => {
          const targetUid = card.dataset.uid;
          const target = players.find(p => p.id === targetUid);
          if (target && target.alive !== false && State.isAlive && !State.votedFor) {
            castVote(targetUid);
          }
        });
      });
    }

    if (DOM.btnSkipVote) {
      DOM.btnSkipVote.disabled = !State.isAlive || State.votedFor !== null;
      DOM.btnSkipVote.onclick = () => castVote('SKIP');
    }

    showView('meeting');
  }

  async function castVote(targetUid) {
    if (!State.isAlive || State.votedFor) return;
    State.votedFor = targetUid;
    SombrasAudio.vote();
    showToast(`Voto emitido para: ${targetUid === 'SKIP' ? 'Saltar Voto' : 'Jugador'}`, '🗳️');

    if (isSinglePlayerMode) {
      singlePlayerState.votes[State.myUid] = targetUid;
      resolveMeetingVotes(singlePlayerState);
      return;
    }

    if (currentRoomRef) {
      await currentRoomRef.child(`votes/${State.myUid}`).set(targetUid);
      const snap = await currentRoomRef.once('value');
      const r = snap.val();
      const living = Object.values(r.players || {}).filter(p => p.alive !== false);
      const voteCount = Object.keys(r.votes || {}).length;
      if (voteCount >= living.length && State.isCreator) {
        resolveMeetingVotes(r);
      }
    }
  }

  async function resolveMeetingVotes(room) {
    const votes = room.votes || {};
    const tally = {};
    Object.values(votes).forEach(v => {
      tally[v] = (tally[v] || 0) + 1;
    });

    let maxVotes = 0;
    let exiledUid = null;
    let isTie = false;

    Object.keys(tally).forEach(cand => {
      if (tally[cand] > maxVotes) {
        maxVotes = tally[cand];
        exiledUid = cand;
        isTie = false;
      } else if (tally[cand] === maxVotes) {
        isTie = true;
      }
    });

    let exileMessage = 'Nadie fue expulsado (Empate en la votación).';
    if (exiledUid && exiledUid !== 'SKIP' && !isTie) {
      const exiledPlayer = room.players[exiledUid];
      if (exiledPlayer) {
        exiledPlayer.alive = false;
        exileMessage = `¡${exiledPlayer.name} ha sido expulsado del campamento!`;
      }
    } else if (exiledUid === 'SKIP') {
      exileMessage = 'Nadie fue expulsado (Voto saltado por mayoría).';
    }

    showToast(exileMessage, '🚪');

    setTimeout(async () => {
      if (isSinglePlayerMode) {
        singlePlayerState.status = 'PLAYING';
        singlePlayerState.votes = {};
        renderGameView(singlePlayerState);
      } else if (currentRoomRef) {
        await currentRoomRef.update({
          status: 'PLAYING',
          votes: {},
          players: room.players
        });
      }
    }, 2500);
  }

  function handleGameOver(winReason) {
    stopCanvasLoop();
    const isSurvivorsWin = winReason.startsWith('SURVIVORS');

    if (isSurvivorsWin) SombrasAudio.win();
    else SombrasAudio.lose();

    if (DOM.podiumTitle) {
      DOM.podiumTitle.textContent = isSurvivorsWin
        ? '¡VICTORIA DE LOS SUPERVIVIENTES!'
        : '¡LOS ASESINOS HAN TOMADO EL CONTROL!';
      DOM.podiumTitle.style.color = isSurvivorsWin ? 'var(--accent-cyan)' : 'var(--accent-rose)';
    }

    if (DOM.podiumSubtitle) {
      DOM.podiumSubtitle.textContent = isSurvivorsWin
        ? 'El campamento completó las tareas y sobrevivió a la noche.'
        : 'Los asesinos eliminaron a los supervivientes.';
    }

    const room = isSinglePlayerMode ? singlePlayerState : State.room;
    if (room && DOM.podiumRoleList) {
      const players = Object.values(room.players || {});
      DOM.podiumRoleList.innerHTML = players.map(p => `
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; background: var(--bg-surface); border-radius: var(--radius-sm); border: 1px solid var(--border-color);">
          <span style="font-weight: 700; color: var(--text-main);">${p.name} ${p.id === State.myUid ? '(Tú)' : ''}</span>
          <span class="difficulty-badge ${p.id === State.myUid && State.mySecretRole === 'KILLER' ? 'diff-EXTREMO' : 'diff-EXPERTO'}">
            ${p.id === State.myUid ? (State.mySecretRole === 'KILLER' ? '🔪 ASESINO' : '🛡️ SUPERVIVIENTE') : '👤 JUGADOR'}
          </span>
        </div>
      `).join('');
    }

    showView('results');
  }

  // --- 2D CANVAS RENDERING ---

  function render() {
    if (!DOM.ctx || !DOM.canvas) return;
    const ctx = DOM.ctx;
    const canvas = DOM.canvas;

    if (canvas.width !== canvas.clientWidth || canvas.height !== canvas.clientHeight) {
      canvas.width = canvas.clientWidth;
      canvas.height = canvas.clientHeight;
    }

    const cw = canvas.width;
    const ch = canvas.height;

    const camX = cw / 2 - LocalPlayer.x;
    const camY = ch / 2 - LocalPlayer.y;

    ctx.clearRect(0, 0, cw, ch);

    ctx.save();
    ctx.translate(camX, camY);

    // 1. Draw 1024x1024 Map Background
    const mapImg = global.SombrasAssets.Assets.mapImage;
    if (mapImg) {
      ctx.drawImage(mapImg, 0, 0, MAP_SIZE, MAP_SIZE);
    } else {
      ctx.fillStyle = '#064e3b';
      ctx.fillRect(0, 0, MAP_SIZE, MAP_SIZE);
    }

    // 2. Draw Task Station Glow Indicators
    const room = isSinglePlayerMode ? singlePlayerState : State.room;
    global.SombrasTasks.TASKS.forEach(task => {
      const isDone = State.myCompletedTasks.has(task.id);
      ctx.save();
      ctx.beginPath();
      ctx.arc(task.x, task.y, 22, 0, Math.PI * 2);
      ctx.fillStyle = isDone ? 'rgba(16, 185, 129, 0.4)' : 'rgba(245, 158, 11, 0.5)';
      ctx.fill();
      ctx.strokeStyle = isDone ? '#10b981' : '#f59e0b';
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.font = '16px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(task.icon, task.x, task.y);
      ctx.restore();
    });

    // 3. Draw Dead Bodies
    if (room && room.deadBodies) {
      Object.values(room.deadBodies).forEach(body => {
        const spriteObj = global.SombrasAssets.Assets.characterSprites[body.charId || 'char_red'];
        if (spriteObj && spriteObj.deadCanvas) {
          ctx.drawImage(spriteObj.deadCanvas, body.x - 24, body.y - 18, 48, 36);
        } else {
          ctx.fillStyle = '#ef4444';
          ctx.fillRect(body.x - 16, body.y - 10, 32, 20);
        }
      });
    }

    // 4. Draw Other Remote Players
    if (room && room.players) {
      Object.values(room.players).forEach(p => {
        if (p.id !== State.myUid && p.alive !== false) {
          renderPlayerSprite(ctx, p.charId || 'char_blue', p.x, p.y, p.name, 1, false);
        }
      });
    }

    // 5. Draw Local Player
    if (State.isAlive) {
      renderPlayerSprite(
        ctx,
        State.selectedCharId || 'char_red',
        LocalPlayer.x,
        LocalPlayer.y,
        getPlayerName() + ' (Tú)',
        LocalPlayer.facing,
        LocalPlayer.isMoving,
        LocalPlayer.walkCycle
      );
    }

    ctx.restore();

    // 6. ATMOSPHERIC NIGHT & TORCHLIGHT LIGHTING MASK
    renderLightingMask(ctx, cw, ch, room);
  }

  function renderPlayerSprite(ctx, charId, x, y, name, facing, isMoving, walkCycle = 0) {
    ctx.save();
    ctx.translate(x, y);

    // Drop shadow under feet
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.beginPath();
    ctx.ellipse(0, 16, 16, 7, 0, 0, Math.PI * 2);
    ctx.fill();

    // Walking animation bobbing
    const bobY = isMoving ? Math.sin(walkCycle) * 3 : 0;

    if (facing < 0) ctx.scale(-1, 1);

    const spriteObj = global.SombrasAssets.Assets.characterSprites[charId];
    if (spriteObj && spriteObj.aliveCanvas) {
      ctx.drawImage(spriteObj.aliveCanvas, -20, -32 + bobY, 40, 64);
    } else {
      ctx.fillStyle = '#38bdf8';
      ctx.beginPath();
      ctx.arc(0, -10 + bobY, 14, 0, Math.PI * 2);
      ctx.fill();
    }

    if (facing < 0) ctx.scale(-1, 1);

    // Nametag
    ctx.font = 'bold 11px Inter, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.shadowColor = '#000000';
    ctx.shadowBlur = 4;
    ctx.fillText(name, 0, 28 + bobY);

    ctx.restore();
  }

  function renderLightingMask(ctx, cw, ch, room) {
    const lights = room && room.lights ? room.lights : { phase: 'LIGHT' };
    const isBlackout = lights.phase === 'BLACKOUT';
    const isKiller = State.mySecretRole === 'KILLER';

    // Camera coordinates
    const camX = cw / 2 - LocalPlayer.x;
    const camY = ch / 2 - LocalPlayer.y;

    ctx.save();

    // 1. Soft night overlay (45% darkness in light phase, 85% in blackout)
    ctx.fillStyle = isBlackout && !isKiller ? 'rgba(2, 6, 23, 0.88)' : 'rgba(2, 6, 23, 0.42)';
    ctx.fillRect(0, 0, cw, ch);

    // 2. Cut out torchlight and ambient lanterns
    ctx.globalCompositeOperation = 'destination-out';

    // Player Torchlight
    let playerRadius = 220;
    if (isBlackout) {
      playerRadius = isKiller ? 260 : 60;
    }

    const playerGrad = ctx.createRadialGradient(cw / 2, ch / 2, playerRadius * 0.35, cw / 2, ch / 2, playerRadius);
    playerGrad.addColorStop(0, 'rgba(0, 0, 0, 1)');
    playerGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = playerGrad;
    ctx.beginPath();
    ctx.arc(cw / 2, ch / 2, playerRadius, 0, Math.PI * 2);
    ctx.fill();

    // Campfire & Lantern glows
    if (!isBlackout || isKiller) {
      LANTERNS.forEach(l => {
        const sx = l.x + camX;
        const sy = l.y + camY;
        const rad = isBlackout ? l.radius * 0.4 : l.radius;

        const lGrad = ctx.createRadialGradient(sx, sy, rad * 0.2, sx, sy, rad);
        lGrad.addColorStop(0, 'rgba(0, 0, 0, 0.9)');
        lGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = lGrad;
        ctx.beginPath();
        ctx.arc(sx, sy, rad, 0, Math.PI * 2);
        ctx.fill();
      });
    }

    ctx.restore();

    // Blackout alert red flash on screen borders
    if (isBlackout) {
      ctx.save();
      ctx.strokeStyle = 'rgba(225, 29, 72, 0.35)';
      ctx.lineWidth = 12;
      ctx.strokeRect(0, 0, cw, ch);
      ctx.restore();
    }
  }

  function syncMyPosition() {
    if (isSinglePlayerMode) {
      if (singlePlayerState && singlePlayerState.players[State.myUid]) {
        singlePlayerState.players[State.myUid].x = LocalPlayer.x;
        singlePlayerState.players[State.myUid].y = LocalPlayer.y;
      }
      return;
    }

    if (currentRoomRef && State.myUid) {
      currentRoomRef.child(`players/${State.myUid}`).update({
        x: Math.round(LocalPlayer.x),
        y: Math.round(LocalPlayer.y)
      }).catch(() => {});
    }
  }

  // --- REALTIME LISTENERS ---

  function attachRoomListeners(roomRef, myUid) {
    const db = global.FirebaseService.getDb();
    currentPrivateRef = db.ref(`sombras_private/${currentRoomId}/${myUid}`);

    currentPrivateRef.on('value', snap => {
      const data = snap.val() || {};
      State.mySecretRole = data.role || 'SURVIVOR';
      State.partnerKillerName = data.partnerKillerName || null;
    });

    roomRef.on('value', snap => {
      const room = snap.val();
      if (!room) {
        showToast('La sala fue cerrada o abandonada.', '🚪');
        leaveRoom();
        return;
      }

      State.room = room;
      State.isCreator = (room.creatorId === myUid);

      if (room.status === 'WAITING') {
        renderWaitingRoom(room);
      } else if (room.status === 'ROLE_REVEAL') {
        renderRoleRevealView(room);
      } else if (room.status === 'PLAYING') {
        renderGameView(room);
      } else if (room.status === 'MEETING') {
        renderMeetingView(room);
      } else if (room.status === 'FINISHED') {
        handleGameOver('FINISHED');
      }
    });
  }

  function renderWaitingRoom(room) {
    if (DOM.displayRoomCode) DOM.displayRoomCode.textContent = room.id;
    const playerList = Object.values(room.players || {});
    if (DOM.waitingPlayersCount) DOM.waitingPlayersCount.textContent = `${playerList.length} / 10 Jugadores`;
    if (DOM.waitingKillerBadge) DOM.waitingKillerBadge.textContent = `${room.killerCount || 1} Asesino(s)`;

    if (DOM.waitingPlayersList) {
      DOM.waitingPlayersList.innerHTML = playerList.map(p => {
        const spriteObj = global.SombrasAssets.Assets.characterSprites[p.charId || 'char_red'];
        const iconUrl = spriteObj ? spriteObj.iconDataUrl : '';

        return `
          <div class="player-slot-card ready" style="padding: 10px 14px; display: flex; align-items: center; gap: 10px;">
            <span class="status-dot ${p.connected ? 'online' : 'offline'}"></span>
            <div style="width: 36px; height: 36px; border-radius: 50%; overflow: hidden; background: #0f172a; border: 2px solid #fff; flex-shrink: 0;">
              ${iconUrl ? `<img src="${iconUrl}" style="width: 100%; height: 100%; object-fit: contain;">` : `👤`}
            </div>
            <span style="font-weight: 700; flex: 1;">${p.name} ${p.id === State.myUid ? '(Tú)' : ''}</span>
            ${p.id === room.creatorId ? '<span class="player-badge badge-host">👑 Anfitrión</span>' : '<span class="player-badge badge-guest">Superviviente</span>'}
          </div>
        `;
      }).join('');
    }

    if (DOM.btnHostStart) {
      DOM.btnHostStart.style.display = State.isCreator ? 'flex' : 'none';
      DOM.btnHostStart.innerHTML = playerList.length === 1
        ? '<span>🌲</span> INICIAR (SOLO VS 3 BOTS)'
        : `<span>🌲</span> INICIAR PARTIDA (${playerList.length} JUGADORES)`;
    }

    showView('waiting');
  }

  function leaveRoom() {
    stopCanvasLoop();
    if (currentRoomRef && currentRoomId) {
      const myUid = State.myUid;
      try {
        currentRoomRef.child(`players/${myUid}/connected`).set(false);
      } catch (e) {}
      currentRoomRef.off();
      currentRoomRef = null;
    }
    if (currentPrivateRef) {
      currentPrivateRef.off();
      currentPrivateRef = null;
    }
    currentRoomId = null;
    isSinglePlayerMode = false;
    singlePlayerState = null;

    showView('lobby');
  }

  // --- CONTROLS & EVENTS ---

  function initControls() {
    window.addEventListener('keydown', e => {
      if (['w', 'a', 's', 'd', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight'].includes(e.key)) {
        Keys[e.key] = true;
      }
    });

    window.addEventListener('keyup', e => {
      if (['w', 'a', 's', 'd', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight'].includes(e.key)) {
        Keys[e.key] = false;
      }
    });

    if (DOM.joystickArea && DOM.joystickKnob) {
      const area = DOM.joystickArea;
      const knob = DOM.joystickKnob;
      const maxRadius = 45;

      const handleTouchStart = e => {
        const touch = e.touches[0];
        const rect = area.getBoundingClientRect();
        Joystick.active = true;
        Joystick.startX = rect.left + rect.width / 2;
        Joystick.startY = rect.top + rect.height / 2;
        updateJoystickPosition(touch.clientX, touch.clientY);
      };

      const handleTouchMove = e => {
        if (!Joystick.active) return;
        const touch = e.touches[0];
        updateJoystickPosition(touch.clientX, touch.clientY);
      };

      const handleTouchEnd = () => {
        Joystick.active = false;
        Joystick.dirX = 0;
        Joystick.dirY = 0;
        knob.style.transform = `translate(0px, 0px)`;
      };

      const updateJoystickPosition = (clientX, clientY) => {
        const dx = clientX - Joystick.startX;
        const dy = clientY - Joystick.startY;
        const dist = Math.hypot(dx, dy);
        const clampedDist = Math.min(dist, maxRadius);
        const angle = Math.atan2(dy, dx);

        const knobX = Math.cos(angle) * clampedDist;
        const knobY = Math.sin(angle) * clampedDist;
        knob.style.transform = `translate(${knobX}px, ${knobY}px)`;

        Joystick.dirX = knobX / maxRadius;
        Joystick.dirY = knobY / maxRadius;
      };

      area.addEventListener('touchstart', handleTouchStart, { passive: false });
      area.addEventListener('touchmove', handleTouchMove, { passive: false });
      area.addEventListener('touchend', handleTouchEnd);
      area.addEventListener('touchcancel', handleTouchEnd);
    }
  }

  function initEvents() {
    initControls();
    renderCharacterPicker();

    if (DOM.inputNickname) {
      DOM.inputNickname.value = getPlayerName();
      DOM.inputNickname.addEventListener('change', () => {
        const clean = DOM.inputNickname.value.trim().substring(0, 20) || getPlayerName();
        localStorage.setItem('sudoku_player_name', clean);
        DOM.inputNickname.value = clean;
      });
    }

    if (DOM.killerCountSelector) {
      DOM.killerCountSelector.querySelectorAll('.btn-toggle-option').forEach(btn => {
        btn.addEventListener('click', () => {
          const val = parseInt(btn.dataset.killers, 10) || 1;
          State.killerCountSetting = val;
          DOM.killerCountSelector.querySelectorAll('.btn-toggle-option').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          SombrasAudio.click();
        });
      });
    }

    if (DOM.btnCreateRoom) {
      DOM.btnCreateRoom.addEventListener('click', async () => {
        try {
          const roomId = await createRoom();
          showToast(`¡Sala de Sombras creada! Código: ${roomId}`, '🚀');
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
          navigator.clipboard.writeText(code).then(() => showToast('¡Código copiado!', '📋'));
        }
      });
    }

    if (DOM.btnShareRoom) {
      DOM.btnShareRoom.addEventListener('click', () => {
        const code = DOM.displayRoomCode ? DOM.displayRoomCode.textContent : '';
        const url = `${window.location.origin}${window.location.pathname}?game=sombras&room=${code}`;
        if (navigator.share) {
          navigator.share({ title: 'Sombras del Bosque', text: `¡Únete a mi partida de Sombras! Código: ${code}`, url }).catch(() => {});
        } else if (navigator.clipboard) {
          navigator.clipboard.writeText(url).then(() => showToast('¡Enlace copiado!', '🔗'));
        }
      });
    }

    if (DOM.btnHostStart) DOM.btnHostStart.addEventListener('click', startGame);
    if (DOM.btnLeaveWaiting) DOM.btnLeaveWaiting.addEventListener('click', leaveRoom);
    if (DOM.btnPlayAgain) DOM.btnPlayAgain.addEventListener('click', startGame);
    if (DOM.btnReturnMenu) DOM.btnReturnMenu.addEventListener('click', leaveRoom);
  }

  function onAssetsReady() {
    renderCharacterPicker();
  }

  function init() {
    cacheDOM();
    initEvents();
  }

  const SombrasGame = {
    init,
    createRoom,
    joinRoom,
    leaveRoom,
    showView,
    onAssetsReady
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = SombrasGame;
  } else {
    global.SombrasGame = SombrasGame;
  }

})(typeof window !== 'undefined' ? window : self);
