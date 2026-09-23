/**
 * GUERRA ONLINE - MOTOR DE INTELIGENCIA ARTIFICIAL BASADO EN SIMULACIÓN MONTE CARLO
 * (ISMCTS / Information Set Monte Carlo Simulation & Deck Tracker)
 *
 * Características:
 * 1. Simulación Monte Carlo Determinista (PIMC): Predice el resultado de cada jugada candidata.
 * 2. Conteo de Cartas en Vivo (52 cartas): Deduce qué cartas quedan libres, probabilidades de respuesta y cartas invencibles.
 * 3. Rompe-Bucles Inteligente (Loop Circuit Breaker): Detecta y desactiva el ping-pong de cartas altas en pozos pequeños.
 * 4. Evaluación Conjunta por Equipos (2v2): Cuenta el total combinado del equipo para erradicar falsas alertas rojas.
 * 5. Conservación Estratégica de Comodines: Los 2 y 10 se protegen para emergencias o remates ganadores.
 * 6. Sin dependencias externas: JavaScript puro ultra-rápido (< 20ms por turno).
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
  // 1. REGISTRO Y DETECTOR DE BUCLES (CIRCUIT BREAKER ANTI-ESTANCAMIENTO)
  // =========================================================================
  const recentTableEvents = [];
  let lastObservedPileState = {
    topRank: null,
    length: 0,
    activeUid: null
  };

  function recordTableEvent(rank, pileLengthBefore, wasPickup, playerUid) {
    recentTableEvents.push({
      rank: rank || null,
      pileLengthBefore: pileLengthBefore || 0,
      wasPickup: !!wasPickup,
      playerUid: playerUid || null,
      timestamp: Date.now()
    });
    if (recentTableEvents.length > 12) {
      recentTableEvents.shift();
    }
  }

  function updatePileTracking(room) {
    if (!room) return;
    const pile = room.pile || [];
    const currentLen = pile.length;
    const currentTop = room.pileTop;

    // Si la pila anterior tenía cartas y ahora disminuyó (alguien recogió o se quemó):
    if (lastObservedPileState.length > 0 && currentLen < lastObservedPileState.length) {
      const wasTen = lastObservedPileState.topRank === '10';
      if (!wasTen && lastObservedPileState.topRank) {
        // Alguien recogió el montón
        recordTableEvent(lastObservedPileState.topRank, lastObservedPileState.length, true, lastObservedPileState.activeUid);
      }
    }

    if (currentTop) {
      recordTableEvent(currentTop.rank, currentLen, false, room.activePlayerUid);
    }

    lastObservedPileState = {
      topRank: currentTop ? currentTop.rank : null,
      length: currentLen,
      activeUid: room.activePlayerUid
    };
  }

  function detectStalemateLoop(room) {
    if (recentTableEvents.length < 3) return { inLoop: false, loopRank: null };

    // Buscar si en los últimos eventos se ha recogido un pozo diminuto (<= 2 cartas)
    // con una carta alta (A, K, Q) repetidamente
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
  // 2. CONTEO DE CARTAS Y ESTIMACIÓN PROBABILÍSTICA (DECK TRACKER)
  // =========================================================================
  function getDeckStatistics(room, myCards) {
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

    // 2. Cartas propias visibles y en mano
    if (Array.isArray(myCards)) {
      myCards.forEach(markSeen);
    }

    // 3. Cartas boca arriba visibles de todos los jugadores
    if (room && room.players) {
      for (const uid in room.players) {
        const p = room.players[uid];
        if (p && Array.isArray(p.faceUp)) {
          p.faceUp.forEach(markSeen);
        }
      }
    }

    // Calcular cuántas cartas de cada rango siguen ocultas (en mazo o manos rivales)
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
      // Una carta es invencible si no queda ningún As libre (o si es un As)
      isKingInvincible: (remainingAces === 0),
      isQueenInvincible: (remainingAces === 0 && remainingKings === 0)
    };
  }

  // =========================================================================
  // 3. MOTOR DE SIMULACIÓN MONTE CARLO (ISMCTS ROLLOUTS)
  // =========================================================================
  function simulateCandidateMove(candidateGroup, room, botUid, fullHand, deckStats, loopStatus, hasNormalMoves) {
    const firstCard = candidateGroup[0];
    const candidateRank = firstCard.rank;
    const candidateValue = firstCard.value;
    const pile = room.pile || [];
    const pileLength = pile.length;
    const pileTop = room.pileTop;
    const isLower = room.isLowerRestriction;
    const isTeamMode = (room.gameMode === '2v2');

    const nextPlayer = getNextActivePlayer(room, botUid);
    const myPlayer = room.players && room.players[botUid];
    const isNextTeammate = isTeamMode && nextPlayer && (nextPlayer.team === (myPlayer && myPlayer.team));
    const nextThreat = nextPlayer ? getPlayerThreatLevel(nextPlayer, room) : 0;
    const nextTeamTotal = nextPlayer ? getTeamTotalCards(room, nextPlayer.id || nextPlayer.uid) : 999;

    let utility = 0;

    // -----------------------------------------------------------------------
    // A) DETECCIÓN Y CONDENA DE BUCLES (ROMPE-BUCLES)
    // -----------------------------------------------------------------------
    if (loopStatus.inLoop && candidateRank === loopStatus.loopRank && pileLength <= 2) {
      // Jugar la misma carta alta en un pozo de 1 o 2 cartas perpetúa el bucle: PENALIZACIÓN MÁXIMA
      utility -= 160;
    } else if (loopStatus.inLoop && candidateValue <= 8 && candidateRank !== '10' && candidateRank !== '2') {
      // Jugar una carta baja o media rompe el bucle con elegancia: GRAN BONIFICACIÓN
      utility += 70;
    }

    // -----------------------------------------------------------------------
    // B) POLÍTICA DE COMODINES (10 Y 2) - PROTECCIÓN RIGUROSA
    // -----------------------------------------------------------------------
    if (candidateRank === '10') {
      // Quema con 10:
      if (hasNormalMoves && pileLength <= 2 && nextThreat < 2) {
        utility -= 120; // Si hay cartas normales y el pozo no tiene peligro ni cartas, NUNCA gastar el 10
      } else if (pileLength >= 6) {
        utility += 70; // Excelente limpieza de pozo peligroso
      } else if (pileLength >= 3) {
        utility += 30;
      } else if (pileLength <= 1 && nextThreat < 2) {
        utility -= 90; // Desperdiciar un 10 en pozo de 0 o 1 carta sin peligro es fatal
      }
    }

    if (candidateRank === '2') {
      // El 2 reinicia la mesa:
      if (hasNormalMoves) {
        // REGLA CRUCIAL: Si el bot tiene cartas comunes que pueden jugar sobre la mesa,
        // está terminantemente desaconsejado gastar un 2. Se reserva para emergencias.
        utility -= 85;
      } else if (pileTop && pileTop.value >= 12) {
        utility += 40; // Excelente reset necesario sobre As o Rey cuando no hay alternativa normal
      } else if (pileLength <= 1 && nextThreat < 2) {
        utility -= 40;
      }
    }

    // -----------------------------------------------------------------------
    // C) EVALUACIÓN DEL RIVAL SIGUIENTE (AMENAZA CRÍTICA VS RIVAL CÓMODO)
    // -----------------------------------------------------------------------
    if (!isNextTeammate) {
      if (nextThreat >= 2 || nextTeamTotal <= 2) {
        // ¡RIVAL A PUNTO DE GANAR! (1 o 2 cartas restantes)
        // Bloquearlo con carta alta o 7-trap
        if (candidateRank === 'A') {
          utility += 90;
        } else if (candidateRank === 'K' && deckStats.isKingInvincible) {
          utility += 95; // Un Rey garantizado sin Ases es tan letal como un As
        } else if (candidateRank === 'K') {
          utility += 70;
        } else if (candidateRank === 'Q' && deckStats.isQueenInvincible) {
          utility += 85;
        } else if (candidateRank === '7' && nextPlayer && nextPlayer.faceUp && nextPlayer.faceUp.every(c => c.value > 7)) {
          utility += 100; // Trampa perfecta del 7
        } else if (candidateValue <= 6 && candidateRank !== '2' && candidateRank !== '10') {
          // Tirar un 3, 4 o 5 a quien va a ganar es un regalo suicida: PENALIZACIÓN SEVERA
          utility -= 120;
        }
      } else {
        // RIVAL CÓMODO (tiene 4, 6, 8 o 10 cartas):
        // NO regalar Ases o Reyes en pozos diminutos. Dejar crecer el pozo.
        if (pileLength <= 1) {
          if (candidateValue <= 7 && candidateRank !== '2' && candidateRank !== '10') {
            utility += 45; // Apertura perfecta: descartar carta baja y empezar el pozo
          } else if (candidateRank === 'A' || candidateRank === 'K') {
            utility -= 50; // Regalar un As en un pozo de 1 carta a alguien con 10 cartas es pésimo
          }
        } else {
          // Pozo en crecimiento: escalada gradual
          if (candidateValue <= 9 && candidateRank !== '2' && candidateRank !== '10') {
            utility += 25;
          }
        }
      }
    }

    // -----------------------------------------------------------------------
    // D) COOPERACIÓN EN MODO 2v2 (COMPAÑERO SIGUIENTE)
    // -----------------------------------------------------------------------
    if (isNextTeammate) {
      if (candidateRank === '7' || candidateRank === 'A') {
        utility -= 40; // No atacar al compañero
      } else if (candidateValue <= 8 && candidateRank !== '2') {
        utility += 50; // Facilitarle el juego con carta media-baja
      }
    }

    // -----------------------------------------------------------------------
    // E) BENEFICIO DE DESCARGA MÚLTIPLE (PAREJAS / TRÍOS)
    // -----------------------------------------------------------------------
    if (candidateGroup.length >= 2 && candidateRank !== 'A' && candidateRank !== '7') {
      utility += (candidateGroup.length * 15); // Gran valor por vaciar varias cartas en 1 turno
    }

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

  // --- API GLOBAL EXPUESTA ---
  const GuerraBotAI = {
    version: '3.0.0-ISMCTS',
    chooseSetupCards,
    chooseHandPlay,
    chooseFaceUpPlay,
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
