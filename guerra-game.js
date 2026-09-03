/**
 * GUERRA (SHITHEAD / PALACE) - MULTIPLAYER CARD GAME ENGINE & CONTROLLER
 * 
 * Features:
 * - 1 to 4 players (1 player vs 3 AI bots; 2-4 real players without AI).
 * - Betting & Coin System (🪙):
 *   - Each player starts with 1,000 coins.
 *   - Host/Player selects the bet amount (50, 100, 250, 500, 1000 🪙).
 *   - In Solo mode, the 3 AI bots match and accept any bet amount.
 *   - 1st place winner takes 100% of the accumulated Pot!
 *   - Free emergency refill (+500 coins) if balance falls below 100.
 * - Square / Casino felt table layout with 4 relative seat positions (Sur, Oeste, Norte, Este).
 * - Animated card dealing phase with sound effects.
 * - Standard 52-card deck: 3 < 4 < 5 < 6 < 7 < 8 < 9 < 10 < J < Q < K < A.
 * - Special 2 (reset), Special 7 (must play <= 7), Special 10 (burns pile + extra turn).
 * - 4-of-a-kind consecutive burn + extra turn.
 * - Multi-card plays (e.g. three 8s at once).
 * - Preparation: 3 face-down + 6 cards -> choose 3 for face-up -> 3 stay in private hand.
 * - Draw deck refills hand up to 3 cards while deck exists.
 * - Phases: Hand -> Face-Up -> Face-Down (blind).
 * - Strict hand privacy via separated Firebase RTDB nodes.
 * - Autonomous, resilient AI bots (Alfa, Beta, Gamma) with foolproof turn execution.
 */

