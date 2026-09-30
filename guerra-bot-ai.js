/**
 * GUERRA ONLINE - MOTOR HÍBRIDO DE INTELIGENCIA ARTIFICIAL:
 * DEEPSEEK / UNLIMITED FREE AI API + SIMULACIÓN MONTE CARLO (ISMCTS)
 *
 * Características:
 * 1. IA en la Nube Gratuita y Sin Límites (Zero-Key DeepSeek / Pollinations OpenAI / Multi-Provider):
 *    - Conecta directamente desde el navegador con modelos gratuitos (`deepseek`, `openai`, `mistral`)
 *      sin requerir API Key (y soporta llaves opcionales de OpenRouter/Groq/DeepSeek).
 *    - Genera decisiones tácticas contextuales y frases dinámicas en español para el globo de chat.
 * 2. Simulación Monte Carlo Determinista (ISMCTS) + Conteo de 52 Cartas en Vivo:
 *    - Evalúa cada jugada candidata, protege comodines (2 y 10) y sirve como guardrail y fallback
 *      instantáneo (< 20ms) si la API gratuita tarda más de 2.5s o no hay internet.
 * 3. Rompe-Bucles Inteligente (Loop Circuit Breaker) y Evaluación Conjunta por Equipos (2v2).
 */

(function (global) {
  'use strict';

  // --- CONFIGURACIÓN DE PERSONALIDADES ---
  const BOT_PROFILES = {
    'Bot Alfa 🤖': {
      id: 'alfa',
      name: 'Bot Alfa 🤖',
      style: 'AGRESSIVE_BURNING',
      burnPreference: 1.3,
      chokePreference: 1.0,
      chatLines: {
        burn: ['¡Fuego a discreción! 🔥', '¡Mesa limpia! 💥', '¡Turno extra para Alfa! 🤖', '¡Qué arda todo! 💣'],
        fourKind: ['¡Cuatro iguales! ¡Todo mío! 🔥', '¡Quema cuádruple! 😎', '¡Eso es un 4-combo! 💥'],
        choke: ['¡A ver cómo respondes a esto! ⚔️', '¡No en mi guardia! 🛑', '¡Freno de mano! 🖐️'],
        seven: ['⚡ ¡Siete o menos! A sufrir...', 'A ver si bajas de 7 😏', 'La ley del siete ⚡'],
        saveFriend: ['¡Te cubro la espalda! 🛡️', '¡Mesa despejada, socio! 🤝'],
        loopBreak: ['Basta de jugar al gato y al ratón 🐱🐭', 'Cambio de ritmo táctico ♟️', '¡A romper el bucle! 🔄']
      }
    },
    'Bot Beta 🤖': {
      id: 'beta',
      name: 'Bot Beta 🤖',
      style: 'TACTICAL_CONTROL',
      burnPreference: 1.0,
      chokePreference: 1.5,
      chatLines: {
        burn: ['Limpio el montón justo a tiempo 🧹', 'Adiós montón peligroso 👋', 'Ese pozo era mío 😎'],
        fourKind: ['¡Combinación perfecta de 4! 🎯', 'La jugada calculada 🧠'],
        choke: ['Te tengo completamente medido 🧠', '¡Buen provecho con el montón! 📥', 'Sé exactamente qué cartas tienes 😏'],
        seven: ['El 7 es mi carta favorita ⚡', 'Bloqueo táctico activado 🔒', '¡A comer cartas! 🍽️'],
        saveFriend: ['Despejando el camino para ti 🔵', 'Toma un turno fácil compañero 👍'],
        loopBreak: ['Rompiendo el ciclo repetitivo 🧠', 'Abro la mesa para que el pozo crezca 📊']
      }
    },
    'Bot Gamma 🤖': {
      id: 'gamma',
      name: 'Bot Gamma 🤖',
      style: 'MATHEMATICAL_HOARDER',
      burnPreference: 0.9,
      chokePreference: 1.3,
      chatLines: {
        burn: ['Momento estadísticamente óptimo para quemar 📊', 'El pozo ya tenía valor crítico 🔥'],
        fourKind: ['Probabilidad de 4 iguales calculada: 100% 📐', 'Quema matemática ejecutada ♟️'],
        choke: ['Jugada de bloqueo de alta probabilidad 🛑', 'Matemáticamente no puedes responder 📉'],
        seven: ['Filtro de valor $\\le 7$ aplicado ⚡', 'Tus probabilidades de responder son mínimas 📉'],
        saveFriend: ['Optimizando probabilidad del equipo 🛡️', 'Compañero seguro 🤝'],
        loopBreak: ['Bucle detectado. Aplicando desvío estadístico 🔄', 'Secuencia infinita abortada 📉']
      }
    }
  };

  function getBotProfile(botName) {
    if (!botName) return BOT_PROFILES['Bot Alfa 🤖'];
    for (const key in BOT_PROFILES) {
      if (botName.includes(BOT_PROFILES[key].name) || botName.includes(BOT_PROFILES[key].id)) {
        return BOT_PROFILES[key];
      }
    }
    return BOT_PROFILES['Bot Alfa 🤖'];
  }

  // --- REGLAS BÁSICAS Y DEFINICIONES DE CARTAS ---
  const CARD_RANKS = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'];
  const CARD_VALUES = {
    '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
    '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14, '2': 15
  };
  const CARD_SUITS = ['♠', '♥', '♦', '♣'];

  function canPlay(card, pileTop, isLowerRestriction) {
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

  function getConsecutiveTopCount(pile) {
    if (!pile || pile.length === 0) return { rank: null, count: 0 };
    const topRank = pile[pile.length - 1].rank;
    let count = 0;
    for (let i = pile.length - 1; i >= 0; i--) {
      if (pile[i].rank === topRank) {
        count++;
      } else {
        break;
      }
    }
    return { rank: topRank, count };
  }

  function getTurnOrderArray(room) {
    if (!room) return [];
    const t = room.turnOrder;
    if (Array.isArray(t)) return t;
    if (t && typeof t === 'object') return Object.values(t);
    return Object.keys(room.players || {});
  }

  function getNextActivePlayer(room, currentUid) {
    const turnOrder = getTurnOrderArray(room);
    if (!turnOrder || turnOrder.length === 0) return null;
    const myIdx = turnOrder.indexOf(currentUid);
    if (myIdx === -1) return null;

    let idx = (myIdx + 1) % turnOrder.length;
    for (let i = 0; i < turnOrder.length; i++) {
      const candidateUid = turnOrder[idx];
      const p = room.players && room.players[candidateUid];
      if (candidateUid !== currentUid && p && !p.isFinished && !p.isAbandoned && p.connected !== false) {
        return p;
      }
      idx = (idx + 1) % turnOrder.length;
    }
    return null;
  }

  // --- EVALUACIÓN DE CARTAS POR EQUIPO EN 2v2 ---
  function getTeamTotalCards(room, playerUid) {
    if (!room || !room.players || !room.players[playerUid]) return 0;
    const isTeamMode = (room.gameMode === '2v2');
    const p = room.players[playerUid];

    const getPCount = (player) => {
      if (!player || player.isFinished) return 0;
      const h = player.handCount !== undefined ? player.handCount : ((player.hand && player.hand.length) || 0);
      const u = (player.faceUp && player.faceUp.length) !== undefined ? player.faceUp.length : (player.faceUpCount || 0);
      const d = player.faceDownCount || (player.faceDown && player.faceDown.length) || 0;
      return h + u + d;
    };

    const pCount = getPCount(p);
    if (!isTeamMode || !p.team) return pCount;

    // Sumar las cartas del compañero de equipo
    let teammateCount = 0;
    for (const uid in room.players) {
      if (uid !== playerUid && room.players[uid].team === p.team) {
        teammateCount = getPCount(room.players[uid]);
        break;
      }
    }
    return pCount + teammateCount;
  }

  function getPlayerThreatLevel(player, room) {
    if (!player || player.isFinished) return 0;
    const total = room ? getTeamTotalCards(room, player.id || player.uid) : (
      (player.handCount || 0) + ((player.faceUp && player.faceUp.length) || 0) + (player.faceDownCount || 0)
    );

    if (total <= 1) return 3; // CRÍTICA: 1 sola carta restante para todo el equipo
    if (total <= 2) return 2; // ALTA AMENAZA: 2 cartas restantes
    if (total <= 3) return 1; // MODERADA
    return 0; // NORMAL: Tienen 4+ cartas, sin urgencia
  }

  function findTableThreatLeader(room, myUid, myTeam) {
    if (!room || !room.players) return null;
    const turnOrder = getTurnOrderArray(room);
    let minCards = 999;
    let leader = null;

    turnOrder.forEach(uid => {
      if (uid === myUid) return;
      const p = room.players[uid];
      if (!p || p.isFinished || p.isAbandoned || p.connected === false) return;
      if (myTeam && p.team === myTeam) return;

      const total = getTeamTotalCards(room, uid);
      const isRealThreat = (total <= 3);

      if (isRealThreat && total < minCards) {
        minCards = total;
        leader = {
          uid,
          player: p,
          totalCards: total,
          threatLevel: getPlayerThreatLevel(p, room)
        };
      }
    });

    return leader;
  }

  function getTurnDistance(room, fromUid, toUid) {
    const turnOrder = getTurnOrderArray(room).filter(uid => {
      const p = room.players && room.players[uid];
      return p && !p.isFinished && !p.isAbandoned && p.connected !== false;
    });
    const fromIdx = turnOrder.indexOf(fromUid);
    const toIdx = turnOrder.indexOf(toUid);
    if (fromIdx === -1 || toIdx === -1) return 999;
    return (toIdx - fromIdx + turnOrder.length) % turnOrder.length;
  }

  function sayBotQuote(botUid, botName, category) {
    try {
      const profile = getBotProfile(botName);
      const lines = profile.chatLines[category];
      if (!lines || lines.length === 0) return;
      const text = lines[Math.floor(Math.random() * lines.length)];

      if (global.GuerraGame && global.GuerraGame.chat && typeof global.GuerraGame.chat.showSeatSpeechBubble === 'function') {
        global.GuerraGame.chat.showSeatSpeechBubble(botUid, text, true);
      }
    } catch (e) {}
  }

  // =========================================================================
  // 1. MEMORIA EN VIVO DE LA PARTIDA Y RASTREO DE LAS 3 MANOS RIVALES
  // =========================================================================
  const recentTableEvents = [];
  let lastObservedPileState = {
    matchId: null,
    topRank: null,
    topValue: 0,
    isLower: false,
    length: 0,
    pileCards: [],
    activeUid: null,
    handCounts: {}
  };

  // Libreta de memoria en vivo por partida
  const MatchMemory = {
    matchId: null,
    knownHands: {},       // { [uid]: Array<{id, rank, value, suit}> } -> Cartas exactas que cada jugador recogió del pozo
    inferredCeiling: {},  // { [uid]: { maxNormalValue: number, lacksTwoAndTen: boolean, lacksLowSeven: boolean } }
    burnedCards: [],      // Cartas quemadas definitivamente fuera del juego (con 10 o 4 iguales)
    pickupHistory: [],    // Historial de recogidas en la partida actual
    matchTrace: []        // Decisiones tomadas en la partida real para aprender al final
  };

  function resetMatchMemory(room) {
    MatchMemory.matchId = (room && room.matchId) || `m_${Date.now()}`;
    MatchMemory.knownHands = {};
    MatchMemory.inferredCeiling = {};
    MatchMemory.burnedCards = [];
    MatchMemory.pickupHistory = [];
    MatchMemory.matchTrace = [];
    recentTableEvents.length = 0;

    if (room && room.players) {
      for (const uid in room.players) {
        MatchMemory.knownHands[uid] = [];
        MatchMemory.inferredCeiling[uid] = null;
      }
    }
  }

  function ensurePlayerMemory(uid) {
    if (!uid) return;
    if (!Array.isArray(MatchMemory.knownHands[uid])) {
      MatchMemory.knownHands[uid] = [];
    }
  }

  // Llamado cuando cualquier jugador (humano o bot) recoge el pozo
  function observePickup(playerUid, pileCards, extraFailedCard, pileTopBefore, wasLowerRestriction, room, silent) {
    if (!playerUid) return;
    if (room && room.matchId && MatchMemory.matchId !== room.matchId) {
      resetMatchMemory(room);
    }
    ensurePlayerMemory(playerUid);

    const picked = Array.isArray(pileCards) ? [...pileCards] : [];
    if (extraFailedCard && extraFailedCard.rank) {
      picked.push(extraFailedCard);
    }

    // 1. Deducir qué cartas NO tenía el jugador antes de recoger
    if (pileTopBefore && pileTopBefore.rank) {
      if (wasLowerRestriction) {
        // No pudo jugar <= 7 ni 2 ni 10
        MatchMemory.inferredCeiling[playerUid] = {
          maxNormalValue: 14,
          lacksLowSeven: true,
          lacksTwoAndTen: true,
          timestamp: Date.now()
        };
      } else if (pileTopBefore.rank !== '2') {
        // No tenía ninguna carta >= pileTopBefore.value, ni 2, ni 10
        MatchMemory.inferredCeiling[playerUid] = {
          maxNormalValue: (pileTopBefore.value || CARD_VALUES[pileTopBefore.rank] || 14) - 1,
          lacksLowSeven: false,
          lacksTwoAndTen: true,
          timestamp: Date.now()
        };
      }
    }

    // 2. Registrar todas las cartas recogidas en la mano conocida de ese jugador
    picked.forEach(c => {
      if (!c || !c.rank) return;
      const val = c.value || CARD_VALUES[c.rank] || 0;
      const exists = c.id && MatchMemory.knownHands[playerUid].some(k => k.id === c.id);
      if (!exists) {
        MatchMemory.knownHands[playerUid].push({
          id: c.id || `${c.rank}_${c.suit || ''}_${Math.random()}`,
          rank: c.rank,
          value: val,
          suit: c.suit || ''
        });
      }
      // Si recogió un 2, un 10 o una carta alta del pozo, actualizar su techo inferido
      const ceil = MatchMemory.inferredCeiling[playerUid];
      if (ceil) {
        if (c.rank === '2' || c.rank === '10') ceil.lacksTwoAndTen = false;
        if (val >= 3 && val <= 7) ceil.lacksLowSeven = false;
        if (val > ceil.maxNormalValue && c.rank !== '2' && c.rank !== '10') {
          ceil.maxNormalValue = val;
        }
      }
    });

    MatchMemory.pickupHistory.push({
      uid: playerUid,
      count: picked.length,
      ranks: picked.map(c => c.rank),
      topBefore: pileTopBefore ? pileTopBefore.rank : null
    });

    recordTableEvent(pileTopBefore ? pileTopBefore.rank : null, picked.length, true, playerUid);

    if (!silent && picked.length > 0 && typeof console !== 'undefined') {
      const pName = (room && room.players && room.players[playerUid] && room.players[playerUid].name) || playerUid;
      console.log(`👁️ [Memoria IA] ${pName} recogió ${picked.length} carta(s): [${picked.map(c => c.rank).join(', ')}] -> Mano conocida actual: [${MatchMemory.knownHands[playerUid].map(c => c.rank).join(', ')}]`);
    }
  }

  // Llamado cuando cualquier jugador (humano o bot) juega cartas a la mesa
  function observePlay(playerUid, playedCards, wasBurn, pileBeforeBurn, room, silent) {
    if (!playerUid || !Array.isArray(playedCards)) return;
    if (room && room.matchId && MatchMemory.matchId !== room.matchId) {
      resetMatchMemory(room);
    }
    ensurePlayerMemory(playerUid);

    // 1. Quitar las cartas jugadas de la lista de cartas conocidas en su mano
    const known = MatchMemory.knownHands[playerUid];
    playedCards.forEach(pc => {
      if (!pc) return;
      let idx = -1;
      if (pc.id) {
        idx = known.findIndex(k => k.id === pc.id);
      }
      if (idx === -1) {
        idx = known.findIndex(k => k.rank === pc.rank);
      }
      if (idx !== -1) {
        known.splice(idx, 1);
      }
    });

    // Si el mazo de robo aún tiene cartas, el jugador robó cartas nuevas desconocidas,
    // por lo que su techo inferido previo deja de ser estricto.
    if (room && (room.deckCount || 0) > 0) {
      MatchMemory.inferredCeiling[playerUid] = null;
    }

    // 2. Si hubo quema (con 10 o 4 iguales), registrar todas esas cartas como quemadas para el conteo exacto
    if (wasBurn) {
      const burnedNow = [...(Array.isArray(pileBeforeBurn) ? pileBeforeBurn : []), ...playedCards];
      burnedNow.forEach(bc => {
        if (!bc || !bc.rank) return;
        const already = bc.id && MatchMemory.burnedCards.some(x => x.id === bc.id);
        if (!already) {
          MatchMemory.burnedCards.push({
            id: bc.id || `${bc.rank}_${Math.random()}`,
            rank: bc.rank,
            value: bc.value || CARD_VALUES[bc.rank] || 0
          });
        }
      });
    }

    // 3. Si el jugador es humano, aprender de sus hábitos para el perfil adaptativo
    const pObj = room && room.players && room.players[playerUid];
    if (pObj && !pObj.isAI && !silent) {
      updateHumanProfileOnPlay(playedCards, wasBurn, pileBeforeBurn ? pileBeforeBurn.length : 0);
    }
  }

  function recordTableEvent(rank, pileLengthBefore, wasPickup, playerUid) {
    recentTableEvents.push({
      rank: rank || null,
      pileLengthBefore: pileLengthBefore || 0,
      wasPickup: !!wasPickup,
      playerUid: playerUid || null,
      timestamp: Date.now()
    });
    if (recentTableEvents.length > 16) {
      recentTableEvents.shift();
    }
  }

  // Sincronización automática por si ocurre algún cambio de estado vía Firebase sin hook directo
  function updatePileTracking(room) {
    if (!room) return;
    if (room.matchId && MatchMemory.matchId !== room.matchId) {
      resetMatchMemory(room);
    }

    const pile = room.pile || [];
    const currentLen = pile.length;
    const currentTop = room.pileTop;

    if (lastObservedPileState.matchId === MatchMemory.matchId &&
        lastObservedPileState.length > 0 &&
        currentLen < lastObservedPileState.length) {
      // Detectar si alguien recogió el pozo comparando handCount si no fue registrado aún
      const prevActor = lastObservedPileState.activeUid;
      const prevActorHand = prevActor && room.players && room.players[prevActor] ? (room.players[prevActor].handCount || 0) : 0;
      const oldHand = (prevActor && lastObservedPileState.handCounts[prevActor]) || 0;

      if (prevActor && prevActorHand > oldHand && lastObservedPileState.pileCards.length > 0) {
        const recentLast = MatchMemory.pickupHistory[MatchMemory.pickupHistory.length - 1];
        const alreadyRecorded = recentLast && recentLast.uid === prevActor && recentLast.count >= lastObservedPileState.length;
        if (!alreadyRecorded) {
          observePickup(
            prevActor,
            lastObservedPileState.pileCards,
            null,
            { rank: lastObservedPileState.topRank, value: lastObservedPileState.topValue },
            lastObservedPileState.isLower,
            room,
            false
          );
        }
      }
    }

    if (currentTop) {
      recordTableEvent(currentTop.rank, currentLen, false, room.activePlayerUid);
    }

    const hc = {};
    if (room.players) {
      for (const u in room.players) {
        hc[u] = room.players[u].handCount || 0;
      }
    }

    lastObservedPileState = {
      matchId: MatchMemory.matchId,
      topRank: currentTop ? currentTop.rank : null,
      topValue: currentTop ? (currentTop.value || CARD_VALUES[currentTop.rank] || 0) : 0,
      isLower: !!room.isLowerRestriction,
      length: currentLen,
      pileCards: pile.slice(),
      activeUid: room.activePlayerUid,
      handCounts: hc
    };
  }

  function detectStalemateLoop(room) {
    if (recentTableEvents.length < 3) return { inLoop: false, loopRank: null };
    const lastEvents = recentTableEvents.slice(-6);
    let pickupCount = 0;
    let suspiciousRank = null;

    for (let i = 0; i < lastEvents.length; i++) {
      const ev = lastEvents[i];
      if (ev.wasPickup && ev.pileLengthBefore <= 2) {
        pickupCount++;
        if (ev.rank === 'A' || ev.rank === 'K' || ev.rank === 'Q') {
          suspiciousRank = ev.rank;
        }
      }
    }

    if (pickupCount >= 2 && suspiciousRank) {
      return { inLoop: true, loopRank: suspiciousRank };
    }
    return { inLoop: false, loopRank: null };
  }

  // =========================================================================
  // 2. CEREBRO DE APRENDIZAJE POR REFUERZO PERSISTENTE (Q-LEARNING + PESOS)
  // =========================================================================
  const BRAIN_STORAGE_KEY = 'guerra_bot_learned_brain_v2';

  const LearnedBrain = {
    version: 2,
    gamesSimulated: 0,
    realMatchesPlayed: 0,
    totalMovesLearned: 0,
    generation: 1,
    // Pesos tácticos adaptativos que evolucionan con la simulación y las partidas reales
    weights: {
      knownHandKillBonus: 145,      // Bono por tirar una carta que supera toda la mano conocida del rival
      knownSevenTrapBonus: 155,     // Bono por tirar un 7 cuando sabemos que el rival solo tiene cartas > 7
      feedKnownPairPenalty: 105,    // Castigo por tirarle al rival un rango que le permite soltar pareja conocida
      ffaDistanceBlockBonus: 95,    // Bono por bloquear en Todos contra Todos a un jugador a 1-3 turnos que va a ganar
      saveTenMinPile: 4,            // Tamaño mínimo ideal del pozo para quemar con 10 sin amenaza
      protectTwoPenalty: 95,        // Protección del comodín 2 cuando hay jugadas normales
      multiDumpBonusPerCard: 22,    // Bono por descargar parejas/tríos
      lowOpenBonus: 50,             // Bono por abrir pozo vacío con cartas bajas (3-7)
      highWastePenalty: 60,         // Castigo por malgastar A/K en pozo de 0-1 cartas sin amenaza
      teammateAssistBonus: 58       // Bono por asistir al compañero en 2v2
    },
    // Tabla Q de estados tácticos aprendidos: { [stateActionKey]: { q: number, n: number } }
    qTable: {},
    // Perfil aprendido sobre el jugador humano
    humanProfile: {
      playsObserved: 0,
      burnsObserved: 0,
      sevensObserved: 0,
      avgBurnPileSize: 4.5,
      aggressiveStyle: 0.5
    }
  };

  function loadLearnedBrain() {
    try {
      if (typeof localStorage !== 'undefined') {
        const raw = localStorage.getItem(BRAIN_STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && parsed.version === 2) {
            LearnedBrain.gamesSimulated = parsed.gamesSimulated || 0;
            LearnedBrain.realMatchesPlayed = parsed.realMatchesPlayed || 0;
            LearnedBrain.totalMovesLearned = parsed.totalMovesLearned || 0;
            LearnedBrain.generation = parsed.generation || 1;
            if (parsed.weights) Object.assign(LearnedBrain.weights, parsed.weights);
            if (parsed.qTable) LearnedBrain.qTable = parsed.qTable;
            if (parsed.humanProfile) Object.assign(LearnedBrain.humanProfile, parsed.humanProfile);
          }
        }
      }
    } catch (e) {}
  }

  function saveLearnedBrain() {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(BRAIN_STORAGE_KEY, JSON.stringify(LearnedBrain));
      }
    } catch (e) {}
  }

  function updateHumanProfileOnPlay(playedCards, wasBurn, pileLenBefore) {
    if (!playedCards || playedCards.length === 0) return;
    const hp = LearnedBrain.humanProfile;
    hp.playsObserved++;
    const r = playedCards[0].rank;
    const v = playedCards[0].value || CARD_VALUES[r] || 0;
    if (wasBurn) {
      hp.burnsObserved++;
      hp.avgBurnPileSize = (hp.avgBurnPileSize * 0.85) + (pileLenBefore * 0.15);
    }
    if (r === '7') hp.sevensObserved++;
    if (v >= 13 && pileLenBefore <= 2) {
      hp.aggressiveStyle = Math.min(1, hp.aggressiveStyle * 0.92 + 0.08);
    } else if (v <= 7 && pileLenBefore <= 2) {
      hp.aggressiveStyle = Math.max(0, hp.aggressiveStyle * 0.92);
    }
  }

  function buildQStateKey(room, candidateGroup, nextThreat, maxFfaThreat, killsKnownHand) {
    const first = candidateGroup[0];
    const rank = first.rank;
    const val = first.value || CARD_VALUES[rank] || 0;
    const pileLen = (room && room.pile) ? room.pile.length : 0;
    const deckLeft = (room && room.deckCount) ? room.deckCount : 0;

    const phase = deckLeft > 0 ? 'D1' : 'D0';
    const pileBucket = pileLen === 0 ? 'P0' : (pileLen <= 2 ? 'P1' : (pileLen <= 5 ? 'P2' : 'P3'));
    const threatBucket = `T${Math.min(3, Math.max(nextThreat || 0, maxFfaThreat || 0))}`;
    const killTag = killsKnownHand ? 'K1' : 'K0';

    let actionClass = 'MID';
    if (rank === '10') actionClass = 'BURN10';
    else if (rank === '2') actionClass = 'RESET2';
    else if (rank === '7') actionClass = 'TRAP7';
    else if (val >= 13) actionClass = candidateGroup.length > 1 ? 'HIGH_MULTI' : 'HIGH';
    else if (val <= 6) actionClass = candidateGroup.length > 1 ? 'LOW_MULTI' : 'LOW';
    else if (candidateGroup.length > 1) actionClass = 'MID_MULTI';

    return `${phase}|${pileBucket}|${threatBucket}|${killTag}|${actionClass}`;
  }

  function getLearnedQBonus(stateKey) {
    const entry = LearnedBrain.qTable[stateKey];
    if (!entry || !entry.n) return 0;
    // Escalar el valor Q aprendido (-1..+1) a puntos de utilidad táctica (-45..+45)
    const confidence = Math.min(1, entry.n / 20);
    return Math.round(entry.q * 45 * confidence);
  }

  function updateQTableFromTrajectory(trajectory, reward) {
    if (!Array.isArray(trajectory) || trajectory.length === 0) return;
    const alpha = 0.08;
    const gamma = 0.94;
    let discountedReward = reward;

    for (let i = trajectory.length - 1; i >= 0; i--) {
      const key = trajectory[i];
      if (!key) continue;
      if (!LearnedBrain.qTable[key]) {
        LearnedBrain.qTable[key] = { q: 0, n: 0 };
      }
      const cell = LearnedBrain.qTable[key];
      cell.n++;
      cell.q = Number((cell.q + alpha * (discountedReward - cell.q)).toFixed(4));
      discountedReward *= gamma;
      LearnedBrain.totalMovesLearned++;
    }
  }

  // =========================================================================
  // 3. CONTEO EXACTO DE 52 CARTAS + CARTAS QUEMADAS + MANOS CONOCIDAS
  // =========================================================================
  function getDeckStatistics(room, myCards, botUid) {
    const seenCounts = {};
    CARD_RANKS.forEach(r => { seenCounts[r] = 0; });

    const markSeen = (card) => {
      if (card && card.rank && seenCounts[card.rank] !== undefined) {
        seenCounts[card.rank]++;
      }
    };

    // 1. Cartas en el pozo actual
    const pile = (room && room.pile) || [];
    pile.forEach(markSeen);

    // 2. Cartas quemadas históricamente en esta partida
    MatchMemory.burnedCards.forEach(markSeen);

    // 3. Cartas propias visibles y en mano
    if (Array.isArray(myCards)) {
      myCards.forEach(markSeen);
    }

    // 4. Cartas boca arriba visibles de todos los jugadores
    if (room && room.players) {
      for (const uid in room.players) {
        const p = room.players[uid];
        if (p && Array.isArray(p.faceUp)) {
          p.faceUp.forEach(markSeen);
        }
      }
    }

    const unseenCounts = {};
    CARD_RANKS.forEach(r => {
      unseenCounts[r] = Math.max(0, 4 - seenCounts[r]);
    });

    const remainingAces = unseenCounts['A'] || 0;
    const remainingKings = unseenCounts['K'] || 0;
    const remainingTens = unseenCounts['10'] || 0;
    const remainingTwos = unseenCounts['2'] || 0;

    return {
      seenCounts,
      unseenCounts,
      remainingAces,
      remainingKings,
      remainingTens,
      remainingTwos,
      isKingInvincible: (remainingAces === 0 && remainingTens === 0 && remainingTwos === 0),
      isQueenInvincible: (remainingAces === 0 && remainingKings === 0)
    };
  }

  // Analiza los 3 jugadores restantes en orden de turno (+1, +2, +3) y sus cartas conocidas en mano
  function analyzeThreeRemainingPlayers(room, botUid) {
    const turnOrder = getTurnOrderArray(room);
    const myPlayer = room && room.players && room.players[botUid];
    const myTeam = (room && room.gameMode === '2v2' && myPlayer) ? myPlayer.team : null;
    const result = {
      opponents: [],
      nextSeat: null,
      mostDangerousOpponent: null,
      maxOpponentThreat: 0
    };

    if (!turnOrder || turnOrder.length === 0 || !room || !room.players) return result;
    const myIdx = turnOrder.indexOf(botUid);
    if (myIdx === -1) return result;

    let seatDist = 0;
    for (let step = 1; step < turnOrder.length; step++) {
      const uid = turnOrder[(myIdx + step) % turnOrder.length];
      const p = room.players[uid];
      if (!p || p.isFinished || p.isAbandoned || p.connected === false) continue;
      seatDist++;

      const isTeammate = !!(myTeam && p.team === myTeam);
      const totalCards = getTeamTotalCards(room, uid);
      const individualCards = (p.handCount || 0) + ((p.faceUp && p.faceUp.length) || 0) + (p.faceDownCount || 0);
      const threatLevel = getPlayerThreatLevel(p, room);
      const knownHand = (MatchMemory.knownHands[uid] || []).slice();
      const ceiling = MatchMemory.inferredCeiling[uid] || null;
      const visibleFaceUp = Array.isArray(p.faceUp) ? p.faceUp : [];

      // Si el jugador no tiene cartas desconocidas en mano (porque handCount <= knownHand.length o handCount === 0),
      // sabemos el 100% de lo que puede jugar en su turno.
      const activePool = (p.handCount || 0) > 0 ? knownHand : visibleFaceUp;
      const isHandFullyKnown = ((p.handCount || 0) > 0 && knownHand.length >= (p.handCount || 0)) ||
                               ((p.handCount || 0) === 0 && visibleFaceUp.length > 0);

      const info = {
        uid,
        name: p.name || uid,
        seatDist,
        isTeammate,
        totalCards,
        individualCards,
        handCount: p.handCount || 0,
        faceUp: visibleFaceUp,
        knownHand,
        activePool,
        isHandFullyKnown,
        ceiling,
        threatLevel
      };

      if (seatDist === 1) {
        result.nextSeat = info;
      }

      if (!isTeammate) {
        result.opponents.push(info);
        if (threatLevel > result.maxOpponentThreat) {
          result.maxOpponentThreat = threatLevel;
        }
        if (!result.mostDangerousOpponent || individualCards < result.mostDangerousOpponent.individualCards) {
          result.mostDangerousOpponent = info;
        }
      }
    }

    return result;
  }

  // Comprueba si jugar `candidateRank` obliga al rival `oppInfo` a recoger el pozo según las cartas que le conocemos
  function evaluateKnownHandImpact(candidateRank, candidateValue, oppInfo) {
    if (!oppInfo || oppInfo.isTeammate) {
      return { guaranteesPickup: false, trapsKnownCards: false, feedsKnownMulti: false };
    }

    const pool = oppInfo.activePool || [];
    const ceil = oppInfo.ceiling;

    // Si jugamos un 10 o un 2, no bloqueamos directamente (10 da turno extra, 2 abre mesa)
    if (candidateRank === '10' || candidateRank === '2') {
      return { guaranteesPickup: false, trapsKnownCards: false, feedsKnownMulti: false };
    }

    const nextIsLower = (candidateRank === '7');
    let canBeatWithKnown = false;
    let feedsKnownMulti = false;

    if (pool.length > 0) {
      const rankCounts = {};
      pool.forEach(c => {
        rankCounts[c.rank] = (rankCounts[c.rank] || 0) + 1;
        const fakeTop = { rank: candidateRank, value: candidateValue };
        if (canPlay(c, fakeTop, nextIsLower)) {
          canBeatWithKnown = true;
        }
      });

      // Verificar si el rival tiene pareja/trío conocido que podría descargar sobre nuestra carta
      for (const r in rankCounts) {
        if (rankCounts[r] >= 2 && r !== '2' && r !== '10') {
          const rVal = CARD_VALUES[r] || 0;
          const fakeTop = { rank: candidateRank, value: candidateValue };
          if (canPlay({ rank: r, value: rVal }, fakeTop, nextIsLower)) {
            feedsKnownMulti = true;
          }
        }
      }
    }

    // Caso 1: Conocemos TODA su mano (o está en fase faceUp) y ninguna carta supera la nuestra
    if (oppInfo.isHandFullyKnown && pool.length > 0 && !canBeatWithKnown) {
      return { guaranteesPickup: true, trapsKnownCards: true, feedsKnownMulti: false };
    }

    // Caso 2: Tenemos su techo inferido (porque acaba de recoger el pozo y no ha robado del mazo)
    if (ceil && ceil.lacksTwoAndTen && !canBeatWithKnown) {
      if (nextIsLower && ceil.lacksLowSeven) {
        return { guaranteesPickup: true, trapsKnownCards: true, feedsKnownMulti: false };
      }
      if (!nextIsLower && candidateValue > ceil.maxNormalValue) {
        return { guaranteesPickup: true, trapsKnownCards: true, feedsKnownMulti: false };
      }
    }

    // Caso 3: Le conocemos al menos 1-3 cartas recogidas y ninguna puede responder a nuestra jugada
    if (pool.length > 0 && !canBeatWithKnown) {
      return { guaranteesPickup: false, trapsKnownCards: true, feedsKnownMulti: false };
    }

    return { guaranteesPickup: false, trapsKnownCards: false, feedsKnownMulti };
  }

  // =========================================================================
  // 4. MOTOR DE SIMULACIÓN TÁCTICA + MEMORIA DE 3 RIVALES + Q-LEARNING
  // =========================================================================
  function simulateCandidateMove(candidateGroup, room, botUid, fullHand, deckStats, loopStatus, hasNormalMoves, customWeights) {
    const W = customWeights || LearnedBrain.weights;
    const firstCard = candidateGroup[0];
    const candidateRank = firstCard.rank;
    const candidateValue = firstCard.value || CARD_VALUES[candidateRank] || 0;
    const pile = (room && room.pile) || [];
    const pileLength = pile.length;
    const pileTop = room && room.pileTop;
    const isTeamMode = (room && room.gameMode === '2v2');

    const tableIntel = analyzeThreeRemainingPlayers(room, botUid);
    const nextSeat = tableIntel.nextSeat;
    const isNextTeammate = !!(nextSeat && nextSeat.isTeammate);
    const nextThreat = nextSeat ? nextSeat.threatLevel : 0;
    const nextTeamTotal = nextSeat ? nextSeat.totalCards : 999;

    // Evaluar impacto contra las cartas que sabemos que el siguiente jugador tiene en la mano
    const knownImpact = evaluateKnownHandImpact(candidateRank, candidateValue, nextSeat);

    let utility = 0;

    // -----------------------------------------------------------------------
    // A) EXPLOTACIÓN DE MANO CONOCIDA (CARTAS RECOGIDAS POR EL RIVAL)
    // -----------------------------------------------------------------------
    if (!isNextTeammate && nextSeat) {
      if (knownImpact.guaranteesPickup) {
        // ¡Sabemos con certeza matemática que el rival NO puede superar esta carta y comerá el pozo!
        utility += W.knownHandKillBonus + (pileLength * 12);
        if (candidateRank === '7') utility += 20;
      } else if (knownImpact.trapsKnownCards) {
        // Ninguna de las cartas que recogió antes le sirve contra esta carta
        utility += (candidateRank === '7') ? W.knownSevenTrapBonus * 0.65 : (W.knownHandKillBonus * 0.55);
      }

      if (knownImpact.feedsKnownMulti) {
        // Sabemos que recogió pareja/trío de un número que podría soltar gratis si jugamos esto
        utility -= W.feedKnownPairPenalty;
      }
    }

    // -----------------------------------------------------------------------
    // B) CONTROL DE LOS 3 JUGADORES EN TODOS CONTRA TODOS (FFA) Y 2v2
    // -----------------------------------------------------------------------
    const dangerousOpp = tableIntel.mostDangerousOpponent;
    if (dangerousOpp && dangerousOpp.individualCards <= 2 && (!nextSeat || dangerousOpp.uid !== nextSeat.uid)) {
      // ¡Un rival a 2 o 3 asientos de distancia está a punto de ganar!
      // Subir el piso de la mesa o activar un 7 / quemar con 10 para no dejar que le llegue una mesa baja
      const dangerousImpact = evaluateKnownHandImpact(candidateRank, candidateValue, dangerousOpp);
      if (candidateRank === '10' && pileLength >= 2) {
        utility += W.ffaDistanceBlockBonus; // Quemar y mantener el turno para controlar la mesa
      } else if (dangerousImpact.guaranteesPickup || dangerousImpact.trapsKnownCards || candidateValue >= 12 || candidateRank === '7') {
        utility += Math.round(W.ffaDistanceBlockBonus * 0.8);
      } else if (candidateValue <= 6 && candidateRank !== '2' && candidateRank !== '10') {
        // No dejar la mesa baja cuando alguien en la mesa tiene 1 o 2 cartas
        utility -= Math.round(W.ffaDistanceBlockBonus * 0.75);
      }
    }

    // -----------------------------------------------------------------------
    // C) DETECCIÓN Y CONDENA DE BUCLES (ROMPE-BUCLES)
    // -----------------------------------------------------------------------
    if (loopStatus.inLoop && candidateRank === loopStatus.loopRank && pileLength <= 2 && !knownImpact.guaranteesPickup) {
      utility -= 160;
    } else if (loopStatus.inLoop && candidateValue <= 8 && candidateRank !== '10' && candidateRank !== '2') {
      utility += 70;
    }

    // -----------------------------------------------------------------------
    // D) POLÍTICA DE COMODINES (10 Y 2) - PROTECCIÓN RIGUROSA
    // -----------------------------------------------------------------------
    if (candidateRank === '10') {
      if (hasNormalMoves && pileLength < W.saveTenMinPile && nextThreat < 2 && tableIntel.maxOpponentThreat < 2) {
        utility -= 125;
      } else if (pileLength >= 6) {
        utility += 80;
      } else if (pileLength >= W.saveTenMinPile) {
        utility += 40;
      } else if (pileLength <= 1 && nextThreat < 2) {
        utility -= 95;
      }
    }

    if (candidateRank === '2') {
      if (hasNormalMoves) {
        utility -= W.protectTwoPenalty;
      } else if (pileTop && pileTop.value >= 12) {
        utility += 45;
      } else if (pileLength <= 1 && nextThreat < 2) {
        utility -= 45;
      }
    }

    // -----------------------------------------------------------------------
    // E) EVALUACIÓN DEL RIVAL INMEDIATO (+1)
    // -----------------------------------------------------------------------
    if (!isNextTeammate) {
      if (nextThreat >= 2 || nextTeamTotal <= 2) {
        if (candidateRank === 'A') {
          utility += 95;
        } else if (candidateRank === 'K' && deckStats.isKingInvincible) {
          utility += 105;
        } else if (candidateRank === 'K') {
          utility += 75;
        } else if (candidateRank === 'Q' && deckStats.isQueenInvincible) {
          utility += 90;
        } else if (candidateRank === '7' && nextSeat && nextSeat.faceUp && nextSeat.faceUp.length > 0 && nextSeat.faceUp.every(c => c.value > 7)) {
          utility += 115;
        } else if (candidateValue <= 6 && candidateRank !== '2' && candidateRank !== '10') {
          utility -= 130;
        }
      } else {
        // Rival con 4+ cartas: conservar cartas altas si no garantizan que recoja un pozo jugoso
        if (pileLength <= 1 && !knownImpact.guaranteesPickup) {
          if (candidateValue <= 7 && candidateRank !== '2' && candidateRank !== '10') {
            utility += W.lowOpenBonus;
          } else if (candidateRank === 'A' || candidateRank === 'K') {
            utility -= W.highWastePenalty;
          }
        } else {
          if (candidateValue <= 9 && candidateRank !== '2' && candidateRank !== '10') {
            utility += 28;
          }
        }
      }
    }

    // -----------------------------------------------------------------------
    // F) COOPERACIÓN EN MODO 2v2 (COMPAÑERO SIGUIENTE)
    // -----------------------------------------------------------------------
    if (isNextTeammate) {
      // Si el compañero sabemos que solo tiene cartas altas o bajas, ayudarle
      if (candidateRank === '7' || candidateRank === 'A') {
        utility -= 45;
      } else if (candidateValue <= 8 && candidateRank !== '2') {
        utility += W.teammateAssistBonus;
      }
    }

    // -----------------------------------------------------------------------
    // G) BENEFICIO DE DESCARGA MÚLTIPLE (PAREJAS / TRÍOS) + TABLA Q APRENDIDA
    // -----------------------------------------------------------------------
    if (candidateGroup.length >= 2 && candidateRank !== 'A' && candidateRank !== '7') {
      utility += (candidateGroup.length * W.multiDumpBonusPerCard);
    }

    const qKey = buildQStateKey(room, candidateGroup, nextThreat, tableIntel.maxOpponentThreat, knownImpact.guaranteesPickup);
    utility += getLearnedQBonus(qKey);

    return utility;
  }

  // =========================================================================
  // 4. SETUP TÁCTICO INICIAL (Preparación de las 3 cartas boca arriba y 3 de mano)
  // =========================================================================
  function chooseSetupCards(sixCards, isTeamMode, botName) {
    if (!Array.isArray(sixCards) || sixCards.length !== 6) return null;

    const cards = [...sixCards];
    const tens = cards.filter(c => c.rank === '10');
    const twos = cards.filter(c => c.rank === '2');

    const byRank = {};
    cards.forEach(c => {
      if (!byRank[c.rank]) byRank[c.rank] = [];
      byRank[c.rank].push(c);
    });

    const faceUpCandidates = [];
    const handCandidates = [];

    // Reservar 1 comodín en mano para sobrevivir al inicio
    let specialForHand = null;
    if (tens.length > 0) specialForHand = tens[0];
    else if (twos.length > 0) specialForHand = twos[0];

    if (specialForHand) {
      handCandidates.push(specialForHand);
      const sIdx = cards.findIndex(c => c.id === specialForHand.id);
      if (sIdx !== -1) cards.splice(sIdx, 1);
    }

    // Parejas altas en mesa para barrido en fase 2
    const pairs = Object.values(byRank)
      .filter(grp => grp.length >= 2 && grp[0].rank !== '2' && grp[0].rank !== '10')
      .sort((a, b) => b[0].value - a[0].value);

    for (const group of pairs) {
      const available = group.filter(gc => cards.some(c => c.id === gc.id));
      if (available.length >= 2 && faceUpCandidates.length + 2 <= 3) {
        available.forEach(c => {
          if (faceUpCandidates.length < 3) {
            faceUpCandidates.push(c);
            const idx = cards.findIndex(cd => cd.id === c.id);
            if (idx !== -1) cards.splice(idx, 1);
          }
        });
      }
    }

    // Llenar mesa con las más altas restantes
    cards.sort((a, b) => {
      const sa = a.rank === '2' ? 18 : (a.rank === '10' ? 19 : a.value);
      const sb = b.rank === '2' ? 18 : (b.rank === '10' ? 19 : b.value);
      return sb - sa;
    });

    while (faceUpCandidates.length < 3 && cards.length > 0) {
      faceUpCandidates.push(cards.shift());
    }

    while (cards.length > 0) {
      handCandidates.push(cards.shift());
    }

    handCandidates.sort((a, b) => a.value - b.value);

    return {
      faceUp: faceUpCandidates,
      hand: handCandidates
    };
  }

  // =========================================================================
  // 5. TOMA DE DECISIÓN INTELIGENTE DESDE LA MANO (CON MONTE CARLO)
  // =========================================================================
  function chooseHandPlay(legalGroups, room, botUid, fullHand) {
    if (!legalGroups || legalGroups.length === 0) return null;
    if (legalGroups.length === 1 && legalGroups[0].length === 1) return legalGroups[0];

    const myPlayer = room.players && room.players[botUid];
    const botName = myPlayer ? myPlayer.name : 'Bot';

    const pile = room.pile || [];
    const pileTop = room.pileTop;
    const pileLength = pile.length;

    // Actualizar seguimiento continuo de jugadas y recogidas para el detector de bucles
    updatePileTracking(room);

    const normalGroups = legalGroups.filter(g => g[0].rank !== '2' && g[0].rank !== '10');
    const hasNormalMoves = normalGroups.length > 0;
    const tenGroup = legalGroups.find(g => g[0].rank === '10');
    const twoGroup = legalGroups.find(g => g[0].rank === '2');

    // -----------------------------------------------------------------------
    // PRIORIDAD 0: REMATE GANADOR (FINISHER CON 10 + TURNO EXTRA)
    // -----------------------------------------------------------------------
    const totalCardsLeft = (fullHand ? fullHand.length : 3) +
      ((myPlayer && myPlayer.faceUp && myPlayer.faceUp.length) || 0) +
      ((myPlayer && myPlayer.faceDownCount) || 0);

    if (totalCardsLeft === 2 && tenGroup) {
      sayBotQuote(botUid, botName, 'burn');
      return [tenGroup[0]];
    }

    // -----------------------------------------------------------------------
    // PRIORIDAD 1: CAZA DE 4-OF-A-KIND (QUEMA INMEDIATA)
    // -----------------------------------------------------------------------
    const topConsecutive = getConsecutiveTopCount(pile);
    if (topConsecutive.count > 0 && topConsecutive.count < 4) {
      const needed = 4 - topConsecutive.count;
      const matchingGroup = legalGroups.find(g => g[0].rank === topConsecutive.rank);
      if (matchingGroup && matchingGroup.length >= needed) {
        sayBotQuote(botUid, botName, 'fourKind');
        return matchingGroup.slice(0, needed);
      }
    }

    const fourInHand = legalGroups.find(g => g.length >= 4);
    if (fourInHand) {
      sayBotQuote(botUid, botName, 'fourKind');
      return fourInHand.slice(0, 4);
    }

    // -----------------------------------------------------------------------
    // EVALUACIÓN MONTE CARLO Y CONTEO DE CARTAS
    // -----------------------------------------------------------------------
    const deckStats = getDeckStatistics(room, fullHand);
    const loopStatus = detectStalemateLoop(room);

    if (loopStatus.inLoop) {
      sayBotQuote(botUid, botName, 'loopBreak');
    }

    // Calcular la utilidad de cada jugada candidata
    let bestGroup = null;
    let maxUtility = -99999;

    for (const group of legalGroups) {
      const util = simulateCandidateMove(group, room, botUid, fullHand, deckStats, loopStatus, hasNormalMoves);
      if (util > maxUtility) {
        maxUtility = util;
        bestGroup = group;
      }
    }

    // Fallback de seguridad
    if (bestGroup) {
      // Si la mejor jugada es un comodín pero hay jugadas normales viables con puntaje decente,
      // respetar la regla de no gastar el 2 o el 10 sin necesidad
      const isSpecial = bestGroup[0].rank === '2' || bestGroup[0].rank === '10';

      if (isSpecial && hasNormalMoves && maxUtility < 50) {
        // En situaciones no críticas, priorizar carta normal más baja
        normalGroups.sort((a, b) => a[0].value - b[0].value);
        return normalGroups[0];
      }

      return bestGroup;
    }

    return legalGroups[0];
  }

  // =========================================================================
  // 6. TOMA DE DECISIÓN INTELIGENTE DESDE CARTAS BOCA ARRIBA (FASE 2)
  // =========================================================================
  function chooseFaceUpPlay(legalFaceUp, room, botUid, fullFaceUp) {
    if (!legalFaceUp || legalFaceUp.length === 0) return null;
    if (legalFaceUp.length === 1) return legalFaceUp[0];

    const myPlayer = room.players && room.players[botUid];
    const botName = myPlayer ? myPlayer.name : 'Bot';
    const pile = room.pile || [];

    // Actualizar seguimiento continuo de jugadas y recogidas para el detector de bucles
    updatePileTracking(room);

    const normalFaceUp = legalFaceUp.filter(c => c.rank !== '2' && c.rank !== '10');
    const hasNormalMoves = normalFaceUp.length > 0;

    // 1. Quema por 4-of-a-kind
    const topConsecutive = getConsecutiveTopCount(pile);
    if (topConsecutive.count > 0 && topConsecutive.count < 4) {
      const needed = 4 - topConsecutive.count;
      const matching = legalFaceUp.filter(c => c.rank === topConsecutive.rank);
      if (matching.length >= needed) {
        sayBotQuote(botUid, botName, 'fourKind');
        return matching[0];
      }
    }

    // Remate ganador con 10 si solo queda 1 carta más
    const faceDownCount = (myPlayer && myPlayer.faceDownCount) || 0;
    const remainingFaceUp = (fullFaceUp && fullFaceUp.length) || legalFaceUp.length;
    const tenCard = legalFaceUp.find(c => c.rank === '10');
    if (remainingFaceUp === 2 && faceDownCount === 0 && tenCard) {
      sayBotQuote(botUid, botName, 'burn');
      return tenCard;
    }

    const deckStats = getDeckStatistics(room, fullFaceUp);
    const loopStatus = detectStalemateLoop(room);

    let bestCard = null;
    let maxUtility = -99999;

    for (const card of legalFaceUp) {
      const util = simulateCandidateMove([card], room, botUid, fullFaceUp, deckStats, loopStatus, hasNormalMoves);
      if (util > maxUtility) {
        maxUtility = util;
        bestCard = card;
      }
    }

    if (bestCard) {
      const isSpecial = bestCard.rank === '2' || bestCard.rank === '10';
      if (isSpecial && hasNormalMoves && maxUtility < 50) {
        normalFaceUp.sort((a, b) => a.value - b.value);
        return normalFaceUp[0];
      }
      return bestCard;
    }

    return legalFaceUp[0];
  }

  // =========================================================================
  // 7. MOTOR IA GRATUITO EN LA NUBE (DEEPSEEK / UNLIMITED FREE AI API)
  // =========================================================================
  const LLM_STORAGE_KEY = 'guerra_bot_llm_config_v1';

  const llmConfig = {
    enabled: true,
    // Proveedor gratuito por defecto sin API key (Pollinations OpenAI-compatible con modelo DeepSeek)
    provider: 'pollinations', // 'pollinations' | 'openrouter' | 'deepseek' | 'groq'
    model: 'deepseek',        // 'deepseek' | 'openai' | 'mistral' | 'deepseek/deepseek-chat:free'
    apiKey: '',               // Opcional: solo necesario si el usuario configura OpenRouter / DeepSeek directo / Groq
    timeoutMs: 2500,          // Timeout estricto para nunca retrasar la partida
    enableTaunts: true        // Permite que la IA escriba frases contextuales en el globo del bot
  };

  // Cargar configuración personalizada si existe en localStorage
  try {
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem(LLM_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object') {
          Object.assign(llmConfig, parsed);
        }
      }
    }
  } catch (e) {}

  const llmStats = {
    requests: 0,
    successes: 0,
    fallbacks: 0,
    lastModelUsed: null,
    lastLatencyMs: 0,
    lastDecisionReason: null
  };

  function configureLLM(customOpts) {
    if (!customOpts || typeof customOpts !== 'object') return { ...llmConfig };
    Object.assign(llmConfig, customOpts);
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(LLM_STORAGE_KEY, JSON.stringify(llmConfig));
      }
    } catch (e) {}
    return { ...llmConfig };
  }

  function getLLMStats() {
    return {
      config: { ...llmConfig, apiKey: llmConfig.apiKey ? '***' : '' },
      stats: { ...llmStats }
    };
  }

  function sayCustomBotText(botUid, text) {
    if (!text || !llmConfig.enableTaunts) return;
    try {
      const clean = String(text).trim().slice(0, 65);
      if (!clean) return;
      const tagged = clean.startsWith('🧠') ? clean : `🧠 ${clean}`;
      if (global.GuerraGame && global.GuerraGame.chat && typeof global.GuerraGame.chat.showSeatSpeechBubble === 'function') {
        global.GuerraGame.chat.showSeatSpeechBubble(botUid, tagged, true);
      }
    } catch (e) {}
  }

  function buildTacticalPrompt(candidates, room, botUid, phaseLabel, deckStats, loopStatus, utilities) {
    const myPlayer = (room.players && room.players[botUid]) || {};
    const botName = myPlayer.name || 'Bot IA';
    const profile = getBotProfile(botName);
    const pile = room.pile || [];
    const pileTop = room.pileTop;
    const isLower = !!room.isLowerRestriction;
    const isTeamMode = (room.gameMode === '2v2');

    const tableIntel = analyzeThreeRemainingPlayers(room, botUid);
    const nextSeat = tableIntel.nextSeat;
    const isNextTeammate = !!(nextSeat && nextSeat.isTeammate);
    const nextTotal = nextSeat ? nextSeat.totalCards : 99;

    const threePlayersReport = tableIntel.opponents.concat(isNextTeammate && nextSeat ? [nextSeat] : [])
      .sort((a, b) => a.seatDist - b.seatDist)
      .map(info => {
        const role = info.isTeammate ? 'ALIADO' : 'RIVAL';
        const knownStr = info.knownHand.length > 0
          ? `Mano conocida (recogida): [${info.knownHand.map(c => c.rank).join(',')}]`
          : 'Mano oculta';
        const upStr = info.faceUp.length > 0
          ? `Mesa: [${info.faceUp.map(c => c.rank).join(',')}]`
          : 'Mesa vacía';
        return `  * Turno +${info.seatDist} (${role} ${info.name}): ${info.individualCards} cartas totales | ${knownStr} | ${upStr}`;
      }).join('\n');

    const optionsDesc = candidates.map((grp, idx) => {
      const arr = Array.isArray(grp) ? grp : [grp];
      const rank = arr[0].rank;
      const count = arr.length;
      const score = utilities[idx];
      let tag = '';
      if (rank === '10') tag = ' (COMODÍN QUEMA POZO)';
      else if (rank === '2') tag = ' (COMODÍN REINICIA MESA)';
      else if (rank === '7') tag = ' (RESTRICCIÓN <=7)';
      const impact = evaluateKnownHandImpact(rank, arr[0].value || CARD_VALUES[rank] || 0, nextSeat);
      if (impact.guaranteesPickup) tag += ' [¡BLOQUEO GARANTIZADO AL RIVAL SEGÚN SU MANO CONOCIDA!]';
      return `[${idx}] Jugar ${count}x "${rank}"${tag} | Valor Táctico Aprendido: ${score}`;
    }).join('\n');

    return {
      system:
        `Eres ${botName} (estilo: ${profile.style}), una IA competitiva que ha entrenado miles de partidas de "Guerra" (Palace/Shithead) y QUIERE GANAR.\n` +
        `Reglas clave:\n` +
        `- Llevas el control exacto de las cartas que los otros 3 jugadores han recogido en su mano.\n` +
        `- Si una opción dice [¡BLOQUEO GARANTIZADO!], esa carta supera todo lo que el rival tiene en mano y lo obligará a comer el pozo.\n` +
        `- En Todos contra Todos (FFA), vigila a los 3 rivales: si cualquiera tiene <=2 cartas, sube el rango de la mesa, usa trampa de 7 o quema con 10.\n` +
        `- El 2 reinicia la mesa (NUNCA lo gastes si tienes cartas normales jugables y no hay emergencia).\n` +
        `Responde ÚNICAMENTE con un objeto JSON válido con este formato exacto:\n` +
        `{"choice": <número de índice>, "taunt": "<comentario corto e ingenioso en español de máx 42 caracteres sobre tu jugada>"}`,
      user:
        `Fase: ${phaseLabel} | Modo: ${room.gameMode || 'FFA'} | Partidas aprendidas por IA: ${LearnedBrain.gamesSimulated}\n` +
        `Pozo actual: ${pile.length} cartas | Tope: ${pileTop ? pileTop.rank : 'Vacío'}${isLower ? ' (Restricción <=7 activa)' : ''}\n` +
        `Mazo de robo: ${room.deckCount || 0} cartas | Cartas quemadas fuera del juego: ${MatchMemory.burnedCards.length} | Ases vivos: ${deckStats.remainingAces}, Reyes vivos: ${deckStats.remainingKings}\n` +
        `Control de los otros 3 jugadores en la mesa:\n${threePlayersReport || '  * Sin datos'}\n` +
        `Siguiente inmediato: ${nextSeat ? nextSeat.name : 'Nadie'} (${isNextTeammate ? 'COMPAÑERO' : 'RIVAL'}, ${nextTotal} cartas)\n` +
        `${loopStatus.inLoop ? `¡ALERTA DE BUCLE! Evita repetir ${loopStatus.loopRank} en pozo pequeño.\n` : ''}` +
        `Opciones legales disponibles:\n${optionsDesc}\n\n` +
        `Elige el mejor índice JSON:`
    };
  }

  function parseLLMJsonChoice(rawText, maxIndex) {
    if (!rawText || typeof rawText !== 'string') return null;
    try {
      const cleaned = rawText.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
      const jsonMatch = cleaned.match(/\{[\s\S]*?\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        const idx = Number(parsed.choice !== undefined ? parsed.choice : parsed.index);
        if (Number.isInteger(idx) && idx >= 0 && idx < maxIndex) {
          return {
            choice: idx,
            taunt: typeof parsed.taunt === 'string' ? parsed.taunt.trim() : ''
          };
        }
      }
      const numMatch = cleaned.match(/\b(\d+)\b/);
      if (numMatch) {
        const idx = parseInt(numMatch[1], 10);
        if (idx >= 0 && idx < maxIndex) {
          return { choice: idx, taunt: '' };
        }
      }
    } catch (e) {}
    return null;
  }

  async function fetchWithTimeout(url, options, timeoutMs) {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const res = await fetch(url, {
        ...options,
        signal: controller ? controller.signal : undefined
      });
      return res;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function runSingleProviderAttempt(attempt, maxIndex, timeoutMs) {
    const res = await fetchWithTimeout(attempt.url, {
      method: attempt.method || 'POST',
      headers: attempt.headers,
      body: attempt.body ? JSON.stringify(attempt.body) : undefined
    }, timeoutMs);

    if (!res || !res.ok) throw new Error(`HTTP ${res ? res.status : 'ERR'}`);
    const text = await res.text();
    let content = text;
    try {
      const data = JSON.parse(text);
      if (data && data.choices && data.choices[0] && data.choices[0].message) {
        content = data.choices[0].message.content;
      }
    } catch (e) {}

    const parsed = parseLLMJsonChoice(content, maxIndex);
    if (!parsed) throw new Error('Invalid JSON choice');
    return { ...parsed, modelUsed: attempt.name };
  }

  async function queryFreeCloudLLM(promptObj, maxIndex) {
    if (!llmConfig.enabled || typeof fetch !== 'function') return null;
    llmStats.requests++;
    const startTime = Date.now();

    const attempts = [];

    if (llmConfig.apiKey && llmConfig.provider === 'openrouter') {
      attempts.push({
        name: `openrouter:${llmConfig.model || 'deepseek/deepseek-chat:free'}`,
        url: 'https://openrouter.ai/api/v1/chat/completions',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${llmConfig.apiKey}`
        },
        body: {
          model: llmConfig.model || 'deepseek/deepseek-chat:free',
          messages: [
            { role: 'system', content: promptObj.system },
            { role: 'user', content: promptObj.user }
          ],
          temperature: 0.2,
          max_tokens: 90
        }
      });
    } else if (llmConfig.apiKey && llmConfig.provider === 'deepseek') {
      attempts.push({
        name: 'deepseek:deepseek-chat',
        url: 'https://api.deepseek.com/chat/completions',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${llmConfig.apiKey}`
        },
        body: {
          model: 'deepseek-chat',
          messages: [
            { role: 'system', content: promptObj.system },
            { role: 'user', content: promptObj.user }
          ],
          temperature: 0.2,
          max_tokens: 90
        }
      });
    } else if (llmConfig.apiKey && llmConfig.provider === 'groq') {
      attempts.push({
        name: 'groq:llama-3.3-70b-versatile',
        url: 'https://api.groq.com/openai/v1/chat/completions',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${llmConfig.apiKey}`
        },
        body: {
          model: llmConfig.model || 'llama-3.3-70b-versatile',
          messages: [
            { role: 'system', content: promptObj.system },
            { role: 'user', content: promptObj.user }
          ],
          temperature: 0.2,
          max_tokens: 90
        }
      });
    }

    // Proveedores 100% GRATUITOS y SIN API KEY (Pollinations AI: DeepSeek + OpenAI en carrera rápida)
    const primaryFreeModel = llmConfig.model || 'deepseek';
    attempts.push({
      name: `pollinations-free:${primaryFreeModel}`,
      url: 'https://text.pollinations.ai/openai',
      headers: { 'Content-Type': 'application/json' },
      body: {
        model: primaryFreeModel,
        messages: [
          { role: 'system', content: promptObj.system },
          { role: 'user', content: promptObj.user }
        ],
        temperature: 0.2,
        jsonMode: true
      }
    });

    if (primaryFreeModel !== 'openai') {
      attempts.push({
        name: 'pollinations-free:openai',
        url: 'https://text.pollinations.ai/openai',
        headers: { 'Content-Type': 'application/json' },
        body: {
          model: 'openai',
          messages: [
            { role: 'system', content: promptObj.system },
            { role: 'user', content: promptObj.user }
          ],
          temperature: 0.2,
          jsonMode: true
        }
      });
    }

    try {
      const perAttemptTimeout = Math.max(1800, llmConfig.timeoutMs || 2800);
      const winner = await Promise.any(
        attempts.map(att => runSingleProviderAttempt(att, maxIndex, perAttemptTimeout))
      );
      if (winner) {
        llmStats.successes++;
        llmStats.lastModelUsed = winner.modelUsed;
        llmStats.lastLatencyMs = Date.now() - startTime;
        llmStats.lastDecisionReason = `Cloud AI (${winner.modelUsed}) en ${llmStats.lastLatencyMs}ms`;
        console.log(`🧠 [GuerraBotAI Cloud] Modelo: ${winner.modelUsed} (${llmStats.lastLatencyMs}ms) -> Opción [${winner.choice}] ${winner.taunt ? `"${winner.taunt}"` : ''}`);
        return winner;
      }
    } catch (err) {
      // Fallback instantáneo al motor local con Q-Learning + Memoria de 3 Rivales
    }

    llmStats.fallbacks++;
    llmStats.lastDecisionReason = 'Motor Local Q-Learning + ISMCTS';
    return null;
  }

  function recordBotMoveTrace(room, botUid, chosenGroup) {
    if (!room || !botUid || !chosenGroup) return;
    const arr = Array.isArray(chosenGroup) ? chosenGroup : [chosenGroup];
    if (arr.length === 0 || !arr[0]) return;
    const tableIntel = analyzeThreeRemainingPlayers(room, botUid);
    const nextSeat = tableIntel.nextSeat;
    const nextThreat = nextSeat ? nextSeat.threatLevel : 0;
    const impact = evaluateKnownHandImpact(arr[0].rank, arr[0].value || CARD_VALUES[arr[0].rank] || 0, nextSeat);
    const qKey = buildQStateKey(room, arr, nextThreat, tableIntel.maxOpponentThreat, impact.guaranteesPickup);
    MatchMemory.matchTrace.push({ botUid, qKey });
  }

  // =========================================================================
  // 8. DECISIONES ASÍNCRONAS HÍBRIDAS (DEEPSEEK CLOUD + Q-LEARNING + MEMORIA)
  // =========================================================================
  async function chooseHandPlayAsync(legalGroups, room, botUid, fullHand) {
    if (!legalGroups || legalGroups.length === 0) return null;
    if (legalGroups.length === 1) {
      recordBotMoveTrace(room, botUid, legalGroups[0]);
      return legalGroups[0];
    }

    const myPlayer = (room && room.players && room.players[botUid]) || {};
    const botName = myPlayer.name || 'Bot';
    const pile = (room && room.pile) || [];

    // 1. Remate ganador inmediato (2 cartas y tiene un 10) o 4-of-a-kind inmediato
    const totalCardsLeft = (fullHand ? fullHand.length : 3) +
      ((myPlayer.faceUp && myPlayer.faceUp.length) || 0) +
      (myPlayer.faceDownCount || 0);
    const tenGroup = legalGroups.find(g => g[0].rank === '10');
    if (totalCardsLeft === 2 && tenGroup) {
      sayBotQuote(botUid, botName, 'burn');
      recordBotMoveTrace(room, botUid, [tenGroup[0]]);
      return [tenGroup[0]];
    }

    const topConsecutive = getConsecutiveTopCount(pile);
    if (topConsecutive.count > 0 && topConsecutive.count < 4) {
      const needed = 4 - topConsecutive.count;
      const matchingGroup = legalGroups.find(g => g[0].rank === topConsecutive.rank);
      if (matchingGroup && matchingGroup.length >= needed) {
        sayBotQuote(botUid, botName, 'fourKind');
        const res = matchingGroup.slice(0, needed);
        recordBotMoveTrace(room, botUid, res);
        return res;
      }
    }

    if (!llmConfig.enabled) {
      const localRes = chooseHandPlay(legalGroups, room, botUid, fullHand);
      recordBotMoveTrace(room, botUid, localRes);
      return localRes;
    }

    updatePileTracking(room);
    const normalGroups = legalGroups.filter(g => g[0].rank !== '2' && g[0].rank !== '10');
    const hasNormalMoves = normalGroups.length > 0;
    const deckStats = getDeckStatistics(room, fullHand, botUid);
    const loopStatus = detectStalemateLoop(room);

    const utilities = legalGroups.map(grp =>
      simulateCandidateMove(grp, room, botUid, fullHand, deckStats, loopStatus, hasNormalMoves)
    );
    const maxUtility = Math.max(...utilities);

    const promptObj = buildTacticalPrompt(legalGroups, room, botUid, 'MANO (Fase 1)', deckStats, loopStatus, utilities);
    const llmDecision = await queryFreeCloudLLM(promptObj, legalGroups.length);

    if (llmDecision && legalGroups[llmDecision.choice]) {
      const chosenGroup = legalGroups[llmDecision.choice];
      const chosenScore = utilities[llmDecision.choice];
      const chosenRank = chosenGroup[0].rank;

      const isWastefulSpecial = (chosenRank === '2' || chosenRank === '10') && hasNormalMoves && chosenScore < 0;
      const isLoopTrap = loopStatus.inLoop && chosenRank === loopStatus.loopRank && pile.length <= 2 && maxUtility > chosenScore;

      if (!isWastefulSpecial && !isLoopTrap && (maxUtility - chosenScore <= 65)) {
        if (llmDecision.taunt) {
          sayCustomBotText(botUid, llmDecision.taunt);
        }
        recordBotMoveTrace(room, botUid, chosenGroup);
        return chosenGroup;
      }
    }

    const fallbackRes = chooseHandPlay(legalGroups, room, botUid, fullHand);
    recordBotMoveTrace(room, botUid, fallbackRes);
    return fallbackRes;
  }

  async function chooseFaceUpPlayAsync(legalFaceUp, room, botUid, fullFaceUp) {
    if (!legalFaceUp || legalFaceUp.length === 0) return null;
    if (legalFaceUp.length === 1) {
      recordBotMoveTrace(room, botUid, [legalFaceUp[0]]);
      return legalFaceUp[0];
    }

    if (!llmConfig.enabled) {
      const localCard = chooseFaceUpPlay(legalFaceUp, room, botUid, fullFaceUp);
      recordBotMoveTrace(room, botUid, [localCard]);
      return localCard;
    }

    updatePileTracking(room);
    const normalFaceUp = legalFaceUp.filter(c => c.rank !== '2' && c.rank !== '10');
    const hasNormalMoves = normalFaceUp.length > 0;
    const deckStats = getDeckStatistics(room, fullFaceUp, botUid);
    const loopStatus = detectStalemateLoop(room);
    const pile = (room && room.pile) || [];

    const utilities = legalFaceUp.map(card =>
      simulateCandidateMove([card], room, botUid, fullFaceUp, deckStats, loopStatus, hasNormalMoves)
    );
    const maxUtility = Math.max(...utilities);

    const promptObj = buildTacticalPrompt(legalFaceUp, room, botUid, 'CARTAS BOCA ARRIBA (Fase 2)', deckStats, loopStatus, utilities);
    const llmDecision = await queryFreeCloudLLM(promptObj, legalFaceUp.length);

    if (llmDecision && legalFaceUp[llmDecision.choice]) {
      const chosenCard = legalFaceUp[llmDecision.choice];
      const chosenScore = utilities[llmDecision.choice];
      const chosenRank = chosenCard.rank;

      const isWastefulSpecial = (chosenRank === '2' || chosenRank === '10') && hasNormalMoves && chosenScore < 0;
      const isLoopTrap = loopStatus.inLoop && chosenRank === loopStatus.loopRank && pile.length <= 2 && maxUtility > chosenScore;

      if (!isWastefulSpecial && !isLoopTrap && (maxUtility - chosenScore <= 65)) {
        if (llmDecision.taunt) {
          sayCustomBotText(botUid, llmDecision.taunt);
        }
        recordBotMoveTrace(room, botUid, [chosenCard]);
        return chosenCard;
      }
    }

    const fallbackCard = chooseFaceUpPlay(legalFaceUp, room, botUid, fullFaceUp);
    recordBotMoveTrace(room, botUid, [fallbackCard]);
    return fallbackCard;
  }

  // Llamado al finalizar una partida real para aprender de todas las jugadas hechas
  function observeMatchEnd(room) {
    if (!room || !room.players || MatchMemory.matchTrace.length === 0) return;
    const isTeamMode = (room.gameMode === '2v2');
    const winningTeam = room.winningTeam;
    const winnersList = Array.isArray(room.winners) ? room.winners : [];

    const byBot = {};
    MatchMemory.matchTrace.forEach(item => {
      if (!byBot[item.botUid]) byBot[item.botUid] = [];
      byBot[item.botUid].push(item.qKey);
    });

    for (const botUid in byBot) {
      const p = room.players[botUid];
      if (!p) continue;
      let reward = -0.3;
      if (isTeamMode && winningTeam) {
        reward = (p.team === winningTeam) ? 1.0 : -0.8;
      } else {
        const wEntry = winnersList.find(w => w.uid === botUid);
        const place = (wEntry && wEntry.place) || p.finishPlace || 4;
        if (place === 1) reward = 1.0;
        else if (place === 2) reward = 0.25;
        else if (place === 3) reward = -0.4;
        else reward = -1.0;
      }
      updateQTableFromTrajectory(byBot[botUid], reward);
    }

    LearnedBrain.realMatchesPlayed++;
    LearnedBrain.generation++;
    MatchMemory.matchTrace = [];
    saveLearnedBrain();
  }

  // =========================================================================
  // 9. SIMULADOR DE ENTRENAMIENTO MASIVO BOT-VS-BOT (SELF-PLAY RL ENGINE)
  // =========================================================================
  function createSimDeck() {
    const deck = [];
    let idCounter = 1;
    for (let s = 0; s < CARD_SUITS.length; s++) {
      const suit = CARD_SUITS[s];
      for (let r = 0; r < CARD_RANKS.length; r++) {
        const rank = CARD_RANKS[r];
        deck.push({
          id: `sim_${idCounter++}`,
          rank,
          suit,
          value: CARD_VALUES[rank]
        });
      }
    }
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = deck[i];
      deck[i] = deck[j];
      deck[j] = tmp;
    }
    return deck;
  }

  function mutateWeights(baseWeights, scale) {
    const mutated = {};
    for (const k in baseWeights) {
      const delta = (Math.random() * 2 - 1) * scale * baseWeights[k];
      mutated[k] = Math.max(5, Math.round((baseWeights[k] + delta) * 10) / 10);
    }
    mutated.saveTenMinPile = Math.max(3, Math.min(7, Math.round(mutated.saveTenMinPile)));
    return mutated;
  }

  // Simula 1 partida completa de 4 bots (FFA o 2v2) con memoria de manos y aprendizaje por refuerzo
  function simulateSingleSelfPlayMatch(gameMode) {
    const savedMemory = {
      matchId: MatchMemory.matchId,
      knownHands: MatchMemory.knownHands,
      inferredCeiling: MatchMemory.inferredCeiling,
      burnedCards: MatchMemory.burnedCards,
      pickupHistory: MatchMemory.pickupHistory,
      matchTrace: MatchMemory.matchTrace
    };

    const deck = createSimDeck();
    const botIds = ['sim_bot_1', 'sim_bot_2', 'sim_bot_3', 'sim_bot_4'];
    const isTeamMode = (gameMode === '2v2');
    const simRoom = {
      matchId: `sim_${Date.now()}_${Math.random()}`,
      status: 'PLAYING',
      gameMode: isTeamMode ? '2v2' : 'FFA',
      turnOrder: botIds,
      activePlayerUid: botIds[Math.floor(Math.random() * 4)],
      pile: [],
      pileTop: null,
      isLowerRestriction: false,
      deckCount: 0,
      players: {},
      winners: []
    };

    const privateData = {};
    const botWeights = {};
    const botTrajectories = {};

    botIds.forEach((id, idx) => {
      const faceDown = [deck.pop(), deck.pop(), deck.pop()];
      const six = [deck.pop(), deck.pop(), deck.pop(), deck.pop(), deck.pop(), deck.pop()];
      const setup = chooseSetupCards(six, isTeamMode, `Bot ${idx + 1}`);
      const faceUp = setup ? setup.faceUp : six.slice(0, 3);
      const hand = setup ? setup.hand : six.slice(3, 6);

      simRoom.players[id] = {
        id,
        uid: id,
        name: `SimBot ${idx + 1}`,
        isAI: true,
        connected: true,
        faceUp: faceUp,
        handCount: hand.length,
        faceDownCount: faceDown.length,
        isFinished: false,
        finishPlace: null,
        team: isTeamMode ? (idx % 2 === 0 ? 'blue' : 'red') : null
      };
      privateData[id] = { hand, faceDown };
      // El bot 0 usa los pesos actuales; los bots 1..3 prueban mutaciones evolutivas
      botWeights[id] = (idx === 0) ? { ...LearnedBrain.weights } : mutateWeights(LearnedBrain.weights, 0.12);
      botTrajectories[id] = [];
    });

    simRoom.deckCount = deck.length;
    resetMatchMemory(simRoom);

    let turns = 0;
    const maxTurns = 260;

    while (turns < maxTurns) {
      turns++;
      const activeUnfinished = botIds.filter(id => !simRoom.players[id].isFinished);
      if (activeUnfinished.length <= 1) break;
      if (isTeamMode) {
        const blueDone = botIds.filter(id => simRoom.players[id].team === 'blue').every(id => simRoom.players[id].isFinished);
        const redDone = botIds.filter(id => simRoom.players[id].team === 'red').every(id => simRoom.players[id].isFinished);
        if (blueDone || redDone) break;
      }

      let actorId = simRoom.activePlayerUid;
      if (!actorId || simRoom.players[actorId].isFinished) {
        actorId = activeUnfinished[0];
        simRoom.activePlayerUid = actorId;
      }

      const player = simRoom.players[actorId];
      const priv = privateData[actorId];
      const W = botWeights[actorId];
      const pileTop = simRoom.pileTop;
      const isLower = simRoom.isLowerRestriction;

      let playedCards = null;

      // Fase 1: Mano
      if (priv.hand.length > 0) {
        const grouped = {};
        priv.hand.forEach(c => {
          if (!grouped[c.rank]) grouped[c.rank] = [];
          grouped[c.rank].push(c);
        });
        const legalGroups = Object.values(grouped).filter(g => canPlay(g[0], pileTop, isLower));

        if (legalGroups.length > 0) {
          const normalGroups = legalGroups.filter(g => g[0].rank !== '2' && g[0].rank !== '10');
          const hasNormalMoves = normalGroups.length > 0;
          const deckStats = getDeckStatistics(simRoom, priv.hand, actorId);
          const loopStatus = detectStalemateLoop(simRoom);

          let bestG = legalGroups[0];
          let maxU = -99999;
          for (let i = 0; i < legalGroups.length; i++) {
            const u = simulateCandidateMove(legalGroups[i], simRoom, actorId, priv.hand, deckStats, loopStatus, hasNormalMoves, W);
            if (u > maxU) {
              maxU = u;
              bestG = legalGroups[i];
            }
          }
          playedCards = bestG;

          // Registrar traza Q-Learning
          const tableIntel = analyzeThreeRemainingPlayers(simRoom, actorId);
          const nextSeat = tableIntel.nextSeat;
          const impact = evaluateKnownHandImpact(bestG[0].rank, bestG[0].value, nextSeat);
          const qKey = buildQStateKey(simRoom, bestG, nextSeat ? nextSeat.threatLevel : 0, tableIntel.maxOpponentThreat, impact.guaranteesPickup);
          botTrajectories[actorId].push(qKey);

          // Quitar de mano
          playedCards.forEach(pc => {
            const idx = priv.hand.findIndex(c => c.id === pc.id);
            if (idx !== -1) priv.hand.splice(idx, 1);
          });
          while (priv.hand.length < 3 && deck.length > 0) {
            priv.hand.push(deck.pop());
          }
          simRoom.deckCount = deck.length;
        }
      }
      // Fase 2: Boca arriba
      else if (player.faceUp.length > 0) {
        const legalUp = player.faceUp.filter(c => canPlay(c, pileTop, isLower));
        if (legalUp.length > 0) {
          const normalUp = legalUp.filter(c => c.rank !== '2' && c.rank !== '10');
          const hasNormalMoves = normalUp.length > 0;
          const deckStats = getDeckStatistics(simRoom, player.faceUp, actorId);
          const loopStatus = detectStalemateLoop(simRoom);

          let bestC = legalUp[0];
          let maxU = -99999;
          for (let i = 0; i < legalUp.length; i++) {
            const u = simulateCandidateMove([legalUp[i]], simRoom, actorId, player.faceUp, deckStats, loopStatus, hasNormalMoves, W);
            if (u > maxU) {
              maxU = u;
              bestC = legalUp[i];
            }
          }
          const matching = player.faceUp.filter(c => c.rank === bestC.rank);
          playedCards = matching.length > 1 ? matching : [bestC];

          const tableIntel = analyzeThreeRemainingPlayers(simRoom, actorId);
          const nextSeat = tableIntel.nextSeat;
          const impact = evaluateKnownHandImpact(bestC.rank, bestC.value, nextSeat);
          const qKey = buildQStateKey(simRoom, playedCards, nextSeat ? nextSeat.threatLevel : 0, tableIntel.maxOpponentThreat, impact.guaranteesPickup);
          botTrajectories[actorId].push(qKey);

          playedCards.forEach(pc => {
            const idx = player.faceUp.findIndex(c => c.id === pc.id);
            if (idx !== -1) player.faceUp.splice(idx, 1);
          });
        }
      }
      // Fase 3: Boca abajo (ciegas)
      else if (priv.faceDown.length > 0) {
        const rIdx = Math.floor(Math.random() * priv.faceDown.length);
        const blindCard = priv.faceDown.splice(rIdx, 1)[0];
        player.faceDownCount = priv.faceDown.length;
        if (canPlay(blindCard, pileTop, isLower)) {
          playedCards = [blindCard];
        } else {
          // Falló carta ciega: recoge pozo + carta fallida
          observePickup(actorId, simRoom.pile, blindCard, pileTop, isLower, simRoom, true);
          priv.hand.push(...simRoom.pile, blindCard);
          player.handCount = priv.hand.length;
          simRoom.pile = [];
          simRoom.pileTop = null;
          simRoom.isLowerRestriction = false;
          const nextP = getNextActivePlayer(simRoom, actorId);
          simRoom.activePlayerUid = nextP ? nextP.id : actorId;
          continue;
        }
      }

      // Si no pudo jugar en Fase 1 o 2 -> Recoge el pozo
      if (!playedCards) {
        observePickup(actorId, simRoom.pile, null, pileTop, isLower, simRoom, true);
        priv.hand.push(...simRoom.pile);
        player.handCount = priv.hand.length;
        simRoom.pile = [];
        simRoom.pileTop = null;
        simRoom.isLowerRestriction = false;
        const nextP = getNextActivePlayer(simRoom, actorId);
        simRoom.activePlayerUid = nextP ? nextP.id : actorId;
        continue;
      }

      // Ejecutó jugada válida
      player.handCount = priv.hand.length;
      player.faceDownCount = priv.faceDown.length;

      const first = playedCards[0];
      const pileBefore = simRoom.pile.slice();
      simRoom.pile.push(...playedCards);
      const consec = getConsecutiveTopCount(simRoom.pile);
      const isBurn = (first.rank === '10') || (consec.count >= 4);

      observePlay(actorId, playedCards, isBurn, pileBefore, simRoom, true);

      if (isBurn) {
        simRoom.pile = [];
        simRoom.pileTop = null;
        simRoom.isLowerRestriction = false;
      } else {
        simRoom.pileTop = first;
        simRoom.isLowerRestriction = (first.rank === '7');
      }

      // Verificar si el bot terminó sus cartas
      if (player.handCount === 0 && player.faceUp.length === 0 && player.faceDownCount === 0) {
        player.isFinished = true;
        const place = simRoom.winners.length + 1;
        player.finishPlace = place;
        simRoom.winners.push({ uid: actorId, place, team: player.team });
      }

      if (isBurn && !player.isFinished) {
        simRoom.activePlayerUid = actorId;
      } else {
        const nextP = getNextActivePlayer(simRoom, actorId);
        simRoom.activePlayerUid = nextP ? nextP.id : null;
      }
    }

    // Asignar lugares finales a los que quedaron con cartas
    const remainingBots = botIds
      .filter(id => !simRoom.players[id].isFinished)
      .sort((a, b) => {
        const ca = simRoom.players[a].handCount + simRoom.players[a].faceUp.length + simRoom.players[a].faceDownCount;
        const cb = simRoom.players[b].handCount + simRoom.players[b].faceUp.length + simRoom.players[b].faceDownCount;
        return ca - cb;
      });

    remainingBots.forEach(id => {
      const place = simRoom.winners.length + 1;
      simRoom.players[id].finishPlace = place;
      simRoom.winners.push({ uid: id, place, team: simRoom.players[id].team });
    });

    // Actualizar Q-Table y evolucionar los pesos hacia el bot campeón (1er lugar)
    const rewardsByPlace = { 1: 1.0, 2: 0.25, 3: -0.4, 4: -1.0 };
    let winnerId = null;

    simRoom.winners.forEach(w => {
      if (w.place === 1) winnerId = w.uid;
      const r = rewardsByPlace[w.place] !== undefined ? rewardsByPlace[w.place] : -0.5;
      updateQTableFromTrajectory(botTrajectories[w.uid], r);
    });

    if (winnerId && winnerId !== 'sim_bot_1') {
      const winW = botWeights[winnerId];
      const lr = 0.05;
      for (const k in LearnedBrain.weights) {
        LearnedBrain.weights[k] = Math.round((LearnedBrain.weights[k] * (1 - lr) + winW[k] * lr) * 10) / 10;
      }
      LearnedBrain.weights.saveTenMinPile = Math.round(LearnedBrain.weights.saveTenMinPile);
    }

    LearnedBrain.gamesSimulated++;
    LearnedBrain.generation++;

    // Restaurar la memoria de la partida en curso del usuario
    MatchMemory.matchId = savedMemory.matchId;
    MatchMemory.knownHands = savedMemory.knownHands;
    MatchMemory.inferredCeiling = savedMemory.inferredCeiling;
    MatchMemory.burnedCards = savedMemory.burnedCards;
    MatchMemory.pickupHistory = savedMemory.pickupHistory;
    MatchMemory.matchTrace = savedMemory.matchTrace;

    return { turns, winnerId };
  }

  // Entrena `numGames` partidas completas entre los 4 bots y guarda el aprendizaje en localStorage
  function trainSelfPlay(numGames = 500, silent = false) {
    const count = Math.max(1, Math.min(10000, parseInt(numGames, 10) || 500));
    const startTime = Date.now();
    let totalTurns = 0;

    for (let i = 0; i < count; i++) {
      const mode = (i % 3 === 0) ? '2v2' : 'FFA';
      const res = simulateSingleSelfPlayMatch(mode);
      totalTurns += res.turns;
    }

    saveLearnedBrain();
    const elapsedMs = Date.now() - startTime;
    const statesCount = Object.keys(LearnedBrain.qTable).length;

    if (!silent && typeof console !== 'undefined') {
      console.log(
        `🏆 [Entrenamiento IA Completado] +${count} partidas simuladas (${totalTurns.toLocaleString()} jugadas en ${elapsedMs}ms).\n` +
        `📊 Total acumulado: ${LearnedBrain.gamesSimulated.toLocaleString()} partidas | ${LearnedBrain.totalMovesLearned.toLocaleString()} decisiones aprendidas | ${statesCount} estados tácticos en Q-Table.`
      );
    }

    return {
      gamesAdded: count,
      movesAdded: totalTurns,
      elapsedMs,
      totalGamesLearned: LearnedBrain.gamesSimulated,
      totalMovesLearned: LearnedBrain.totalMovesLearned,
      qStatesCount: statesCount,
      learnedWeights: { ...LearnedBrain.weights }
    };
  }

  // Entrenamiento automático en segundo plano al cargar si aún tiene pocas partidas aprendidas
  function scheduleInitialSelfPlayTraining() {
    loadLearnedBrain();
    const targetInitialGames = 1500; // ~80,000+ jugadas entre bots
    if (LearnedBrain.gamesSimulated >= targetInitialGames) {
      if (typeof console !== 'undefined') {
        console.log(
          `🧠 [Cerebro IA Cargado] ${LearnedBrain.gamesSimulated.toLocaleString()} partidas aprendidas (${LearnedBrain.totalMovesLearned.toLocaleString()} jugadas en memoria).`
        );
      }
      return;
    }

    const batchSize = 250;
    function runNextBatch() {
      if (LearnedBrain.gamesSimulated >= targetInitialGames) {
        if (typeof console !== 'undefined') {
          console.log(
            `🎓 [Auto-Entrenamiento IA Listo] ${LearnedBrain.gamesSimulated.toLocaleString()} partidas entre bots completadas (${LearnedBrain.totalMovesLearned.toLocaleString()} jugadas aprendidas).`
          );
        }
        return;
      }
      const remaining = targetInitialGames - LearnedBrain.gamesSimulated;
      trainSelfPlay(Math.min(batchSize, remaining), true);
      if (typeof setTimeout === 'function') {
        setTimeout(runNextBatch, 25);
      }
    }

    if (typeof setTimeout === 'function') {
      setTimeout(runNextBatch, 60);
    } else {
      trainSelfPlay(targetInitialGames, true);
    }
  }

  function getBrainStats() {
    return {
      gamesSimulated: LearnedBrain.gamesSimulated,
      realMatchesPlayed: LearnedBrain.realMatchesPlayed,
      totalMovesLearned: LearnedBrain.totalMovesLearned,
      generation: LearnedBrain.generation,
      qStatesLearned: Object.keys(LearnedBrain.qTable).length,
      weights: { ...LearnedBrain.weights },
      humanProfile: { ...LearnedBrain.humanProfile },
      liveMatchMemory: {
        matchId: MatchMemory.matchId,
        knownHands: MatchMemory.knownHands,
        inferredCeiling: MatchMemory.inferredCeiling,
        burnedCardsCount: MatchMemory.burnedCards.length,
        recentPickups: MatchMemory.pickupHistory.slice(-5)
      }
    };
  }

  // Inicializar cerebro y lanzar entrenamiento masivo entre bots en segundo plano
  scheduleInitialSelfPlayTraining();

  // --- API GLOBAL EXPUESTA ---
  const GuerraBotAI = {
    version: '5.0.0-SelfLearning-3PlayerMemory-DeepSeek',
    chooseSetupCards,
    chooseHandPlay,
    chooseFaceUpPlay,
    chooseHandPlayAsync,
    chooseFaceUpPlayAsync,
    observePickup,
    observePlay,
    observeMatchEnd,
    resetMatchMemory,
    analyzeThreeRemainingPlayers,
    trainSelfPlay,
    getBrainStats,
    configureLLM,
    getLLMStats,
    getBotProfile,
    canPlay,
    recordTableEvent,
    detectStalemateLoop,
    getDeckStatistics
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = GuerraBotAI;
  } else {
    global.GuerraBotAI = GuerraBotAI;
  }

})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : self));
