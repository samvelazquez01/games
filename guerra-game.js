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

  // --- RTDB ISOLATED NAMESPACE & KEYS ---
  const RTDB_PATHS = {
    ROOMS: 'guerra_v2_rooms',
    PUBLIC_ROOMS: 'guerra_v2_public_rooms',
    PRIVATE: 'guerra_v2_private',
    USERS: 'guerra_v2_users'
  };

  const PLAYER_STORAGE_KEYS = {
    UID: 'guerra_player_uid',
    NAME: 'guerra_player_name',
    LEGACY_UID: 'sudoku_player_uid',
    LEGACY_NAME: 'sudoku_player_name'
  };

  const STATS_STORAGE_KEYS = {
    WINS: 'guerra_player_wins',
    LOSSES: 'guerra_player_losses'
  };

  // --- COIN & CURRENCY SYSTEM ---
  const COIN_STORAGE_KEY = 'guerra_player_coins';
  const BONUS_CLAIMED_KEY = 'guerra_bonus_claimed';
  const DEFAULT_COINS = 1000;
  let selectedBetAmount = null; // Sin apuesta predeterminada: el usuario debe seleccionar
  let selectedGameMode = 'ffa'; // 'ffa' (Todos contra todos) or '2v2' (Por equipos)
  let payoutProcessedForMatch = null;

  function formatCoinsCompact(num) {
    if (num === null || num === undefined) return '';
    const n = Number(num);
    if (isNaN(n)) return String(num);

    const sign = n < 0 ? '-' : '';
    const abs = Math.abs(n);

    if (abs >= 1000000) {
      const m = abs / 1000000;
      const str = (m % 1 === 0) ? m.toFixed(0) : parseFloat(m.toFixed(2)).toString();
      return `${sign}${str}M`;
    }
    if (abs >= 100000) {
      const k = abs / 1000;
      const str = (k % 1 === 0) ? k.toFixed(0) : parseFloat(k.toFixed(2)).toString();
      return `${sign}${str}k`;
    }
    return n.toLocaleString();
  }

  const LEGACY_COIN_KEYS = [
    'sudoku_player_coins',
    'player_coins',
    'guerra_coins',
    'coins'
  ];

  const _memoryStore = {};
  function safeStorageGet(key) {
    try {
      if (typeof localStorage !== 'undefined' && localStorage) {
        const val = localStorage.getItem(key);
        if (val !== null) return val;
      }
    } catch (e) {}
    return _memoryStore[key] !== undefined ? _memoryStore[key] : null;
  }

  function safeStorageSet(key, val) {
    try {
      if (typeof localStorage !== 'undefined' && localStorage) {
        localStorage.setItem(key, String(val));
      }
    } catch (e) {}
    _memoryStore[key] = String(val);
  }

  function getPlayerCoins() {
    let stored = safeStorageGet(COIN_STORAGE_KEY);
    if (stored === null || isNaN(parseInt(stored, 10))) {
      for (let i = 0; i < LEGACY_COIN_KEYS.length; i++) {
        const legacyVal = safeStorageGet(LEGACY_COIN_KEYS[i]);
        if (legacyVal !== null && !isNaN(parseInt(legacyVal, 10)) && parseInt(legacyVal, 10) > 0) {
          stored = legacyVal;
          break;
        }
      }
    }
    if (stored === null || isNaN(parseInt(stored, 10))) {
      safeStorageSet(COIN_STORAGE_KEY, DEFAULT_COINS.toString());
      return DEFAULT_COINS;
    }
    const clean = Math.max(0, parseInt(stored, 10));
    safeStorageSet(COIN_STORAGE_KEY, clean.toString());
    return clean;
  }

  function setPlayerCoins(amount) {
    const clean = Math.max(0, parseInt(amount, 10) || 0);
    safeStorageSet(COIN_STORAGE_KEY, clean.toString());
    updateCoinsDisplay();
    syncUserProfile({ coins: clean }).catch(() => {});
    return clean;
  }

  function addPlayerCoins(delta) {
    const current = getPlayerCoins();
    return setPlayerCoins(current + delta);
  }

  function getPlayerStats() {
    const wins = parseInt(safeStorageGet(STATS_STORAGE_KEYS.WINS), 10) || 0;
    const losses = parseInt(safeStorageGet(STATS_STORAGE_KEYS.LOSSES), 10) || 0;
    return { wins, losses };
  }

  function recordPlayerMatchResult(isWin) {
    const { wins, losses } = getPlayerStats();
    const newWins = isWin ? wins + 1 : wins;
    const newLosses = isWin ? losses : losses + 1;
    safeStorageSet(STATS_STORAGE_KEYS.WINS, newWins.toString());
    safeStorageSet(STATS_STORAGE_KEYS.LOSSES, newLosses.toString());
    syncUserProfile({ wins: newWins, losses: newLosses }).catch(() => {});
  }

  async function syncUserProfile(extra = {}) {
    const db = global.FirebaseService && global.FirebaseService.getDb();
    const uid = getPlayerUid();
    const name = getPlayerName();
    const coins = getPlayerCoins();
    const { wins, losses } = getPlayerStats();

    const payload = {
      uid,
      name,
      coins,
      wins,
      losses,
      lastSeen: (global.firebase && global.firebase.database && global.firebase.database.ServerValue)
        ? global.firebase.database.ServerValue.TIMESTAMP
        : Date.now(),
      ...extra
    };

    if (db && uid) {
      try {
        await db.ref(`${RTDB_PATHS.USERS}/${uid}`).update(payload);
      } catch (e) {}
    }
  }

  async function initUserProfile() {
    const db = global.FirebaseService && global.FirebaseService.getDb();
    const uid = getPlayerUid();
    if (!db || !uid) return;

    try {
      const snap = await db.ref(`${RTDB_PATHS.USERS}/${uid}`).once('value');
      const remoteData = snap.val();
      if (remoteData) {
        if (remoteData.coins !== undefined && remoteData.coins !== null && !isNaN(remoteData.coins)) {
          const remoteCoins = Math.max(0, parseInt(remoteData.coins, 10));
          const localCoins = getPlayerCoins();
          // Never downgrade coins on startup: preserve the highest between local and remote
          const bestCoins = Math.max(remoteCoins, localCoins);
          safeStorageSet(COIN_STORAGE_KEY, bestCoins.toString());
          updateCoinsDisplay();
        }
        if (remoteData.name && !safeStorageGet(PLAYER_STORAGE_KEYS.NAME)) {
          safeStorageSet(PLAYER_STORAGE_KEYS.NAME, remoteData.name);
          if (DOM.inputNickname) DOM.inputNickname.value = remoteData.name;
        }
        if (remoteData.wins !== undefined) {
          const localStats = getPlayerStats();
          safeStorageSet(STATS_STORAGE_KEYS.WINS, Math.max(localStats.wins, remoteData.wins || 0).toString());
          safeStorageSet(STATS_STORAGE_KEYS.LOSSES, Math.max(localStats.losses, remoteData.losses || 0).toString());
        }
        await db.ref(`${RTDB_PATHS.USERS}/${uid}`).update({
          name: getPlayerName(),
          coins: getPlayerCoins(),
          lastSeen: (global.firebase && global.firebase.database && global.firebase.database.ServerValue)
            ? global.firebase.database.ServerValue.TIMESTAMP
            : Date.now()
        }).catch(() => {});
      } else {
        await syncUserProfile();
      }
    } catch (e) {
      console.warn('Error inicializando perfil de usuario:', e);
    }

    listenMyUserProfile();
  }

  let userCoinsListenerRef = null;
  function listenMyUserProfile() {
    const db = global.FirebaseService && global.FirebaseService.getDb();
    const uid = getPlayerUid();
    if (!db || !uid) return;

    if (userCoinsListenerRef) {
      userCoinsListenerRef.off();
      userCoinsListenerRef = null;
    }

    userCoinsListenerRef = db.ref(`${RTDB_PATHS.USERS}/${uid}/coins`);
    userCoinsListenerRef.on('value', snap => {
      const serverCoins = snap.val();
      if (serverCoins !== null && serverCoins !== undefined && !isNaN(serverCoins)) {
        const localCoins = getPlayerCoins();
        const cleanServer = Math.max(0, parseInt(serverCoins, 10));
        if (cleanServer !== localCoins) {
          safeStorageSet(COIN_STORAGE_KEY, cleanServer.toString());
          updateCoinsDisplay();
          const diff = cleanServer - localCoins;
          if (diff !== 0) {
            showToast(diff > 0 
              ? `🪙 ¡El administrador ha abonado +${diff.toLocaleString()} monedas a tu cuenta!`
              : `🪙 Saldo actualizado a ${cleanServer.toLocaleString()} monedas.`, '🪙');
          }
        }
      }
    }, err => {
      console.warn('Aviso de permisos al escuchar monedas:', err);
    });
  }

  const awardedPayouts = {};
  const paidMatches = {};

  function escapeHTML(str) {
    return String(str || '').replace(/[&<>'"]/g, tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag));
  }

  function ensureBetDeducted(room) {
    if (!room) return;
    const matchId = room.matchId || room.id;
    if (!matchId) return;
    if (room.status !== 'SETUP' && room.status !== 'PLAYING') return;
    if (paidMatches[matchId]) return; // Already deducted for this match

    const myUid = State.myUid;
    const myPlayer = room.players && room.players[myUid];
    if (!myPlayer) return;

    paidMatches[matchId] = true;
    const bet = room.betAmount || 100;
    addPlayerCoins(-bet);
    CardAudio.coin();
    showToast(`Apuesta de ${bet} 🪙 descontada para esta partida. ¡Buena suerte!`, '🪙');
    updateCoinsDisplay();
  }

  function calculatePrizeForPlace(place, totalPlayers, bet, room = null) {
    const pCount = totalPlayers || 4;
    const b = bet || 100;

    // Team 2v2 Mode: The winning team splits the entire pot equally (50% each)
    if (room && room.gameMode === '2v2') {
      if (place === 1) {
        return Math.floor((b * pCount) / 2); // Each winning teammate gets 50% of the pot
      }
      return 0;
    }

    if (place === 1) {
      if (pCount >= 4) return 3 * b;
      if (pCount === 3) return 2 * b;
      return 2 * b; // 2 players: gets 100% of pot
    } else if (place === 2) {
      if (pCount >= 3) return 1 * b; // In 3 or 4 players, 2nd place recovers investment
      return 0; // In 2 players, 2nd place gets 0
    }
    return 0; // 3rd and 4th place get 0
  }

  function awardPrizeIfEligible(playerUid, place, room) {
    if (playerUid === State.myUid) {
      State.myFinished = true;
      if (!State.myFinishedPlace) State.myFinishedPlace = place;
    }
    if (playerUid !== State.myUid) return 0;
    const matchId = (room && (room.matchId || room.id)) || currentRoomId || 'match';
    const matchKey = `${matchId}_place_${place}`;
    if (awardedPayouts[matchKey]) return 0;
    awardedPayouts[matchKey] = true;

    const totalPlayers = (room && room.turnOrder ? room.turnOrder.length : (room && room.players ? Object.keys(room.players).length : 4));
    const bet = (room && room.betAmount) || 100;
    const prize = calculatePrizeForPlace(place, totalPlayers, bet, room);

    if (prize > 0) {
      addPlayerCoins(prize);
      CardAudio.win();
      showToast(`¡Has ganado +${prize} 🪙 por tu victoria! 🏆`, '🪙');
      updateCoinsDisplay();
    }
    return prize;
  }

  function showEarlyVictoryModal(place, room) {
    const modal = document.getElementById('guerra-modal-early-win');
    if (!modal) return;
    const title = document.getElementById('early-win-title');
    const subtitle = document.getElementById('early-win-subtitle');
    const prizeAmount = document.getElementById('early-win-prize-amount');
    const totalPlayers = (room && room.turnOrder ? room.turnOrder.length : 4);
    const bet = (room && room.betAmount) || 100;
    const prize = calculatePrizeForPlace(place, totalPlayers, bet, room);

    if (title) title.textContent = place === 1 ? '¡1.º LUGAR! 🏆' : `¡${place}.º LUGAR! 🥈`;
    if (subtitle) {
      subtitle.textContent = place === 1
        ? '¡Has terminado todas tus cartas y te llevas el gran premio!'
        : (place === 2 ? '¡Excelente partida! Has terminado en segundo puesto y recuperas tu apuesta.' : '¡Partida completada con éxito!');
    }
    if (prizeAmount) {
      prizeAmount.textContent = prize > 0 ? `+${formatCoinsCompact(prize)} Monedas (${prize.toLocaleString()} 🪙)` : '¡Completado!';
    }
    modal.classList.add('active');
  }

  function closeEarlyVictoryModal() {
    const modal = document.getElementById('guerra-modal-early-win');
    if (modal) modal.classList.remove('active');
  }

  function isBonusClaimed() {
    return safeStorageGet(BONUS_CLAIMED_KEY) === 'true';
  }

  function claimFreeCoinsBonus() {
    const current = getPlayerCoins();
    if (current >= 1000) {
      showToast(`Tienes saldo suficiente (${current.toLocaleString()} 🪙). La recarga estará disponible si bajas de 1,000 monedas.`, 'ℹ️');
      return;
    }
    const bonusAmount = 5000;
    addPlayerCoins(bonusAmount);
    CardAudio.win();
    showToast(`¡Has recibido una recarga de +${bonusAmount.toLocaleString()} Monedas! 🎁🪙`, '🪙');
    updateCoinsDisplay();
  }

  function updateCoinsDisplay() {
    const coins = getPlayerCoins();
    const display = document.getElementById('guerra-my-coins-display');
    if (display) {
      display.textContent = formatCoinsCompact(coins);
      display.title = `${coins.toLocaleString()} 🪙`;
    }
    const btnRefill = document.getElementById('guerra-btn-refill-coins');
    if (btnRefill) {
      if (coins >= 1000) {
        btnRefill.style.opacity = '0.5';
        btnRefill.title = `Saldo: ${formatCoinsCompact(coins)} 🪙 (${coins.toLocaleString()}). Recarga de +5,000 disponible si bajas de 1,000 🪙.`;
      } else {
        btnRefill.style.opacity = '1';
        btnRefill.title = 'Reclamar recarga de +5,000 🪙 para seguir jugando';
      }
    }

    const alertZero = document.getElementById('guerra-zero-coins-alert');
    if (alertZero) {
      alertZero.style.display = coins < 50 ? 'flex' : 'none';
    }

    const modalCoins = document.getElementById('bet-modal-user-coins');
    if (modalCoins) {
      modalCoins.textContent = `${formatCoinsCompact(coins)} 🪙`;
      modalCoins.title = `${coins.toLocaleString()} 🪙`;
    }

    const modalBtnRefill = document.getElementById('bet-modal-btn-refill');
    if (modalBtnRefill) {
      modalBtnRefill.style.display = coins < 1000 ? 'inline-block' : 'none';
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
    let soundEnabled = true;
    function getCtx() {
      if (!ctx && (window.AudioContext || window.webkitAudioContext)) {
        const AC = window.AudioContext || window.webkitAudioContext;
        ctx = new AC();
      }
      if (ctx && ctx.state === 'suspended') ctx.resume();
      return ctx;
    }
    function tone(freq, type = 'sine', duration = 0.08, gainVal = 0.15) {
      if (!soundEnabled) return;
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
      toggleSound: () => {
        soundEnabled = !soundEnabled;
        return soundEnabled;
      },
      isSoundEnabled: () => soundEnabled,
      click: () => tone(600, 'sine', 0.03, 0.06),
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
      chat: () => {
        tone(587.33, 'sine', 0.05, 0.08);
        setTimeout(() => tone(880, 'sine', 0.08, 0.1), 45);
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
  let aiTurnScheduledFor = null;
  let aiWatchdogInterval = null;
  let openBetSelectorModal = () => {};

  const State = {
    myUid: null,
    isCreator: false,
    selectedForSetup: new Set(),
    selectedCardsToPlay: new Set(),
    myFinished: false,
    myFinishedPlace: null,
    myPrivateCards: {
      hand: [],
      faceDown: [],
      selectable6: []
    },
    teammatePrivateCards: {
      hand: [],
      faceDown: []
    },
    botPrivateData: {},
    room: null
  };

  function getTeammateUid(room, playerUid) {
    if (!room || room.gameMode !== '2v2' || !room.players) return null;
    const player = room.players[playerUid];
    if (!player || !player.team) return null;
    return Object.keys(room.players).find(id => id !== playerUid && room.players[id].team === player.team) || null;
  }

  function getPlayerUid() {
    let uid = safeStorageGet(PLAYER_STORAGE_KEYS.UID) || safeStorageGet(PLAYER_STORAGE_KEYS.LEGACY_UID);
    if (!uid) {
      uid = 'usr_' + Math.random().toString(36).substring(2, 9) + Date.now().toString(36);
    }
    safeStorageSet(PLAYER_STORAGE_KEYS.UID, uid);
    return uid;
  }

  function getPlayerName() {
    let name = safeStorageGet(PLAYER_STORAGE_KEYS.NAME) || safeStorageGet(PLAYER_STORAGE_KEYS.LEGACY_NAME);
    if (!name) {
      name = 'Jugador ' + Math.floor(1000 + Math.random() * 9000);
    }
    safeStorageSet(PLAYER_STORAGE_KEYS.NAME, name);
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

  function getRoomTurnOrder(room) {
    if (!room) return [];
    const t = room.turnOrder;
    if (Array.isArray(t)) return t;
    if (t && typeof t === 'object') return Object.values(t);
    return Object.keys(room.players || {});
  }

  function getRoomWinners(room) {
    if (!room || !room.winners) return [];
    if (Array.isArray(room.winners)) return room.winners;
    if (typeof room.winners === 'object') return Object.values(room.winners);
    return [];
  }

  function isUserBotController(room) {
    if (isSinglePlayerMode) return true;
    if (!room || !room.players) return false;
    const creator = room.players[room.creatorId];
    if (creator && creator.connected && !creator.isAbandoned) {
      return State.myUid === room.creatorId;
    }
    const turnOrder = getRoomTurnOrder(room);
    const humanPlayers = turnOrder.filter(uid => {
      const p = room.players[uid];
      return p && !p.isAI && p.connected && !p.isAbandoned;
    });
    return humanPlayers.length > 0 && humanPlayers[0] === State.myUid;
  }

  function isPlayerCompleted(p, room = null) {
    if (!p) return false;
    if (p.isAbandoned || p.connected === false) return true;
    if (p.isFinished) return true;
    if (p.finishPlace) return true;

    const currentRoom = room || (isSinglePlayerMode ? singlePlayerState : State.room);
    const pUid = p.id || p.uid;

    if (pUid && pUid === State.myUid && State.myFinished) return true;

    if (currentRoom) {
      const winners = getRoomWinners(currentRoom);
      if (pUid && winners.some(w => w && (w.uid === pUid || w.id === pUid))) return true;

      const deckCount = (currentRoom.deckCount !== undefined)
        ? currentRoom.deckCount
        : ((currentRoom.drawDeck && currentRoom.drawDeck.length) || 0);

      // If draw deck still has cards, players draw up to 3 cards; they cannot be done
      if (deckCount > 0) return false;
    }

    const hand = (p.handCount !== undefined) ? p.handCount : 0;
    const up = (p.faceUp && p.faceUp.length) || 0;
    const down = (p.faceDownCount !== undefined) ? p.faceDownCount : 0;

    // For local human player, double-check local private state
    if (pUid === State.myUid && !isSinglePlayerMode) {
      const myHand = (State.myPrivateCards && State.myPrivateCards.hand) ? State.myPrivateCards.hand.length : 0;
      const myDown = (State.myPrivateCards && State.myPrivateCards.faceDown) ? State.myPrivateCards.faceDown.length : 0;
      if (myHand > 0 || myDown > 0) return false;
    }

    const iAmIndividuallyOut = (hand + up + down === 0);

    // TEAM MODE (2v2) - "Sistema de Ayuda": if MY own cards ran out but my
    // teammate still has cards, I am NOT completed for turn-rotation purposes.
    // I keep receiving turns (to play my teammate's cards, see targetUid
    // redirection in playSelectedCards/playBlindFaceDownCard/executePlayAction)
    // until BOTH of us are out. Only then does the team-finish check elsewhere
    // mark isFinished=true for both, which the early checks above already catch.
    if (iAmIndividuallyOut && currentRoom && currentRoom.gameMode === '2v2' && pUid) {
      const teammateUid = getTeammateUid(currentRoom, pUid);
      const teammate = teammateUid && currentRoom.players ? currentRoom.players[teammateUid] : null;
      if (teammate) {
        const tHand = (teammate.handCount !== undefined) ? teammate.handCount : 0;
        const tUp = (teammate.faceUp && teammate.faceUp.length) || 0;
        const tDown = (teammate.faceDownCount !== undefined) ? teammate.faceDownCount : 0;
        if ((tHand + tUp + tDown) > 0) {
          return false; // Teammate still alive -> I'm the helper now, keep my turns.
        }
      }
    }

    return iAmIndividuallyOut;
  }

  // --- ROBUSTNESS HELPERS (fin de partida / jugadores fuera de competencia) ---

  // Firebase RTDB lanza una excepcion si algun valor es `undefined` (ej. team: undefined
  // porque RTDB borra los `null`). Esto convierte undefined -> null recursivamente.
  function sanitizeForFirebase(value) {
    if (value === undefined) return null;
    if (Array.isArray(value)) return value.map(sanitizeForFirebase);
    if (value && typeof value === 'object') {
      const out = {};
      Object.keys(value).forEach(k => { out[k] = sanitizeForFirebase(value[k]); });
      return out;
    }
    return value;
  }

  // Un jugador que ya termino (bot o humano) esta 100% fuera de la competencia.
  // Nunca puede jugar, recoger ni recibir turno. En 2v2 el "ayudante" (sin cartas
  // propias pero con companero vivo) NO cuenta como fuera: isPlayerCompleted ya lo maneja.
  function isActorAllowed(room, playerUid, label) {
    const p = room && room.players && room.players[playerUid];
    if (!p) return false;
    if (isPlayerCompleted(p, room)) {
      console.warn(`[GUARD] ${label}: ${p.name} ya termino / esta fuera. Accion ignorada.`);
      ensureValidActiveTurn(room);
      return false;
    }
    if (room.activePlayerUid && room.activePlayerUid !== playerUid) {
      console.warn(`[GUARD] ${label}: no es el turno de ${p.name} (turno de ${room.activePlayerUid}). Accion ignorada.`);
      return false;
    }
    return true;
  }

  // Marca a un jugador como terminado en FFA de forma idempotente y lo persiste.
  function finalizeFFAFinish(room, uid) {
    const p = room && room.players && room.players[uid];
    if (!p) return;
    p.isFinished = true;
    const winners = getRoomWinners(room);
    let entry = winners.find(w => w && (w.uid === uid || w.id === uid));
    if (!entry) {
      entry = { uid, name: p.name, place: winners.length + 1, team: p.team || null };
      winners.push(entry);
      room.winners = winners;
      showToast(`🏆 ¡${p.name} terminó todas sus cartas en puesto #${entry.place}!`, '🎉');
    }
    p.finishPlace = entry.place;
    if (!isSinglePlayerMode && currentRoomRef) {
      currentRoomRef.update(sanitizeForFirebase({
        [`players/${uid}/isFinished`]: true,
        [`players/${uid}/finishPlace`]: entry.place,
        winners: winners
      })).catch(err => console.error('Error persistiendo fin de jugador:', err));
    }
    ensureValidActiveTurn(room);
  }

  function getNextTurnPlayerUid(room, currentActiveUid = null) {
    if (!room) return null;
    const turnOrder = getRoomTurnOrder(room);
    if (!turnOrder || turnOrder.length === 0) return null;

    const fromUid = currentActiveUid || room.activePlayerUid || turnOrder[room.currentTurnIndex || 0];
    let startIdx = turnOrder.indexOf(fromUid);
    if (startIdx === -1) startIdx = (room.currentTurnIndex !== undefined ? room.currentTurnIndex : 0);

    for (let i = 1; i <= turnOrder.length; i++) {
      const nextIdx = (startIdx + i) % turnOrder.length;
      const candidateUid = turnOrder[nextIdx];
      const p = room.players && room.players[candidateUid];
      if (p && !isPlayerCompleted(p, room)) {
        room.currentTurnIndex = nextIdx;
        return candidateUid;
      }
    }
    return null; // All players completed
  }

  function ensureValidActiveTurn(room) {
    if (!room || room.status !== 'PLAYING') return;
    const activeUid = room.activePlayerUid;
    const activePlayer = room.players && room.players[activeUid];

    const isStuck = !activePlayer || isPlayerCompleted(activePlayer, room);
    if (!isStuck) return;

    const nextUid = getNextTurnPlayerUid(room, activeUid);
    if (nextUid) {
      room.activePlayerUid = nextUid;

      if (isSinglePlayerMode) {
        singlePlayerState.activePlayerUid = nextUid;
        renderGameTable(singlePlayerState, State.myUid);
        checkAndTriggerAI(singlePlayerState);
      } else if (isUserBotController(room) && currentRoomRef) {
        currentRoomRef.update({
          currentTurnIndex: room.currentTurnIndex,
          activePlayerUid: nextUid
        }).catch(() => {});
      }
    } else {
      if (isSinglePlayerMode) {
        singlePlayerState.status = 'FINISHED';
        renderResultsView(singlePlayerState);
        showView('results');
      } else if (isUserBotController(room) && currentRoomRef) {
        currentRoomRef.update({ status: 'FINISHED' }).catch(() => {});
      }
    }
  }

  // Card Sorting Ascending (3 < 4 < 5 < 6 < 7 < 8 < 9 < 10 < J < Q < K < A < 2)
  const RANK_SORT_ORDER = {
    '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10,
    'J': 11, 'Q': 12, 'K': 13, 'A': 14, '2': 15
  };
  const SUIT_SORT_ORDER = { '♠': 1, '♥': 2, '♦': 3, '♣': 4 };

  function sortCardsAscending(cards) {
    if (!Array.isArray(cards)) return [];
    return [...cards].sort((a, b) => {
      const valA = a.value !== undefined ? a.value : (RANK_SORT_ORDER[a.rank] || 0);
      const valB = b.value !== undefined ? b.value : (RANK_SORT_ORDER[b.rank] || 0);
      if (valA !== valB) return valA - valB;
      const sA = SUIT_SORT_ORDER[a.suit] || 0;
      const sB = SUIT_SORT_ORDER[b.suit] || 0;
      return sA - sB;
    });
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
    DOM.btnCreatePublic = document.getElementById('guerra-btn-create-public');
    DOM.btnCreatePrivate = document.getElementById('guerra-btn-create-private');
    DOM.publicRoomsList = document.getElementById('guerra-public-rooms-list');
    DOM.btnRefreshPublicRooms = document.getElementById('guerra-btn-refresh-public-rooms');
    DOM.waitingPrivacyBadge = document.getElementById('guerra-waiting-privacy-badge');
    DOM.btnViewRules = document.getElementById('guerra-btn-view-rules');
    DOM.inputJoinCode = document.getElementById('guerra-input-join-code');
    DOM.btnJoinRoom = document.getElementById('guerra-btn-join-room');
    DOM.btnGameRules = document.getElementById('guerra-btn-game-rules');
    DOM.btnRefillCoins = document.getElementById('guerra-btn-refill-coins');
    DOM.btnOpenBetSelector = document.getElementById('guerra-btn-open-bet-selector');
    DOM.modalBetSelector = document.getElementById('modal-bet-selector');
    DOM.btnCloseBetSelector = document.getElementById('btn-close-bet-selector');
    DOM.btnCloseBetSelectorX = document.getElementById('btn-close-bet-selector-x');
    DOM.betOptionsContainer = document.getElementById('guerra-bet-options-container');
    DOM.selectedBetDisplay = document.getElementById('guerra-selected-bet-display');
    DOM.selectedBetSubtext = document.getElementById('guerra-selected-bet-subtext');
    DOM.betStatusHint = document.getElementById('guerra-bet-status-hint');
    DOM.betModalUserCoins = document.getElementById('bet-modal-user-coins');
    DOM.modeCards = document.querySelectorAll('#guerra-mode-selector .mode-card');

    DOM.displayRoomCode = document.getElementById('guerra-display-room-code');
    DOM.btnCopyCode = document.getElementById('guerra-btn-copy-code');
    DOM.btnShareRoom = document.getElementById('guerra-btn-share-room');
    DOM.waitingPlayersList = document.getElementById('guerra-waiting-players-list');
    DOM.waitingPlayersCount = document.getElementById('guerra-waiting-players-count');
    DOM.waitingBetBadge = document.getElementById('guerra-waiting-bet-badge');
    DOM.waitingModeBadge = document.getElementById('guerra-waiting-mode-badge');
    DOM.waitingBotControls = document.getElementById('guerra-waiting-bot-controls');
    DOM.btnAddBot = document.getElementById('guerra-btn-add-bot');
    DOM.btnRemoveBot = document.getElementById('guerra-btn-remove-bot');
    DOM.teamInstruction = document.getElementById('guerra-team-instruction');
    DOM.btnHostStart = document.getElementById('guerra-btn-host-start');
    DOM.btnLeaveWaiting = document.getElementById('guerra-btn-leave-waiting');

    // Chat DOM Elements
    DOM.btnWaitingChat = document.getElementById('guerra-btn-waiting-chat');
    DOM.waitingChatBadge = document.getElementById('guerra-waiting-chat-badge');
    DOM.btnGameChat = document.getElementById('guerra-btn-game-chat');
    DOM.gameChatBadge = document.getElementById('guerra-game-chat-badge');
    DOM.chatToggleBtn = document.getElementById('guerra-chat-toggle-btn');
    DOM.chatUnreadBadge = document.getElementById('guerra-chat-unread-badge');
    DOM.chatOverlay = document.getElementById('guerra-chat-overlay');
    DOM.chatCloseBtn = document.getElementById('guerra-chat-close-btn');
    DOM.chatMessagesContainer = document.getElementById('guerra-chat-messages');
    DOM.chatForm = document.getElementById('guerra-chat-form');
    DOM.chatInput = document.getElementById('guerra-chat-input');
    DOM.chatSendBtn = document.getElementById('guerra-chat-send-btn');

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

    DOM.modalEarlyWin = document.getElementById('guerra-modal-early-win');
    DOM.btnEarlyExit = document.getElementById('btn-early-exit');
    DOM.btnEarlySpectate = document.getElementById('btn-early-spectate');

    // Header actions & modals
    DOM.btnHeaderRules = document.getElementById('btn-rules');
    DOM.btnHeaderSound = document.getElementById('btn-sound');
    DOM.btnHeaderSettings = document.getElementById('btn-settings');

    DOM.modalRules = document.getElementById('modal-game-rules');
    DOM.btnCloseRules = document.getElementById('btn-close-rules');

    DOM.modalSettings = document.getElementById('modal-settings');
    DOM.btnCloseSettings = document.getElementById('btn-close-settings');
    DOM.btnSaveSettings = document.getElementById('btn-save-settings');
    DOM.inputApiKey = document.getElementById('setting-api-key');
    DOM.inputDbUrl = document.getElementById('setting-db-url');
    DOM.inputProjectId = document.getElementById('setting-project-id');

    // Ranking Elements
    DOM.btnRanking = document.getElementById('btn-ranking');
    DOM.btnViewRanking = document.getElementById('guerra-btn-view-ranking');
    DOM.modalRanking = document.getElementById('modal-ranking');
    DOM.btnCloseRanking = document.getElementById('btn-close-ranking');
    DOM.btnCloseRankingX = document.getElementById('btn-close-ranking-x');
    DOM.rankingSearchInput = document.getElementById('ranking-search-input');
    DOM.rankingTableBody = document.getElementById('ranking-table-body');
    DOM.rankingTotalPlayersCount = document.getElementById('ranking-total-players-count');
  }

  // --- FIREBASE AUTH HELPER ---
  async function ensureFirebaseAuth() {
    try {
      const service = global.FirebaseService;
      if (!service || !service.isConfigured()) return null;
      service.initFirebase();
      const auth = service.getAuth();
      if (auth && !auth.currentUser) {
        try {
          await auth.signInAnonymously();
        } catch (err) {
          console.warn('Fallo auth anónima en Guerra:', err);
        }
      }
      return service.getDb();
    } catch (e) {
      console.warn('ensureFirebaseAuth notice:', e);
      return null;
    }
  }

  // --- PUBLIC ROOMS DISCOVERY SYSTEM ---
  let publicRoomsRef = null;

  async function listenPublicRooms() {
    const service = global.FirebaseService;
    if (!service || !service.isConfigured()) {
      renderPublicRoomsList({});
      return;
    }
    try {
      const db = await ensureFirebaseAuth();
      if (!db) return;

      if (publicRoomsRef) {
        publicRoomsRef.off();
      }

      publicRoomsRef = db.ref(RTDB_PATHS.PUBLIC_ROOMS);
      publicRoomsRef.on('value', snap => {
        const roomsMap = snap.val() || {};
        renderPublicRoomsList(roomsMap);
      }, err => {
        console.warn('Error escuchando salas públicas:', err);
      });
    } catch (e) {
      console.warn('Error inicializando salas públicas:', e);
    }
  }

  function stopListeningPublicRooms() {
    if (publicRoomsRef) {
      publicRoomsRef.off();
      publicRoomsRef = null;
    }
  }

  function renderPublicRoomsList(roomsMap) {
    if (!DOM.publicRoomsList) return;
    const now = Date.now();
    const list = Object.values(roomsMap || {}).filter(r => {
      // Show waiting rooms created in the last 2 hours with available slots
      return r && r.id && (r.status === 'WAITING' || !r.status) && (r.playerCount || 0) < 4;
    });

    if (list.length === 0) {
      DOM.publicRoomsList.innerHTML = `
        <div class="public-rooms-empty">
          <span style="font-size: 26px; opacity: 0.8;">🃏</span>
          <span style="font-weight: 600;">No hay salas públicas abiertas en este momento.</span>
          <span style="font-size: 11px; color: var(--accent-amber);">¡Crea una sala pública para que otros se unan!</span>
        </div>
      `;
      return;
    }

    DOM.publicRoomsList.innerHTML = list.map(room => {
      const pCount = room.playerCount || 1;
      const bet = room.betAmount || 100;
      return `
        <div class="public-room-card" data-room-id="${room.id}">
          <div class="public-room-info">
            <div class="public-room-host">
              <span>👑</span>
              <span>${escapeHTML(room.creatorName || 'Anfitrión')}</span>
            </div>
            <div class="public-room-meta">
              <span class="public-room-bet">🪙 ${formatCoinsCompact(bet)}</span>
              <span class="public-room-players">👥 ${pCount}/4 Jugadores</span>
            </div>
          </div>
          <button class="public-room-btn-join" data-room-id="${room.id}">
            ENTRAR 🚀
          </button>
        </div>
      `;
    }).join('');

    DOM.publicRoomsList.querySelectorAll('.public-room-btn-join').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const rid = btn.dataset.roomId;
        if (!rid) return;
        try {
          btn.disabled = true;
          btn.textContent = 'Entrando...';
          await joinRoom(rid);
          showToast(`¡Conectado a la sala pública ${rid}!`, '🚀');
        } catch (err) {
          btn.disabled = false;
          btn.textContent = 'ENTRAR 🚀';
          showToast(err.message || 'Error al unirse.', '❌');
        }
      });
    });
  }

  function showView(viewKey) {
    Object.keys(DOM.views).forEach(key => {
      if (DOM.views[key]) {
        DOM.views[key].classList.toggle('active', key === viewKey);
      }
    });
    if (DOM.chatToggleBtn) {
      DOM.chatToggleBtn.style.display = (viewKey !== 'lobby' && currentRoomId) ? 'flex' : 'none';
    }
    if (viewKey === 'lobby') {
      listenPublicRooms();
    } else {
      stopListeningPublicRooms();
    }
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

  async function createRoom(isPublic = true) {
    const uid = getPlayerUid();
    const name = getPlayerName();
    if (!selectedBetAmount || isNaN(selectedBetAmount) || selectedBetAmount <= 0) {
      if (typeof openBetSelectorModal === 'function') openBetSelectorModal();
      throw new Error('Debes seleccionar un monto de apuesta antes de crear la sala.');
    }
    const bet = selectedBetAmount;
    const roomId = generateRoomCode();

    // Verify balance
    if (getPlayerCoins() < bet) {
      throw new Error(`Saldo insuficiente (${getPlayerCoins().toLocaleString()} 🪙). Necesitas ${formatCoinsCompact(bet)} 🪙 para crear esta sala. Ajusta la apuesta o reclama el bono.`);
    }

    const service = global.FirebaseService;
    let db = null;
    if (service && service.isConfigured()) {
      db = await ensureFirebaseAuth();
    }

    currentRoomId = roomId;
    State.myUid = uid;
    State.isCreator = true;
    State.botPrivateData = {};
    State.myFinished = false;
    State.myFinishedPlace = null;
    payoutProcessedForMatch = null;
    GuerraChat.init(roomId);

    if (!db) {
      isSinglePlayerMode = true;
      singlePlayerState = createLocalRoomState(roomId, uid, name, bet, isPublic);
      renderWaitingRoom(singlePlayerState);
      return roomId;
    }

    isSinglePlayerMode = false;
    const roomRef = db.ref(`${RTDB_PATHS.ROOMS}/${roomId}`);
    currentRoomRef = roomRef;

    const initialPayload = {
      id: roomId,
      creatorId: uid,
      isPublic: !!isPublic,
      gameMode: selectedGameMode || 'ffa',
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
          team: selectedGameMode === '2v2' ? 'blue' : null,
          joinedAt: global.firebase.database.ServerValue.TIMESTAMP
        }
      },
      winners: []
    };

    await roomRef.set(initialPayload);

    if (isPublic) {
      try {
        const pubRef = db.ref(`${RTDB_PATHS.PUBLIC_ROOMS}/${roomId}`);
        await pubRef.set({
          id: roomId,
          creatorName: name,
          creatorId: uid,
          betAmount: bet,
          gameMode: selectedGameMode || 'ffa',
          playerCount: 1,
          status: 'WAITING',
          createdAt: global.firebase.database.ServerValue.TIMESTAMP
        });
        pubRef.onDisconnect().remove();
      } catch (e) {
        console.warn('Error publicando sala:', e);
      }
    }

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

    const db = await ensureFirebaseAuth();
    if (!db) {
      throw new Error('No se pudo conectar a la base de datos de Firebase.');
    }
    const roomRef = db.ref(`${RTDB_PATHS.ROOMS}/${cleanCode}`);
    const snap = await roomRef.once('value');
    const room = snap.val();

    if (!room) {
      throw new Error('La sala de Guerra no existe. Verifica el código.');
    }

    const bet = room.betAmount || 100;
    if (getPlayerCoins() < bet) {
      throw new Error(`Saldo insuficiente (${getPlayerCoins().toLocaleString()} 🪙). Esta sala requiere una apuesta de ${formatCoinsCompact(bet)} 🪙 (${bet.toLocaleString()} monedas).`);
    }

    if (room.status !== 'WAITING') {
      if (room.players && room.players[uid]) {
        currentRoomId = cleanCode;
        currentRoomRef = roomRef;
        State.myUid = uid;
        State.isCreator = (room.creatorId === uid);
        const myPlr = room.players[uid];
        State.myFinished = !!(myPlr && myPlr.isFinished);
        State.myFinishedPlace = myPlr ? myPlr.finishPlace : null;
        GuerraChat.init(cleanCode);
        attachRoomListeners(roomRef, uid);
        return cleanCode;
      }
      throw new Error('La partida ya ha comenzado.');
    }

    State.myFinished = false;
    State.myFinishedPlace = null;

    const currentPlayers = room.players || {};
    const count = Object.keys(currentPlayers).length;
    if (count >= 4) {
      throw new Error('La sala ya tiene el límite máximo de 4 jugadores.');
    }

    let assignedTeam = null;
    if (room.gameMode === '2v2') {
      const blueCount = Object.values(currentPlayers).filter(p => p.team === 'blue').length;
      const redCount = Object.values(currentPlayers).filter(p => p.team === 'red').length;
      assignedTeam = blueCount <= redCount ? 'blue' : 'red';
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
      team: assignedTeam,
      joinedAt: global.firebase.database.ServerValue.TIMESTAMP
    };

    const turnOrder = room.turnOrder || [];
    if (!turnOrder.includes(uid)) turnOrder.push(uid);

    await roomRef.child(`players/${uid}`).set(playerPayload);
    await roomRef.child('turnOrder').set(turnOrder);

    if (room.isPublic) {
      try {
        const pubRef = db.ref(`${RTDB_PATHS.PUBLIC_ROOMS}/${cleanCode}`);
        pubRef.update({
          playerCount: count + 1,
          status: (count + 1 >= 4) ? 'FULL' : 'WAITING'
        }).catch(() => {});
      } catch (e) {}
    }

    currentRoomId = cleanCode;
    currentRoomRef = roomRef;
    State.myUid = uid;
    State.isCreator = (room.creatorId === uid);
    payoutProcessedForMatch = null;
    GuerraChat.init(cleanCode);

    attachRoomListeners(roomRef, uid);
    return cleanCode;
  }

  function createLocalRoomState(roomId, uid, name, bet = 100, isPublic = false) {
    GuerraChat.init(roomId);
    return {
      id: roomId,
      creatorId: uid,
      isPublic: !!isPublic,
      gameMode: selectedGameMode || 'ffa',
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
          finishPlace: null,
          team: selectedGameMode === '2v2' ? 'blue' : null
        }
      },
      privateData: {
        [uid]: { hand: [], faceDown: [] }
      },
      winners: []
    };
  }

  // --- BOT MANAGEMENT & TEAM SELECTION IN WAITING ROOM ---

  async function addBotToWaitingRoom() {
    if (!State.isCreator) return;
    const room = isSinglePlayerMode ? singlePlayerState : State.room;
    if (!room || room.status !== 'WAITING') return;

    const currentPlayers = room.players || {};
    const count = Object.keys(currentPlayers).length;
    if (count >= 4) {
      showToast('La sala ya tiene el límite máximo de 4 jugadores.', '⚠️');
      return;
    }

    let botNum = 1;
    while (currentPlayers[`bot_${botNum}`]) {
      botNum++;
    }
    const botId = `bot_${botNum}`;
    const botNames = ['Bot Alfa 🤖', 'Bot Beta 🤖', 'Bot Gamma 🤖', 'Bot Omega 🤖'];
    const botName = botNames[botNum - 1] || `Bot ${botNum} 🤖`;

    let botTeam = null;
    if (room.gameMode === '2v2') {
      const blueCount = Object.values(currentPlayers).filter(p => p.team === 'blue').length;
      const redCount = Object.values(currentPlayers).filter(p => p.team === 'red').length;
      botTeam = blueCount <= redCount ? 'blue' : 'red';
    }

    const botPayload = {
      id: botId,
      name: botName,
      isAI: true,
      connected: true,
      faceUp: [],
      handCount: 0,
      faceDownCount: 0,
      setupReady: true,
      isFinished: false,
      finishPlace: null,
      team: botTeam
    };

    if (isSinglePlayerMode) {
      singlePlayerState.players[botId] = botPayload;
      if (!singlePlayerState.turnOrder.includes(botId)) {
        singlePlayerState.turnOrder.push(botId);
      }
      renderWaitingRoom(singlePlayerState);
      showToast(`Se añadió ${botName}`, '🤖');
      return;
    }

    try {
      const db = global.FirebaseService.getDb();
      if (db && currentRoomRef) {
        const turnOrder = room.turnOrder || [];
        if (!turnOrder.includes(botId)) turnOrder.push(botId);

        await currentRoomRef.child(`players/${botId}`).set(botPayload);
        await currentRoomRef.child('turnOrder').set(turnOrder);

        if (room.isPublic) {
          const pubRef = db.ref(`${RTDB_PATHS.PUBLIC_ROOMS}/${currentRoomId}`);
          pubRef.update({
            playerCount: count + 1,
            status: (count + 1 >= 4) ? 'FULL' : 'WAITING'
          }).catch(() => {});
        }
        showToast(`Se añadió ${botName} a la sala`, '🤖');
      }
    } catch (e) {
      console.warn('Error añadiendo bot:', e);
    }
  }

  async function removeBotFromWaitingRoom() {
    if (!State.isCreator) return;
    const room = isSinglePlayerMode ? singlePlayerState : State.room;
    if (!room || room.status !== 'WAITING') return;

    const currentPlayers = room.players || {};
    const botEntries = Object.entries(currentPlayers).filter(([id, p]) => p.isAI);
    if (botEntries.length === 0) {
      showToast('No hay bots para retirar de la sala.', 'ℹ️');
      return;
    }

    const [lastBotId, lastBot] = botEntries[botEntries.length - 1];

    if (isSinglePlayerMode) {
      delete singlePlayerState.players[lastBotId];
      singlePlayerState.turnOrder = (singlePlayerState.turnOrder || []).filter(id => id !== lastBotId);
      renderWaitingRoom(singlePlayerState);
      showToast(`Se retiró ${lastBot.name}`, 'ℹ️');
      return;
    }

    try {
      const db = global.FirebaseService.getDb();
      if (db && currentRoomRef) {
        const turnOrder = (room.turnOrder || []).filter(id => id !== lastBotId);
        const count = Object.keys(currentPlayers).length;

        await currentRoomRef.child(`players/${lastBotId}`).remove();
        await currentRoomRef.child('turnOrder').set(turnOrder);

        if (room.isPublic) {
          const pubRef = db.ref(`${RTDB_PATHS.PUBLIC_ROOMS}/${currentRoomId}`);
          pubRef.update({
            playerCount: Math.max(1, count - 1),
            status: 'WAITING'
          }).catch(() => {});
        }
        showToast(`Se retiró ${lastBot.name}`, 'ℹ️');
      }
    } catch (e) {
      console.warn('Error quitando bot:', e);
    }
  }

  async function togglePlayerTeam(playerId) {
    const room = isSinglePlayerMode ? singlePlayerState : State.room;
    if (!room || room.status !== 'WAITING' || room.gameMode !== '2v2') return;

    const targetUid = playerId || State.myUid;
    if (targetUid !== State.myUid && !State.isCreator) return;

    const player = room.players && room.players[targetUid];
    if (!player) return;

    const currentTeam = player.team || 'blue';
    const newTeam = currentTeam === 'blue' ? 'red' : 'blue';

    // Verify team capacity (max 2 players per team in 4-player game)
    const playersInNewTeam = Object.values(room.players).filter(p => p.id !== targetUid && p.team === newTeam).length;
    if (playersInNewTeam >= 2) {
      showToast(`El equipo ${newTeam === 'blue' ? 'Azul' : 'Rojo'} ya tiene 2 jugadores.`, '⚠️');
      return;
    }

    if (isSinglePlayerMode) {
      player.team = newTeam;
      renderWaitingRoom(singlePlayerState);
      return;
    }

    try {
      if (currentRoomRef) {
        await currentRoomRef.child(`players/${targetUid}/team`).set(newTeam);
      }
    } catch (e) {
      console.warn('Error cambiando equipo:', e);
    }
  }

  global.togglePlayerTeam = togglePlayerTeam;

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
      showToast(`No tienes suficientes monedas (${getPlayerCoins().toLocaleString()} 🪙) para la apuesta de ${formatCoinsCompact(bet)} 🪙 (${bet.toLocaleString()} monedas).`, '❌');
      return;
    }

    const players = room.players || {};
    const playerIds = Object.keys(players);
    const realPlayerCount = playerIds.length;
    const isTeamMode = (room.gameMode === '2v2');

    const deck = createDeck();
    const finalPlayers = { ...players };
    const botNames = ['Bot Alfa 🤖', 'Bot Beta 🤖', 'Bot Gamma 🤖', 'Bot Omega 🤖'];

    // Auto-fill bots if needed
    if (realPlayerCount === 1) {
      for (let i = 0; i < 3; i++) {
        const botId = `bot_${i + 1}`;
        if (!finalPlayers[botId]) {
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
            finishPlace: null,
            team: null
          };
        }
      }
    } else if (isTeamMode && Object.keys(finalPlayers).length < 4) {
      let bIdx = 0;
      while (Object.keys(finalPlayers).length < 4) {
        const botId = `bot_${bIdx + 1}`;
        if (!finalPlayers[botId]) {
          finalPlayers[botId] = {
            id: botId,
            name: botNames[bIdx] || `Bot ${bIdx + 1} 🤖`,
            isAI: true,
            connected: true,
            faceUp: [],
            handCount: 3,
            faceDownCount: 3,
            setupReady: true,
            isFinished: false,
            finishPlace: null,
            team: null
          };
        }
        bIdx++;
      }
    }

    // Determine randomized seating and turn rotation
    let shuffledTurnOrder = [];
    let randomStartIdx = 0;
    let startingPlayerUid = null;

    if (isTeamMode) {
      // Balance teams: exactly 2 Blue and 2 Red
      const allIds = Object.keys(finalPlayers);
      let blueTeam = allIds.filter(id => finalPlayers[id].team === 'blue');
      let redTeam = allIds.filter(id => finalPlayers[id].team === 'red');

      allIds.forEach(id => {
        if (!finalPlayers[id].team) {
          if (blueTeam.length < 2) {
            finalPlayers[id].team = 'blue';
            blueTeam.push(id);
          } else {
            finalPlayers[id].team = 'red';
            redTeam.push(id);
          }
        }
      });

      // Ensure equal counts
      while (blueTeam.length > 2) redTeam.push(blueTeam.pop());
      while (redTeam.length > 2) blueTeam.push(redTeam.pop());
      blueTeam.forEach(id => { finalPlayers[id].team = 'blue'; });
      redTeam.forEach(id => { finalPlayers[id].team = 'red'; });

      const shufBlue = shuffle(blueTeam);
      const shufRed = shuffle(redTeam);
      const coin = Math.random() < 0.5;

      shuffledTurnOrder = coin
        ? [shufBlue[0], shufRed[0], shufBlue[1], shufRed[1]]
        : [shufRed[0], shufBlue[0], shufRed[1], shufBlue[1]];

      randomStartIdx = 0;
      startingPlayerUid = shuffledTurnOrder[0];
    } else {
      shuffledTurnOrder = shuffle(Object.keys(finalPlayers));
      randomStartIdx = Math.floor(Math.random() * shuffledTurnOrder.length);
      startingPlayerUid = shuffledTurnOrder[randomStartIdx];
    }

    const totalPot = bet * shuffledTurnOrder.length;
    const matchId = `m_${currentRoomId}_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;
    State.myFinished = false;
    State.myFinishedPlace = null;

    const db = global.FirebaseService.getDb();
    if (db) {
      db.ref(`${RTDB_PATHS.PUBLIC_ROOMS}/${currentRoomId}`).remove().catch(() => {});
    }

    const privateUpdates = {};
    State.botPrivateData = {};

    shuffledTurnOrder.forEach(pid => {
      const faceDown = [deck.pop(), deck.pop(), deck.pop()];
      const selectable6 = [deck.pop(), deck.pop(), deck.pop(), deck.pop(), deck.pop(), deck.pop()];

      if (finalPlayers[pid].isAI) {
        selectable6.sort((a, b) => {
          const scoreA = a.rank === '2' ? 20 : (a.rank === '10' ? 19 : a.value);
          const scoreB = b.rank === '2' ? 20 : (b.rank === '10' ? 19 : b.value);
          return scoreB - scoreA;
        });
        const chosenFaceUp = [selectable6[0], selectable6[1], selectable6[2]];
        const privateHand = sortCardsAscending([selectable6[3], selectable6[4], selectable6[5]]);

        finalPlayers[pid].faceUp = chosenFaceUp;
        finalPlayers[pid].handCount = 3;
        finalPlayers[pid].faceDownCount = 3;
        finalPlayers[pid].setupReady = true;

        State.botPrivateData[pid] = {
          hand: privateHand,
          faceDown: faceDown
        };

        privateUpdates[`${RTDB_PATHS.PRIVATE}/${currentRoomId}/${pid}`] = {
          hand: privateHand,
          faceDown: faceDown
        };
      } else {
        finalPlayers[pid].faceDownCount = 3;
        finalPlayers[pid].handCount = 3;
        finalPlayers[pid].setupReady = false;

        privateUpdates[`${RTDB_PATHS.PRIVATE}/${currentRoomId}/${pid}`] = {
          hand: [],
          faceDown: faceDown,
          selectable6: sortCardsAscending(selectable6)
        };
      }
    });

    await playDealingAnimation(Object.values(finalPlayers).map(p => p.name));

    try {
      await db.ref().update(privateUpdates);
    } catch (e) {
      console.warn('Private updates warning:', e);
    }

    ensureBetDeducted({ matchId, betAmount: bet, status: 'SETUP', players: finalPlayers });

    await currentRoomRef.update({
      matchId: matchId,
      status: 'SETUP',
      betAmount: bet,
      totalPot: totalPot,
      deckCount: deck.length,
      drawDeck: deck,
      players: finalPlayers,
      turnOrder: shuffledTurnOrder,
      currentTurnIndex: randomStartIdx,
      activePlayerUid: startingPlayerUid,
      botPrivate: State.botPrivateData,
      winners: [],
      winningTeam: null
    });
  }

  async function startLocalGame() {
    const uid = State.myUid;
    const name = getPlayerName();
    const bet = singlePlayerState.betAmount || selectedBetAmount || 100;
    const isTeamMode = (singlePlayerState.gameMode === '2v2');

    if (getPlayerCoins() < bet) {
      showToast(`No tienes suficientes monedas (${getPlayerCoins()} 🪙) para la apuesta de ${bet} 🪙.`, '❌');
      return;
    }

    State.myFinished = false;
    State.myFinishedPlace = null;
    const deck = createDeck();
    const botNames = ['Bot Alfa 🤖', 'Bot Beta 🤖', 'Bot Gamma 🤖'];
    const totalPot = bet * 4;
    const matchId = `m_local_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;

    singlePlayerState.matchId = matchId;
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
        finishPlace: null,
        team: isTeamMode ? 'blue' : null
      }
    };

    singlePlayerState.privateData = {};

    const humanFaceDown = [deck.pop(), deck.pop(), deck.pop()];
    const humanSelectable = sortCardsAscending([deck.pop(), deck.pop(), deck.pop(), deck.pop(), deck.pop(), deck.pop()]);
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
      const botHand = sortCardsAscending([bot6[3], bot6[4], bot6[5]]);

      // In 2v2 Solo mode: Tú + Bot Alfa = Blue Team vs Bot Beta + Bot Gamma = Red Team
      let bTeam = null;
      if (isTeamMode) {
        bTeam = (i === 0) ? 'blue' : 'red';
      }

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
        finishPlace: null,
        team: bTeam
      };

      singlePlayerState.privateData[bid] = {
        faceDown: botFaceDown,
        hand: botHand
      };
    }

    let turnOrder = [];
    let randomStartIdx = 0;
    let startingPlayerUid = null;

    if (isTeamMode) {
      // Blue: [uid, bot_1], Red: [bot_2, bot_3]
      const coin = Math.random() < 0.5;
      turnOrder = coin ? [uid, 'bot_2', 'bot_1', 'bot_3'] : ['bot_2', 'bot_1', 'bot_3', uid];
      randomStartIdx = 0;
      startingPlayerUid = turnOrder[0];
    } else {
      turnOrder = shuffle([uid, 'bot_1', 'bot_2', 'bot_3']);
      randomStartIdx = Math.floor(Math.random() * turnOrder.length);
      startingPlayerUid = turnOrder[randomStartIdx];
    }

    singlePlayerState.turnOrder = turnOrder;
    singlePlayerState.currentTurnIndex = randomStartIdx;
    singlePlayerState.activePlayerUid = startingPlayerUid;
    ensureBetDeducted(singlePlayerState);

    await playDealingAnimation(['Tú', ...botNames]);

    singlePlayerState.status = 'SETUP';
    singlePlayerState.betAmount = bet;
    singlePlayerState.totalPot = totalPot;
    singlePlayerState.deck = deck;
    singlePlayerState.deckCount = deck.length;
    singlePlayerState.winners = [];
    singlePlayerState.winningTeam = null;

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
      const privateHand = sortCardsAscending(all6.filter(c => !chosenFaceUp.some(cf => cf.id === c.id)));

      pData.hand = privateHand;
      delete pData.selectable6;

      singlePlayerState.players[myUid].faceUp = chosenFaceUp;
      singlePlayerState.players[myUid].setupReady = true;

      // Start Playing immediately with random starting player
      singlePlayerState.status = 'PLAYING';
      const tOrder = singlePlayerState.turnOrder || [myUid, 'bot_1', 'bot_2', 'bot_3'];
      let randomIdx = singlePlayerState.currentTurnIndex;
      if (randomIdx === undefined || randomIdx === null || !singlePlayerState.activePlayerUid) {
        randomIdx = Math.floor(Math.random() * tOrder.length);
      }
      singlePlayerState.currentTurnIndex = randomIdx;
      singlePlayerState.activePlayerUid = tOrder[randomIdx];
      renderGameTable(singlePlayerState, myUid);
      showView('game');
      checkAndTriggerAI(singlePlayerState);
      const starterName = (singlePlayerState.players[tOrder[randomIdx]] && singlePlayerState.players[tOrder[randomIdx]].name) || 'Jugador';
      showToast(`🎲 ¡Inicia la partida! Turno sorteado: ${starterName}`, '🎲');
      return;
    }

    // Multiplayer Firebase Flow
    const all6 = State.myPrivateCards.selectable6 || [];
    const privateHand = sortCardsAscending(all6.filter(c => !chosenFaceUp.some(cf => cf.id === c.id)));

    // Update local state immediately so UI responds without waiting for network
    State.myPrivateCards.hand = privateHand;
    delete State.myPrivateCards.selectable6;

    if (State.room && State.room.players && State.room.players[myUid]) {
      State.room.players[myUid].faceUp = chosenFaceUp;
      State.room.players[myUid].setupReady = true;
    }

    // Check if other players are AI, already setupReady, or abandoned/disconnected
    const currentRoom = State.room || {};
    const allPlayersList = Object.values(currentRoom.players || {});
    const otherPlayers = allPlayersList.filter(p => p.id !== myUid);
    const areOthersReady = otherPlayers.length === 0 || otherPlayers.every(p => p.isAI || p.setupReady || p.isAbandoned || p.connected === false);

    if (areOthersReady) {
      // IN A BOT GAME OR WHEN ALL OTHERS ARE READY: TRANSITION IMMEDIATELY!
      if (DOM.setupWaitingNotice) DOM.setupWaitingNotice.style.display = 'none';
      if (DOM.btnConfirmSetup) DOM.btnConfirmSetup.style.display = 'none';

      const turnOrder = currentRoom.turnOrder || Object.keys(currentRoom.players || {});
      let randomTurnIdx = currentRoom.currentTurnIndex;
      if (randomTurnIdx === undefined || randomTurnIdx === null || !currentRoom.activePlayerUid) {
        randomTurnIdx = Math.floor(Math.random() * turnOrder.length);
      }
      const firstTurnUid = currentRoom.activePlayerUid || turnOrder[randomTurnIdx] || turnOrder[0];

      if (State.room) {
        State.room.status = 'PLAYING';
        State.room.activePlayerUid = firstTurnUid;
        State.room.currentTurnIndex = randomTurnIdx;
      }

      renderGameTable(State.room, myUid);
      showView('game');
      checkAndTriggerAI(State.room);

      const starter = (currentRoom.players && currentRoom.players[firstTurnUid]) || { name: 'Jugador' };
      showToast(`🎲 ¡Inicia la partida! Turno sorteado: ${starter.name}`, '🎲');

      // Persist to Firebase in background without blocking UI
      try {
        const db = global.FirebaseService.getDb();
        if (db && currentRoomId) {
          db.ref(`${RTDB_PATHS.PRIVATE}/${currentRoomId}/${myUid}`).set({
            hand: privateHand,
            faceDown: State.myPrivateCards.faceDown || []
          }).catch(err => console.warn('Private cards save warning:', err));
        }

        if (currentRoomRef) {
          await currentRoomRef.update({
            status: 'PLAYING',
            activePlayerUid: firstTurnUid,
            currentTurnIndex: randomTurnIdx,
            [`players/${myUid}/faceUp`]: chosenFaceUp,
            [`players/${myUid}/setupReady`]: true
          });
        }
      } catch (err) {
        console.warn('Error sincronizando PLAYING en Firebase:', err);
      }
      return;
    }

    // If there ARE other human players who have not confirmed yet:
    if (DOM.setupWaitingNotice) DOM.setupWaitingNotice.style.display = 'block';
    if (DOM.btnConfirmSetup) DOM.btnConfirmSetup.style.display = 'none';

    try {
      const db = global.FirebaseService.getDb();
      if (db && currentRoomId) {
        db.ref(`${RTDB_PATHS.PRIVATE}/${currentRoomId}/${myUid}`).set({
          hand: privateHand,
          faceDown: State.myPrivateCards.faceDown || []
        }).catch(err => console.warn('Private cards save warning:', err));
      }

      if (currentRoomRef) {
        await currentRoomRef.child(`players/${myUid}`).update({
          faceUp: chosenFaceUp,
          setupReady: true
        });

        // Double-check room status in case other human finished simultaneously
        const snap = await currentRoomRef.once('value');
        const r = snap.val();
        if (r && r.status === 'SETUP') {
          const playersObj = r.players || {};
          const allP = Object.values(playersObj);
          const allReady = allP.length > 0 && allP.every(p => p.id === myUid || p.isAI || p.setupReady || p.isAbandoned || p.connected === false);
          if (allReady) {
            const tOrder = r.turnOrder || Object.keys(playersObj);
            let rIdx = r.currentTurnIndex;
            if (rIdx === undefined || rIdx === null || !r.activePlayerUid) {
              rIdx = Math.floor(Math.random() * tOrder.length);
            }
            const firstTurn = r.activePlayerUid || tOrder[rIdx] || tOrder[0];
            await currentRoomRef.update({
              status: 'PLAYING',
              activePlayerUid: firstTurn,
              currentTurnIndex: rIdx
            });
          }
        }
      }
    } catch (err) {
      console.warn('Error en confirmSetup multijugador:', err);
    }
  }

  // --- GAMEPLAY ENGINE: PLAY CARDS, BURNS, SPECIALS ---

  async function playSelectedCards() {
    if (State.selectedCardsToPlay.size === 0) return;
    {
      const guardRoom = isSinglePlayerMode ? singlePlayerState : State.room;
      if (!guardRoom || guardRoom.activePlayerUid !== State.myUid || State.myFinished) {
        State.selectedCardsToPlay.clear();
        showToast('No es tu turno.', '⏳');
        return;
      }
    }
    const selectedCards = Array.from(State.selectedCardsToPlay);
    const first = selectedCards[0];

    // Must be all of same rank
    const allSame = selectedCards.every(c => c.rank === first.rank);
    if (!allSame) {
      showToast('Solo puedes jugar varias cartas si son del mismo número.', '⚠️');
      return;
    }

    const room = isSinglePlayerMode ? singlePlayerState : State.room;
    const isDeckEmpty = (room.deckCount || (room.drawDeck && room.drawDeck.length) || 0) === 0;

    // Face-up card combo restriction:
    // Face-up cards can ONLY be played together with hand cards if this rank represents
    // the LAST card(s) remaining in the player's hand and the draw deck is empty.
    let targetUid = State.myUid;
    if (room.gameMode === '2v2') {
      const myP = room.players && room.players[State.myUid];
      const myRem = ((myP && myP.handCount) || 0) + ((myP && myP.faceUp && myP.faceUp.length) || 0) + ((myP && myP.faceDownCount) || 0);
      if (myRem === 0) {
        const tUid = getTeammateUid(room, State.myUid);
        if (tUid) targetUid = tUid;
      }
    }
    const targetP = (room.players && room.players[targetUid]) || {};
    const targetFaceUp = targetP.faceUp || [];
    const hasFaceUpInSelection = selectedCards.some(sc => targetFaceUp.some(fc => fc.id === sc.id));

    if (hasFaceUpInSelection) {
      let curHand = [];
      if (isSinglePlayerMode) {
        curHand = (singlePlayerState.privateData[targetUid] && singlePlayerState.privateData[targetUid].hand) || [];
      } else if (targetUid === State.myUid) {
        curHand = (State.myPrivateCards && State.myPrivateCards.hand) || [];
      } else {
        curHand = (State.teammatePrivateCards && State.teammatePrivateCards.hand) || [];
      }

      if (curHand.length > 0) {
        const handOnlyHasMatching = isDeckEmpty && curHand.every(c => c.rank === first.rank);
        if (!handOnlyHasMatching) {
          showToast('Solo puedes tirar cartas de la mesa si es la última carta/número en tu mano y el mazo terminó.', '⚠️');
          return;
        }
      }
    }

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
    if (room.activePlayerUid !== State.myUid || State.myFinished) {
      showToast('No es tu turno.', '⏳');
      return;
    }

    let targetUid = State.myUid;
    if (room.gameMode === '2v2') {
      const myP = room.players && room.players[State.myUid];
      const myRem = ((myP && myP.handCount) || 0) + ((myP && myP.faceUp && myP.faceUp.length) || 0) + ((myP && myP.faceDownCount) || 0);
      if (myRem === 0) {
        const tUid = getTeammateUid(room, State.myUid);
        if (tUid) targetUid = tUid;
      }
    }

    let privateInfo;
    if (isSinglePlayerMode) {
      privateInfo = singlePlayerState.privateData[targetUid];
    } else if (targetUid === State.myUid) {
      privateInfo = State.myPrivateCards;
    } else {
      const tPlayer = room.players && room.players[targetUid];
      if (tPlayer && tPlayer.isAI) {
        privateInfo = State.botPrivateData[targetUid] || (room.botPrivate && room.botPrivate[targetUid]);
      } else {
        privateInfo = State.teammatePrivateCards;
      }
    }

    const faceDown = (privateInfo && privateInfo.faceDown) || [];
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
    if (room.activePlayerUid !== State.myUid || State.myFinished) {
      showToast('No es tu turno.', '⏳');
      return;
    }
    await executePickupAction(State.myUid);
  }

  async function executePlayAction(playerUid, playedCards, isFromFaceDown = false) {
    const room = isSinglePlayerMode ? singlePlayerState : State.room;
    if (!room || !room.players || !room.players[playerUid]) return;
    if (room.status === 'FINISHED') return;
    if (!isActorAllowed(room, playerUid, 'executePlayAction')) return;

    const player = room.players[playerUid];
    const firstCard = playedCards[0];
    if (!firstCard) return;

    let targetUid = playerUid;
    const isTeamMode = (room.gameMode === '2v2');
    if (isTeamMode) {
      const pRem = (player.handCount || 0) + (player.faceUp ? player.faceUp.length : 0) + (player.faceDownCount || 0);
      if (pRem === 0) {
        const tUid = getTeammateUid(room, playerUid);
        if (tUid) targetUid = tUid;
      }
    }
    const targetPlayer = room.players[targetUid];

    let privateInfo;
    if (isSinglePlayerMode) {
      privateInfo = singlePlayerState.privateData[targetUid] || { hand: [], faceDown: [] };
    } else if (targetPlayer.isAI) {
      if (!State.botPrivateData[targetUid]) {
        State.botPrivateData[targetUid] = (room.botPrivate && room.botPrivate[targetUid]) || { hand: [], faceDown: [] };
      }
      privateInfo = State.botPrivateData[targetUid];
    } else if (targetUid === State.myUid) {
      privateInfo = State.myPrivateCards;
    } else {
      privateInfo = State.teammatePrivateCards;
    }

    // Nadie puede jugar cartas que no tiene (mano o mesa boca arriba).
    if (!isFromFaceDown) {
      const ownedHand = privateInfo.hand || [];
      const ownedUp = targetPlayer.faceUp || [];
      const ownsAll = playedCards.every(pc => pc && (
        ownedHand.some(c => c.id === pc.id) || ownedUp.some(c => c.id === pc.id)
      ));
      if (!ownsAll) {
        console.warn(`[GUARD] ${player.name} intento jugar cartas que no posee. Jugada anulada.`);
        return;
      }
    }

    CardAudio.playCard();

    // Remove played cards from source (hand and/or face-up table cards)
    if (!isFromFaceDown) {
      const hand = privateInfo.hand || [];
      const faceUp = targetPlayer.faceUp || [];

      playedCards.forEach(pc => {
        const handIdx = hand.findIndex(c => c.id === pc.id);
        if (handIdx !== -1) {
          hand.splice(handIdx, 1);
        } else {
          const upIdx = faceUp.findIndex(c => c.id === pc.id);
          if (upIdx !== -1) {
            faceUp.splice(upIdx, 1);
          }
        }
      });

      privateInfo.hand = hand;
      targetPlayer.faceUp = faceUp;
    }

    // Refill Hand up to 3 from draw deck
    const drawDeck = isSinglePlayerMode ? singlePlayerState.deck : (room.drawDeck || []);
    while ((privateInfo.hand || []).length < 3 && drawDeck.length > 0) {
      const drawn = drawDeck.pop();
      if (drawn) {
        privateInfo.hand.push(drawn);
      }
    }
    privateInfo.hand = sortCardsAscending(privateInfo.hand || []);

    // Check Special Rules & Burns
    let newPile = [...(room.pile || []), ...playedCards];
    let newPileTop = firstCard;
    let isBurn = false;
    let is7Played = false;

    // 10 = Burn Pile + Extra Turn
    if (firstCard && firstCard.rank === '10') {
      isBurn = true;
      newPile = [];
      newPileTop = null;
      CardAudio.burn();
      triggerBurnAnimation();
      showActionBanner(`💥 ¡${player.name} tiró un 10 y quemó el montón! (Turno extra)`);
    }
    // 4 of a kind consecutive = Burn Pile + Extra Turn
    else if (firstCard && checkFourOfAKindBurn(room.pile || [], playedCards)) {
      isBurn = true;
      newPile = [];
      newPileTop = null;
      CardAudio.burn();
      triggerBurnAnimation();
      showActionBanner(`🔥 ¡4 cartas iguales consecutivas! ${player.name} quemó el montón (Turno extra).`);
    }
    // 2 = Reset pile top
    else if (firstCard && firstCard.rank === '2') {
      showActionBanner(`🃏 ${player.name} jugó un 2 (Reinicio). La siguiente carta puede ser cualquiera.`);
    }
    // 7 = Lower restriction
    else if (firstCard && firstCard.rank === '7') {
      is7Played = true;
      showActionBanner(`⚡ ${player.name} jugó un 7. ¡El siguiente debe tirar 7 o menor!`);
    }
    else if (firstCard) {
      showActionBanner(`${player.name} jugó ${playedCards.map(c => c.name).join(', ')}.`);
    }

    targetPlayer.handCount = (privateInfo.hand && privateInfo.hand.length) || 0;
    targetPlayer.faceUpCount = (targetPlayer.faceUp && targetPlayer.faceUp.length) || 0;
    targetPlayer.faceDownCount = (privateInfo.faceDown && privateInfo.faceDown.length) || 0;

    // Check Victory Condition
    if (isTeamMode) {
      const teammateUid = getTeammateUid(room, playerUid);
      const teammate = teammateUid ? room.players[teammateUid] : null;
      const myTotal = (player.handCount || 0) + (player.faceUp ? player.faceUp.length : 0) + (player.faceDownCount || 0);
      const teamTotal = teammate ? ((teammate.handCount || 0) + (teammate.faceUp ? teammate.faceUp.length : 0) + (teammate.faceDownCount || 0)) : 0;

      // Both teammates must have 0 cards for team to finish!
      if (myTotal === 0 && teamTotal === 0 && !player.isFinished) {
        player.isFinished = true;
        if (teammate) teammate.isFinished = true;
        if (playerUid === State.myUid || (teammateUid && teammateUid === State.myUid)) {
          State.myFinished = true;
          State.myFinishedPlace = 1;
        }
        showToast(`🏆 ¡El Equipo ${player.team === 'blue' ? 'Azul 🔵' : 'Rojo 🔴'} terminó todas sus cartas!`, '🎉');
        CardAudio.win();
      }
    } else {
      const totalRemaining = targetPlayer.handCount + targetPlayer.faceUpCount + targetPlayer.faceDownCount;
      if (totalRemaining === 0 && !player.isFinished) {
        player.isFinished = true;
        targetPlayer.isFinished = true;
        const currentWinners = getRoomWinners(room);
        const place = currentWinners.length + 1;
        player.finishPlace = place;
        targetPlayer.finishPlace = place;
        currentWinners.push({ uid: playerUid, name: player.name, place, team: player.team || null });
        room.winners = currentWinners;
        CardAudio.win();

        if (playerUid === State.myUid) {
          State.myFinished = true;
          State.myFinishedPlace = place;
          awardPrizeIfEligible(playerUid, place, room);
          showEarlyVictoryModal(place, room);
        } else {
          showToast(`🏆 ¡${player.name} terminó todas sus cartas en puesto #${place}!`, '🎉');
        }
      }
    }

    // Check Game Over (FFA vs 2v2)
    const activeUnfinished = Object.values(room.players || {}).filter(p => !isPlayerCompleted(p, room));
    let isGameOver = false;
    let winningTeam = null;

    if (room.gameMode === '2v2') {
      const bluePlayers = Object.values(room.players).filter(p => p.team === 'blue');
      const redPlayers = Object.values(room.players).filter(p => p.team === 'red');
      const blueAllDone = bluePlayers.length > 0 && bluePlayers.every(p => isPlayerCompleted(p, room));
      const redAllDone = redPlayers.length > 0 && redPlayers.every(p => isPlayerCompleted(p, room));

      if (blueAllDone) {
        isGameOver = true;
        winningTeam = 'blue';
        room.winningTeam = 'blue';
        showToast('🏆 ¡EQUIPO AZUL HA GANADO LA PARTIDA! 🔵', '🎉');
      } else if (redAllDone) {
        isGameOver = true;
        winningTeam = 'red';
        room.winningTeam = 'red';
        showToast('🏆 ¡EQUIPO ROJO HA GANADO LA PARTIDA! 🔴', '🎉');
      }
    } else {
      isGameOver = (activeUnfinished.length <= 1);
    }

    if (isGameOver) {
      if (aiTurnTimeout) { clearTimeout(aiTurnTimeout); aiTurnTimeout = null; }
    }

    // Next Turn: Never give extra turn to finished players
    const isPlayerDone = isPlayerCompleted(player, room);
    const canTakeExtraTurn = isBurn && !isPlayerDone;
    let nextTurnUid = null;

    if (canTakeExtraTurn) {
      nextTurnUid = playerUid;
    } else {
      nextTurnUid = getNextTurnPlayerUid(room, playerUid);
    }

    State.selectedCardsToPlay.clear();

    if (isSinglePlayerMode) {
      singlePlayerState.pile = newPile;
      singlePlayerState.pileTop = newPileTop;
      singlePlayerState.isLowerRestriction = is7Played;
      singlePlayerState.deckCount = drawDeck.length;
      singlePlayerState.activePlayerUid = nextTurnUid || (activeUnfinished[0] ? activeUnfinished[0].id : null);

      if (isGameOver) {
        singlePlayerState.status = 'FINISHED';
        singlePlayerState.winningTeam = winningTeam;

        if (singlePlayerState.gameMode === '2v2') {
          const myTeam = singlePlayerState.players[State.myUid] && singlePlayerState.players[State.myUid].team;
          if (myTeam === winningTeam) {
            awardPrizeIfEligible(State.myUid, 1, singlePlayerState);
          }
        } else if (activeUnfinished.length === 1) {
          const lastPlayer = activeUnfinished[0];
          lastPlayer.isFinished = true;
          const place = (singlePlayerState.winners.length + 1);
          lastPlayer.finishPlace = place;
          singlePlayerState.winners.push({ uid: lastPlayer.id, name: lastPlayer.name, place });
          awardPrizeIfEligible(lastPlayer.id, place, singlePlayerState);
        }
        renderResultsView(singlePlayerState);
        showView('results');
        return;
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
      activePlayerUid: nextTurnUid || (activeUnfinished[0] ? activeUnfinished[0].id : null),
      [`players/${targetUid}/handCount`]: targetPlayer.handCount,
      [`players/${targetUid}/faceUp`]: targetPlayer.faceUp || [],
      [`players/${targetUid}/faceDownCount`]: targetPlayer.faceDownCount,
      [`players/${targetUid}/isFinished`]: targetPlayer.isFinished || false,
      [`players/${playerUid}/isFinished`]: player.isFinished || false,
      [`players/${playerUid}/finishPlace`]: player.finishPlace || null,
      winners: getRoomWinners(room),
      winningTeam: winningTeam || room.winningTeam || null
    };

    if (targetPlayer.isAI) {
      updates[`botPrivate/${targetUid}`] = privateInfo;
    }

    if (isGameOver) {
      updates.status = 'FINISHED';
      if (room.gameMode === '2v2') {
        updates.winningTeam = winningTeam;
      } else if (activeUnfinished.length === 1) {
        const lastPlayer = activeUnfinished[0];
        const currentW = getRoomWinners(room);
        const place = currentW.length + 1;
        updates[`players/${lastPlayer.id}/isFinished`] = true;
        updates[`players/${lastPlayer.id}/finishPlace`] = place;
        const finalWinners = [...currentW, { uid: lastPlayer.id, name: lastPlayer.name, place }];
        updates.winners = finalWinners;
        awardPrizeIfEligible(lastPlayer.id, place, room);
      }
    }

    try {
      const db = global.FirebaseService.getDb();
      if (db && currentRoomId && !targetPlayer.isAI) {
        db.ref(`${RTDB_PATHS.PRIVATE}/${currentRoomId}/${targetUid}`).set({
          hand: privateInfo.hand || [],
          faceDown: privateInfo.faceDown || []
        }).catch(() => {});
      }
    } catch (e) {}

    try {
      await currentRoomRef.update(sanitizeForFirebase(updates));
    } catch (err) {
      console.error('Error updating room:', err);
    }
  }

  async function executePickupAction(playerUid, extraFailedCard = null) {
    const room = isSinglePlayerMode ? singlePlayerState : State.room;
    if (!room || !room.players || !room.players[playerUid]) return;
    if (room.status === 'FINISHED') return;
    if (!isActorAllowed(room, playerUid, 'executePickupAction')) return;

    const player = room.players[playerUid];
    CardAudio.pickup();
    showActionBanner(`📥 ${player.name} recogió el montón (${room.pile ? room.pile.length : 0} cartas).`);

    let targetUid = playerUid;
    if (room.gameMode === '2v2') {
      const pRem = (player.handCount || 0) + (player.faceUp ? player.faceUp.length : 0) + (player.faceDownCount || 0);
      if (pRem === 0) {
        const tUid = getTeammateUid(room, playerUid);
        if (tUid) targetUid = tUid;
      }
    }
    const targetPlayer = room.players[targetUid];

    let privateInfo;
    if (isSinglePlayerMode) {
      privateInfo = singlePlayerState.privateData[targetUid] || { hand: [], faceDown: [] };
    } else if (targetPlayer.isAI) {
      if (!State.botPrivateData[targetUid]) {
        State.botPrivateData[targetUid] = (room.botPrivate && room.botPrivate[targetUid]) || { hand: [], faceDown: [] };
      }
      privateInfo = State.botPrivateData[targetUid];
    } else if (targetUid === State.myUid) {
      privateInfo = State.myPrivateCards;
    } else {
      privateInfo = State.teammatePrivateCards;
    }

    const cardsToAdd = [...(room.pile || [])];
    if (extraFailedCard) cardsToAdd.push(extraFailedCard);

    privateInfo.hand = sortCardsAscending([...(privateInfo.hand || []), ...cardsToAdd]);
    targetPlayer.handCount = privateInfo.hand.length;

    const newPile = [];
    const newPileTop = null;
    const isLowerRestriction = false;

    const nextTurnUid = getNextTurnPlayerUid(room, playerUid) || playerUid;
    room.activePlayerUid = nextTurnUid;

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
      if (db && currentRoomId && !targetPlayer.isAI) {
        db.ref(`${RTDB_PATHS.PRIVATE}/${currentRoomId}/${targetUid}`).set({
          hand: privateInfo.hand || [],
          faceDown: privateInfo.faceDown || []
        }).catch(() => {});
      }
    } catch (e) {}

    const updates = {
      pile: newPile,
      pileTop: newPileTop,
      isLowerRestriction: isLowerRestriction,
      currentTurnIndex: room.currentTurnIndex,
      activePlayerUid: nextTurnUid,
      [`players/${targetUid}/handCount`]: targetPlayer.handCount
    };

    if (targetPlayer.isAI) {
      updates[`botPrivate/${targetUid}`] = privateInfo;
    }

    try {
      await currentRoomRef.update(sanitizeForFirebase(updates));
    } catch (err) {
      console.error('Error in pickupPile update:', err);
    }
  }

  // --- RESILIENT SMART AI BOT ENGINE ---

  function getNextActiveOpponent(room, currentUid) {
    const turnOrder = getRoomTurnOrder(room);
    const myIndex = turnOrder.indexOf(currentUid);
    if (myIndex === -1) return null;
    let idx = (myIndex + 1) % turnOrder.length;
    for (let i = 0; i < turnOrder.length; i++) {
      const candidate = turnOrder[idx];
      const p = room.players[candidate];
      if (candidate !== currentUid && p && !p.isFinished && !p.isAbandoned && p.connected !== false) {
        return p;
      }
      idx = (idx + 1) % turnOrder.length;
    }
    return null;
  }

  function evaluateOpponentThreat(player) {
    if (!player || player.isFinished) return 0;
    const handCount = player.handCount || 0;
    const faceUpCount = (player.faceUp && player.faceUp.length) || 0;
    const faceDownCount = player.faceDownCount || 0;
    const total = handCount + faceUpCount + faceDownCount;

    if (total <= 1) return 3; // CRITICAL: Can win on their next turn!
    if (total <= 2) return 2; // HIGH THREAT: 2 cards left
    if (handCount === 0 && faceUpCount <= 2) return 2; // HIGH THREAT: In face-up phase with <=2 cards
    if (total <= 4) return 1; // MODERATE THREAT
    return 0; // NORMAL
  }

  function chooseSmartHandGroup(legalGroups, room, botUid) {
    if (legalGroups.length === 0) return null;
    if (legalGroups.length === 1) return legalGroups[0];

    const nextOpponent = getNextActiveOpponent(room, botUid);
    const threatLevel = evaluateOpponentThreat(nextOpponent);
    const pileTop = room.pileTop;
    const pileLength = (room.pile && room.pile.length) || 0;

    // 1. If pile can be burned with a 10
    const tenGroup = legalGroups.find(g => g[0].rank === '10');
    if (tenGroup) {
      if (threatLevel >= 2 || pileLength >= 2) {
        return tenGroup;
      }
    }

    // 2. Anti-win tactical defense when next opponent is about to win (threatLevel >= 2)
    if (threatLevel >= 2 && nextOpponent) {
      if (nextOpponent.handCount === 0 && nextOpponent.faceUp && nextOpponent.faceUp.length > 0) {
        const oppCards = nextOpponent.faceUp;
        const oppHasOnlyHighCards = oppCards.every(c => c.value > 7 && c.rank !== '2');

        const sevenGroup = legalGroups.find(g => g[0].rank === '7');
        if (sevenGroup && oppHasOnlyHighCards) {
          return sevenGroup;
        }
      }

      // Play highest legal card to choke the opponent
      const sortedByRankDesc = [...legalGroups].sort((a, b) => b[0].value - a[0].value);
      return sortedByRankDesc[0];
    }

    // 3. Smart progression:
    const multiGroups = legalGroups.filter(g => g.length > 1 && g[0].rank !== '2' && g[0].rank !== '10');
    if (multiGroups.length > 0) {
      multiGroups.sort((a, b) => (b.length - a.length) || (a[0].value - b[0].value));
      return multiGroups[0];
    }

    const normalGroups = legalGroups.filter(g => g[0].rank !== '2' && g[0].rank !== '10');
    if (normalGroups.length > 0) {
      normalGroups.sort((a, b) => a[0].value - b[0].value);
      return normalGroups[0];
    }

    if (tenGroup && pileLength >= 2) return tenGroup;
    const twoGroup = legalGroups.find(g => g[0].rank === '2');
    if (twoGroup) return twoGroup;
    if (tenGroup) return tenGroup;

    return legalGroups[0];
  }

  function chooseSmartFaceUpCard(legalFaceUp, room, botUid) {
    if (legalFaceUp.length === 0) return null;
    if (legalFaceUp.length === 1) return legalFaceUp[0];

    const nextOpponent = getNextActiveOpponent(room, botUid);
    const threatLevel = evaluateOpponentThreat(nextOpponent);

    if (threatLevel >= 2 && nextOpponent) {
      const ten = legalFaceUp.find(c => c.rank === '10');
      if (ten) return ten;

      if (nextOpponent.handCount === 0 && nextOpponent.faceUp && nextOpponent.faceUp.length > 0) {
        const oppOnlyHigh = nextOpponent.faceUp.every(c => c.value > 7 && c.rank !== '2');
        const seven = legalFaceUp.find(c => c.rank === '7');
        if (seven && oppOnlyHigh) return seven;
      }

      const sortedDesc = [...legalFaceUp].sort((a, b) => b.value - a.value);
      return sortedDesc[0];
    }

    const normalFaceUp = legalFaceUp.filter(c => c.rank !== '2' && c.rank !== '10');
    if (normalFaceUp.length > 0) {
      normalFaceUp.sort((a, b) => a.value - b.value);
      return normalFaceUp[0];
    }

    const sortedAsc = [...legalFaceUp].sort((a, b) => a.value - b.value);
    return sortedAsc[0];
  }

  // Recovers from any failed AI action (sync throw OR async/promise rejection)
  // so the game never freezes waiting on a bot turn that silently failed.
  // This is the actual fix for "el juego se queda congelado en el turno del bot":
  // executePlayAction/executePickupAction are async, so calling them without
  // awaiting or catching them let internal errors become invisible unhandled
  // promise rejections that killed the whole auto-play chain with no recovery
  // until the user happened to interact with the UI (which forced a re-render
  // and re-armed the chain, making it look like "tocar una carta le da una
  // carta al bot": it was really the bot finally finishing its overdue turn).
  function handleAITurnFailure(botUid, err) {
    console.error('AI Turn error (recovered):', err);
    const room = isSinglePlayerMode ? singlePlayerState : State.room;
    if (!room || room.status === 'FINISHED') return;
    try {
      const p = room.players && room.players[botUid];
      if (p && !isPlayerCompleted(p, room)) {
        executePickupAction(botUid).catch(err2 => {
          console.error('AI recovery pickup also failed:', err2);
          ensureValidActiveTurn(room);
          checkAndTriggerAI(room);
        });
      } else {
        ensureValidActiveTurn(room);
        checkAndTriggerAI(room);
      }
    } catch (err3) {
      console.error('AI recovery error:', err3);
    }
  }

  // Belt-and-suspenders watchdog: runs continuously in the background and
  // re-nudges the AI/turn engine every couple of seconds. Even if some future
  // code path forgets to call checkAndTriggerAI after an action, the game
  // will self-heal on its own within ~2s instead of staying frozen until the
  // user happens to click something.
  function startAIWatchdog() {
    if (aiWatchdogInterval) return;
    aiWatchdogInterval = setInterval(() => {
      const room = isSinglePlayerMode ? singlePlayerState : State.room;
      if (!room || room.status !== 'PLAYING') return;
      if (aiTurnTimeout) return; // a turn is already scheduled, nothing to nudge
      try {
        checkAndTriggerAI(room);
      } catch (err) {
        console.error('AI watchdog error:', err);
      }
    }, 2000);
  }

  function stopAIWatchdog() {
    if (aiWatchdogInterval) {
      clearInterval(aiWatchdogInterval);
      aiWatchdogInterval = null;
    }
  }

  function checkAndTriggerAI(room) {
    const currentRoom = isSinglePlayerMode ? singlePlayerState : State.room;
    if (!currentRoom || currentRoom.status !== 'PLAYING') {
      if (aiTurnTimeout) { clearTimeout(aiTurnTimeout); aiTurnTimeout = null; }
      return;
    }

    ensureValidActiveTurn(currentRoom);

    const activeUid = currentRoom.activePlayerUid;
    if (!activeUid) return;

    const player = currentRoom.players && currentRoom.players[activeUid];
    if (!player || !player.isAI || isPlayerCompleted(player, currentRoom)) return;

    if (!isSinglePlayerMode && !isUserBotController(currentRoom)) return;

    // Already scheduled for this exact bot? Don't stack duplicate timeouts.
    if (aiTurnTimeout && aiTurnScheduledFor === activeUid) return;

    if (aiTurnTimeout) clearTimeout(aiTurnTimeout);
    const delay = 800 + Math.floor(Math.random() * 500);
    aiTurnScheduledFor = activeUid;

    aiTurnTimeout = setTimeout(() => {
      aiTurnTimeout = null;
      aiTurnScheduledFor = null;
      const liveRoom = isSinglePlayerMode ? singlePlayerState : State.room;
      const livePlayer = liveRoom && liveRoom.players && liveRoom.players[activeUid];
      if (!liveRoom || liveRoom.status !== 'PLAYING' || liveRoom.activePlayerUid !== activeUid ||
          !livePlayer || isPlayerCompleted(livePlayer, liveRoom)) {
        // El turno cambio o el bot ya termino mientras esperaba: no jugar, re-evaluar.
        if (liveRoom && liveRoom.status === 'PLAYING') checkAndTriggerAI(liveRoom);
        return;
      }
      try {
        executeAITurn(activeUid);
      } catch (err) {
        handleAITurnFailure(activeUid, err);
      }
    }, delay);
  }

  function executeAITurn(botUid) {
    const room = isSinglePlayerMode ? singlePlayerState : State.room;
    if (!room || room.status === 'FINISHED') return;

    const player = room.players && room.players[botUid];
    if (!player || isPlayerCompleted(player, room)) return;
    if (room.activePlayerUid && room.activePlayerUid !== botUid) return;

    let targetUid = botUid;
    const isTeamMode = (room.gameMode === '2v2');

    let privateInfo;
    if (isSinglePlayerMode) {
      privateInfo = singlePlayerState.privateData[botUid] || { hand: [], faceDown: [] };
    } else {
      if (room.botPrivate && room.botPrivate[botUid]) {
        privateInfo = room.botPrivate[botUid];
      } else if (State.botPrivateData && State.botPrivateData[botUid]) {
        privateInfo = State.botPrivateData[botUid];
      } else {
        privateInfo = { hand: [], faceDown: [] };
      }
    }

    if (isTeamMode) {
      const bHand = (privateInfo.hand || []).length;
      const bFaceUp = (player.faceUp || []).length;
      const bFaceDown = (privateInfo.faceDown || []).length;
      if (bHand === 0 && bFaceUp === 0 && bFaceDown === 0) {
        const tUid = getTeammateUid(room, botUid);
        if (tUid) {
          targetUid = tUid;
          const tPlayer = room.players[tUid];
          if (isSinglePlayerMode) {
            privateInfo = singlePlayerState.privateData[tUid] || { hand: [], faceDown: [] };
          } else if (tPlayer && tPlayer.isAI) {
            privateInfo = (room.botPrivate && room.botPrivate[tUid]) || (State.botPrivateData && State.botPrivateData[tUid]) || { hand: [], faceDown: [] };
          } else if (tUid === State.myUid) {
            // El companero humano SOY YO: mis cartas estan en myPrivateCards.
            privateInfo = State.myPrivateCards || { hand: [], faceDown: [] };
          } else {
            privateInfo = State.teammatePrivateCards || { hand: [], faceDown: [] };
          }
        }
      }
    }

    const targetPlayer = room.players[targetUid] || player;
    const pileTop = room.pileTop;
    const isLower = room.isLowerRestriction;
    const isDeckEmpty = (room.deckCount || 0) === 0;

    // 1. Play from Hand (with combo if deck is empty!)
    const hand = privateInfo.hand || [];
    const faceUp = targetPlayer.faceUp || [];

    if (hand.length > 0) {
      const grouped = {};
      hand.forEach(c => {
        if (!grouped[c.rank]) grouped[c.rank] = [];
        grouped[c.rank].push(c);
      });

      const legalGroups = Object.values(grouped).filter(cards => canPlayCard(cards[0], pileTop, isLower));

      if (legalGroups.length > 0) {
        let chosenCards = chooseSmartHandGroup(legalGroups, room, botUid);
        // Special rule: if draw deck is empty and faceUp has matching cards, play them together ONLY if all remaining cards in hand are of this rank!
        if (isDeckEmpty && faceUp.length > 0 && chosenCards.length > 0 && hand.every(c => c.rank === chosenCards[0].rank)) {
          const rank = chosenCards[0].rank;
          const matchingFaceUp = faceUp.filter(c => c.rank === rank);
          if (matchingFaceUp.length > 0) {
            chosenCards = [...chosenCards, ...matchingFaceUp];
          }
        }
        executePlayAction(botUid, chosenCards).catch(err => handleAITurnFailure(botUid, err));
        return;
      }

      executePickupAction(botUid).catch(err => handleAITurnFailure(botUid, err));
      return;
    }

    // 2. Play from Face-Up Cards
    if (faceUp.length > 0) {
      const legalFaceUp = faceUp.filter(c => canPlayCard(c, pileTop, isLower));
      if (legalFaceUp.length > 0) {
        const chosenCard = chooseSmartFaceUpCard(legalFaceUp, room, botUid);
        const matchingFaceUp = faceUp.filter(c => c.rank === chosenCard.rank);
        executePlayAction(botUid, matchingFaceUp.length > 1 ? matchingFaceUp : [chosenCard]).catch(err => handleAITurnFailure(botUid, err));
        return;
      }
      executePickupAction(botUid).catch(err => handleAITurnFailure(botUid, err));
      return;
    }

    // 3. Play from Face-Down (Blind flip strictly from real dealt cards)
    let faceDown = privateInfo.faceDown || [];
    if (faceDown.length > 0) {
      const cardIndex = Math.floor(Math.random() * faceDown.length);
      const revealed = faceDown.splice(cardIndex, 1)[0];
      if (revealed) {
        if (canPlayCard(revealed, pileTop, isLower)) {
          showToast(`🤖 ${player.name} reveló ${revealed.name} (Válida) ✅`, '🂠');
          executePlayAction(botUid, [revealed], true).catch(err => handleAITurnFailure(botUid, err));
        } else {
          showToast(`🤖 ${player.name} reveló ${revealed.name} (No válida) ❌`, '💥');
          executePickupAction(botUid, revealed).catch(err => handleAITurnFailure(botUid, err));
        }
        return;
      }
    }

    // Sin cartas propias ni de companero.
    if ((privateInfo.faceDown || []).length === 0 && hand.length === 0 && faceUp.length === 0) {
      if (isTeamMode) {
        // En 2v2 el fin lo decide la suma de AMBOS companeros, nunca un puesto individual.
        const tUid = getTeammateUid(room, botUid);
        const mate = tUid && room.players[tUid];
        const mateTotal = mate ? ((mate.handCount || 0) + ((mate.faceUp || []).length) + (mate.faceDownCount || 0)) : 0;
        const ownTotal = (player.handCount || 0) + ((player.faceUp || []).length) + (player.faceDownCount || 0);
        if (ownTotal === 0 && mateTotal === 0) {
          player.isFinished = true;
          if (mate) mate.isFinished = true;
        }
        ensureValidActiveTurn(room);
        return;
      }
      finalizeFFAFinish(room, botUid);
      return;
    }
  }

  // --- UI RENDERING: SQUARE CASINO CARD TABLE ---

  function renderGameTable(room, myUid) {
    if (!room) return;
    if (room.status === 'FINISHED') {
      if (aiTurnTimeout) { clearTimeout(aiTurnTimeout); aiTurnTimeout = null; }
      renderResultsView(room);
      showView('results');
      return;
    }

    // Never switch away if results view is active
    const resultsEl = document.getElementById('guerra-view-results');
    if (resultsEl && resultsEl.classList.contains('active')) {
      return;
    }

    const players = room.players || {};
    const turnOrder = getRoomTurnOrder(room);
    const activeUid = room.activePlayerUid;
    const activePlayer = players[activeUid] || { name: 'Jugador' };

    // My completion state (Spectator Mode)
    const myPublic = players[myUid] || {};
    const winners = getRoomWinners(room);
    const wonWinner = winners.find(w => w && (w.uid === myUid || w.id === myUid));
    const isMeDone = (room.status === 'PLAYING') && !!(
      State.myFinished ||
      myPublic.isFinished ||
      (wonWinner && wonWinner.place) ||
      isPlayerCompleted(myPublic, room)
    );

    if (isMeDone && (myPublic.isFinished || wonWinner)) {
      State.myFinished = true;
      if (!State.myFinishedPlace) {
        State.myFinishedPlace = myPublic.finishPlace || (wonWinner ? wonWinner.place : 1);
      }
    }

    // Auto-fix active turn if current player is finished or disconnected (or if I am already done)
    if (isMeDone && room.activePlayerUid === myUid) {
      ensureValidActiveTurn(room);
    } else {
      ensureValidActiveTurn(room);
    }

    // Update Turn Badge & Rule Alerts
    if (DOM.turnPlayerName) {
      if (isMeDone) {
        const otherPlayerName = (activeUid && activeUid !== myUid && activePlayer.name) ? activePlayer.name : 'los demás';
        DOM.turnPlayerName.textContent = `Turno de ${otherPlayerName} (Modo Espectador)`;
        DOM.turnNotice.className = 'guerra-turn-badge spectator-turn';
      } else {
        DOM.turnPlayerName.textContent = activeUid === myUid ? '¡ES TU TURNO!' : `Turno de ${activePlayer.name}`;
        DOM.turnNotice.className = `guerra-turn-badge ${activeUid === myUid ? 'my-turn' : ''}`;
      }
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
      DOM.livePotCount.textContent = formatCoinsCompact(totalPot);
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

    const isTeamMode = (room.gameMode === '2v2');

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
      const oppTeamClass = isTeamMode ? (opp.team === 'blue' ? 'team-blue' : (opp.team === 'red' ? 'team-red' : '')) : '';

      el.className = `guerra-seat-box ${oppTeamClass} ${isCurrentTurn ? 'active-turn' : ''} ${opp.isFinished ? 'finished' : ''}`;
      el.innerHTML = `
        <div class="opponent-header">
          <span class="status-dot ${opp.connected ? 'online' : 'offline'}"></span>
          <span class="opponent-name">${opp.name}</span>
          ${isTeamMode && opp.team ? (opp.team === 'blue' ? '<span class="difficulty-badge team-badge-blue">🔵 Azul</span>' : '<span class="difficulty-badge team-badge-red">🔴 Rojo</span>') : ''}
          ${opp.isFinished ? `<span class="difficulty-badge" style="background: rgba(16, 185, 129, 0.2); color: var(--accent-emerald);">🏆 Terminado</span>` : ''}
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
    const myTeammateUid = isTeamMode ? getTeammateUid(room, myUid) : null;
    const myTeammate = myTeammateUid ? (players[myTeammateUid] || {}) : null;

    let myPrivate = isSinglePlayerMode ? singlePlayerState.privateData[myUid] : State.myPrivateCards;
    if (myPrivate && myPrivate.hand) {
      myPrivate.hand = sortCardsAscending(myPrivate.hand);
    }
    let myHand = (myPrivate && myPrivate.hand) || [];
    let myFaceUp = myPublic.faceUp || [];
    let myFaceDownCount = (myPrivate && myPrivate.faceDown) ? myPrivate.faceDown.length : (myPublic.faceDownCount || 0);

    const isMyCardsEmpty = (myHand.length === 0 && myFaceUp.length === 0 && myFaceDownCount === 0);
    const teammateRemaining = myTeammate ? ((myTeammate.handCount || 0) + (myTeammate.faceUp ? myTeammate.faceUp.length : 0) + (myTeammate.faceDownCount || 0)) : 0;
    const isPlayingPartnerCards = isTeamMode && isMyCardsEmpty && teammateRemaining > 0;

    let activePartnerName = '';
    if (isPlayingPartnerCards) {
      activePartnerName = myTeammate.name || 'tu compañero';
      let partnerPrivate = null;
      if (isSinglePlayerMode) {
        partnerPrivate = singlePlayerState.privateData[myTeammateUid];
      } else if (myTeammate.isAI) {
        partnerPrivate = State.botPrivateData[myTeammateUid] || (room.botPrivate && room.botPrivate[myTeammateUid]);
      } else {
        partnerPrivate = State.teammatePrivateCards;
      }
      myHand = (partnerPrivate && partnerPrivate.hand) ? sortCardsAscending(partnerPrivate.hand) : [];
      myFaceUp = myTeammate.faceUp || [];
      myFaceDownCount = (partnerPrivate && partnerPrivate.faceDown) ? partnerPrivate.faceDown.length : (myTeammate.faceDownCount || 0);
    }

    // Show/remove partner helper banner
    if (DOM.seatBottom) {
      let partnerBanner = DOM.seatBottom.querySelector('.partner-helper-banner');
      if (isPlayingPartnerCards) {
        if (!partnerBanner) {
          partnerBanner = document.createElement('div');
          partnerBanner.className = 'partner-helper-banner';
          DOM.seatBottom.insertBefore(partnerBanner, DOM.seatBottom.firstChild);
        }
        partnerBanner.innerHTML = `
          <span style="font-size: 24px;">🤝</span>
          <div style="text-align: left;">
            <div style="font-weight: 800; font-size: 13px; color: #93c5fd;">¡TUS CARTAS TERMINARON!</div>
            <div style="font-size: 11px; color: #e2e8f0;">Jugando en tu turno con las cartas de tu compañero <b>${activePartnerName}</b>.</div>
          </div>
        `;
      } else if (partnerBanner) {
        partnerBanner.remove();
      }
    }

    // 1. Table Cards
    const isDeckEmpty = (room.deckCount || 0) === 0;

    if (DOM.myTableCardsContainer) {
      let tableHtml = '';
      for (let i = 0; i < 3; i++) {
        const hasDown = i < myFaceDownCount;
        const upCard = myFaceUp[i] || null;

        // Special combo rule: When draw deck is empty, a face-up card can only be played/selected
        // together with hand cards if this is the LAST card (or cards) remaining in hand (all cards in hand have this rank)!
        const isLastHandMatching = isDeckEmpty && upCard && myHand.length > 0 && myHand.every(c => c.rank === upCard.rank);
        const isComboEligible = isLastHandMatching;

        const isFaceUpPlayable = (myHand.length === 0 || isComboEligible) && upCard !== null;
        const isFaceDownPlayable = myHand.length === 0 && myFaceUp.length === 0 && hasDown;
        const comboClass = isComboEligible ? 'combo-match-glow' : '';

        tableHtml += `
          <div class="my-table-slot">
            ${hasDown ? renderCardHTML(null, false, true, isFaceDownPlayable) : '<div class="guerra-card card-placeholder"></div>'}
            ${upCard ? `<div class="faceup-overlay">${renderCardHTML(upCard, isCardSelected(upCard), false, isFaceUpPlayable, comboClass)}</div>` : ''}
          </div>
        `;
      }
      DOM.myTableCardsContainer.innerHTML = tableHtml;

      DOM.myTableCardsContainer.querySelectorAll('.my-table-slot').forEach((slot, idx) => {
        const upCard = myFaceUp[idx];
        const isLastHandMatching = isDeckEmpty && upCard && myHand.length > 0 && myHand.every(c => c.rank === upCard.rank);
        const isComboEligible = isLastHandMatching;

        if (upCard && (myHand.length === 0 || isComboEligible)) {
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
          ${renderCardHTML(card, isCardSelected(card), false, true)}
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
    const isMyTurn = (activeUid === myUid) && !isMeDone;
    const hasSelection = State.selectedCardsToPlay.size > 0;
    if (DOM.btnPlaySelected) {
      DOM.btnPlaySelected.disabled = !isMyTurn || !hasSelection;
    }
    if (DOM.btnPickupPile) {
      DOM.btnPickupPile.disabled = !isMyTurn || !room.pile || room.pile.length === 0;
    }

    // Check if I have finished (Early Win / Podium in 3-4 player match)
    if (isMeDone) {
      const place = State.myFinishedPlace || myPublic.finishPlace || (wonWinner ? wonWinner.place : 1);
      const totalPlayers = turnOrder.length || 4;
      const bet = room.betAmount || 100;
      const prize = calculatePrizeForPlace(place, totalPlayers, bet, room);

      // Show Early Win Banner in Seat Bottom
      if (DOM.seatBottom) {
        let earlyBanner = DOM.seatBottom.querySelector('.guerra-early-win-banner');
        if (!earlyBanner) {
          earlyBanner = document.createElement('div');
          earlyBanner.className = 'guerra-early-win-banner';
          DOM.seatBottom.insertBefore(earlyBanner, DOM.seatBottom.firstChild);
        }
        earlyBanner.innerHTML = `
          <div style="font-size: 28px;">🏆</div>
          <div style="flex: 1; min-width: 0;">
            <div style="font-size: 15px; font-weight: 800; color: #fff;">
              ¡HAS TERMINADO EN ${place}º LUGAR!
            </div>
            <div style="font-size: 13px; color: var(--accent-amber); font-weight: 700;">
              ${prize > 0 ? `Premio Asegurado: +${formatCoinsCompact(prize)} (${prize.toLocaleString()} 🪙)` : '¡Partida Completada!'}
            </div>
            <div style="font-size: 11px; color: #94a3b8; margin-top: 2px;">
              👀 Modo Espectador: viendo la partida terminar. Puedes salir al menú cuando desees:
            </div>
          </div>
          <button id="guerra-btn-claim-exit" class="btn-claim-exit">
            <span>🚪</span> Salir con mi Premio
          </button>
        `;
        const btnClaimExit = earlyBanner.querySelector('#guerra-btn-claim-exit');
        if (btnClaimExit) {
          btnClaimExit.onclick = (e) => {
            e.stopPropagation();
            leaveRoom();
          };
        }
      }
    } else {
      if (DOM.seatBottom) {
        const earlyBanner = DOM.seatBottom.querySelector('.guerra-early-win-banner');
        if (earlyBanner) earlyBanner.remove();
      }
    }

    if (room && room.status === 'PLAYING') {
      const resultsEl = document.getElementById('guerra-view-results');
      if (!resultsEl || !resultsEl.classList.contains('active')) {
        showView('game');
      }
    }
  }

  function isCardSelected(card) {
    if (!card) return false;
    return Array.from(State.selectedCardsToPlay).some(c => c.id === card.id);
  }

  function toggleCardSelection(card) {
    if (!card) return;
    if (State.myFinished) return; // ya termine: modo espectador
    const existing = Array.from(State.selectedCardsToPlay).find(c => c.id === card.id);
    if (existing) {
      State.selectedCardsToPlay.delete(existing);
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
    const winners = getRoomWinners(room);
    const bet = room.betAmount || 100;
    const turnOrder = getRoomTurnOrder(room);
    const totalPlayers = turnOrder.length || 4;
    const totalPot = room.totalPot || (bet * totalPlayers);
    const isTeamMode = (room.gameMode === '2v2');

    // Process payout & stats once per match (in case not already awarded early)
    if (payoutProcessedForMatch !== (room.id || 'match')) {
      payoutProcessedForMatch = (room.id || 'match');
      if (isTeamMode) {
        const myTeam = room.players[State.myUid] && room.players[State.myUid].team;
        const isWin = (myTeam && myTeam === room.winningTeam);
        recordPlayerMatchResult(isWin);
        if (isWin) {
          awardPrizeIfEligible(State.myUid, 1, room);
        }
      } else {
        const myWinRecord = winners.find(w => w.uid === State.myUid);
        const isWin = (myWinRecord && myWinRecord.place === 1);
        recordPlayerMatchResult(isWin);
        if (myWinRecord) {
          awardPrizeIfEligible(State.myUid, myWinRecord.place, room);
        }
      }
    }

    if (isTeamMode) {
      const winningTeamName = room.winningTeam === 'blue' ? 'Equipo Azul 🔵' : 'Equipo Rojo 🔴';
      const myTeam = room.players[State.myUid] && room.players[State.myUid].team;
      const isWinnerMe = (myTeam === room.winningTeam);
      const teamPrize = Math.floor(totalPot / 2);

      if (DOM.podiumContainer) {
        DOM.podiumContainer.innerHTML = `
          <div style="font-size: 56px; filter: drop-shadow(0 0 20px var(--accent-amber-glow));">🏆</div>
          <h2 style="font-size: 26px; font-weight: 900; color: #fff; margin-top: -6px;">¡${winningTeamName.toUpperCase()} GANA!</h2>
          <div style="display: flex; align-items: center; justify-content: center; gap: 8px; background: rgba(245, 158, 11, 0.15); border: 1px solid var(--accent-amber); border-radius: var(--radius-full); padding: 6px 18px; margin-top: 4px;">
            <span style="font-size: 20px;">🪙</span>
            <span style="color: var(--accent-amber); font-size: 16px; font-weight: 900;">
              ${isWinnerMe ? `¡Tu equipo gana! Premio para ti: +${formatCoinsCompact(teamPrize)} Monedas` : `Ganador: ${winningTeamName} (+${formatCoinsCompact(teamPrize)} Monedas c/u)`}
            </span>
          </div>
        `;
      }

      if (DOM.resultsTableBody) {
        const bluePlayers = Object.values(room.players || {}).filter(p => p.team === 'blue');
        const redPlayers = Object.values(room.players || {}).filter(p => p.team === 'red');
        const isBlueWin = room.winningTeam === 'blue';

        DOM.resultsTableBody.innerHTML = `
          <tr style="background: rgba(59, 130, 246, 0.15); border-bottom: 1px solid rgba(59, 130, 246, 0.4);">
            <td colspan="3" style="padding: 10px 8px; font-weight: 800; color: #60a5fa;">
              ${isBlueWin ? '🏆 1.º LUGAR: EQUIPO AZUL 🔵 (GANADORES)' : '2.º LUGAR: EQUIPO AZUL 🔵'}
            </td>
          </tr>
          ${bluePlayers.map(p => `
            <tr style="border-bottom: 1px solid rgba(51, 65, 85, 0.4);">
              <td style="padding: 8px 12px; font-size: 16px;">${isBlueWin ? '🥇' : '🥈'}</td>
              <td style="padding: 8px 12px; font-weight: 700;">${p.name} ${p.id === State.myUid ? '(Tú)' : ''}</td>
              <td style="padding: 8px 12px; text-align: right; font-family: var(--font-mono); font-weight: 800; color: ${isBlueWin ? 'var(--accent-emerald)' : 'var(--accent-rose)'};">
                ${isBlueWin ? `+${formatCoinsCompact(teamPrize)} 🪙 (Ganancia: +${formatCoinsCompact(teamPrize - bet)})` : `-${formatCoinsCompact(bet)} 🪙`}
              </td>
            </tr>
          `).join('')}

          <tr style="background: rgba(239, 68, 68, 0.15); border-bottom: 1px solid rgba(239, 68, 68, 0.4);">
            <td colspan="3" style="padding: 10px 8px; font-weight: 800; color: #f87171;">
              ${!isBlueWin ? '🏆 1.º LUGAR: EQUIPO ROJO 🔴 (GANADORES)' : '2.º LUGAR: EQUIPO ROJO 🔴'}
            </td>
          </tr>
          ${redPlayers.map(p => `
            <tr style="border-bottom: 1px solid rgba(51, 65, 85, 0.4);">
              <td style="padding: 8px 12px; font-size: 16px;">${!isBlueWin ? '🥇' : '🥈'}</td>
              <td style="padding: 8px 12px; font-weight: 700;">${p.name} ${p.id === State.myUid ? '(Tú)' : ''}</td>
              <td style="padding: 8px 12px; text-align: right; font-family: var(--font-mono); font-weight: 800; color: ${!isBlueWin ? 'var(--accent-emerald)' : 'var(--accent-rose)'};">
                ${!isBlueWin ? `+${formatCoinsCompact(teamPrize)} 🪙 (Ganancia: +${formatCoinsCompact(teamPrize - bet)})` : `-${formatCoinsCompact(bet)} 🪙`}
              </td>
            </tr>
          `).join('')}
        `;
      }
    } else {
      const champion = winners[0] || { name: 'Campeón' };
      const firstPrize = calculatePrizeForPlace(1, totalPlayers, bet, room);
      const isWinnerMe = champion.uid === State.myUid;

      if (DOM.podiumContainer) {
        DOM.podiumContainer.innerHTML = `
          <div style="font-size: 56px; filter: drop-shadow(0 0 20px var(--accent-amber-glow));">🏆</div>
          <h2 style="font-size: 26px; font-weight: 900; color: #fff; margin-top: -6px;">¡${champion.name.toUpperCase()} HA GANADO!</h2>
          <div style="display: flex; align-items: center; justify-content: center; gap: 8px; background: rgba(245, 158, 11, 0.15); border: 1px solid var(--accent-amber); border-radius: var(--radius-full); padding: 6px 18px; margin-top: 4px;">
            <span style="font-size: 20px;">🪙</span>
            <span style="color: var(--accent-amber); font-size: 16px; font-weight: 900;">
              ${isWinnerMe ? `¡Te llevas el 1.º Lugar: +${formatCoinsCompact(firstPrize)} Monedas!` : `1.º Lugar (${champion.name}): +${formatCoinsCompact(firstPrize)} Monedas`}
            </span>
          </div>
        `;
      }

      if (DOM.resultsTableBody) {
        DOM.resultsTableBody.innerHTML = winners.map(w => {
          const prize = calculatePrizeForPlace(w.place, totalPlayers, bet, room);
          const netProfit = prize - bet;
          let profitStr = '';
          let color = 'var(--text-dim)';

          if (w.place === 1) {
            profitStr = `+${formatCoinsCompact(prize)} 🪙 (Ganancia: +${formatCoinsCompact(netProfit)})`;
            color = 'var(--accent-emerald)';
          } else if (w.place === 2) {
            if (prize > 0) {
              profitStr = `+${formatCoinsCompact(prize)} 🪙 (Recupera apuesta: 0 net)`;
              color = 'var(--accent-amber)';
            } else {
              profitStr = `-${formatCoinsCompact(bet)} 🪙`;
              color = 'var(--accent-rose)';
            }
          } else {
            profitStr = `-${formatCoinsCompact(bet)} 🪙`;
            color = 'var(--accent-rose)';
          }

          return `
            <tr style="border-bottom: 1px solid rgba(51, 65, 85, 0.4); ${w.place === 1 ? 'background: rgba(245, 158, 11, 0.1);' : ''}">
              <td style="padding: 12px 8px; font-size: 18px; font-weight: 800;">
                ${w.place === 1 ? '🥇 1.º' : w.place === 2 ? '🥈 2.º' : w.place === 3 ? '🥉 3.º' : '4.º'}
              </td>
              <td style="padding: 12px 8px; font-weight: 700; color: var(--text-main);">
                ${w.name} ${w.uid === State.myUid ? '(Tú)' : ''}
              </td>
              <td style="padding: 12px 8px; text-align: right; font-family: var(--font-mono); font-weight: 800; color: ${color};">
                ${profitStr}
              </td>
            </tr>
          `;
        }).join('');
      }
    }

    if (State.isCreator) {
      if (DOM.btnPlayAgain) DOM.btnPlayAgain.style.display = 'flex';
    } else {
      if (DOM.btnPlayAgain) DOM.btnPlayAgain.style.display = 'none';
    }

    updateCoinsDisplay();
  }

  // --- REALTIME LISTENERS & PRESENCE ---

  let teammatePrivateRef = null;
  function updateTeammatePrivateListener(room, myUid) {
    if (!room || room.gameMode !== '2v2' || !currentRoomId) {
      if (teammatePrivateRef) {
        teammatePrivateRef.off();
        teammatePrivateRef = null;
      }
      return;
    }

    const tUid = getTeammateUid(room, myUid);
    if (!tUid) return;

    const tPlayer = room.players && room.players[tUid];
    if (tPlayer && tPlayer.isAI) {
      return;
    }

    const db = global.FirebaseService && global.FirebaseService.getDb();
    if (!db) return;

    if (!teammatePrivateRef || teammatePrivateRef.key !== tUid) {
      if (teammatePrivateRef) teammatePrivateRef.off();
      teammatePrivateRef = db.ref(`${RTDB_PATHS.PRIVATE}/${currentRoomId}/${tUid}`);
      teammatePrivateRef.on('value', snap => {
        const data = snap.val() || {};
        State.teammatePrivateCards = {
          hand: sortCardsAscending(data.hand || []),
          faceDown: data.faceDown || []
        };
        if (State.room && (State.room.status === 'PLAYING' || State.room.status === 'SETUP')) {
          renderGameTable(State.room, myUid);
        }
      });
    }
  }

  function attachRoomListeners(roomRef, myUid) {
    const db = global.FirebaseService.getDb();
    currentPrivateRef = db.ref(`${RTDB_PATHS.PRIVATE}/${currentRoomId}/${myUid}`);

    currentPrivateRef.on('value', snap => {
      const data = snap.val() || {};
      State.myPrivateCards = {
        hand: sortCardsAscending(data.hand || []),
        faceDown: data.faceDown || [],
        selectable6: sortCardsAscending(data.selectable6 || [])
      };
      const myPublic = (State.room && State.room.players && State.room.players[myUid]) || {};
      if (State.room && (State.room.status === 'PLAYING' || State.room.status === 'SETUP')) {
        renderGameTable(State.room, myUid);
      }
    });

    currentRoomRef.on('value', snap => {
      const room = snap.val();
      if (!room) {
        showToast('La sala ha sido cerrada por el anfitrión.', 'ℹ️');
        leaveRoom();
        return;
      }

      State.room = room;
      if (room.botPrivate) {
        State.botPrivateData = room.botPrivate;
      }

      updateTeammatePrivateListener(room, myUid);

      const myData = room.players && room.players[myUid];
      if (!myData && State.room.status !== 'WAITING') {
        leaveRoom();
        return;
      }

      const isHost = (room.creatorId === myUid);
      State.isCreator = isHost;

      if (room.status === 'WAITING') {
        renderWaitingRoom(room);
      } else if (room.status === 'SETUP') {
        const allPlayers = Object.values(room.players || {});
        const activeConnected = allPlayers.filter(p => !p.isAbandoned && p.connected !== false);

        if (allPlayers.length >= 2 && activeConnected.length <= 1 && isUserBotController(room)) {
          const solePlayer = activeConnected[0];
          const finalWinners = [{ uid: solePlayer.id, name: solePlayer.name, place: 1 }];
          currentRoomRef.update({
            status: 'FINISHED',
            winners: finalWinners,
            [`players/${solePlayer.id}/isFinished`]: true,
            [`players/${solePlayer.id}/finishPlace`]: 1
          }).catch(() => {});
          return;
        }

        // Check if all players are ready (AI, setupReady, abandoned, or disconnected)
        const allReady = allPlayers.length > 0 && allPlayers.every(p => p.isAI || p.setupReady || p.isAbandoned || p.connected === false);
        if (allReady) {
          const turnOrder = getRoomTurnOrder(room);
          let startIdx = room.currentTurnIndex;
          if (startIdx === undefined || startIdx === null || !room.activePlayerUid) {
            startIdx = Math.floor(Math.random() * turnOrder.length);
          }
          const firstTurn = room.activePlayerUid || turnOrder[startIdx] || turnOrder[0];
          if (State.isCreator || isUserBotController(room)) {
            currentRoomRef.update({
              status: 'PLAYING',
              activePlayerUid: firstTurn,
              currentTurnIndex: startIdx
            }).catch(() => {});
          }
          room.status = 'PLAYING';
          room.activePlayerUid = firstTurn;
          room.currentTurnIndex = startIdx;
          renderGameTable(room, myUid);
          showView('game');
          checkAndTriggerAI(room);
          const starter = (room.players && room.players[firstTurn]) || { name: 'Jugador' };
          showToast(`🎲 ¡Inicia la partida! Turno sorteado: ${starter.name}`, '🎲');
          return;
        }

        if (!room.players[myUid] || !room.players[myUid].setupReady) {
          renderSetupView(room, myUid);
        } else {
          showView('setup');
          if (DOM.setupWaitingNotice) DOM.setupWaitingNotice.style.display = 'block';
          if (DOM.btnConfirmSetup) DOM.btnConfirmSetup.style.display = 'none';
        }
      } else if (room.status === 'PLAYING') {
        ensureBetDeducted(room);

        // Auto-win check if players abandoned / disconnected leaving only 1 active unfinished player
        const allPlayers = Object.values(room.players || {});
        const unfinishedActive = allPlayers.filter(p => !isPlayerCompleted(p, room));

        if (room.gameMode === '2v2' && isUserBotController(room)) {
          const bluePlayers = Object.values(room.players).filter(p => p.team === 'blue');
          const redPlayers = Object.values(room.players).filter(p => p.team === 'red');
          const blueAllDone = bluePlayers.length > 0 && bluePlayers.every(p => isPlayerCompleted(p, room));
          const redAllDone = redPlayers.length > 0 && redPlayers.every(p => isPlayerCompleted(p, room));

          if (blueAllDone || redAllDone) {
            const winTeam = blueAllDone ? 'blue' : 'red';
            currentRoomRef.update({
              status: 'FINISHED',
              winningTeam: winTeam
            }).catch(() => {});
            return;
          }
        }

        if (allPlayers.length >= 2 && unfinishedActive.length <= 1 && isUserBotController(room)) {
          const solePlayer = unfinishedActive[0];
          if (solePlayer) {
            const currentWinners = getRoomWinners(room);
            const place = currentWinners.length + 1;
            const finalWinners = [...currentWinners, { uid: solePlayer.id, name: solePlayer.name, place }];
            currentRoomRef.update({
              status: 'FINISHED',
              winners: finalWinners,
              [`players/${solePlayer.id}/isFinished`]: true,
              [`players/${solePlayer.id}/finishPlace`]: place
            }).catch(() => {});
            return;
          } else {
            // Nobody unfinished active
            currentRoomRef.update({ status: 'FINISHED' }).catch(() => {});
            return;
          }
        }

        renderGameTable(room, myUid);
        checkAndTriggerAI(room);
      } else if (room.status === 'FINISHED') {
        if (aiTurnTimeout) { clearTimeout(aiTurnTimeout); aiTurnTimeout = null; }
        renderResultsView(room);
        showView('results');
      }
    });
  }

  function renderWaitingRoom(room) {
    if (DOM.displayRoomCode) DOM.displayRoomCode.textContent = room.id;
    const playerList = Object.values(room.players || {});
    if (DOM.waitingPlayersCount) DOM.waitingPlayersCount.textContent = `${playerList.length} / 4 Jugadores`;

    if (DOM.waitingPrivacyBadge) {
      if (room.isPublic) {
        DOM.waitingPrivacyBadge.textContent = '🌐 Sala Pública';
        DOM.waitingPrivacyBadge.style.background = 'rgba(59, 130, 246, 0.2)';
        DOM.waitingPrivacyBadge.style.color = '#60a5fa';
        DOM.waitingPrivacyBadge.style.border = '1px solid rgba(59, 130, 246, 0.4)';
      } else {
        DOM.waitingPrivacyBadge.textContent = '🔒 Sala Privada';
        DOM.waitingPrivacyBadge.style.background = 'rgba(168, 85, 247, 0.2)';
        DOM.waitingPrivacyBadge.style.color = '#c084fc';
        DOM.waitingPrivacyBadge.style.border = '1px solid rgba(168, 85, 247, 0.4)';
      }
    }

    const isTeamMode = (room.gameMode === '2v2');
    if (DOM.waitingModeBadge) {
      DOM.waitingModeBadge.textContent = isTeamMode ? '👥 2 vs 2 Equipos' : '⚔️ Todos vs Todos';
      DOM.waitingModeBadge.style.background = isTeamMode ? 'rgba(59, 130, 246, 0.2)' : 'rgba(245, 158, 11, 0.2)';
      DOM.waitingModeBadge.style.color = isTeamMode ? '#93c5fd' : '#fcd34d';
      DOM.waitingModeBadge.style.border = isTeamMode ? '1px solid rgba(59, 130, 246, 0.4)' : '1px solid rgba(245, 158, 11, 0.4)';
    }

    const bet = room.betAmount || selectedBetAmount || 100;
    const pot = isTeamMode ? bet * 4 : bet * (playerList.length === 1 ? 4 : playerList.length);
    if (DOM.waitingBetBadge) {
      DOM.waitingBetBadge.textContent = `🪙 Apuesta: ${formatCoinsCompact(bet)} | Bote: ${formatCoinsCompact(pot)}`;
    }

    // Bot Controls for host
    if (DOM.waitingBotControls) {
      DOM.waitingBotControls.style.display = State.isCreator ? 'flex' : 'none';
      if (DOM.btnAddBot) DOM.btnAddBot.disabled = playerList.length >= 4;
      const botCount = playerList.filter(p => p.isAI).length;
      if (DOM.btnRemoveBot) DOM.btnRemoveBot.disabled = botCount <= 0;
    }

    // Team instruction
    if (DOM.teamInstruction) {
      DOM.teamInstruction.style.display = isTeamMode ? 'block' : 'none';
    }

    if (DOM.waitingPlayersList) {
      DOM.waitingPlayersList.innerHTML = playerList.map(p => {
        const isMe = (p.id === State.myUid);
        const canSwitchTeam = isTeamMode && (isMe || State.isCreator);
        let teamBadgeHtml = '';
        if (isTeamMode) {
          const teamColor = p.team === 'red' ? 'red' : 'blue';
          const teamLabel = p.team === 'red' ? '🔴 Rojo' : '🔵 Azul';
          teamBadgeHtml = `
            <span class="team-badge-${teamColor}" style="padding: 3px 9px; border-radius: 9999px; font-size: 11px; font-weight: 800;">
              ${teamLabel}
            </span>
            ${canSwitchTeam ? `<button class="btn-team-toggle" data-player-id="${p.id}" style="padding: 2px 7px; font-size: 10px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.2); background: rgba(255,255,255,0.1); color: #fff; cursor: pointer;">Cambiar 🔄</button>` : ''}
          `;
        }

        return `
          <div class="player-slot-card ready" style="padding: 10px 14px; display: flex; align-items: center; justify-content: space-between; gap: 8px;">
            <div style="display: flex; align-items: center; gap: 10px; flex: 1;">
              <span class="status-dot ${p.connected ? 'online' : 'offline'}"></span>
              <span style="font-weight: 700; text-align: left;">
                ${p.name} ${isMe ? '(Tú)' : ''} ${p.isAI ? '🤖' : ''}
              </span>
              ${p.id === room.creatorId ? '<span class="player-badge badge-host">👑 Anfitrión</span>' : ''}
            </div>
            <div style="display: flex; align-items: center; gap: 6px;">
              ${teamBadgeHtml}
            </div>
          </div>
        `;
      }).join('');

      DOM.waitingPlayersList.querySelectorAll('.btn-team-toggle').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const targetId = btn.dataset.playerId;
          togglePlayerTeam(targetId);
        });
      });
    }

    if (DOM.btnHostStart) {
      DOM.btnHostStart.style.display = State.isCreator ? 'flex' : 'none';
      if (isTeamMode) {
        const blueCount = playerList.filter(p => p.team === 'blue').length;
        const redCount = playerList.filter(p => p.team === 'red').length;
        if (playerList.length < 4) {
          DOM.btnHostStart.disabled = false;
          DOM.btnHostStart.innerHTML = `<span>🤖</span> INICIAR 2v2 (AUTOCOMPLETAR CON BOTS - BOTE: ${formatCoinsCompact(bet * 4)} 🪙)`;
        } else if (blueCount !== 2 || redCount !== 2) {
          DOM.btnHostStart.disabled = true;
          DOM.btnHostStart.innerHTML = `<span>⚠️</span> EQUIPOS DESBALANCEADOS (${blueCount} Azules vs ${redCount} Rojos)`;
        } else {
          DOM.btnHostStart.disabled = false;
          DOM.btnHostStart.innerHTML = `<span>⚔️</span> INICIAR PARTIDA 2 vs 2 (BOTE: ${formatCoinsCompact(bet * 4)} 🪙)`;
        }
      } else {
        DOM.btnHostStart.disabled = false;
        DOM.btnHostStart.innerHTML = playerList.length === 1
          ? `<span>🤖</span> INICIAR (SOLO VS 3 IA - BOTE: ${formatCoinsCompact(bet * 4)} 🪙)`
          : `<span>⚔️</span> INICIAR PARTIDA (${playerList.length} JUGADORES - BOTE: ${formatCoinsCompact(pot)} 🪙)`;
      }
    }

    showView('waiting');
  }

  // --- REALTIME GUERRA CHAT MODULE ---
  const GuerraChat = (function () {
    let isOpen = false;
    let unreadCount = 0;
    let messages = [];
    let chatRef = null;
    let localRoomId = null;

    function init(roomId) {
      cleanup();
      localRoomId = roomId;
      unreadCount = 0;
      messages = [];
      updateUnreadBadges();
      renderMessages();

      if (DOM.chatToggleBtn) DOM.chatToggleBtn.style.display = 'flex';

      if (!isSinglePlayerMode) {
        const db = global.FirebaseService ? global.FirebaseService.getDb() : null;
        if (db && roomId) {
          chatRef = db.ref(`${RTDB_PATHS.ROOMS}/${roomId}/messages`);
          chatRef.limitToLast(50).on('child_added', snap => {
            const msg = snap.val();
            if (!msg || !msg.id) return;
            if (!messages.some(m => m.id === msg.id)) {
              messages.push(msg);
              handleIncomingMessage(msg);
            }
          });
        }
      }
    }

    function cleanup() {
      if (chatRef) {
        chatRef.off();
        chatRef = null;
      }
      localRoomId = null;
      messages = [];
      unreadCount = 0;
      close();
      if (DOM.chatToggleBtn) DOM.chatToggleBtn.style.display = 'none';
      updateUnreadBadges();
    }

    function open() {
      isOpen = true;
      unreadCount = 0;
      updateUnreadBadges();
      if (DOM.chatOverlay) DOM.chatOverlay.style.display = 'flex';
      renderMessages();
      if (DOM.chatInput) DOM.chatInput.focus();
    }

    function close() {
      isOpen = false;
      if (DOM.chatOverlay) DOM.chatOverlay.style.display = 'none';
    }

    function toggle() {
      if (isOpen) close();
      else open();
    }

    function updateUnreadBadges() {
      const show = unreadCount > 0;
      if (DOM.chatUnreadBadge) {
        DOM.chatUnreadBadge.textContent = unreadCount > 9 ? '9+' : unreadCount;
        DOM.chatUnreadBadge.style.display = show ? 'inline-flex' : 'none';
      }
      if (DOM.waitingChatBadge) {
        DOM.waitingChatBadge.style.display = show ? 'block' : 'none';
      }
      if (DOM.gameChatBadge) {
        DOM.gameChatBadge.style.display = show ? 'block' : 'none';
      }
    }

    function sendMessage(text, type = 'text') {
      if (!text || !text.trim()) return;
      const cleanText = text.trim().substring(0, 120);
      const myUid = State.myUid;
      const myName = getPlayerName();

      const msgObj = {
        id: 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
        senderUid: myUid,
        senderName: myName,
        text: cleanText,
        timestamp: Date.now(),
        isAI: false,
        type: type
      };

      if (!isSinglePlayerMode && chatRef) {
        chatRef.push(msgObj).catch(err => console.warn('Chat send error:', err));
      } else {
        messages.push(msgObj);
        handleIncomingMessage(msgObj);
        triggerBotReaction(cleanText);
      }

      if (DOM.chatInput) DOM.chatInput.value = '';
    }

    function handleIncomingMessage(msg) {
      CardAudio.chat();
      renderMessages();

      if (!isOpen) {
        unreadCount++;
        updateUnreadBadges();
      }

      showSeatSpeechBubble(msg.senderUid, msg.text, msg.isAI);
    }

    function renderMessages() {
      if (!DOM.chatMessagesContainer) return;
      if (messages.length === 0) {
        DOM.chatMessagesContainer.innerHTML = `
          <div class="chat-empty-hint">
            <span style="font-size: 24px;">🃏</span>
            <span>¡Saluda a los jugadores o usa los mensajes rápidos!</span>
          </div>
        `;
        return;
      }

      const myUid = State.myUid;
      DOM.chatMessagesContainer.innerHTML = messages.map(msg => {
        const isMe = msg.senderUid === myUid;
        let isEmojiOnly = false;
        try {
          isEmojiOnly = new RegExp('^(\\p{Extended_Pictographic}|[\\u{1F300}-\\u{1FAFF}]+)+$', 'u').test(msg.text.trim()) && msg.text.trim().length <= 8;
        } catch (e) {
          isEmojiOnly = false;
        }
        const timeStr = new Date(msg.timestamp || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        return `
          <div class="chat-msg-row ${isMe ? 'is-me' : isBot ? 'is-bot' : 'is-rival'} ${isEmojiOnly ? 'emoji-only' : ''}">
            <span class="chat-sender-name">${isMe ? 'Tú' : escapeHTML(msg.senderName || 'Jugador')}</span>
            <div class="chat-bubble">
              ${escapeHTML(msg.text)}
            </div>
            <span class="chat-timestamp">${timeStr}</span>
          </div>
        `;
      }).join('');

      DOM.chatMessagesContainer.scrollTop = DOM.chatMessagesContainer.scrollHeight;
    }

    function escapeHTML(str) {
      return (str || '').replace(/[&<>'"]/g, tag => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;'
      }[tag] || tag));
    }

    function showSeatSpeechBubble(senderUid, text, isBot = false) {
      let seatEl = null;
      if (senderUid === State.myUid) {
        seatEl = DOM.seatBottom;
      } else {
        const room = isSinglePlayerMode ? singlePlayerState : State.room;
        if (room && room.turnOrder) {
          const myIndex = room.turnOrder.indexOf(State.myUid);
          const total = room.turnOrder.length;
          let sMap = { top: null, left: null, right: null };
          if (total === 4) {
            sMap.left = room.turnOrder[(myIndex + 1) % 4];
            sMap.top = room.turnOrder[(myIndex + 2) % 4];
            sMap.right = room.turnOrder[(myIndex + 3) % 4];
          } else if (total === 3) {
            sMap.left = room.turnOrder[(myIndex + 1) % 3];
            sMap.right = room.turnOrder[(myIndex + 2) % 3];
          } else if (total === 2) {
            sMap.top = room.turnOrder[(myIndex + 1) % 2];
          }

          if (sMap.top === senderUid) seatEl = DOM.seatTop;
          else if (sMap.left === senderUid) seatEl = DOM.seatLeft;
          else if (sMap.right === senderUid) seatEl = DOM.seatRight;
        }
      }

      if (!seatEl) return;

      const existing = seatEl.querySelector('.seat-speech-bubble');
      if (existing) existing.remove();

      const bubble = document.createElement('div');
      bubble.className = `seat-speech-bubble ${isBot ? 'bot-bubble' : ''}`;
      bubble.textContent = text.length > 25 ? text.substring(0, 22) + '...' : text;
      seatEl.style.position = 'relative';
      seatEl.appendChild(bubble);

      setTimeout(() => {
        bubble.style.transition = 'opacity 0.4s, transform 0.4s';
        bubble.style.opacity = '0';
        bubble.style.transform = 'translateX(-50%) translateY(-10px)';
        setTimeout(() => bubble.remove(), 400);
      }, 3500);
    }

    function triggerBotReaction(userText) {
      if (!isSinglePlayerMode) return;
      const botNames = ['Bot Alfa 🤖', 'Bot Beta 🤖', 'Bot Gamma 🤖'];
      const botUids = ['bot_1', 'bot_2', 'bot_3'];
      const randomIdx = Math.floor(Math.random() * 3);
      const chosenBotUid = botUids[randomIdx];
      const chosenBotName = botNames[randomIdx];

      let reply = null;
      const lower = userText.toLowerCase();

      if (lower.includes('mejor') || lower.includes('ganar')) {
        const replies = ['¡Aún no has ganado! 😉', '¡Ya veremos quién ríe al final! 😂', '¡La suerte puede cambiar! 🃏', '👑 ¿Seguro? ¡Mira mis cartas!'];
        reply = replies[Math.floor(Math.random() * replies.length)];
      } else if (lower.includes('buena') || lower.includes('jugada')) {
        const replies = ['¡Gracias! 👏', '¡Esa estuvo bien calculada! 😎', 'Hago lo que puedo 🤖', '¡Tú también juegas bien! 👍'];
        reply = replies[Math.floor(Math.random() * replies.length)];
      } else if (lower.includes('mala suerte') || lower.includes('suerte')) {
        const replies = ['A cualquiera le pasa 😅', '¡Así es la Guerra! 🔥', 'El montón no perdona 📥', '¡Ánimo! 💪'];
        reply = replies[Math.floor(Math.random() * replies.length)];
      } else if (lower.includes('jaja') || lower.includes('😂')) {
        const replies = ['😂😂😂', '¡Qué risa! 🤣', 'No te confíes 😜', '👀'];
        reply = replies[Math.floor(Math.random() * replies.length)];
      } else if (lower.includes('hola') || lower.includes('saludos')) {
        const replies = ['¡Hola! ¡A jugar con todo! ⚔️', '¡Buena suerte a todos! 🃏', '¡Hola humano! 🤖'];
        reply = replies[Math.floor(Math.random() * replies.length)];
      } else if (lower.includes('te toca') || lower.includes('rapido')) {
        const replies = ['¡Ya voy, ya voy! ⏱️', 'Analizando jugada óptima... 🧠', '¡Tranquilo! 🧘'];
        reply = replies[Math.floor(Math.random() * replies.length)];
      } else if (lower.includes('gg') || lower.includes('partida')) {
        const replies = ['¡Bien jugado! 🤝', '¡GG! 🏆', '¡Excelente partida! 👏'];
        reply = replies[Math.floor(Math.random() * replies.length)];
      } else {
        const generic = ['😎', '🤔', '🔥', '¡Buena jugada!', '👀', '¡Vamos con todo! 🃏'];
        reply = generic[Math.floor(Math.random() * generic.length)];
      }

      const delay = 1200 + Math.floor(Math.random() * 1500);
      setTimeout(() => {
        if (!isSinglePlayerMode) return;
        const botMsg = {
          id: 'msg_bot_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
          senderUid: chosenBotUid,
          senderName: chosenBotName,
          text: reply,
          timestamp: Date.now(),
          isAI: true,
          type: 'text'
        };
        messages.push(botMsg);
        handleIncomingMessage(botMsg);
      }, delay);
    }

    return {
      init,
      cleanup,
      open,
      close,
      toggle,
      sendMessage,
      showSeatSpeechBubble
    };
  })();

  function handleForfeitAndLeave() {
    const room = isSinglePlayerMode ? singlePlayerState : State.room;
    const myUid = State.myUid;
    const myPlayer = room && room.players && room.players[myUid];
    const winners = getRoomWinners(room);
    const isWon = winners.some(w => w && (w.uid === myUid || w.id === myUid)) || State.myFinished;
    const isDone = !room || room.status === 'FINISHED' || isWon || (myPlayer && isPlayerCompleted(myPlayer, room));

    // If game has already finished or I have already finished (or have 0 cards left): leave safely without penalty!
    if (isDone) {
      leaveRoom();
      return;
    }

    // In active game (WAITING, SETUP, or PLAYING), confirm forfeit
    if (confirm('¿Deseas abandonar la partida? Si sales ahora perderás tu apuesta y el otro jugador ganará.')) {
      if (isSinglePlayerMode) {
        leaveRoom();
        return;
      }

      if (currentRoomRef && currentRoomId) {
        try {
          const allPlayers = Object.values(room.players || {});
          const remainingUnfinished = allPlayers.filter(p => p.id !== myUid && !isPlayerCompleted(p, room));

          const updates = {
            [`players/${myUid}/connected`]: false,
            [`players/${myUid}/isAbandoned`]: true
          };

          if (remainingUnfinished.length === 1 && (room.status === 'PLAYING' || room.status === 'SETUP')) {
            const solePlayer = remainingUnfinished[0];
            const currentWinners = getRoomWinners(room);
            const place = currentWinners.length + 1;
            updates.status = 'FINISHED';
            updates.winners = [...currentWinners, { uid: solePlayer.id, name: solePlayer.name, place }];
            updates[`players/${solePlayer.id}/isFinished`] = true;
            updates[`players/${solePlayer.id}/finishPlace`] = place;
          } else if (room.activePlayerUid === myUid && room.status === 'PLAYING') {
            // Advance turn if it was my turn
            const turnOrder = room.turnOrder || Object.keys(room.players);
            let nextIdx = (room.currentTurnIndex + 1) % turnOrder.length;
            let loops = 0;
            while (loops < turnOrder.length) {
              const candidate = turnOrder[nextIdx];
              const p = room.players[candidate];
              if (candidate !== myUid && p && !isPlayerCompleted(p)) {
                updates.currentTurnIndex = nextIdx;
                updates.activePlayerUid = candidate;
                break;
              }
              nextIdx = (nextIdx + 1) % turnOrder.length;
              loops++;
            }
          }

          currentRoomRef.update(updates).catch(() => {});
        } catch (e) {}
      }

      leaveRoom();
    }
  }

  function leaveRoom() {
    if (aiTurnTimeout) {
      clearTimeout(aiTurnTimeout);
      aiTurnTimeout = null;
    }
    aiTurnScheduledFor = null;
    GuerraChat.cleanup();
    if (currentRoomRef && currentRoomId) {
      const myUid = State.myUid;
      const db = global.FirebaseService && global.FirebaseService.getDb();
      if (db) {
        if (State.isCreator) {
          db.ref(`${RTDB_PATHS.PUBLIC_ROOMS}/${currentRoomId}`).remove().catch(() => {});
        } else if (State.room && State.room.isPublic && State.room.status === 'WAITING') {
          const remaining = Object.values(State.room.players || {}).filter(p => p.id !== myUid && p.connected !== false).length;
          if (remaining <= 0) {
            db.ref(`${RTDB_PATHS.PUBLIC_ROOMS}/${currentRoomId}`).remove().catch(() => {});
          } else {
            db.ref(`${RTDB_PATHS.PUBLIC_ROOMS}/${currentRoomId}`).update({ playerCount: remaining, status: 'WAITING' }).catch(() => {});
          }
        }
      }
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
    if (teammatePrivateRef) {
      teammatePrivateRef.off();
      teammatePrivateRef = null;
    }
    State.teammatePrivateCards = { hand: [], faceDown: [] };
    State.myFinished = false;
    State.myFinishedPlace = null;
    State.selectedCardsToPlay.clear();
    State.selectedForSetup.clear();
    currentRoomId = null;
    isSinglePlayerMode = false;
    singlePlayerState = null;
    payoutProcessedForMatch = null;
    if (aiTurnTimeout) clearTimeout(aiTurnTimeout);

    showView('lobby');
  }

  // --- INITIALIZATION & EVENTS ---

  function initEvents() {
    const inputNick = DOM.inputNickname || document.getElementById('guerra-nickname-input');
    if (inputNick) {
      inputNick.value = getPlayerName();
      const onNameChange = () => {
        const clean = inputNick.value.trim().substring(0, 20) || getPlayerName();
        safeStorageSet(PLAYER_STORAGE_KEYS.NAME, clean);
        inputNick.value = clean;
      };
      inputNick.addEventListener('change', onNameChange);
      inputNick.addEventListener('blur', onNameChange);
    }

    // Bet selection modal controls in lobby
    openBetSelectorModal = function () {
      if (DOM.betModalUserCoins) {
        DOM.betModalUserCoins.textContent = `${getPlayerCoins().toLocaleString()} 🪙`;
      }
      if (DOM.modalBetSelector) {
        DOM.modalBetSelector.classList.add('active');
      }
      if (DOM.betOptionsContainer) {
        DOM.betOptionsContainer.querySelectorAll('.bet-option-card').forEach(card => {
          const cardBet = parseInt(card.dataset.bet, 10);
          card.classList.toggle('selected', cardBet === selectedBetAmount);
        });
      }
    };

    function closeBetSelectorModal() {
      if (DOM.modalBetSelector) {
        DOM.modalBetSelector.classList.remove('active');
      }
    }

    function applySelectedBet(amount) {
      selectedBetAmount = parseInt(amount, 10) || null;
      if (!selectedBetAmount) return;

      if (DOM.selectedBetDisplay) {
        DOM.selectedBetDisplay.textContent = `${formatCoinsCompact(selectedBetAmount)} 🪙 (${selectedBetAmount.toLocaleString()} Monedas)`;
        DOM.selectedBetDisplay.classList.remove('unselected');
      }
      if (DOM.selectedBetSubtext) {
        DOM.selectedBetSubtext.textContent = `Bote Estimado: ${formatCoinsCompact(selectedBetAmount * 4)} 🪙 (4 jugadores)`;
      }
      if (DOM.betStatusHint) {
        DOM.betStatusHint.textContent = `✅ ${formatCoinsCompact(selectedBetAmount)} 🪙`;
        DOM.betStatusHint.style.color = 'var(--accent-emerald)';
      }
      if (DOM.btnOpenBetSelector) {
        DOM.btnOpenBetSelector.classList.add('selected');
      }

      if (DOM.betOptionsContainer) {
        DOM.betOptionsContainer.querySelectorAll('.bet-option-card').forEach(card => {
          const cardBet = parseInt(card.dataset.bet, 10);
          card.classList.toggle('selected', cardBet === selectedBetAmount);
        });
      }

      document.querySelectorAll('.quick-bet-chip[data-bet]').forEach(chip => {
        const chipBet = parseInt(chip.dataset.bet, 10);
        chip.classList.toggle('selected', chipBet === selectedBetAmount);
      });

      CardAudio.click();
      closeBetSelectorModal();
    }

    if (DOM.btnOpenBetSelector) {
      DOM.btnOpenBetSelector.addEventListener('click', openBetSelectorModal);
    }
    const btnMoreBets = document.getElementById('guerra-btn-more-bets');
    if (btnMoreBets) {
      btnMoreBets.addEventListener('click', openBetSelectorModal);
    }
    document.querySelectorAll('.quick-bet-chip[data-bet]').forEach(chip => {
      chip.addEventListener('click', () => {
        const betVal = chip.dataset.bet;
        applySelectedBet(betVal);
      });
    });
    if (DOM.btnCloseBetSelector) {
      DOM.btnCloseBetSelector.addEventListener('click', closeBetSelectorModal);
    }
    if (DOM.btnCloseBetSelectorX) {
      DOM.btnCloseBetSelectorX.addEventListener('click', closeBetSelectorModal);
    }
    if (DOM.modalBetSelector) {
      DOM.modalBetSelector.addEventListener('click', (e) => {
        if (e.target === DOM.modalBetSelector) closeBetSelectorModal();
      });
    }

    if (DOM.betOptionsContainer) {
      DOM.betOptionsContainer.querySelectorAll('.bet-option-card').forEach(card => {
        card.addEventListener('click', () => {
          const betVal = card.dataset.bet;
          applySelectedBet(betVal);
        });
      });
    }

    // Game mode selection cards in lobby
    if (DOM.modeCards) {
      DOM.modeCards.forEach(card => {
        card.addEventListener('click', () => {
          DOM.modeCards.forEach(c => {
            c.classList.remove('active');
            c.classList.remove('selected');
          });
          card.classList.add('active');
          card.classList.add('selected');
          selectedGameMode = card.dataset.mode || 'ffa';
          CardAudio.click();
        });
      });
    }

    // Claim bonus / refill buttons
    if (DOM.btnRefillCoins) {
      DOM.btnRefillCoins.addEventListener('click', claimFreeCoinsBonus);
    }
    const btnEmergencyRefill = document.getElementById('guerra-btn-emergency-refill');
    if (btnEmergencyRefill) {
      btnEmergencyRefill.addEventListener('click', claimFreeCoinsBonus);
    }
    const btnModalRefill = document.getElementById('bet-modal-btn-refill');
    if (btnModalRefill) {
      btnModalRefill.addEventListener('click', claimFreeCoinsBonus);
    }

    // Create Public Room Button
    if (DOM.btnCreatePublic) {
      DOM.btnCreatePublic.addEventListener('click', async () => {
        if (!selectedBetAmount) {
          openBetSelectorModal();
          showToast('Selecciona el monto de la apuesta primero.', '🪙');
          return;
        }
        try {
          const roomId = await createRoom(true);
          showToast(`¡Sala pública creada! Código: ${roomId}`, '🌐');
        } catch (e) {
          showToast(e.message || 'Error creando sala.', '❌');
        }
      });
    }

    // Create Private Room Button
    if (DOM.btnCreatePrivate) {
      DOM.btnCreatePrivate.addEventListener('click', async () => {
        if (!selectedBetAmount) {
          openBetSelectorModal();
          showToast('Selecciona el monto de la apuesta primero.', '🪙');
          return;
        }
        try {
          const roomId = await createRoom(false);
          showToast(`¡Sala privada creada! Código: ${roomId}`, '🔒');
        } catch (e) {
          showToast(e.message || 'Error creando sala.', '❌');
        }
      });
    }

    // Fallback Create Room Button
    if (DOM.btnCreateRoom) {
      DOM.btnCreateRoom.addEventListener('click', async () => {
        if (!selectedBetAmount) {
          openBetSelectorModal();
          showToast('Selecciona el monto de la apuesta primero.', '🪙');
          return;
        }
        try {
          const roomId = await createRoom(true);
          showToast(`¡Sala de Guerra creada! Código: ${roomId}`, '🚀');
        } catch (e) {
          showToast(e.message || 'Error creando sala.', '❌');
        }
      });
    }

    // Refresh Public Rooms list button
    if (DOM.btnRefreshPublicRooms) {
      DOM.btnRefreshPublicRooms.addEventListener('click', () => {
        listenPublicRooms();
        showToast('Lista de salas públicas actualizada.', '🔄');
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
        const url = `${window.location.origin}${window.location.pathname}?room=${code}`;
        if (navigator.share) {
          navigator.share({ title: 'Guerra Online - Juego de Cartas', text: `¡Únete a mi partida de Guerra! Código de sala: ${code}`, url }).catch(() => {});
        } else if (navigator.clipboard) {
          navigator.clipboard.writeText(url).then(() => showToast('¡Enlace de sala copiado!', '🔗'));
        }
      });
    }

    // Waiting room bot controls
    if (DOM.btnAddBot) {
      DOM.btnAddBot.addEventListener('click', () => {
        addBotToWaitingRoom();
        CardAudio.click();
      });
    }

    if (DOM.btnRemoveBot) {
      DOM.btnRemoveBot.addEventListener('click', () => {
        removeBotFromWaitingRoom();
        CardAudio.click();
      });
    }

    if (DOM.btnHostStart) {
      DOM.btnHostStart.addEventListener('click', startGame);
    }

    if (DOM.btnConfirmSetup) DOM.btnConfirmSetup.addEventListener('click', confirmSetup);
    if (DOM.btnPlaySelected) DOM.btnPlaySelected.addEventListener('click', playSelectedCards);
    if (DOM.btnPickupPile) DOM.btnPickupPile.addEventListener('click', pickupPile);
    if (DOM.btnLeaveWaiting) DOM.btnLeaveWaiting.addEventListener('click', handleForfeitAndLeave);
    if (DOM.btnAbandonGame) {
      DOM.btnAbandonGame.addEventListener('click', handleForfeitAndLeave);
    }

    if (DOM.btnPlayAgain) {
      DOM.btnPlayAgain.addEventListener('click', startGame);
    }
    if (DOM.btnReturnMenu) {
      DOM.btnReturnMenu.addEventListener('click', leaveRoom);
    }

    if (DOM.btnEarlyExit) {
      DOM.btnEarlyExit.addEventListener('click', () => {
        closeEarlyVictoryModal();
        leaveRoom();
      });
    }
    if (DOM.btnEarlySpectate) {
      DOM.btnEarlySpectate.addEventListener('click', () => {
        closeEarlyVictoryModal();
        showToast('Modo Espectador activado. Puedes salir al menú cuando desees.', '👀');
      });
    }

    // --- RULES MODAL CONTROLS ---
    function openRulesModal() {
      if (DOM.modalRules) DOM.modalRules.classList.add('active');
    }
    function closeRulesModal() {
      if (DOM.modalRules) DOM.modalRules.classList.remove('active');
    }
    if (DOM.btnHeaderRules) DOM.btnHeaderRules.addEventListener('click', openRulesModal);
    if (DOM.btnViewRules) DOM.btnViewRules.addEventListener('click', openRulesModal);
    if (DOM.btnGameRules) DOM.btnGameRules.addEventListener('click', openRulesModal);
    if (DOM.btnCloseRules) DOM.btnCloseRules.addEventListener('click', closeRulesModal);
    if (DOM.modalRules) {
      DOM.modalRules.addEventListener('click', (e) => {
        if (e.target === DOM.modalRules) closeRulesModal();
      });
    }

    // --- RANKING MODAL CONTROLS ---
    let rankingUsersList = [];

    async function openRankingModal() {
      if (DOM.modalRanking) DOM.modalRanking.classList.add('active');
      if (DOM.rankingSearchInput) DOM.rankingSearchInput.value = '';
      await loadRankingData();
    }

    function closeRankingModal() {
      if (DOM.modalRanking) DOM.modalRanking.classList.remove('active');
    }

    async function loadRankingData() {
      const db = global.FirebaseService && global.FirebaseService.getDb();
      if (DOM.rankingTableBody) {
        DOM.rankingTableBody.innerHTML = `
          <tr>
            <td colspan="6" style="text-align: center; padding: 24px; color: var(--text-muted);">
              Cargando clasificación...
            </td>
          </tr>
        `;
      }

      let users = {};
      if (db) {
        try {
          const snap = await db.ref(RTDB_PATHS.USERS).once('value');
          users = snap.val() || {};
        } catch (e) {
          console.warn('Error cargando ranking de Firebase:', e);
        }
      }

      const myUid = State.myUid;
      const myStats = getPlayerStats();
      if (!users[myUid]) {
        users[myUid] = {
          uid: myUid,
          name: getPlayerName(),
          coins: getPlayerCoins(),
          wins: myStats.wins,
          losses: myStats.losses
        };
      } else {
        users[myUid].coins = getPlayerCoins();
        users[myUid].name = getPlayerName();
      }

      rankingUsersList = Object.values(users);
      renderRankingTable();
    }

    function renderRankingTable() {
      if (!DOM.rankingTableBody) return;
      const query = (DOM.rankingSearchInput && DOM.rankingSearchInput.value || '').toLowerCase().trim();

      let filtered = rankingUsersList.filter(u => {
        if (!query) return true;
        return (u.name || '').toLowerCase().includes(query) || (u.uid || '').toLowerCase().includes(query);
      });

      if (DOM.rankingTotalPlayersCount) {
        DOM.rankingTotalPlayersCount.textContent = `${rankingUsersList.length} jugadores registrados`;
      }

      if (filtered.length === 0) {
        DOM.rankingTableBody.innerHTML = `
          <tr>
            <td colspan="6" style="text-align: center; padding: 24px; color: var(--text-muted);">
              No se encontraron jugadores.
            </td>
          </tr>
        `;
        return;
      }

      filtered.sort((a, b) => {
        const winsA = parseInt(a.wins, 10) || 0;
        const winsB = parseInt(b.wins, 10) || 0;
        if (winsB !== winsA) return winsB - winsA;
        return (parseInt(b.coins, 10) || 0) - (parseInt(a.coins, 10) || 0);
      });

      DOM.rankingTableBody.innerHTML = filtered.map((u, index) => {
        const pos = index + 1;
        let posBadge = `${pos}º`;
        if (pos === 1) posBadge = '🥇 1º';
        else if (pos === 2) posBadge = '🥈 2º';
        else if (pos === 3) posBadge = '🥉 3º';

        const isMe = (u.uid === State.myUid);
        const wins = parseInt(u.wins, 10) || 0;
        const losses = parseInt(u.losses, 10) || 0;
        const total = wins + losses;
        const winrate = total > 0 ? Math.round((wins / total) * 100) : 0;
        const coins = parseInt(u.coins, 10) || 0;

        let winrateColor = '#94a3b8';
        let winrateBg = 'rgba(148, 163, 184, 0.15)';
        if (winrate >= 60) {
          winrateColor = '#34d399';
          winrateBg = 'rgba(16, 185, 129, 0.2)';
        } else if (winrate >= 40) {
          winrateColor = '#fbbf24';
          winrateBg = 'rgba(245, 158, 11, 0.2)';
        } else if (total > 0) {
          winrateColor = '#f87171';
          winrateBg = 'rgba(239, 68, 68, 0.2)';
        }

        return `
          <tr class="${isMe ? 'ranking-row-me' : ''}">
            <td style="text-align: center; font-weight: 800; font-size: 14px;">
              ${posBadge}
            </td>
            <td>
              <span style="color: ${isMe ? '#fbbf24' : '#fff'}; font-weight: 700;">
                ${escapeHTML(u.name || 'Jugador')}
              </span>
              ${isMe ? '<span style="font-size: 10px; background: rgba(245, 158, 11, 0.2); color: #fbbf24; border-radius: 4px; padding: 1px 4px; margin-left: 4px; font-weight: 800;">TÚ</span>' : ''}
            </td>
            <td style="text-align: center; font-family: var(--font-mono); font-weight: 800; color: var(--accent-emerald);">
              ${wins}
            </td>
            <td style="text-align: center; font-family: var(--font-mono); font-weight: 800; color: var(--accent-rose);">
              ${losses}
            </td>
            <td style="text-align: center;">
              <span class="winrate-badge" style="background: ${winrateBg}; color: ${winrateColor};">
                ${winrate}%
              </span>
            </td>
            <td style="text-align: right; font-family: var(--font-mono); font-weight: 800; color: var(--accent-amber);" title="${coins.toLocaleString()} 🪙">
              ${formatCoinsCompact(coins)} 🪙
            </td>
          </tr>
        `;
      }).join('');
    }

    if (DOM.btnRanking) DOM.btnRanking.addEventListener('click', openRankingModal);
    if (DOM.btnViewRanking) DOM.btnViewRanking.addEventListener('click', openRankingModal);
    if (DOM.btnCloseRanking) DOM.btnCloseRanking.addEventListener('click', closeRankingModal);
    if (DOM.btnCloseRankingX) DOM.btnCloseRankingX.addEventListener('click', closeRankingModal);
    if (DOM.modalRanking) {
      DOM.modalRanking.addEventListener('click', (e) => {
        if (e.target === DOM.modalRanking) closeRankingModal();
      });
    }
    if (DOM.rankingSearchInput) {
      DOM.rankingSearchInput.addEventListener('input', renderRankingTable);
    }

    // --- SOUND TOGGLE ---
    if (DOM.btnHeaderSound) {
      DOM.btnHeaderSound.addEventListener('click', () => {
        const isEnabled = CardAudio.toggleSound();
        DOM.btnHeaderSound.textContent = isEnabled ? '🔊' : '🔇';
        DOM.btnHeaderSound.title = isEnabled ? 'Silenciar sonido' : 'Activar sonido';
        showToast(isEnabled ? 'Sonido activado' : 'Sonido silenciado', isEnabled ? '🔊' : '🔇');
      });
    }

    // --- FIREBASE SETTINGS MODAL CONTROLS ---
    function openSettingsModal() {
      const cfg = global.FirebaseService ? global.FirebaseService.getActiveConfig() : {};
      if (DOM.inputApiKey) DOM.inputApiKey.value = cfg.apiKey || '';
      if (DOM.inputDbUrl) DOM.inputDbUrl.value = cfg.databaseURL || '';
      if (DOM.inputProjectId) DOM.inputProjectId.value = cfg.projectId || '';
      if (DOM.modalSettings) DOM.modalSettings.classList.add('active');
    }
    function closeSettingsModal() {
      if (DOM.modalSettings) DOM.modalSettings.classList.remove('active');
    }
    function saveFirebaseSettings() {
      if (!global.FirebaseService) return;
      const config = {
        apiKey: (DOM.inputApiKey && DOM.inputApiKey.value.trim()) || '',
        databaseURL: (DOM.inputDbUrl && DOM.inputDbUrl.value.trim()) || '',
        projectId: (DOM.inputProjectId && DOM.inputProjectId.value.trim()) || ''
      };
      if (global.FirebaseService.saveCustomConfig(config)) {
        global.FirebaseService.initFirebase();
        showToast('Configuración de Firebase guardada.', '✅');
        closeSettingsModal();
        listenPublicRooms();
      }
    }
    if (DOM.btnHeaderSettings) DOM.btnHeaderSettings.addEventListener('click', openSettingsModal);
    if (DOM.btnCloseSettings) DOM.btnCloseSettings.addEventListener('click', closeSettingsModal);
    if (DOM.btnSaveSettings) DOM.btnSaveSettings.addEventListener('click', saveFirebaseSettings);
    if (DOM.modalSettings) {
      DOM.modalSettings.addEventListener('click', (e) => {
        if (e.target === DOM.modalSettings) closeSettingsModal();
      });
    }

    // Auto-fill room code from URL ?room=CODE
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const roomParam = urlParams.get('room');
      if (roomParam && DOM.inputJoinCode) {
        DOM.inputJoinCode.value = roomParam.trim().toUpperCase();
      }
    } catch (e) {}

    // Guerra Chat Event Handlers
    if (DOM.chatToggleBtn) DOM.chatToggleBtn.addEventListener('click', GuerraChat.toggle);
    if (DOM.btnWaitingChat) DOM.btnWaitingChat.addEventListener('click', GuerraChat.open);
    if (DOM.btnGameChat) DOM.btnGameChat.addEventListener('click', GuerraChat.open);
    if (DOM.chatCloseBtn) DOM.chatCloseBtn.addEventListener('click', GuerraChat.close);

    if (DOM.chatOverlay) {
      DOM.chatOverlay.addEventListener('click', (e) => {
        if (e.target === DOM.chatOverlay) GuerraChat.close();
      });
    }

    if (DOM.chatForm) {
      DOM.chatForm.addEventListener('submit', (e) => {
        e.preventDefault();
        if (DOM.chatInput) {
          GuerraChat.sendMessage(DOM.chatInput.value, 'text');
        }
      });
    }

    document.querySelectorAll('.chat-preset-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const text = chip.dataset.msg;
        if (text) GuerraChat.sendMessage(text, 'preset');
      });
    });

    document.querySelectorAll('.chat-emoji-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const emoji = btn.dataset.emoji;
        if (emoji) GuerraChat.sendMessage(emoji, 'emoji');
      });
    });
  }

  let isInitialized = false;

  function init() {
    if (isInitialized) return;
    isInitialized = true;

    // 1. Core UI, event listeners, and coins display run IMMEDIATELY and synchronously
    try {
      cacheDOM();
    } catch (e) {
      console.warn('cacheDOM error:', e);
    }

    try {
      initEvents();
    } catch (e) {
      console.warn('initEvents error:', e);
    }

    try {
      updateCoinsDisplay();
    } catch (e) {
      console.warn('updateCoinsDisplay error:', e);
    }

    try {
      startAIWatchdog();
    } catch (e) {
      console.warn('startAIWatchdog error:', e);
    }

    // Global safety net: if ANY promise anywhere rejects without being
    // caught (a failed Firebase write mid-turn, etc.), don't let the match
    // sit frozen — recover the turn engine automatically.
    try {
      global.addEventListener('unhandledrejection', (event) => {
        console.error('Unhandled promise rejection (auto-recovering):', event.reason);
        const room = isSinglePlayerMode ? singlePlayerState : State.room;
        if (room && room.status === 'PLAYING') {
          try {
            ensureValidActiveTurn(room);
            checkAndTriggerAI(room);
          } catch (e) {
            console.error('Auto-recovery after unhandled rejection failed:', e);
          }
        }
      });
    } catch (e) {
      console.warn('unhandledrejection listener setup error:', e);
    }

    // 2. Firebase background calls (never block UI or freeze buttons)
    setTimeout(() => {
      try {
        listenPublicRooms();
      } catch (e) {
        console.warn('listenPublicRooms notice:', e);
      }
      try {
        initUserProfile();
      } catch (e) {
        console.warn('initUserProfile notice:', e);
      }
    }, 50);
  }

  const GuerraGame = {
    init,
    createRoom,
    joinRoom,
    leaveRoom,
    showView,
    getPlayerCoins,
    setPlayerCoins,
    addPlayerCoins,
    calculatePrizeForPlace,
    chat: GuerraChat,
    sortCardsAscending,
    _ai: {
      evaluateOpponentThreat,
      getNextActiveOpponent,
      chooseSmartHandGroup,
      chooseSmartFaceUpCard
    }
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = GuerraGame;
  } else {
    global.GuerraGame = GuerraGame;
  }

  // Single clean auto-initialization
  if (typeof window !== 'undefined') {
    if (document.readyState === 'loading') {
      window.addEventListener('DOMContentLoaded', () => GuerraGame.init());
    } else {
      GuerraGame.init();
    }
  }

})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : self));