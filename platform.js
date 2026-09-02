/**
 * PLATFORM COORDINATOR & GAME PORTAL NAVIGATION
 * Coordinates navigation between Main Game Portal, Sudoku, STOP, Guerra, and Sombras del Bosque.
 */

(function (global) {
  'use strict';

  let currentActiveGame = null; // 'sudoku' | 'stop' | 'guerra' | 'sombras' | null

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
      return clean;
    }
    return getPlayerName();
  }

  function switchGame(gameId) {
    const portalView = document.getElementById('view-portal');
    const sudokuContainer = document.getElementById('sudoku-app-container');
    const stopContainer = document.getElementById('stop-app-container');
    const guerraContainer = document.getElementById('guerra-app-container');
    const sombrasContainer = document.getElementById('sombras-app-container');
    const btnNavGames = document.getElementById('btn-nav-games');

    if (!gameId) {
      // Show Main Menu Portal
      currentActiveGame = null;
      if (portalView) portalView.style.display = 'flex';
      if (sudokuContainer) sudokuContainer.style.display = 'none';
      if (stopContainer) stopContainer.style.display = 'none';
      if (guerraContainer) guerraContainer.style.display = 'none';
      if (sombrasContainer) sombrasContainer.style.display = 'none';
      if (btnNavGames) btnNavGames.style.display = 'none';
      return;
    }

    currentActiveGame = gameId;
    if (portalView) portalView.style.display = 'none';
    if (btnNavGames) btnNavGames.style.display = 'flex';

    if (gameId === 'sudoku') {
      if (sudokuContainer) sudokuContainer.style.display = 'flex';
      if (stopContainer) stopContainer.style.display = 'none';
      if (guerraContainer) guerraContainer.style.display = 'none';
      if (sombrasContainer) sombrasContainer.style.display = 'none';
    } else if (gameId === 'stop') {
      if (sudokuContainer) sudokuContainer.style.display = 'none';
      if (stopContainer) stopContainer.style.display = 'flex';
      if (guerraContainer) guerraContainer.style.display = 'none';
      if (sombrasContainer) sombrasContainer.style.display = 'none';
      if (global.StopGame && global.StopGame.showView) {
        global.StopGame.showView('lobby');
      }
    } else if (gameId === 'guerra') {
      if (sudokuContainer) sudokuContainer.style.display = 'none';
      if (stopContainer) stopContainer.style.display = 'none';
      if (guerraContainer) guerraContainer.style.display = 'flex';
      if (sombrasContainer) sombrasContainer.style.display = 'none';
      if (global.GuerraGame && global.GuerraGame.showView) {
        global.GuerraGame.showView('lobby');
      }
    } else if (gameId === 'sombras') {
      if (sudokuContainer) sudokuContainer.style.display = 'none';
      if (stopContainer) stopContainer.style.display = 'none';
      if (guerraContainer) guerraContainer.style.display = 'none';
      if (sombrasContainer) sombrasContainer.style.display = 'flex';
      if (global.SombrasGame && global.SombrasGame.showView) {
        global.SombrasGame.showView('lobby');
      }
    }
  }

  // --- RULES MODAL SYSTEM ---

  function openRulesModal(preferredTab = null) {
    const modal = document.getElementById('modal-game-rules');
    if (!modal) return;

    const targetTab = preferredTab || currentActiveGame || 'sombras';
    switchRulesTab(targetTab);
    modal.classList.add('active');
  }

  function closeRulesModal() {
    const modal = document.getElementById('modal-game-rules');
    if (modal) modal.classList.remove('active');
  }

  function switchRulesTab(tabKey) {
    const tabs = document.querySelectorAll('.rules-tab-btn');
    const contents = {
      sombras: document.getElementById('rules-tab-content-sombras'),
      guerra: document.getElementById('rules-tab-content-guerra'),
      sudoku: document.getElementById('rules-tab-content-sudoku'),
      stop: document.getElementById('rules-tab-content-stop')
    };

    tabs.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.rulesTab === tabKey);
    });

    Object.keys(contents).forEach(key => {
      if (contents[key]) {
        contents[key].style.display = key === tabKey ? 'flex' : 'none';
      }
    });
  }

  function initRulesModalEvents() {
    const btnHeaderRules = document.getElementById('btn-rules');
    const btnCloseRules = document.getElementById('btn-close-rules');
    const btnRulesOk = document.getElementById('btn-rules-ok');
    const modalRules = document.getElementById('modal-game-rules');
    const tabButtons = document.querySelectorAll('.rules-tab-btn');

    if (btnHeaderRules) {
      btnHeaderRules.addEventListener('click', () => openRulesModal(currentActiveGame || 'sombras'));
    }

    if (btnCloseRules) {
      btnCloseRules.addEventListener('click', closeRulesModal);
    }

    if (btnRulesOk) {
      btnRulesOk.addEventListener('click', closeRulesModal);
    }

    if (modalRules) {
      modalRules.addEventListener('click', e => {
        if (e.target === modalRules) closeRulesModal();
      });
    }

    tabButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.rulesTab;
        if (tab) switchRulesTab(tab);
      });
    });
  }

  function init() {
    const btnNavGames = document.getElementById('btn-nav-games');
    const portalNickname = document.getElementById('portal-nickname-input');
    const cardSudoku = document.getElementById('portal-card-sudoku');
    const cardStop = document.getElementById('portal-card-stop');
    const cardGuerra = document.getElementById('portal-card-guerra');
    const cardSombras = document.getElementById('portal-card-sombras');

    initRulesModalEvents();

    if (portalNickname) {
      portalNickname.value = getPlayerName();
      portalNickname.addEventListener('change', () => {
        const clean = setPlayerName(portalNickname.value);
        portalNickname.value = clean;
        const sudNick = document.getElementById('input-nickname');
        const stopNick = document.getElementById('stop-nickname-input');
        const guerraNick = document.getElementById('guerra-nickname-input');
        const sombrasNick = document.getElementById('sombras-nickname-input');
        if (sudNick) sudNick.value = clean;
        if (stopNick) stopNick.value = clean;
        if (guerraNick) guerraNick.value = clean;
        if (sombrasNick) sombrasNick.value = clean;
      });
    }

    if (cardSudoku) {
      cardSudoku.addEventListener('click', () => switchGame('sudoku'));
    }

    if (cardStop) {
      cardStop.addEventListener('click', () => switchGame('stop'));
    }

    if (cardGuerra) {
      cardGuerra.addEventListener('click', () => switchGame('guerra'));
    }

    if (cardSombras) {
      cardSombras.addEventListener('click', () => switchGame('sombras'));
    }

    if (btnNavGames) {
      btnNavGames.addEventListener('click', () => {
        if (confirm('¿Deseas volver al Menú Principal de Juegos?')) {
          if (currentActiveGame === 'sudoku' && global.MultiplayerService) {
            global.MultiplayerService.leaveRoom();
          }
          if (currentActiveGame === 'stop' && global.StopGame) {
            global.StopGame.leaveRoom();
          }
          if (currentActiveGame === 'guerra' && global.GuerraGame) {
            global.GuerraGame.leaveRoom();
          }
          if (currentActiveGame === 'sombras' && global.SombrasGame) {
            global.SombrasGame.leaveRoom();
          }
          switchGame(null);
        }
      });
    }

    // Check URL parameters for direct routing
    const urlParams = new URLSearchParams(window.location.search);
    const gameParam = urlParams.get('game');
    const roomParam = urlParams.get('room');

    if (gameParam === 'sombras') {
      switchGame('sombras');
      if (roomParam) {
        const joinInp = document.getElementById('sombras-input-join-code');
        if (joinInp) joinInp.value = roomParam.trim().toUpperCase();
        setTimeout(() => {
          const btnJoin = document.getElementById('sombras-btn-join-room');
          if (btnJoin) btnJoin.click();
        }, 400);
      }
    } else if (gameParam === 'guerra') {
      switchGame('guerra');
      if (roomParam) {
        const joinInp = document.getElementById('guerra-input-join-code');
        if (joinInp) joinInp.value = roomParam.trim().toUpperCase();
        setTimeout(() => {
          const btnJoin = document.getElementById('guerra-btn-join-room');
          if (btnJoin) btnJoin.click();
        }, 400);
      }
    } else if (gameParam === 'stop') {
      switchGame('stop');
      if (roomParam) {
        const stopJoinInp = document.getElementById('stop-input-join-code');
        if (stopJoinInp) stopJoinInp.value = roomParam.trim().toUpperCase();
        setTimeout(() => {
          const btnJoin = document.getElementById('stop-btn-join-room');
          if (btnJoin) btnJoin.click();
        }, 400);
      }
    } else if (gameParam === 'sudoku' || (roomParam && !gameParam)) {
      switchGame('sudoku');
    } else {
      // Default: show Portal Main Menu
      switchGame(null);
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    init();
    if (global.StopGame && global.StopGame.init) {
      global.StopGame.init();
    }
    if (global.GuerraGame && global.GuerraGame.init) {
      global.GuerraGame.init();
    }
    if (global.SombrasGame && global.SombrasGame.init) {
      global.SombrasGame.init();
    }
  });

  global.PlatformService = {
    switchGame,
    getPlayerName,
    setPlayerName,
    openRulesModal,
    closeRulesModal
  };

})(typeof window !== 'undefined' ? window : self);