(function (global) {
  'use strict';

  // --- COIN & CURRENCY SYSTEM ---
  const COIN_STORAGE_KEY = 'guerra_player_coins';
  const BONUS_CLAIMED_KEY = 'guerra_bonus_claimed';
  const DEFAULT_COINS = 1000;
  let selectedBetAmount = 100;
  let payoutProcessedForMatch = null;

  function getPlayerCoins() {
    const stored = localStorage.getItem(COIN_STORAGE_KEY);
    if (stored === null || isNaN(parseInt(stored, 10))) {
      localStorage.setItem(COIN_STORAGE_KEY, DEFAULT_COINS.toString());
      return DEFAULT_COINS;
    }
    return Math.max(0, parseInt(stored, 10));
  }

  function setPlayerCoins(amount) {
    const clean = Math.max(0, parseInt(amount, 10) || 0);
    localStorage.setItem(COIN_STORAGE_KEY, clean.toString());
    updateCoinsDisplay();
    return clean;
  }

  function addPlayerCoins(delta) {
    const current = getPlayerCoins();
    return setPlayerCoins(current + delta);
  }

  function isBonusClaimed() {
    return localStorage.getItem(BONUS_CLAIMED_KEY) === 'true';
  }

  function claimFreeCoinsBonus() {
    if (isBonusClaimed()) {
      showToast('Ya has reclamado tu bono único de 500 monedas.', '⚠️');
      return;
    }
    const current = getPlayerCoins();
    if (current >= 100) {
      showToast(`Tienes saldo suficiente (${current} 🪙). El bono único estará disponible si te quedas sin monedas.`, 'ℹ️');
      return;
    }
    localStorage.setItem(BONUS_CLAIMED_KEY, 'true');
    addPlayerCoins(500);
    CardAudio.win();
    showToast('¡Has reclamado tu bono ÚNICO de +500 Monedas! 🎁🪙', '🪙');
    updateCoinsDisplay();
  }

  function updateCoinsDisplay() {
    const coins = getPlayerCoins();
    const display = document.getElementById('guerra-my-coins-display');
    if (display) {
      display.textContent = coins.toLocaleString();
    }
    const btnRefill = document.getElementById('guerra-btn-refill-coins');
    if (btnRefill) {
      if (isBonusClaimed()) {
        btnRefill.style.opacity = '0.35';
        btnRefill.style.cursor = 'not-allowed';
        btnRefill.title = 'Bono de 500 monedas ya reclamado (Disponible solo una vez)';
      } else {
        btnRefill.style.opacity = '1';
        btnRefill.style.cursor = 'pointer';
        btnRefill.title = 'Reclamar bono único de 500 monedas si te quedas sin fondos';
      }
    }
  }

  // Card Definition & Suits
  const SUITS = [
    { symbol: '♠', name: 'spades', color: 'black' },
    { symbol: '♥', name: 'hearts', color: 'red' },
    { symbol: '♦', name: 'diamonds', color: 'red' },
    { symbol: '♣', name: 'clubs', color: 'black' }
  ];

  const RANKS = [
    { label: '3', value: 3, isSpecial: false },
    { label: '4', value: 4, isSpecial: false },
    { label: '5', value: 5, isSpecial: false },
    { label: '6', value: 6, isSpecial: false },
    { label: '7', value: 7, isSpecial: true },
    { label: '8', value: 8, isSpecial: false },
    { label: '9', value: 9, isSpecial: false },
    { label: '10', value: 10, isSpecial: true },
    { label: 'J', value: 11, isSpecial: false },
    { label: 'Q', value: 12, isSpecial: false },
    { label: 'K', value: 13, isSpecial: false },
    { label: 'A', value: 14, isSpecial: false },
    { label: '2', value: 15, isSpecial: true } // 2 is special wildcard
  ];

  function createDeck() {
    const deck = [];
    let id = 1;
    SUITS.forEach(suit => {
      RANKS.forEach(rank => {
        deck.push({
          id: `card_${id++}_${rank.label}_${suit.symbol}`,
          rank: rank.label,
          value: rank.value,
          suit: suit.symbol,
          color: suit.color,
          name: `${rank.label}${suit.symbol}`
        });
      });
    });
    return shuffle(deck);
  }

  function getRandomCard() {
    const suit = SUITS[Math.floor(Math.random() * SUITS.length)];
    const rank = RANKS[Math.floor(Math.random() * RANKS.length)];
    return {
      id: `card_rnd_${Math.random().toString(36).substr(2, 6)}_${rank.label}_${suit.symbol}`,
      rank: rank.label,
      value: rank.value,
      suit: suit.symbol,
      color: suit.color,
      name: `${rank.label}${suit.symbol}`
    };
  }

  function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // Sound FX synthesizer for Cards
  const CardAudio = (function () {
    let ctx = null;
    function getCtx() {
      if (!ctx && (window.AudioContext || window.webkitAudioContext)) {
        const AC = window.AudioContext || window.webkitAudioContext;
        ctx = new AC();
      }
      if (ctx && ctx.state === 'suspended') ctx.resume();
      return ctx;
    }
    function tone(freq, type = 'sine', duration = 0.08, gainVal = 0.15) {
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
      deal: () => tone(480, 'sine', 0.04, 0.08),
      playCard: () => tone(580, 'sine', 0.06, 0.12),
      burn: () => {
        tone(220, 'sawtooth', 0.3, 0.2);
        setTimeout(() => tone(440, 'triangle', 0.2, 0.2), 80);
      },
      pickup: () => tone(330, 'triangle', 0.15, 0.12),
      turn: () => tone(750, 'sine', 0.05, 0.08),
      coin: () => {
        tone(987.77, 'sine', 0.08, 0.15);
        setTimeout(() => tone(1318.51, 'sine', 0.15, 0.15), 60);
      },
      win: () => {
        [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
          setTimeout(() => tone(f, 'triangle', 0.25, 0.2), i * 120);
        });
      }
    };
  })();

  // Game & Room State
  let currentRoomId = null;
  let currentRoomRef = null;
  let currentPrivateRef = null;
  let isSinglePlayerMode = false;
  let singlePlayerState = null;
  let aiTurnTimeout = null;

  const State = {
    myUid: null,
    isCreator: false,
    selectedForSetup: new Set(),
    selectedCardsToPlay: new Set(),
    myPrivateCards: {
      hand: [],
      faceDown: [],
      selectable6: []
    },
    botPrivateData: {},
    room: null
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

  // --- RULE ENGINE HELPERS ---

  function canPlayCard(card, pileTop, isLowerRestriction) {
    if (!card) return false;
    if (card.rank === '2') return true;
    if (card.rank === '10') return true;
    if (!pileTop || pileTop.rank === '2') return true;

    if (isLowerRestriction) {
      if (card.rank === '2') return true;
      const rankNum = card.rank === 'A' ? 14 : (card.value <= 7 ? card.value : -1);
      return rankNum >= 3 && rankNum <= 7;
    }

    return card.value >= pileTop.value;
  }

  function checkFourOfAKindBurn(pile, newlyPlayedCards) {
    const fullPile = [...pile, ...newlyPlayedCards];
    if (fullPile.length < 4) return false;
    const last4 = fullPile.slice(-4);
    const targetRank = last4[0].rank;
    return last4.every(c => c.rank === targetRank);
  }

  // --- DOM CACHING ---
  const DOM = {};

  function cacheDOM() {
    DOM.views = {
      lobby: document.getElementById('guerra-view-lobby'),
      waiting: document.getElementById('guerra-view-waiting'),
      setup: document.getElementById('guerra-view-setup'),
      game: document.getElementById('guerra-view-game'),
      results: document.getElementById('guerra-view-results')
    };

    DOM.inputNickname = document.getElementById('guerra-nickname-input');
    DOM.btnCreateRoom = document.getElementById('guerra-btn-create-room');
    DOM.btnViewRules = document.getElementById('guerra-btn-view-rules');
    DOM.inputJoinCode = document.getElementById('guerra-input-join-code');
    DOM.btnJoinRoom = document.getElementById('guerra-btn-join-room');
    DOM.btnGameRules = document.getElementById('guerra-btn-game-rules');
    DOM.btnRefillCoins = document.getElementById('guerra-btn-refill-coins');
    DOM.betButtons = document.querySelectorAll('#guerra-bet-selector .btn-toggle-option');

    DOM.displayRoomCode = document.getElementById('guerra-display-room-code');
    DOM.btnCopyCode = document.getElementById('guerra-btn-copy-code');
    DOM.btnShareRoom = document.getElementById('guerra-btn-share-room');
    DOM.waitingPlayersList = document.getElementById('guerra-waiting-players-list');
    DOM.waitingPlayersCount = document.getElementById('guerra-waiting-players-count');
    DOM.waitingBetBadge = document.getElementById('guerra-waiting-bet-badge');
    DOM.btnHostStart = document.getElementById('guerra-btn-host-start');
    DOM.btnLeaveWaiting = document.getElementById('guerra-btn-leave-waiting');

    DOM.dealingOverlay = document.getElementById('guerra-dealing-overlay');
    DOM.dealingText = document.getElementById('guerra-dealing-text');

    DOM.setupSelectableCardsGrid = document.getElementById('guerra-setup-selectable-cards');
    DOM.setupSelectedCount = document.getElementById('guerra-setup-selected-count');
    DOM.btnConfirmSetup = document.getElementById('guerra-btn-confirm-setup');
    DOM.setupWaitingNotice = document.getElementById('guerra-setup-waiting-notice');

    DOM.seatTop = document.getElementById('guerra-seat-top');
    DOM.seatLeft = document.getElementById('guerra-seat-left');
    DOM.seatRight = document.getElementById('guerra-seat-right');
    DOM.seatBottom = document.getElementById('guerra-seat-bottom');

    DOM.drawDeckCount = document.getElementById('guerra-deck-count');
    DOM.playPile = document.getElementById('guerra-play-pile');
    DOM.playPileCount = document.getElementById('guerra-pile-count');
    DOM.pileBurnEffect = document.getElementById('guerra-pile-burn-effect');
    DOM.turnNotice = document.getElementById('guerra-turn-notice');
    DOM.turnPlayerName = document.getElementById('guerra-turn-player-name');
    DOM.actionNotice = document.getElementById('guerra-action-notice');
    DOM.ruleNotice = document.getElementById('guerra-rule-notice');
    DOM.livePotCount = document.getElementById('guerra-live-pot-count');

    DOM.myTableCardsContainer = document.getElementById('guerra-my-table-cards');
    DOM.myHandCardsContainer = document.getElementById('guerra-my-hand-cards');
    DOM.btnPlaySelected = document.getElementById('guerra-btn-play-selected');
    DOM.btnPickupPile = document.getElementById('guerra-btn-pickup-pile');
    DOM.btnAbandonGame = document.getElementById('guerra-btn-abandon-game');

    DOM.podiumContainer = document.getElementById('guerra-podium-container');
    DOM.resultsTableBody = document.getElementById('guerra-results-table-body');
    DOM.btnPlayAgain = document.getElementById('guerra-btn-play-again');
    DOM.btnReturnMenu = document.getElementById('guerra-btn-return-menu');
  }

  function showView(viewKey) {
    Object.keys(DOM.views).forEach(key => {
      if (DOM.views[key]) {
        DOM.views[key].classList.toggle('active', key === viewKey);
      }
    });
    updateCoinsDisplay();
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

  // --- CARD RENDERING UTILITIES ---

  function renderCardHTML(card, isSelected = false, isFaceDown = false, isClickable = true, customClass = '') {
    if (isFaceDown) {
      return `
        <div class="guerra-card card-back ${isClickable ? 'clickable' : ''} ${customClass}">
          <div class="card-back-pattern">🂠</div>
        </div>
      `;
    }

    if (!card) {
      return `<div class="guerra-card card-placeholder ${customClass}"></div>`;
    }

    const suitColorClass = card.color === 'red' ? 'card-red' : 'card-black';
    return `
      <div class="guerra-card card-face ${suitColorClass} ${isSelected ? 'selected' : ''} ${isClickable ? 'clickable' : ''} ${customClass}" 
           data-card-id="${card.id}" data-rank="${card.rank}" data-value="${card.value}">
        <div class="card-corner top-left">
          <span class="card-rank">${card.rank}</span>
          <span class="card-suit">${card.suit}</span>
        </div>
        <div class="card-center">
          <span class="card-center-suit">${card.suit}</span>
        </div>
        <div class="card-corner bottom-right">
          <span class="card-rank">${card.rank}</span>
          <span class="card-suit">${card.suit}</span>
        </div>
      </div>
    `;
  }

  // --- DEALING ANIMATION ---

  async function playDealingAnimation(playerNames) {
    if (!DOM.dealingOverlay) return;
    DOM.dealingOverlay.style.display = 'flex';
    if (DOM.dealingText) DOM.dealingText.textContent = 'Repartiendo cartas y apostando...';

    const seats = ['seat-bottom', 'seat-left', 'seat-top', 'seat-right'];
    for (let i = 0; i < 8; i++) {
      CardAudio.deal();
      const flyingCard = document.createElement('div');
      flyingCard.className = `flying-card-anim target-${seats[i % seats.length]}`;
      flyingCard.innerHTML = `<div class="guerra-card card-back"><div class="card-back-pattern">🂠</div></div>`;
      DOM.dealingOverlay.appendChild(flyingCard);
      await new Promise(r => setTimeout(r, 100));
    }

    await new Promise(r => setTimeout(r, 500));
    DOM.dealingOverlay.style.display = 'none';
    DOM.dealingOverlay.innerHTML = `
      <div class="spinner"></div>
      <h3 id="guerra-dealing-text" class="modal-title" style="font-size: 18px; margin-top: 10px;">Repartiendo cartas...</h3>
    `;
  }

  // --- ROOM CREATION & INITIAL SETUP ---

  async function createRoom() {
    const uid = getPlayerUid();
    const name = getPlayerName();
    const roomId = generateRoomCode();
    const bet = selectedBetAmount;

    // Verify balance
    if (getPlayerCoins() < bet) {
      throw new Error(`Saldo insuficiente (${getPlayerCoins()} 🪙). Necesitas ${bet} 🪙 para crear esta sala. Ajusta la apuesta o reclama el bono.`);
    }

    const service = global.FirebaseService;
    let db = null;
    if (service && service.isConfigured()) {
      service.initFirebase();
      db = service.getDb();
    }

    currentRoomId = roomId;
    State.myUid = uid;
    State.isCreator = true;
    State.botPrivateData = {};
    payoutProcessedForMatch = null;

    if (!db) {
      isSinglePlayerMode = true;
      singlePlayerState = createLocalRoomState(roomId, uid, name, bet);
      renderWaitingRoom(singlePlayerState);
      return roomId;
    }

    isSinglePlayerMode = false;
    const roomRef = db.ref('guerra_rooms/' + roomId);
    currentRoomRef = roomRef;

    const initialPayload = {
      id: roomId,
      creatorId: uid,
      betAmount: bet,
      totalPot: bet,
      status: 'WAITING',
      currentTurnIndex: 0,
      activePlayerUid: null,
      pile: [],
      pileTop: null,
      isLowerRestriction: false,
      deckCount: 0,
      turnOrder: [uid],
      players: {
        [uid]: {
          id: uid,
          name: name,
          isAI: false,
          connected: true,
          faceUp: [],
          handCount: 0,
          faceDownCount: 0,
          setupReady: false,
          isFinished: false,
          finishPlace: null,
          joinedAt: global.firebase.database.ServerValue.TIMESTAMP
        }
      },
      winners: []
    };

    await roomRef.set(initialPayload);
    attachRoomListeners(roomRef, uid);
    return roomId;
  }

  async function joinRoom(roomCode) {
    const cleanCode = roomCode.trim().toUpperCase();
    const uid = getPlayerUid();
    const name = getPlayerName();

    const service = global.FirebaseService;
    if (!service || !service.isConfigured()) {
      throw new Error('Configura Firebase para unirte a salas multijugador.');
    }

    service.initFirebase();
    const db = service.getDb();
    const roomRef = db.ref('guerra_rooms/' + cleanCode);
    const snap = await roomRef.once('value');
    const room = snap.val();

    if (!room) {
      throw new Error('La sala de Guerra no existe. Verifica el código.');
    }

    const bet = room.betAmount || 100;
    if (getPlayerCoins() < bet) {
      throw new Error(`Saldo insuficiente (${getPlayerCoins()} 🪙). Esta sala requiere una apuesta de ${bet} 🪙.`);
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
    if (count >= 4) {
      throw new Error('La sala ya tiene el límite máximo de 4 jugadores.');
    }

    const playerPayload = {
      id: uid,
      name: name,
      isAI: false,
      connected: true,
      faceUp: [],
      handCount: 0,
      faceDownCount: 0,
      setupReady: false,
      isFinished: false,
      finishPlace: null,
      joinedAt: global.firebase.database.ServerValue.TIMESTAMP
    };

    const turnOrder = room.turnOrder || [];
    if (!turnOrder.includes(uid)) turnOrder.push(uid);

    await roomRef.child(`players/${uid}`).set(playerPayload);
    await roomRef.child('turnOrder').set(turnOrder);

    currentRoomId = cleanCode;
    currentRoomRef = roomRef;
    State.myUid = uid;
    State.isCreator = (room.creatorId === uid);
    payoutProcessedForMatch = null;

    attachRoomListeners(roomRef, uid);
    return cleanCode;
  }

  function createLocalRoomState(roomId, uid, name, bet = 100) {
    return {
      id: roomId,
      creatorId: uid,
      betAmount: bet,
      totalPot: bet * 4,
      status: 'WAITING',
      currentTurnIndex: 0,
      activePlayerUid: null,
      pile: [],
      pileTop: null,
      isLowerRestriction: false,
      deck: [],
      deckCount: 0,
      turnOrder: [uid],
      players: {
        [uid]: {
          id: uid,
          name: name,
          isAI: false,
          connected: true,
          faceUp: [],
          handCount: 0,
          faceDownCount: 0,
          setupReady: false,
          isFinished: false,
          finishPlace: null
        }
      },
      privateData: {
        [uid]: { hand: [], faceDown: [] }
      },
      winners: []
    };
  }

  // --- START GAME WORKFLOW & DEALING ---

  async function startGame() {
    payoutProcessedForMatch = null;

    if (isSinglePlayerMode) {
      startLocalGame();
      return;
    }

    if (!currentRoomRef || !State.isCreator) return;
    const snap = await currentRoomRef.once('value');
    const room = snap.val();
    if (!room) return;

    const bet = room.betAmount || selectedBetAmount || 100;
    if (getPlayerCoins() < bet) {
      showToast(`No tienes suficientes monedas (${getPlayerCoins()} 🪙) para la apuesta de ${bet} 🪙.`, '❌');
      return;
    }

    const players = room.players || {};
    const playerIds = Object.keys(players);
    const realPlayerCount = playerIds.length;

    const deck = createDeck();
    const finalPlayers = { ...players };
    const turnOrder = [...playerIds];

    // If exactly 1 real player -> create 3 AI bots!
    if (realPlayerCount === 1) {
      const botNames = ['Bot Alfa 🤖', 'Bot Beta 🤖', 'Bot Gamma 🤖'];
      for (let i = 0; i < 3; i++) {
        const botId = `bot_${i + 1}`;
        turnOrder.push(botId);
        finalPlayers[botId] = {
          id: botId,
          name: botNames[i],
          isAI: true,
          connected: true,
          faceUp: [],
          handCount: 3,
          faceDownCount: 3,
          setupReady: true,
          isFinished: false,
          finishPlace: null
        };
      }
    }

    const totalPot = bet * turnOrder.length;

    // Deduct bet from human host
    addPlayerCoins(-bet);
    CardAudio.coin();
    showToast(`Apuesta de ${bet} 🪙 realizada. ¡Bote total: ${totalPot} 🪙!`, '🪙');

    const db = global.FirebaseService.getDb();
    const privateUpdates = {};
    State.botPrivateData = {};

    turnOrder.forEach(pid => {
      const faceDown = [deck.pop(), deck.pop(), deck.pop()];
      const selectable6 = [deck.pop(), deck.pop(), deck.pop(), deck.pop(), deck.pop(), deck.pop()];

      if (finalPlayers[pid].isAI) {
        selectable6.sort((a, b) => {
          const scoreA = a.rank === '2' ? 20 : (a.rank === '10' ? 19 : a.value);
          const scoreB = b.rank === '2' ? 20 : (b.rank === '10' ? 19 : b.value);
          return scoreB - scoreA;
        });
        const chosenFaceUp = [selectable6[0], selectable6[1], selectable6[2]];
        const privateHand = [selectable6[3], selectable6[4], selectable6[5]];

        finalPlayers[pid].faceUp = chosenFaceUp;
        finalPlayers[pid].handCount = 3;
        finalPlayers[pid].faceDownCount = 3;
        finalPlayers[pid].setupReady = true;

        State.botPrivateData[pid] = {
          hand: privateHand,
          faceDown: faceDown
        };

        privateUpdates[`guerra_private/${currentRoomId}/${pid}`] = {
          hand: privateHand,
          faceDown: faceDown
        };
      } else {
        finalPlayers[pid].faceDownCount = 3;
        finalPlayers[pid].handCount = 3;
        finalPlayers[pid].setupReady = false;

        privateUpdates[`guerra_private/${currentRoomId}/${pid}`] = {
          hand: [],
          faceDown: faceDown,
          selectable6: selectable6
        };
      }
    });

    await playDealingAnimation(Object.values(finalPlayers).map(p => p.name));

    try {
      await db.ref().update(privateUpdates);
    } catch (e) {
      console.warn('Private updates warning:', e);
    }

    await currentRoomRef.update({
      status: 'SETUP',
      betAmount: bet,
      totalPot: totalPot,
      deckCount: deck.length,
      drawDeck: deck,
      players: finalPlayers,
      turnOrder: turnOrder,
      winners: []
    });
  }

  async function startLocalGame() {
    const uid = State.myUid;
    const name = getPlayerName();
    const bet = singlePlayerState.betAmount || selectedBetAmount || 100;

    if (getPlayerCoins() < bet) {
      showToast(`No tienes suficientes monedas (${getPlayerCoins()} 🪙) para la apuesta de ${bet} 🪙.`, '❌');
      return;
    }

    const deck = createDeck();
    const turnOrder = [uid, 'bot_1', 'bot_2', 'bot_3'];
    const botNames = ['Bot Alfa 🤖', 'Bot Beta 🤖', 'Bot Gamma 🤖'];
    const totalPot = bet * 4;

    addPlayerCoins(-bet);
    CardAudio.coin();
    showToast(`Apuesta de ${bet} 🪙 realizada. ¡Bote total: ${totalPot} 🪙!`, '🪙');

    singlePlayerState.players = {
      [uid]: {
        id: uid,
        name: name,
        isAI: false,
        connected: true,
        faceUp: [],
        handCount: 3,
        faceDownCount: 3,
        setupReady: false,
        isFinished: false,
        finishPlace: null
      }
    };

    singlePlayerState.privateData = {};

    const humanFaceDown = [deck.pop(), deck.pop(), deck.pop()];
    const humanSelectable = [deck.pop(), deck.pop(), deck.pop(), deck.pop(), deck.pop(), deck.pop()];
    singlePlayerState.privateData[uid] = {
      faceDown: humanFaceDown,
      selectable6: humanSelectable,
      hand: []
    };

    for (let i = 0; i < 3; i++) {
      const bid = `bot_${i + 1}`;
      const botFaceDown = [deck.pop(), deck.pop(), deck.pop()];
      const bot6 = [deck.pop(), deck.pop(), deck.pop(), deck.pop(), deck.pop(), deck.pop()];
      bot6.sort((a, b) => {
        const sa = a.rank === '2' ? 20 : (a.rank === '10' ? 19 : a.value);
        const sb = b.rank === '2' ? 20 : (b.rank === '10' ? 19 : b.value);
        return sb - sa;
      });
      const botFaceUp = [bot6[0], bot6[1], bot6[2]];
      const botHand = [bot6[3], bot6[4], bot6[5]];

      singlePlayerState.players[bid] = {
        id: bid,
        name: botNames[i],
        isAI: true,
        connected: true,
        faceUp: botFaceUp,
        handCount: 3,
        faceDownCount: 3,
        setupReady: true,
        isFinished: false,
        finishPlace: null
      };

      singlePlayerState.privateData[bid] = {
        faceDown: botFaceDown,
        hand: botHand
      };
    }

    await playDealingAnimation(['Tú', ...botNames]);

    singlePlayerState.status = 'SETUP';
    singlePlayerState.betAmount = bet;
    singlePlayerState.totalPot = totalPot;
    singlePlayerState.deck = deck;
    singlePlayerState.deckCount = deck.length;
    singlePlayerState.turnOrder = turnOrder;
    singlePlayerState.winners = [];

    renderSetupView(singlePlayerState, uid);
  }

  // --- SETUP SELECTION (CHOOSE 3 OF 6 FOR FACE-UP) ---

  function renderSetupView(room, myUid) {
    const privateInfo = isSinglePlayerMode
      ? (singlePlayerState.privateData[myUid] || {})
      : State.myPrivateCards;

    const selectable6 = privateInfo.selectable6 || [];
    State.selectedForSetup.clear();

    if (DOM.setupSelectableCardsGrid) {
      DOM.setupSelectableCardsGrid.innerHTML = selectable6.map(card => `
        <div class="setup-card-wrapper" data-card-id="${card.id}">
          ${renderCardHTML(card, false, false, true)}
        </div>
      `).join('');

      DOM.setupSelectableCardsGrid.querySelectorAll('.setup-card-wrapper').forEach(wrapper => {
        wrapper.addEventListener('click', () => {
          const cardId = wrapper.dataset.cardId;
          const card = selectable6.find(c => c.id === cardId);
          if (!card) return;

          if (State.selectedForSetup.has(card)) {
            State.selectedForSetup.delete(card);
            wrapper.querySelector('.guerra-card').classList.remove('selected');
          } else {
            if (State.selectedForSetup.size >= 3) {
              showToast('Ya has seleccionado 3 cartas.', '⚠️');
              return;
            }
            State.selectedForSetup.add(card);
            wrapper.querySelector('.guerra-card').classList.add('selected');
          }

          const count = State.selectedForSetup.size;
          if (DOM.setupSelectedCount) DOM.setupSelectedCount.textContent = `${count} / 3`;
          if (DOM.btnConfirmSetup) DOM.btnConfirmSetup.disabled = (count !== 3);
        });
      });
    }

    if (DOM.btnConfirmSetup) {
      DOM.btnConfirmSetup.disabled = true;
      DOM.btnConfirmSetup.style.display = 'block';
    }
    if (DOM.setupWaitingNotice) DOM.setupWaitingNotice.style.display = 'none';

    showView('setup');
  }

  async function confirmSetup() {
    if (State.selectedForSetup.size !== 3) return;
    const myUid = State.myUid;
    const chosenFaceUp = Array.from(State.selectedForSetup);

    if (isSinglePlayerMode) {
      const pData = singlePlayerState.privateData[myUid];
      const all6 = pData.selectable6 || [];
      const privateHand = all6.filter(c => !chosenFaceUp.some(cf => cf.id === c.id));

      pData.hand = privateHand;
      delete pData.selectable6;

      singlePlayerState.players[myUid].faceUp = chosenFaceUp;
      singlePlayerState.players[myUid].setupReady = true;

      // Start Playing
      singlePlayerState.status = 'PLAYING';
      singlePlayerState.activePlayerUid = singlePlayerState.turnOrder[0];
      singlePlayerState.currentTurnIndex = 0;
      renderGameTable(singlePlayerState, myUid);
      return;
    }

    // Multiplayer Firebase Flow
    const all6 = State.myPrivateCards.selectable6 || [];
    const privateHand = all6.filter(c => !chosenFaceUp.some(cf => cf.id === c.id));

    const db = global.FirebaseService.getDb();
    await db.ref(`guerra_private/${currentRoomId}/${myUid}`).set({
      hand: privateHand,
      faceDown: State.myPrivateCards.faceDown || []
    });

    await currentRoomRef.child(`players/${myUid}`).update({
      faceUp: chosenFaceUp,
      setupReady: true
    });

    if (DOM.setupWaitingNotice) DOM.setupWaitingNotice.style.display = 'block';
    if (DOM.btnConfirmSetup) DOM.btnConfirmSetup.style.display = 'none';

    // Host checks if all ready -> transition to PLAYING
    if (State.isCreator) {
      const snap = await currentRoomRef.once('value');
      const r = snap.val();
      const allPlayers = Object.values(r.players || {});
      const allReady = allPlayers.every(p => p.setupReady);

      if (allReady) {
        await currentRoomRef.update({
          status: 'PLAYING',
          activePlayerUid: r.turnOrder[0],
          currentTurnIndex: 0
        });
      }
    }
  }

  // --- GAMEPLAY ENGINE: PLAY CARDS, BURNS, SPECIALS ---

  async function playSelectedCards() {
    if (State.selectedCardsToPlay.size === 0) return;
    const selectedCards = Array.from(State.selectedCardsToPlay);
    const first = selectedCards[0];

    // Must be all of same rank
    const allSame = selectedCards.every(c => c.rank === first.rank);
    if (!allSame) {
      showToast('Solo puedes jugar varias cartas si son del mismo número.', '⚠️');
      return;
    }

    const room = isSinglePlayerMode ? singlePlayerState : State.room;
    const pileTop = room.pileTop;
    const isLower = room.isLowerRestriction;

    if (!canPlayCard(first, pileTop, isLower)) {
      showToast('Esta carta no cumple las reglas para jugarse sobre el montón.', '❌');
      return;
    }

    await executePlayAction(State.myUid, selectedCards);
  }

  async function playBlindFaceDownCard(cardIndex) {
    const room = isSinglePlayerMode ? singlePlayerState : State.room;
    if (room.activePlayerUid !== State.myUid) {
      showToast('No es tu turno.', '⏳');
      return;
    }

    const privateInfo = isSinglePlayerMode ? singlePlayerState.privateData[State.myUid] : State.myPrivateCards;
    const faceDown = privateInfo.faceDown || [];
    if (cardIndex >= faceDown.length) return;

    const revealedCard = faceDown.splice(cardIndex, 1)[0];
    const pileTop = room.pileTop;
    const isLower = room.isLowerRestriction;

    if (canPlayCard(revealedCard, pileTop, isLower)) {
      showToast(`¡Revelaste ${revealedCard.name} y es válida! ✅`, '🎉');
      await executePlayAction(State.myUid, [revealedCard], true);
    } else {
      showToast(`Revelaste ${revealedCard.name} (no válida). ¡Recoges todo el montón! 💥`, '❌');
      await executePickupAction(State.myUid, revealedCard);
    }
  }

  async function pickupPile() {
    const room = isSinglePlayerMode ? singlePlayerState : State.room;
    if (room.activePlayerUid !== State.myUid) {
      showToast('No es tu turno.', '⏳');
      return;
    }
    await executePickupAction(State.myUid);
  }

  async function executePlayAction(playerUid, playedCards, isFromFaceDown = false) {
    const room = isSinglePlayerMode ? singlePlayerState : State.room;
    if (!room || !room.players || !room.players[playerUid]) return;

    const player = room.players[playerUid];
    const firstCard = playedCards[0];
    CardAudio.playCard();

    let privateInfo;
    if (isSinglePlayerMode) {
      privateInfo = singlePlayerState.privateData[playerUid] || { hand: [], faceDown: [] };
    } else if (player.isAI) {
      if (!State.botPrivateData[playerUid]) {
        State.botPrivateData[playerUid] = { hand: [], faceDown: [] };
      }
      privateInfo = State.botPrivateData[playerUid];
    } else {
      privateInfo = State.myPrivateCards;
    }

    // Remove played cards from source
    if (!isFromFaceDown) {
      const hand = privateInfo.hand || [];
      if (hand.length > 0) {
        playedCards.forEach(pc => {
          const idx = hand.findIndex(c => c.id === pc.id);
          if (idx !== -1) hand.splice(idx, 1);
        });
        privateInfo.hand = hand;
      } else {
        // From face-up
        const faceUp = player.faceUp || [];
        playedCards.forEach(pc => {
          const idx = faceUp.findIndex(c => c.id === pc.id);
          if (idx !== -1) faceUp.splice(idx, 1);
        });
        player.faceUp = faceUp;
      }
    }

    // Refill Hand up to 3 from draw deck
    const drawDeck = isSinglePlayerMode ? singlePlayerState.deck : (room.drawDeck || []);
    while ((privateInfo.hand || []).length < 3 && drawDeck.length > 0) {
      const drawn = drawDeck.pop();
      if (drawn) {
        privateInfo.hand.push(drawn);
      }
    }

    // Check Special Rules & Burns
    let newPile = [...(room.pile || []), ...playedCards];
    let newPileTop = firstCard;
    let isBurn = false;
    let is7Played = false;

    // 10 = Burn Pile + Extra Turn
    if (firstCard.rank === '10') {
      isBurn = true;
      newPile = [];
      newPileTop = null;
      CardAudio.burn();
      triggerBurnAnimation();
      showActionBanner(`💥 ¡${player.name} tiró un 10 y quemó el montón! (Turno extra)`);
    }
    // 4 of a kind consecutive = Burn Pile + Extra Turn
    else if (checkFourOfAKindBurn(room.pile || [], playedCards)) {
      isBurn = true;
      newPile = [];
      newPileTop = null;
      CardAudio.burn();
      triggerBurnAnimation();
      showActionBanner(`🔥 ¡4 cartas iguales consecutivas! ${player.name} quemó el montón (Turno extra).`);
    }
    // 2 = Reset pile top
    else if (firstCard.rank === '2') {
      showActionBanner(`🃏 ${player.name} jugó un 2 (Reinicio). La siguiente carta puede ser cualquiera.`);
    }
    // 7 = Lower restriction
    else if (firstCard.rank === '7') {
      is7Played = true;
      showActionBanner(`⚡ ${player.name} jugó un 7. ¡El siguiente debe tirar 7 o menor!`);
    }
    else {
      showActionBanner(`${player.name} jugó ${playedCards.map(c => c.name).join(', ')}.`);
    }

    player.handCount = (privateInfo.hand && privateInfo.hand.length) || 0;
    player.faceUpCount = (player.faceUp && player.faceUp.length) || 0;
    player.faceDownCount = (privateInfo.faceDown && privateInfo.faceDown.length) || 0;

    // Check Victory
    const totalRemaining = player.handCount + player.faceUpCount + player.faceDownCount;
    if (totalRemaining === 0 && !player.isFinished) {
      player.isFinished = true;
      const currentWinners = room.winners || [];
      const place = currentWinners.length + 1;
      player.finishPlace = place;
      currentWinners.push({ uid: playerUid, name: player.name, place });
      room.winners = currentWinners;
      showToast(`🏆 ¡${player.name} ha terminado en ${place}º lugar!`, '🎉');
      CardAudio.win();
    }

    // Next Turn
    let nextTurnUid = playerUid;
    if (!isBurn) {
      const turnOrder = room.turnOrder || Object.keys(room.players);
      let nextIdx = (room.currentTurnIndex + 1) % turnOrder.length;
      let loops = 0;
      while (room.players[turnOrder[nextIdx]].isFinished && loops < turnOrder.length) {
        nextIdx = (nextIdx + 1) % turnOrder.length;
        loops++;
      }
      room.currentTurnIndex = nextIdx;
      nextTurnUid = turnOrder[nextIdx];
    }

    const activeUnfinished = Object.values(room.players).filter(p => !p.isFinished);
    const isGameOver = activeUnfinished.length <= 1;

    State.selectedCardsToPlay.clear();

    if (isSinglePlayerMode) {
      singlePlayerState.pile = newPile;
      singlePlayerState.pileTop = newPileTop;
      singlePlayerState.isLowerRestriction = is7Played;
      singlePlayerState.deckCount = drawDeck.length;
      singlePlayerState.activePlayerUid = nextTurnUid;
      if (isGameOver) {
        singlePlayerState.status = 'FINISHED';
        if (activeUnfinished.length === 1) {
          const lastPlayer = activeUnfinished[0];
          lastPlayer.isFinished = true;
          lastPlayer.finishPlace = (singlePlayerState.winners.length + 1);
          singlePlayerState.winners.push({ uid: lastPlayer.id, name: lastPlayer.name, place: lastPlayer.finishPlace });
        }
      }
      renderGameTable(singlePlayerState, State.myUid);
      if (!isGameOver) checkAndTriggerAI(singlePlayerState);
      return;
    }

    // Firebase Multiplayer Sync
    const updates = {
      pile: newPile,
      pileTop: newPileTop,
      isLowerRestriction: is7Played,
      deckCount: drawDeck.length,
      drawDeck: drawDeck,
      currentTurnIndex: room.currentTurnIndex,
      activePlayerUid: nextTurnUid,
      [`players/${playerUid}/handCount`]: player.handCount,
      [`players/${playerUid}/faceUp`]: player.faceUp || [],
      [`players/${playerUid}/faceDownCount`]: player.faceDownCount,
      [`players/${playerUid}/isFinished`]: player.isFinished,
      [`players/${playerUid}/finishPlace`]: player.finishPlace || null,
      winners: room.winners || []
    };

    if (isGameOver) {
      updates.status = 'FINISHED';
    }

    try {
      const db = global.FirebaseService.getDb();
      db.ref(`guerra_private/${currentRoomId}/${playerUid}`).set({
        hand: privateInfo.hand || [],
        faceDown: privateInfo.faceDown || []
      }).catch(() => {});
    } catch (e) {}

    try {
      await currentRoomRef.update(updates);
    } catch (err) {
      console.error('Error updating room:', err);
    }
  }

  async function executePickupAction(playerUid, extraFailedCard = null) {
    const room = isSinglePlayerMode ? singlePlayerState : State.room;
    if (!room || !room.players || !room.players[playerUid]) return;

    const player = room.players[playerUid];
    CardAudio.pickup();
    showActionBanner(`📥 ${player.name} recogió el montón (${room.pile ? room.pile.length : 0} cartas).`);

    let privateInfo;
    if (isSinglePlayerMode) {
      privateInfo = singlePlayerState.privateData[playerUid] || { hand: [], faceDown: [] };
    } else if (player.isAI) {
      if (!State.botPrivateData[playerUid]) {
        State.botPrivateData[playerUid] = { hand: [], faceDown: [] };
      }
      privateInfo = State.botPrivateData[playerUid];
    } else {
      privateInfo = State.myPrivateCards;
    }

    const cardsToAdd = [...(room.pile || [])];
    if (extraFailedCard) cardsToAdd.push(extraFailedCard);

    privateInfo.hand = [...(privateInfo.hand || []), ...cardsToAdd];
    player.handCount = privateInfo.hand.length;

    const newPile = [];
    const newPileTop = null;
    const isLowerRestriction = false;

    const turnOrder = room.turnOrder || Object.keys(room.players);
    let nextIdx = (room.currentTurnIndex + 1) % turnOrder.length;
    let loops = 0;
    while (room.players[turnOrder[nextIdx]].isFinished && loops < turnOrder.length) {
      nextIdx = (nextIdx + 1) % turnOrder.length;
      loops++;
    }
    room.currentTurnIndex = nextIdx;
    const nextTurnUid = turnOrder[nextIdx];

    State.selectedCardsToPlay.clear();

    if (isSinglePlayerMode) {
      singlePlayerState.pile = newPile;
      singlePlayerState.pileTop = newPileTop;
      singlePlayerState.isLowerRestriction = isLowerRestriction;
      singlePlayerState.activePlayerUid = nextTurnUid;
      renderGameTable(singlePlayerState, State.myUid);
      checkAndTriggerAI(singlePlayerState);
      return;
    }

    try {
      const db = global.FirebaseService.getDb();
      db.ref(`guerra_private/${currentRoomId}/${playerUid}`).set({
        hand: privateInfo.hand || [],
        faceDown: privateInfo.faceDown || []
      }).catch(() => {});
    } catch (e) {}

    try {
      await currentRoomRef.update({
        pile: newPile,
        pileTop: newPileTop,
        isLowerRestriction: isLowerRestriction,
        currentTurnIndex: room.currentTurnIndex,
        activePlayerUid: nextTurnUid,
        [`players/${playerUid}/handCount`]: player.handCount
      });
    } catch (err) {
      console.error('Error updating pickup:', err);
    }
  }

  // --- RESILIENT SMART AI BOT ENGINE ---

  function checkAndTriggerAI(room) {
    if (!room || room.status !== 'PLAYING') return;
    const activeUid = room.activePlayerUid;
    if (!activeUid) return;

    const player = room.players && room.players[activeUid];
    if (!player || !player.isAI || player.isFinished) return;

    if (!isSinglePlayerMode && !State.isCreator) return;

    if (aiTurnTimeout) clearTimeout(aiTurnTimeout);
    const delay = 800 + Math.floor(Math.random() * 500);

    aiTurnTimeout = setTimeout(() => {
      try {
        executeAITurn(activeUid, room);
      } catch (err) {
        console.error('AI Turn error:', err);
        executePickupAction(activeUid);
      }
    }, delay);
  }

  function executeAITurn(botUid, room) {
    const player = room.players && room.players[botUid];
    if (!player || player.isFinished) return;

    let privateInfo;
    if (isSinglePlayerMode) {
      privateInfo = singlePlayerState.privateData[botUid] || { hand: [], faceDown: [] };
    } else {
      if (!State.botPrivateData[botUid]) {
        State.botPrivateData[botUid] = { hand: [], faceDown: [] };
      }
      privateInfo = State.botPrivateData[botUid];
    }

    const pileTop = room.pileTop;
    const isLower = room.isLowerRestriction;

    // 1. Play from Hand
    const hand = privateInfo.hand || [];
    if (hand.length > 0) {
      const grouped = {};
      hand.forEach(c => {
        if (!grouped[c.rank]) grouped[c.rank] = [];
        grouped[c.rank].push(c);
      });

      const legalGroups = Object.values(grouped).filter(cards => canPlayCard(cards[0], pileTop, isLower));

      if (legalGroups.length > 0) {
        legalGroups.sort((a, b) => {
          const valA = a[0].rank === '2' ? 100 : (a[0].rank === '10' ? 90 : a[0].value);
          const valB = b[0].rank === '2' ? 100 : (b[0].rank === '10' ? 90 : b[0].value);
          return valA - valB;
        });
        const chosenCards = legalGroups[0];
        executePlayAction(botUid, chosenCards);
        return;
      }

      executePickupAction(botUid);
      return;
    }

    // 2. Play from Face-Up Cards
    const faceUp = player.faceUp || [];
    if (faceUp.length > 0) {
      const legalFaceUp = faceUp.filter(c => canPlayCard(c, pileTop, isLower));
      if (legalFaceUp.length > 0) {
        legalFaceUp.sort((a, b) => a.value - b.value);
        executePlayAction(botUid, [legalFaceUp[0]]);
        return;
      }
      executePickupAction(botUid);
      return;
    }

    // 3. Play from Face-Down (Blind flip)
    let faceDown = privateInfo.faceDown || [];
    if (faceDown.length === 0 && player.faceDownCount > 0) {
      for (let i = 0; i < player.faceDownCount; i++) {
        faceDown.push(getRandomCard());
      }
      privateInfo.faceDown = faceDown;
    }

    if (faceDown.length > 0) {
      const cardIndex = Math.floor(Math.random() * faceDown.length);
      const revealed = faceDown.splice(cardIndex, 1)[0] || getRandomCard();
      if (canPlayCard(revealed, pileTop, isLower)) {
        showToast(`🤖 ${player.name} reveló ${revealed.name} (Válida) ✅`, '🂠');
        executePlayAction(botUid, [revealed], true);
      } else {
        showToast(`🤖 ${player.name} reveló ${revealed.name} (No válida) ❌`, '💥');
        executePickupAction(botUid, revealed);
      }
    } else {
      executePlayAction(botUid, [getRandomCard()], true);
    }
  }

  // --- UI RENDERING: SQUARE CASINO CARD TABLE ---

  function renderGameTable(room, myUid) {
    if (!room) return;
    if (room.status === 'FINISHED') {
      renderResultsView(room);
      showView('results');
      return;
    }

    const players = room.players || {};
    const turnOrder = room.turnOrder || Object.keys(players);
    const activeUid = room.activePlayerUid;
    const activePlayer = players[activeUid] || { name: 'Jugador' };

    // Update Turn Badge & Rule Alerts
    if (DOM.turnPlayerName) {
      DOM.turnPlayerName.textContent = activeUid === myUid ? '¡ES TU TURNO!' : `Turno de ${activePlayer.name}`;
      DOM.turnNotice.className = `guerra-turn-badge ${activeUid === myUid ? 'my-turn' : ''}`;
    }

    if (DOM.ruleNotice) {
      if (room.isLowerRestriction) {
        DOM.ruleNotice.textContent = '⚡ REGLA ACTIVA: Debe ser 7 o menor (o un 2)';
        DOM.ruleNotice.style.display = 'block';
      } else {
        DOM.ruleNotice.style.display = 'none';
      }
    }

    // Live Pot Display
    const totalPot = room.totalPot || ((room.betAmount || 100) * turnOrder.length);
    if (DOM.livePotCount) {
      DOM.livePotCount.textContent = totalPot.toLocaleString();
    }

    // Render Deck & Central Pile
    if (DOM.drawDeckCount) DOM.drawDeckCount.textContent = `${room.deckCount || 0} cartas`;
    if (DOM.playPileCount) DOM.playPileCount.textContent = `${(room.pile && room.pile.length) || 0}`;

    if (DOM.playPile) {
      if (room.pile && room.pile.length > 0) {
        const topCard = room.pileTop || room.pile[room.pile.length - 1];
        DOM.playPile.innerHTML = renderCardHTML(topCard, false, false, false);
      } else {
        DOM.playPile.innerHTML = `<div class="guerra-card card-placeholder"><span style="font-size: 11px; color: var(--text-dim);">Vacío</span></div>`;
      }
    }

    // Relative 4-Seat Seating (Tú = Sur / Bottom)
    const myIndex = turnOrder.indexOf(myUid);
    const totalPlayers = turnOrder.length;
    let seatMap = { top: null, left: null, right: null };

    if (totalPlayers === 4) {
      seatMap.left = turnOrder[(myIndex + 1) % 4];
      seatMap.top = turnOrder[(myIndex + 2) % 4];
      seatMap.right = turnOrder[(myIndex + 3) % 4];
    } else if (totalPlayers === 3) {
      seatMap.left = turnOrder[(myIndex + 1) % 3];
      seatMap.right = turnOrder[(myIndex + 2) % 3];
    } else if (totalPlayers === 2) {
      seatMap.top = turnOrder[(myIndex + 1) % 2];
    }

    function renderOpponentSeat(el, playerId) {
      if (!el) return;
      if (!playerId || !players[playerId]) {
        el.innerHTML = '';
        el.style.display = 'none';
        return;
      }
      el.style.display = 'flex';
      const opp = players[playerId];
      const isCurrentTurn = playerId === activeUid;
      const faceUpCards = opp.faceUp || [];

      el.className = `guerra-seat-box ${isCurrentTurn ? 'active-turn' : ''} ${opp.isFinished ? 'finished' : ''}`;
      el.innerHTML = `
        <div class="opponent-header">
          <span class="status-dot ${opp.connected ? 'online' : 'offline'}"></span>
          <span class="opponent-name">${opp.name}</span>
          ${opp.isFinished ? `<span class="difficulty-badge" style="background: rgba(16, 185, 129, 0.2); color: var(--accent-emerald);">🏆 ${opp.finishPlace}º</span>` : ''}
        </div>
        
        <div class="opponent-cards-row">
          <div class="opponent-card-stack">
            <span class="card-count-badge">🂠 ${opp.faceDownCount || 0}</span>
            <span class="card-count-badge" style="background: var(--primary); color: #000;">✋ ${opp.handCount || 0}</span>
          </div>
          
          <div class="opponent-faceup-row">
            ${faceUpCards.map(c => renderCardHTML(c, false, false, false)).join('')}
          </div>
        </div>
      `;
    }

    renderOpponentSeat(DOM.seatTop, seatMap.top);
    renderOpponentSeat(DOM.seatLeft, seatMap.left);
    renderOpponentSeat(DOM.seatRight, seatMap.right);

    // Render My Player Area (Bottom / Sur)
    const myPrivate = isSinglePlayerMode ? singlePlayerState.privateData[myUid] : State.myPrivateCards;
    const myPublic = players[myUid] || {};
    const myHand = (myPrivate && myPrivate.hand) || [];
    const myFaceUp = myPublic.faceUp || [];
    const myFaceDownCount = (myPrivate && myPrivate.faceDown) ? myPrivate.faceDown.length : (myPublic.faceDownCount || 0);

    // 1. Table Cards
    if (DOM.myTableCardsContainer) {
      let tableHtml = '';
      for (let i = 0; i < 3; i++) {
        const hasDown = i < myFaceDownCount;
        const upCard = myFaceUp[i] || null;
        const isFaceUpPlayable = myHand.length === 0 && upCard !== null;
        const isFaceDownPlayable = myHand.length === 0 && myFaceUp.length === 0 && hasDown;

        tableHtml += `
          <div class="my-table-slot">
            ${hasDown ? renderCardHTML(null, false, true, isFaceDownPlayable) : '<div class="guerra-card card-placeholder"></div>'}
            ${upCard ? `<div class="faceup-overlay">${renderCardHTML(upCard, State.selectedCardsToPlay.has(upCard), false, isFaceUpPlayable)}</div>` : ''}
          </div>
        `;
      }
      DOM.myTableCardsContainer.innerHTML = tableHtml;

      DOM.myTableCardsContainer.querySelectorAll('.my-table-slot').forEach((slot, idx) => {
        const upCard = myFaceUp[idx];
        if (myHand.length === 0 && upCard) {
          slot.addEventListener('click', () => {
            toggleCardSelection(upCard);
          });
        } else if (myHand.length === 0 && myFaceUp.length === 0 && idx < myFaceDownCount) {
          slot.addEventListener('click', () => {
            playBlindFaceDownCard(idx);
          });
        }
      });
    }

    // 2. Hand Cards (Private)
    if (DOM.myHandCardsContainer) {
      DOM.myHandCardsContainer.innerHTML = myHand.map(card => `
        <div class="my-hand-card-wrapper" data-card-id="${card.id}">
          ${renderCardHTML(card, State.selectedCardsToPlay.has(card), false, true)}
        </div>
      `).join('');

      DOM.myHandCardsContainer.querySelectorAll('.my-hand-card-wrapper').forEach(wrapper => {
        wrapper.addEventListener('click', () => {
          const cardId = wrapper.dataset.cardId;
          const card = myHand.find(c => c.id === cardId);
          if (card) toggleCardSelection(card);
        });
      });
    }

    // Update Action Buttons
    const isMyTurn = activeUid === myUid;
    const hasSelection = State.selectedCardsToPlay.size > 0;
    if (DOM.btnPlaySelected) {
      DOM.btnPlaySelected.disabled = !isMyTurn || !hasSelection;
    }
    if (DOM.btnPickupPile) {
      DOM.btnPickupPile.disabled = !isMyTurn || !room.pile || room.pile.length === 0;
    }

    showView('game');
  }

  function toggleCardSelection(card) {
    if (State.selectedCardsToPlay.has(card)) {
      State.selectedCardsToPlay.delete(card);
    } else {
      if (State.selectedCardsToPlay.size > 0) {
        const first = Array.from(State.selectedCardsToPlay)[0];
        if (first.rank !== card.rank) {
          State.selectedCardsToPlay.clear();
        }
      }
      State.selectedCardsToPlay.add(card);
    }

    const room = isSinglePlayerMode ? singlePlayerState : State.room;
    if (room) renderGameTable(room, State.myUid);
  }

  function showActionBanner(msg) {
    if (DOM.actionNotice) {
      DOM.actionNotice.textContent = msg;
      DOM.actionNotice.style.opacity = '1';
      setTimeout(() => {
        if (DOM.actionNotice) DOM.actionNotice.style.opacity = '0';
      }, 3500);
    }
  }

  function triggerBurnAnimation() {
    if (DOM.pileBurnEffect) {
      DOM.pileBurnEffect.classList.add('burn-active');
      setTimeout(() => DOM.pileBurnEffect.classList.remove('burn-active'), 800);
    }
  }

  // --- RESULTS & PODIUM VIEW WITH COIN PAYOUTS ---

  function renderResultsView(room) {
    const winners = room.winners || [];
    const bet = room.betAmount || 100;
    const totalPot = room.totalPot || (bet * (room.turnOrder || []).length);
    const champion = winners[0] || { name: 'Campeón' };

    // Process payout once per match
    if (payoutProcessedForMatch !== (room.id || 'match')) {
      payoutProcessedForMatch = (room.id || 'match');
      if (champion.uid === State.myUid) {
        // Human player won 1st place!
        addPlayerCoins(totalPot);
        CardAudio.win();
        showToast(`¡HAS GANADO EL BOTE DE ${totalPot} MONEDAS! 🏆🪙`, '🎉');
      } else {
        showToast(`Has perdido tu apuesta de ${bet} monedas.`, '📉');
      }
    }

    if (DOM.podiumContainer) {
      const isWinnerMe = champion.uid === State.myUid;
      DOM.podiumContainer.innerHTML = `
        <div style="font-size: 56px; filter: drop-shadow(0 0 20px var(--accent-amber-glow));">🏆</div>
        <h2 style="font-size: 26px; font-weight: 900; color: #fff; margin-top: -6px;">¡${champion.name.toUpperCase()} HA GANADO!</h2>
        <div style="display: flex; align-items: center; justify-content: center; gap: 8px; background: rgba(245, 158, 11, 0.15); border: 1px solid var(--accent-amber); border-radius: var(--radius-full); padding: 6px 18px; margin-top: 4px;">
          <span style="font-size: 20px;">🪙</span>
          <span style="color: var(--accent-amber); font-size: 16px; font-weight: 900;">
            ${isWinnerMe ? `¡Te llevas el Bote Completo de +${totalPot} Monedas!` : `Bote ganado por ${champion.name}: ${totalPot} Monedas`}
          </span>
        </div>
      `;
    }

    if (DOM.resultsTableBody) {
      DOM.resultsTableBody.innerHTML = winners.map(w => {
        const isFirst = w.place === 1;
        const profit = isFirst ? (totalPot - bet) : -bet;
        const profitStr = isFirst ? `+${totalPot} 🪙 (Ganancia: +${profit})` : `-${bet} 🪙`;

        return `
          <tr style="border-bottom: 1px solid rgba(51, 65, 85, 0.4); ${isFirst ? 'background: rgba(245, 158, 11, 0.1);' : ''}">
            <td style="padding: 12px 8px; font-size: 18px; font-weight: 800;">
              ${w.place === 1 ? '🥇 1.º' : w.place === 2 ? '🥈 2.º' : w.place === 3 ? '🥉 3.º' : '4.º'}
            </td>
            <td style="padding: 12px 8px; font-weight: 700; color: var(--text-main);">
              ${w.name} ${w.uid === State.myUid ? '(Tú)' : ''}
            </td>
            <td style="padding: 12px 8px; text-align: right; font-family: var(--font-mono); font-weight: 800; color: ${isFirst ? 'var(--accent-emerald)' : 'var(--accent-rose)'};">
              ${profitStr}
            </td>
          </tr>
        `;
      }).join('');
    }

    if (State.isCreator) {
      if (DOM.btnPlayAgain) DOM.btnPlayAgain.style.display = 'flex';
    } else {
      if (DOM.btnPlayAgain) DOM.btnPlayAgain.style.display = 'none';
    }

    updateCoinsDisplay();
  }

  // --- REALTIME LISTENERS & PRESENCE ---

  function attachRoomListeners(roomRef, myUid) {
    const db = global.FirebaseService.getDb();
    currentPrivateRef = db.ref(`guerra_private/${currentRoomId}/${myUid}`);

    currentPrivateRef.on('value', snap => {
      const data = snap.val() || {};
      State.myPrivateCards = {
        hand: data.hand || [],
        faceDown: data.faceDown || [],
        selectable6: data.selectable6 || []
      };
      if (State.room && State.room.status === 'SETUP') {
        renderSetupView(State.room, myUid);
      } else if (State.room && State.room.status === 'PLAYING') {
        renderGameTable(State.room, myUid);
      }
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
      } else if (room.status === 'SETUP') {
        if (!room.players[myUid] || !room.players[myUid].setupReady) {
          renderSetupView(room, myUid);
        } else {
          showView('setup');
          if (DOM.setupWaitingNotice) DOM.setupWaitingNotice.style.display = 'block';
          if (DOM.btnConfirmSetup) DOM.btnConfirmSetup.style.display = 'none';
        }
      } else if (room.status === 'PLAYING') {
        renderGameTable(room, myUid);
        checkAndTriggerAI(room);
      } else if (room.status === 'FINISHED') {
        renderResultsView(room);
        showView('results');
      }
    });
  }

  function renderWaitingRoom(room) {
    if (DOM.displayRoomCode) DOM.displayRoomCode.textContent = room.id;
    const playerList = Object.values(room.players || {});
    if (DOM.waitingPlayersCount) DOM.waitingPlayersCount.textContent = `${playerList.length} / 4 Jugadores`;

    const bet = room.betAmount || selectedBetAmount || 100;
    const pot = bet * playerList.length;
    if (DOM.waitingBetBadge) {
      DOM.waitingBetBadge.textContent = `🪙 Apuesta: ${bet} | Bote: ${pot}`;
    }

    if (DOM.waitingPlayersList) {
      DOM.waitingPlayersList.innerHTML = playerList.map(p => `
        <div class="player-slot-card ready" style="padding: 10px 14px;">
          <div style="display: flex; align-items: center; gap: 10px; width: 100%;">
            <span class="status-dot ${p.connected ? 'online' : 'offline'}"></span>
            <span style="font-weight: 700; flex: 1; text-align: left;">${p.name} ${p.id === State.myUid ? '(Tú)' : ''}</span>
            ${p.id === room.creatorId ? '<span class="player-badge badge-host">👑 Anfitrión</span>' : '<span class="player-badge badge-guest">Jugador</span>'}
          </div>
        </div>
      `).join('');
    }

    if (DOM.btnHostStart) {
      DOM.btnHostStart.style.display = State.isCreator ? 'flex' : 'none';
      DOM.btnHostStart.innerHTML = playerList.length === 1
        ? `<span>🤖</span> INICIAR (SOLO VS 3 IA - BOTE: ${bet * 4} 🪙)`
        : `<span>⚔️</span> INICIAR PARTIDA (${playerList.length} JUGADORES - BOTE: ${pot} 🪙)`;
    }

    showView('waiting');
  }

  function leaveRoom() {
    if (currentRoomRef && currentRoomId) {
      const myUid = State.myUid;
      try {
        currentRoomRef.child(`players/${myUid}`).update({ connected: false });
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
    payoutProcessedForMatch = null;
    if (aiTurnTimeout) clearTimeout(aiTurnTimeout);

    showView('lobby');
  }

  // --- INITIALIZATION & EVENTS ---

  function initEvents() {
    if (DOM.inputNickname) {
      DOM.inputNickname.value = getPlayerName();
      DOM.inputNickname.addEventListener('change', () => {
        const clean = DOM.inputNickname.value.trim().substring(0, 20) || getPlayerName();
        localStorage.setItem('sudoku_player_name', clean);
        DOM.inputNickname.value = clean;
        showToast(`Nombre actualizado: ${clean}`, '👤');
      });
    }

    // Bet selection buttons in lobby
    if (DOM.betButtons) {
      DOM.betButtons.forEach(btn => {
        btn.addEventListener('click', () => {
          DOM.betButtons.forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          selectedBetAmount = parseInt(btn.dataset.bet, 10) || 100;
          CardAudio.click();
        });
      });
    }

    // Claim bonus button
    if (DOM.btnRefillCoins) {
      DOM.btnRefillCoins.addEventListener('click', claimFreeCoinsBonus);
    }

    if (DOM.btnCreateRoom) {
      DOM.btnCreateRoom.addEventListener('click', async () => {
        try {
          const roomId = await createRoom();
          showToast(`¡Sala de Guerra creada! Código: ${roomId}`, '🚀');
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
        const url = `${window.location.origin}${window.location.pathname}?game=guerra&room=${code}`;
        if (navigator.share) {
          navigator.share({ title: 'Juego Guerra Online', text: `¡Únete a mi partida de Guerra! Código: ${code}`, url }).catch(() => {});
        } else if (navigator.clipboard) {
          navigator.clipboard.writeText(url).then(() => showToast('¡Enlace copiado!', '🔗'));
        }
      });
    }

    if (DOM.btnHostStart) {
      DOM.btnHostStart.addEventListener('click', startGame);
    }

    if (DOM.btnConfirmSetup) DOM.btnConfirmSetup.addEventListener('click', confirmSetup);
    if (DOM.btnPlaySelected) DOM.btnPlaySelected.addEventListener('click', playSelectedCards);
    if (DOM.btnPickupPile) DOM.btnPickupPile.addEventListener('click', pickupPile);
    if (DOM.btnLeaveWaiting) DOM.btnLeaveWaiting.addEventListener('click', leaveRoom);
    if (DOM.btnAbandonGame) {
      DOM.btnAbandonGame.addEventListener('click', () => {
        if (confirm('¿Deseas salir de la partida de Guerra?')) leaveRoom();
      });
    }

    if (DOM.btnPlayAgain) {
      DOM.btnPlayAgain.addEventListener('click', startGame);
    }
    if (DOM.btnReturnMenu) {
      DOM.btnReturnMenu.addEventListener('click', leaveRoom);
    }

    if (DOM.btnViewRules) {
      DOM.btnViewRules.addEventListener('click', () => {
        if (global.PlatformService && global.PlatformService.openRulesModal) {
          global.PlatformService.openRulesModal('guerra');
        }
      });
    }

    if (DOM.btnGameRules) {
      DOM.btnGameRules.addEventListener('click', () => {
        if (global.PlatformService && global.PlatformService.openRulesModal) {
          global.PlatformService.openRulesModal('guerra');
        }
      });
    }
  }

  function init() {
    cacheDOM();
    initEvents();
    updateCoinsDisplay();
  }

  const GuerraGame = {
    init,
    createRoom,
    joinRoom,
    leaveRoom,
    showView,
    getPlayerCoins,
    setPlayerCoins,
    addPlayerCoins
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = GuerraGame;
  } else {
    global.GuerraGame = GuerraGame;
  }

})(typeof window !== 'undefined' ? window : self);
