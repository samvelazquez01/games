/**
 * GUERRA ONLINE - MÓDULO DE INTELIGENCIA ARTIFICIAL AVANZADA PARA BOTS
 * (Guerra / Palace / Shithead)
 *
 * Módulo independiente que gestiona:
 * 1. Preparación táctica de mesa (Setup balanceado mano/mesa).
 * 2. Caza y ejecución de quemas por 4-of-a-kind consecutivas.
 * 3. Gestión inteligente de cartas múltiples (no despilfarrar 2 Ases o 2 Sietes juntos).
 * 4. Protocolo Anti-Victoria (Alerta Roja): no regalar victorias con cartas bajas.
 * 5. Castigo a cartas boca abajo (Fase 3 a ciegas con Ases y Sietes).
 * 6. Bloqueo quirúrgico (Choke) leyendo las cartas visibles del rival.
 * 7. Finisher: Remate en cadena con 10 + turno extra.
 * 8. Cooperación 2 vs 2: Protección y cero fuego amigo contra compañeros.
 * 9. Personalidades diferenciadas: Bot Alfa (Agresivo), Bot Beta (Controlador), Bot Gamma (Calculador).
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
        saveFriend: ['¡Te cubro la espalda! 🛡️', '¡Mesa despejada, socio! 🤝']
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
        saveFriend: ['Despejando el camino para ti 🔵', 'Toma un turno fácil compañero 👍']
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
        saveFriend: ['Optimizando probabilidad del equipo 🛡️', 'Compañero seguro 🤝']
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

  // --- REGLAS BÁSICAS DE JUEGO ---
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

  // Cuenta cuántas cartas consecutivas del mismo rango hay en la cima del montón
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

  // Evalúa el nivel de amenaza de un jugador (0 = normal, 1 = moderada, 2 = alta, 3 = crítica)
  // CRÍTICA (3) = 1 sola carta restante (a punto de ganar en su próximo turno).
  // ALTA (2) = 2 cartas restantes o en fase ciega/última carta boca arriba.
  function getPlayerThreatLevel(player) {
    if (!player || player.isFinished) return 0;
    const handCount = player.handCount !== undefined ? player.handCount : ((player.hand && player.hand.length) || 0);
    const faceUpCount = (player.faceUp && player.faceUp.length) !== undefined
      ? player.faceUp.length
      : (player.faceUpCount || 0);
    const faceDownCount = player.faceDownCount || (player.faceDown && player.faceDown.length) || 0;
    const total = handCount + faceUpCount + faceDownCount;

    if (total <= 1) return 3; // CRÍTICA: Puede ganar en su próximo turno
    if (total <= 2) return 2; // ALTA AMENAZA: Le quedan 2 cartas
    if (handCount === 0 && faceUpCount <= 1) return 2; // ALTA: Última carta boca arriba
    if (handCount === 0 && faceUpCount === 0 && faceDownCount > 0) return 2; // A ciegas
    if (total <= 3) return 1; // MODERADA
    return 0;
  }

  // Encuentra al jugador con menos cartas restantes en toda la mesa (el líder a batir)
  // IMPORTANTE: Solo devuelve líder si ese jugador representa una amenaza real (<= 3 cartas o sin mano).
  function findTableThreatLeader(room, myUid, myTeam) {
    if (!room || !room.players) return null;
    const turnOrder = getTurnOrderArray(room);
    let minCards = 999;
    let leader = null;

    turnOrder.forEach(uid => {
      if (uid === myUid) return;
      const p = room.players[uid];
      if (!p || p.isFinished || p.isAbandoned || p.connected === false) return;
      if (myTeam && p.team === myTeam) return; // En 2v2 no es amenaza

      const handCount = p.handCount !== undefined ? p.handCount : ((p.hand && p.hand.length) || 0);
      const faceUpCount = (p.faceUp && playerFaceUpLen(p)) || 0;
      const faceDownCount = p.faceDownCount || (p.faceDown && p.faceDown.length) || 0;
      const total = handCount + faceUpCount + faceDownCount;

      const isRealThreat = (total <= 3) || (handCount === 0);

      if (isRealThreat && total < minCards) {
        minCards = total;
        leader = {
          uid,
          player: p,
          totalCards: total,
          threatLevel: getPlayerThreatLevel(p),
          isFaceDownPhase: (handCount === 0 && faceUpCount === 0 && faceDownCount > 0),
          isFaceUpPhase: (handCount === 0 && faceUpCount > 0)
        };
      }
    });

    return leader;
  }

  function playerFaceUpLen(p) {
    if (!p) return 0;
    if (Array.isArray(p.faceUp)) return p.faceUp.length;
    if (p.faceUpCount !== undefined) return p.faceUpCount;
    return 0;
  }

  // Calcula cuántos turnos faltan para que le toque a un jugador determinado
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

  // Emite un mensaje de chat o burbuja de voz del bot de forma segura si la API existe
  function sayBotQuote(botUid, botName, category) {
    try {
      const profile = getBotProfile(botName);
      const lines = profile.chatLines[category];
      if (!lines || lines.length === 0) return;
      const text = lines[Math.floor(Math.random() * lines.length)];

      if (global.GuerraGame && global.GuerraGame.chat && typeof global.GuerraGame.chat.showSeatSpeechBubble === 'function') {
        global.GuerraGame.chat.showSeatSpeechBubble(botUid, text, true);
      }
    } catch (e) {
      // Ignorar fallos de UI de chat
    }
  }

  // =========================================================================
  // 1. SETUP TÁCTICO INICIAL (Preparación de las 3 cartas boca arriba y 3 de mano)
  // =========================================================================
  function chooseSetupCards(sixCards, isTeamMode, botName) {
    if (!Array.isArray(sixCards) || sixCards.length !== 6) {
      return null;
    }

    const cards = [...sixCards];
    const profile = getBotProfile(botName);

    // Separar cartas especiales y normales
    const tens = cards.filter(c => c.rank === '10');
    const twos = cards.filter(c => c.rank === '2');
    const aces = cards.filter(c => c.rank === 'A');

    // Agrupar por rango para detectar parejas/tríos
    const byRank = {};
    cards.forEach(c => {
      if (!byRank[c.rank]) byRank[c.rank] = [];
      byRank[c.rank].push(c);
    });

    const faceUpCandidates = [];
    const handCandidates = [];

    // Calcular la fuerza media de las 6 cartas
    const normalCards = cards.filter(c => c.rank !== '2' && c.rank !== '10');
    const avgNormalValue = normalCards.length > 0
      ? normalCards.reduce((acc, c) => acc + c.value, 0) / normalCards.length
      : 7;
    const isVeryWeakHand = avgNormalValue < 6.5 && (tens.length + twos.length <= 1);

    // REGLA DE ORO DE ESCAPE:
    // Si tenemos comodines (10 o 2), reservamos AL MENOS UNO en la mano privada
    // para sobrevivir a las trampas de cartas altas durante la fase del mazo central.
    let specialForHand = null;
    if (tens.length > 0) {
      specialForHand = tens[0];
    } else if (twos.length > 0) {
      specialForHand = twos[0];
    }

    if (specialForHand) {
      handCandidates.push(specialForHand);
      const sIdx = cards.findIndex(c => c.id === specialForHand.id);
      if (sIdx !== -1) cards.splice(sIdx, 1);
    }

    // Poner parejas de cartas altas o medias en la mesa boca arriba (barrido en 1 turno final)
    const pairsAndTriplets = Object.values(byRank)
      .filter(grp => grp.length >= 2 && grp[0].rank !== '2' && grp[0].rank !== '10')
      .sort((a, b) => b[0].value - a[0].value);

    for (const group of pairsAndTriplets) {
      const availableInCards = group.filter(gc => cards.some(c => c.id === gc.id));
      // Si la mano es muy débil y la pareja es baja (ej. dos 4s), preferimos conservarla en mano para salir rápido
      const keepPairInHand = isVeryWeakHand && availableInCards[0].value <= 5;
      if (!keepPairInHand && availableInCards.length >= 2 && faceUpCandidates.length + 2 <= 3) {
        availableInCards.forEach(c => {
          if (faceUpCandidates.length < 3) {
            faceUpCandidates.push(c);
            const idx = cards.findIndex(cd => cd.id === c.id);
            if (idx !== -1) cards.splice(idx, 1);
          }
        });
      }
    }

    // EL ARMA DE DOBLE FILO DE CARTAS MALAS EN MESA:
    // Si la mano es en general muy mala (puras cartas bajas), dejar una carta media-baja en la mesa
    // SOLO SI tenemos una carta especial (10 o 2) en la mesa que sirva de salvavidas posterior.
    // De lo contrario, priorizar cartas altas (A, K, Q, J) en la mesa para no atascarse en Fase 2.
    cards.sort((a, b) => {
      const scoreA = a.rank === '2' ? 18 : (a.rank === '10' ? 19 : a.value);
      const scoreB = b.rank === '2' ? 18 : (b.rank === '10' ? 19 : b.value);
      return scoreB - scoreA;
    });

    // Si la mano es muy mala y no tenemos más comodines, dejamos 1 carta media en mano como seguro
    if (isVeryWeakHand && cards.length >= 2 && faceUpCandidates.length < 2) {
      // Tomamos la carta más alta disponible para la mesa
      faceUpCandidates.push(cards.shift());
      // Guardamos la siguiente mejor en la mano para no quedar indefensos en mano
      handCandidates.push(cards.shift());
    }

    while (faceUpCandidates.length < 3 && cards.length > 0) {
      faceUpCandidates.push(cards.shift());
    }

    // Todo lo restante va a la mano
    while (cards.length > 0) {
      handCandidates.push(cards.shift());
    }

    // Ordenar mano de menor a mayor
    handCandidates.sort((a, b) => a.value - b.value);

    return {
      faceUp: faceUpCandidates,
      hand: handCandidates
    };
  }

  // =========================================================================
  // 2. TOMA DE DECISIÓN INTELIGENTE DESDE LA MANO
  // =========================================================================
  function chooseHandPlay(legalGroups, room, botUid, fullHand) {
    if (!legalGroups || legalGroups.length === 0) return null;
    if (legalGroups.length === 1 && legalGroups[0].length === 1) return legalGroups[0];

    const myPlayer = room.players && room.players[botUid];
    const botName = myPlayer ? myPlayer.name : 'Bot';
    const profile = getBotProfile(botName);

    const isTeamMode = (room.gameMode === '2v2');
    const nextPlayer = getNextActivePlayer(room, botUid);
    const isNextTeammate = isTeamMode && nextPlayer && (nextPlayer.team === (myPlayer && myPlayer.team));
    const nextThreat = nextPlayer ? getPlayerThreatLevel(nextPlayer) : 0;

    const pile = room.pile || [];
    const pileTop = room.pileTop;
    const pileLength = pile.length;
    const isDeckEmpty = (room.deckCount || 0) === 0;

    const tenGroup = legalGroups.find(g => g[0].rank === '10');
    const twoGroup = legalGroups.find(g => g[0].rank === '2');
    const sevenGroup = legalGroups.find(g => g[0].rank === '7');
    const normalPlayable = legalGroups.filter(g => g[0].rank !== '2' && g[0].rank !== '10');

    // -----------------------------------------------------------------------
    // PRIORIDAD 0: REMATE GANADOR (FINISHER CON 10 + TURNO EXTRA)
    // -----------------------------------------------------------------------
    // Si al bot le quedan exactamente 2 cartas (un 10 y cualquier otra carta)
    // o si el mazo está vacío y jugar el 10 le garantiza rematar en el turno extra:
    const totalCardsLeft = (fullHand ? fullHand.length : 3) +
      ((myPlayer && myPlayer.faceUp && myPlayer.faceUp.length) || 0) +
      ((myPlayer && myPlayer.faceDownCount) || 0);

    if (totalCardsLeft === 2 && tenGroup) {
      sayBotQuote(botUid, botName, 'burn');
      return [tenGroup[0]];
    }

    // -----------------------------------------------------------------------
    // PRIORIDAD 1: CAZA DE 4-OF-A-KIND (QUEMA POR 4 IGUALES EN EL MONTÓN)
    // -----------------------------------------------------------------------
    const topConsecutive = getConsecutiveTopCount(pile);
    if (topConsecutive.count > 0 && topConsecutive.count < 4) {
      const needed = 4 - topConsecutive.count;
      const matchingGroup = legalGroups.find(g => g[0].rank === topConsecutive.rank);
      if (matchingGroup && matchingGroup.length >= needed) {
        sayBotQuote(botUid, botName, 'fourKind');
        // Jugar exactamente la cantidad necesaria para completar las 4
        return matchingGroup.slice(0, needed);
      }
    }

    // Si el bot tiene 4 cartas iguales en mano de cualquier rango legal: ¡QUEMA INMEDIATA!
    const fourInHand = legalGroups.find(g => g.length >= 4);
    if (fourInHand) {
      sayBotQuote(botUid, botName, 'fourKind');
      return fourInHand.slice(0, 4);
    }

    // -----------------------------------------------------------------------
    // PRIORIDAD 2: COOPERACIÓN EN MODO POR EQUIPOS 2v2 (CERO FUEGO AMIGO)
    // -----------------------------------------------------------------------
    if (isNextTeammate) {
      const friendlyGroups = legalGroups.filter(g => g[0].rank !== '7' && g[0].rank !== 'A' && g[0].rank !== '10' && g[0].rank !== '2');
      if (friendlyGroups.length > 0) {
        friendlyGroups.sort((a, b) => a[0].value - b[0].value);
        return [friendlyGroups[0][0]];
      }

      if (twoGroup) {
        sayBotQuote(botUid, botName, 'saveFriend');
        return [twoGroup[0]];
      }

      if (pileLength >= 8 && tenGroup && normalPlayable.length === 0) {
        sayBotQuote(botUid, botName, 'saveFriend');
        return [tenGroup[0]];
      }
    }

    // =======================================================================
    // REGLA SUPREMA DE PROTECCIÓN DEL 10:
    // "Los 10 son la mejor carta del juego y hay que protegerlos para ocasiones
    // especiales. En cualquier ocasión que otra carta pueda jugar, se juega la otra carta."
    // - Arriba de un 2 juega cualquiera: ¡NUNCA tirar un 10!
    // - Si tiran un 3 o un 7: si el bot tiene cartas normales jugables, ¡NUNCA tirar un 10!
    // - Si no hay normales pero hay un 2: ¡EL 2 SE JUEGA PRIMERO! El 2 reinicia y salva el 10.
    // - Aunque hayan 20 cartas en el montón: si hay jugada normal o 2, ¡NUNCA tirar el 10!
    // =======================================================================

    // -----------------------------------------------------------------------
    // CASO 1: HAY CARTAS NORMALES JUGABLES (normalPlayable.length > 0)
    // EL 10 Y EL 2 ESTÁN ESTRICTAMENTE PROHIBIDOS. SE DEBE JUGAR CARTA NORMAL.
    // -----------------------------------------------------------------------
    if (normalPlayable.length > 0) {
      // 1.1 Evaluar si un rival representa una amenaza (<= 2 cartas o en fase boca abajo)
      const leaderInfo = findTableThreatLeader(room, botUid, myPlayer && myPlayer.team);
      const distToLeader = leaderInfo ? getTurnDistance(room, botUid, leaderInfo.uid) : 999;
      const isLeaderCritical = leaderInfo && (leaderInfo.totalCards <= 2 || leaderInfo.isFaceDownPhase);

      // CASO A: EL LÍDER ES EL SIGUIENTE INMEDIATO (distToLeader === 1 Y crítico, o nextThreat >= 2)
      // ¡ALERTA ROJA! El siguiente jugador está a 1 o 2 cartas de ganar la partida.
      // PROHIBIDO TIRAR CARTAS BAJAS (3, 4, 5, etc.). Bloquear con la carta normal más alta (As, Rey) o 7.
      const isDirectThreat = !isNextTeammate && ((leaderInfo && distToLeader === 1 && isLeaderCritical) || nextThreat >= 2);
      if (isDirectThreat) {
        // Trampa del 7: Si el rival está en cartas boca arriba y todas son > 7, el 7 lo destruye
        const oppFaceUp = (nextPlayer && nextPlayer.faceUp) || [];
        if (nextPlayer && nextPlayer.handCount === 0 && oppFaceUp.length > 0) {
          const oppHasNoLow = oppFaceUp.every(c => c.value > 7 && c.rank !== '2' && c.rank !== '10');
          if (sevenGroup && oppHasNoLow) {
            sayBotQuote(botUid, botName, 'seven');
            return [sevenGroup[0]];
          }
        }

        // Si el rival está en fase ciega a ciegas (boca abajo) y tenemos un 7: el 7 restringe a <= 7
        if (nextPlayer && nextPlayer.handCount === 0 && (!nextPlayer.faceUp || nextPlayer.faceUp.length === 0) && sevenGroup) {
          sayBotQuote(botUid, botName, 'seven');
          return [sevenGroup[0]];
        }

        // BLOQUEO MÁXIMO CON LA CARTA NORMAL MÁS ALTA DISPONIBLE (As, Rey, Dama, etc.)
        // Jamás regalar una carta baja como un 4 a quien está a 1 carta de ganar.
        const sortedDesc = [...normalPlayable].sort((a, b) => b[0].value - a[0].value);
        sayBotQuote(botUid, botName, 'choke');
        return [sortedDesc[0][0]];
      }

      // CASO B: EL LÍDER ESTÁ A 2 O MÁS TURNOS (distToLeader >= 2)
      // JUGAR SUAVE al intermediario para que la ronda fluya y no regalarle el turno al puntero
      if (!isNextTeammate && distToLeader >= 2 && leaderInfo && isLeaderCritical) {
        const midBridge = normalPlayable.filter(g => g[0].rank !== '7' && g[0].rank !== 'A');
        if (midBridge.length > 0) {
          midBridge.sort((a, b) => a[0].value - b[0].value);
          return [midBridge[0][0]];
        }
      }

      // CASO C: SI EL PLATO ESTÁ VACÍO (pileLength === 0) O ENCIMA DE UN 2
      // (Solo cuando NO hay amenaza directa del siguiente jugador)
      // Apertura suave estándar: jugar la carta más baja posible
      if (pileLength === 0 || (pileTop && pileTop.rank === '2')) {
        normalPlayable.sort((a, b) => a[0].value - b[0].value);
        const lowCards = normalPlayable.filter(g => g[0].value <= 10);
        if (lowCards.length > 0) {
          lowCards.sort((a, b) => a[0].value - b[0].value);
          return lowCards[0];
        }
        return [normalPlayable[0][0]];
      }

      // CASO D: Gestión de múltiples normales (parejas/tríos de 3s, 4s, 5s, 6s, 8s, 9s, Js)
      const multiGroups = normalPlayable.filter(g => g.length > 1 && g[0].rank !== 'A' && g[0].rank !== '7');
      if (multiGroups.length > 0) {
        multiGroups.sort((a, b) => (b.length - a.length) || (a[0].value - b[0].value));
        return multiGroups[0];
      }

      // Si tenemos dos Ases o dos Sietes: jugar solo 1 para no quemar munición doble
      const aceMulti = normalPlayable.find(g => g[0].rank === 'A' && g.length > 1);
      if (aceMulti && !isDeckEmpty) {
        return [aceMulti[0]];
      }
      const sevenMulti = normalPlayable.find(g => g[0].rank === '7' && g.length > 1);
      if (sevenMulti && !isDeckEmpty) {
        return [sevenMulti[0]];
      }

      // CASO E: Escalada suave estándar: la carta normal más baja posible que supere el montón
      normalPlayable.sort((a, b) => a[0].value - b[0].value);
      return normalPlayable[0];
    }

    // -----------------------------------------------------------------------
    // CASO 2: NO HAY CARTAS NORMALES JUGABLES (normalPlayable.length === 0)
    // -----------------------------------------------------------------------
    // Si el siguiente jugador está a 1 o 2 cartas de ganar y tenemos un 10:
    // ¡QUEMAR CON EL 10! Jugar un 2 le daría la mesa libre para ganar de inmediato.
    const isDirectCrisis = !isNextTeammate && nextThreat >= 2;
    if (isDirectCrisis && tenGroup) {
      sayBotQuote(botUid, botName, 'burn');
      return [tenGroup[0]];
    }

    // En situaciones normales sin amenaza directa:
    // EL 2 TIENE PRIORIDAD SOBRE EL 10 (reinicia el montón y guarda el 10).
    if (twoGroup) {
      return [twoGroup[0]];
    }

    // Solo si NO hay cartas normales Y NO tenemos ningún 2:
    // El 10 es el único salvavidas posible para evitar recoger el montón.
    if (tenGroup) {
      sayBotQuote(botUid, botName, 'burn');
      return [tenGroup[0]];
    }

    return legalGroups[0];
  }

  // =========================================================================
  // 3. TOMA DE DECISIÓN INTELIGENTE DESDE LAS CARTAS BOCA ARRIBA (FASE 2)
  // =========================================================================
  function chooseFaceUpPlay(legalFaceUp, room, botUid, fullFaceUp) {
    if (!legalFaceUp || legalFaceUp.length === 0) return null;
    if (legalFaceUp.length === 1) return legalFaceUp[0];

    const myPlayer = room.players && room.players[botUid];
    const botName = myPlayer ? myPlayer.name : 'Bot';
    const nextPlayer = getNextActivePlayer(room, botUid);
    const isTeamMode = (room.gameMode === '2v2');
    const isNextTeammate = isTeamMode && nextPlayer && (nextPlayer.team === (myPlayer && myPlayer.team));
    const nextThreat = nextPlayer ? getPlayerThreatLevel(nextPlayer) : 0;
    const pile = room.pile || [];
    const pileTop = room.pileTop;
    const pileLength = pile.length;

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

    // Remate ganador con 10 si solo queda 1 carta más y no hay fase a ciegas
    const faceDownCount = (myPlayer && myPlayer.faceDownCount) || 0;
    const remainingFaceUp = (fullFaceUp && fullFaceUp.length) || legalFaceUp.length;
    const tenCard = legalFaceUp.find(c => c.rank === '10');
    if (remainingFaceUp === 2 && faceDownCount === 0 && tenCard) {
      sayBotQuote(botUid, botName, 'burn');
      return tenCard;
    }

    const normalFaceUp = legalFaceUp.filter(c => c.rank !== '2' && c.rank !== '10');
    const two = legalFaceUp.find(c => c.rank === '2');
    const ten = legalFaceUp.find(c => c.rank === '10');

    // =======================================================================
    // CASO 1: HAY CARTAS NORMALES BOCA ARRIBA JUGABLES
    // EL 10 Y EL 2 ESTÁN ESTRICTAMENTE PROTEGIDOS. NUNCA JUGARLOS AQUÍ.
    // =======================================================================
    if (normalFaceUp.length > 0) {
      // 1.1 Evaluar si un rival representa una amenaza (<= 2 cartas o en fase boca abajo)
      const leaderInfo = findTableThreatLeader(room, botUid, myPlayer && myPlayer.team);
      const distToLeader = leaderInfo ? getTurnDistance(room, botUid, leaderInfo.uid) : 999;
      const isLeaderCritical = leaderInfo && (leaderInfo.totalCards <= 2 || leaderInfo.isFaceDownPhase);

      // CASO A: Líder es el siguiente inmediato (distToLeader === 1 Y crítico, o nextThreat >= 2)
      // ¡ALERTA ROJA! Bloquear con todo, jamás tirar una carta baja como un 4 a quien va a ganar.
      const isDirectThreat = !isNextTeammate && ((leaderInfo && distToLeader === 1 && isLeaderCritical) || nextThreat >= 2);
      if (isDirectThreat) {
        // Trampa del 7: Si el rival solo tiene cartas altas (> 7) y tenemos un 7 normal
        const seven = normalFaceUp.find(c => c.rank === '7');
        if (seven && nextPlayer && nextPlayer.faceUp && nextPlayer.faceUp.every(c => c.value > 7 && c.rank !== '2' && c.rank !== '10')) {
          sayBotQuote(botUid, botName, 'seven');
          return seven;
        }
        // De lo contrario, bloquear con la carta normal MÁS ALTA (As, Rey, Dama, etc. - ¡SIN GASTAR EL 10!)
        const sortedDesc = [...normalFaceUp].sort((a, b) => b.value - a.value);
        sayBotQuote(botUid, botName, 'choke');
        return sortedDesc[0];
      }

      // CASO B: Líder a 2 o más turnos -> jugar suave al intermedio
      if (!isNextTeammate && distToLeader >= 2 && leaderInfo && isLeaderCritical) {
        const mid = normalFaceUp.filter(c => c.rank !== '7' && c.rank !== 'A');
        if (mid.length > 0) {
          mid.sort((a, b) => a.value - b.value);
          return mid[0];
        }
      }

      // CASO C: Si el montón está vacío o la cima es un 2
      // (Solo cuando NO hay amenaza directa del siguiente jugador)
      if (pileLength === 0 || (pileTop && pileTop.rank === '2')) {
        normalFaceUp.sort((a, b) => a.value - b.value);
        return normalFaceUp[0];
      }

      // CASO D: Si hay parejas en la mesa boca arriba: tirar para barrer juntas
      const byRank = {};
      normalFaceUp.forEach(c => {
        if (!byRank[c.rank]) byRank[c.rank] = [];
        byRank[c.rank].push(c);
      });
      const pairs = Object.values(byRank).filter(grp => grp.length >= 2);
      if (pairs.length > 0) {
        pairs.sort((a, b) => a[0].value - b[0].value);
        return pairs[0][0];
      }

      // CASO E: Escalada suave estándar: la carta normal más baja posible que supere el montón
      normalFaceUp.sort((a, b) => a.value - b.value);
      return normalFaceUp[0];
    }

    // =======================================================================
    // CASO 2: NO HAY CARTAS NORMALES BOCA ARRIBA (normalFaceUp.length === 0)
    // =======================================================================
    // Si el siguiente jugador está a 1 o 2 cartas de ganar y tenemos un 10:
    // ¡QUEMAR CON EL 10! Jugar un 2 le regalaría la mesa libre para ganar.
    const isDirectCrisis = !isNextTeammate && nextThreat >= 2;
    if (isDirectCrisis && ten) {
      sayBotQuote(botUid, botName, 'burn');
      return ten;
    }

    // En situaciones normales sin amenaza directa:
    // El 2 siempre tiene prioridad sobre el 10 (reinicia y salva el 10).
    if (two) return two;

    // Solo si NO tenemos cartas normales Y NO tenemos un 2:
    if (ten) {
      sayBotQuote(botUid, botName, 'burn');
      return ten;
    }

    return legalFaceUp[0];
  }

  // --- API GLOBAL EXPUESTA ---
  const GuerraBotAI = {
    version: '2.0.0',
    chooseSetupCards,
    chooseHandPlay,
    chooseFaceUpPlay,
    getBotProfile,
    canPlay
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = GuerraBotAI;
  } else {
    global.GuerraBotAI = GuerraBotAI;
  }

})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : self));
