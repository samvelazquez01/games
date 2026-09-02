/**
 * SOMBRAS DEL BOSQUE - TASK & MINIGAME ENGINE
 * 
 * 6 Interactive survival tasks placed in different camp buildings:
 * 1. Reparar Generador (Taller / Almacén NE)
 * 2. Calibrar Radio (Estación de Comunicaciones Sur)
 * 3. Regar Invernadero (Invernadero SE)
 * 4. Organizar Botiquín (Clínica Norte)
 * 5. Abastecer Leña (Almacén NW)
 * 6. Limpiar Filtro de Agua (Comedor / Cocina Oeste)
 */

(function (global) {
  'use strict';

  const TASK_DEFINITIONS = [
    {
      id: 'task_generator',
      name: 'Reparar Generador',
      locationName: 'Taller / Almacén NE',
      icon: '⚡',
      x: 790,
      y: 220,
      radius: 50
    },
    {
      id: 'task_radio',
      name: 'Calibrar Frecuencia de Radio',
      locationName: 'Comunicaciones Sur',
      icon: '📻',
      x: 480,
      y: 800,
      radius: 50
    },
    {
      id: 'task_greenhouse',
      name: 'Regar Cultivos del Invernadero',
      locationName: 'Invernadero SE',
      icon: '🌿',
      x: 740,
      y: 770,
      radius: 50
    },
    {
      id: 'task_medbay',
      name: 'Organizar Botiquín Médico',
      locationName: 'Clínica Norte',
      icon: '💊',
      x: 512,
      y: 210,
      radius: 50
    },
    {
      id: 'task_firewood',
      name: 'Abastecer Leña para la Hoguera',
      locationName: 'Almacén NW',
      icon: '🪵',
      x: 230,
      y: 230,
      radius: 50
    },
    {
      id: 'task_filter',
      name: 'Limpiar Filtro de Agua',
      locationName: 'Cocina / Comedor Oeste',
      icon: '💧',
      x: 200,
      y: 490,
      radius: 50
    }
  ];

  let currentActiveTask = null;
  let onTaskCompleteCallback = null;

  // Sound effects
  const TaskAudio = (function () {
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
      click: () => tone(600, 'sine', 0.05, 0.1),
      wireConnect: () => tone(880, 'triangle', 0.1, 0.15),
      taskSuccess: () => {
        [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
          setTimeout(() => tone(f, 'triangle', 0.2, 0.2), i * 90);
        });
      }
    };
  })();

  function openTask(taskId, onComplete) {
    const task = TASK_DEFINITIONS.find(t => t.id === taskId);
    if (!task) return;

    currentActiveTask = task;
    onTaskCompleteCallback = onComplete;

    const overlay = document.getElementById('sombras-task-modal');
    const container = document.getElementById('sombras-task-content');
    const title = document.getElementById('sombras-task-title');
    const location = document.getElementById('sombras-task-location');

    if (title) title.innerHTML = `<span>${task.icon}</span> ${task.name}`;
    if (location) location.textContent = task.locationName;

    if (container) {
      container.innerHTML = '';
      if (task.id === 'task_generator') renderGeneratorTask(container);
      else if (task.id === 'task_radio') renderRadioTask(container);
      else if (task.id === 'task_greenhouse') renderGreenhouseTask(container);
      else if (task.id === 'task_medbay') renderMedbayTask(container);
      else if (task.id === 'task_firewood') renderFirewoodTask(container);
      else if (task.id === 'task_filter') renderFilterTask(container);
    }

    if (overlay) overlay.classList.add('active');
  }

  function closeTask() {
    const overlay = document.getElementById('sombras-task-modal');
    if (overlay) overlay.classList.remove('active');
    currentActiveTask = null;
  }

  function triggerTaskSuccess() {
    TaskAudio.taskSuccess();
    const banner = document.getElementById('sombras-task-success-banner');
    if (banner) {
      banner.style.display = 'flex';
      setTimeout(() => {
        banner.style.display = 'none';
        closeTask();
        if (onTaskCompleteCallback && currentActiveTask) {
          onTaskCompleteCallback(currentActiveTask.id);
        }
      }, 1000);
    } else {
      closeTask();
      if (onTaskCompleteCallback && currentActiveTask) {
        onTaskCompleteCallback(currentActiveTask.id);
      }
    }
  }

  // --- MINIGAME 1: GENERATOR (CONNECT 4 COLORED WIRES) ---
  function renderGeneratorTask(container) {
    const colors = [
      { name: 'Rojo', hex: '#ef4444' },
      { name: 'Azul', hex: '#3b82f6' },
      { name: 'Amarillo', hex: '#eab308' },
      { name: 'Verde', hex: '#10b981' }
    ];
    // Shuffle right sides
    const rightColors = [...colors].sort(() => Math.random() - 0.5);
    const connected = new Set();
    let selectedLeft = null;

    const html = `
      <p style="font-size: 13px; color: var(--text-muted); text-align: center; margin-bottom: 12px;">
        Conecta los cables de la izquierda con sus pares del mismo color a la derecha.
      </p>
      <div class="wire-game-container" style="display: flex; justify-content: space-between; align-items: center; min-height: 220px; padding: 10px;">
        <div class="wire-column-left" style="display: flex; flex-direction: column; gap: 14px;">
          ${colors.map(c => `
            <button class="wire-socket wire-left" data-color="${c.hex}" style="background: ${c.hex}; width: 44px; height: 36px; border-radius: 6px; border: 2px solid #fff; cursor: pointer;"></button>
          `).join('')}
        </div>
        <div id="wire-lines-display" style="flex: 1; height: 100%; position: relative; pointer-events: none;"></div>
        <div class="wire-column-right" style="display: flex; flex-direction: column; gap: 14px;">
          ${rightColors.map(c => `
            <button class="wire-socket wire-right" data-color="${c.hex}" style="background: ${c.hex}; width: 44px; height: 36px; border-radius: 6px; border: 2px solid #fff; cursor: pointer;"></button>
          `).join('')}
        </div>
      </div>
    `;
    container.innerHTML = html;

    const leftSockets = container.querySelectorAll('.wire-left');
    const rightSockets = container.querySelectorAll('.wire-right');

    leftSockets.forEach(btn => {
      btn.addEventListener('click', () => {
        const color = btn.dataset.color;
        if (connected.has(color)) return;
        selectedLeft = color;
        leftSockets.forEach(b => b.style.boxShadow = 'none');
        btn.style.boxShadow = `0 0 15px ${color}`;
        TaskAudio.click();
      });
    });

    rightSockets.forEach(btn => {
      btn.addEventListener('click', () => {
        const color = btn.dataset.color;
        if (!selectedLeft) return;
        if (selectedLeft === color) {
          connected.add(color);
          btn.style.opacity = '0.5';
          btn.style.borderColor = '#10b981';
          const leftBtn = Array.from(leftSockets).find(b => b.dataset.color === color);
          if (leftBtn) {
            leftBtn.style.opacity = '0.5';
            leftBtn.style.boxShadow = 'none';
          }
          selectedLeft = null;
          TaskAudio.wireConnect();

          if (connected.size === 4) {
            triggerTaskSuccess();
          }
        } else {
          selectedLeft = null;
          leftSockets.forEach(b => b.style.boxShadow = 'none');
          TaskAudio.click();
        }
      });
    });
  }

  // --- MINIGAME 2: RADIO FREQUENCY (TUNE SLIDER) ---
  function renderRadioTask(container) {
    const targetFreq = (90 + Math.floor(Math.random() * 25) + 0.5).toFixed(1);
    const html = `
      <p style="font-size: 13px; color: var(--text-muted); text-align: center; margin-bottom: 8px;">
        Ajusta el dial hasta sintonizar la frecuencia de emergencia: <b style="color: var(--accent-amber); font-size: 16px;">${targetFreq} MHz</b>
      </p>
      <div style="background: #0f172a; border: 2px solid var(--border-color); border-radius: 12px; padding: 18px; text-align: center; display: flex; flex-direction: column; gap: 14px;">
        <div id="radio-display" style="font-family: var(--font-mono); font-size: 36px; font-weight: 900; color: #ef4444; letter-spacing: 2px; text-shadow: 0 0 10px rgba(239, 68, 68, 0.5);">
          88.0 MHz
        </div>
        <input type="range" id="radio-slider" min="88.0" max="118.0" step="0.5" value="88.0" style="width: 100%; cursor: pointer; accent-color: var(--accent-amber);">
        <button id="radio-btn-tune" class="btn btn-primary" style="padding: 12px; font-size: 14px;" disabled>
          <span>📻</span> CALIBRAR Y TRANSMITIR
        </button>
      </div>
    `;
    container.innerHTML = html;

    const slider = container.querySelector('#radio-slider');
    const display = container.querySelector('#radio-display');
    const btnTune = container.querySelector('#radio-btn-tune');

    slider.addEventListener('input', () => {
      const val = parseFloat(slider.value).toFixed(1);
      display.textContent = `${val} MHz`;
      TaskAudio.click();

      if (val === targetFreq) {
        display.style.color = '#10b981';
        display.style.textShadow = '0 0 15px rgba(16, 185, 129, 0.8)';
        btnTune.disabled = false;
        btnTune.classList.add('pulse');
      } else {
        display.style.color = '#ef4444';
        display.style.textShadow = '0 0 10px rgba(239, 68, 68, 0.5)';
        btnTune.disabled = true;
        btnTune.classList.remove('pulse');
      }
    });

    btnTune.addEventListener('click', triggerTaskSuccess);
  }

  // --- MINIGAME 3: GREENHOUSE WATER PUMP ---
  function renderGreenhouseTask(container) {
    let progress = 0;
    const html = `
      <p style="font-size: 13px; color: var(--text-muted); text-align: center; margin-bottom: 8px;">
        Mantén presionado el dispensador de agua para regar los cultivos al 100%.
      </p>
      <div style="background: #0f172a; border-radius: 12px; padding: 18px; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 14px;">
        <div style="font-size: 48px;">🌿 💧</div>
        <div class="progress-track" style="width: 100%; height: 16px; border-radius: 8px; overflow: hidden; background: #1e293b;">
          <div id="greenhouse-fill" style="width: 0%; height: 100%; background: linear-gradient(90deg, #38bdf8, #10b981); transition: width 0.1s;"></div>
        </div>
        <span id="greenhouse-pct" style="font-family: var(--font-mono); font-size: 18px; font-weight: 800; color: var(--accent-cyan);">0%</span>
        <button id="greenhouse-btn-pump" class="btn btn-emerald" style="padding: 16px 28px; font-size: 16px; user-select: none;">
          <span>💧</span> REGAR CULTIVOS
        </button>
      </div>
    `;
    container.innerHTML = html;

    const btnPump = container.querySelector('#greenhouse-btn-pump');
    const fill = container.querySelector('#greenhouse-fill');
    const pct = container.querySelector('#greenhouse-pct');

    let pumpInterval = null;

    const startPumping = () => {
      if (pumpInterval) return;
      pumpInterval = setInterval(() => {
        progress += 4;
        if (progress >= 100) {
          progress = 100;
          clearInterval(pumpInterval);
          pumpInterval = null;
          triggerTaskSuccess();
        }
        fill.style.width = `${progress}%`;
        pct.textContent = `${progress}%`;
        TaskAudio.click();
      }, 70);
    };

    const stopPumping = () => {
      if (pumpInterval) {
        clearInterval(pumpInterval);
        pumpInterval = null;
      }
    };

    btnPump.addEventListener('mousedown', startPumping);
    btnPump.addEventListener('mouseup', stopPumping);
    btnPump.addEventListener('mouseleave', stopPumping);
    btnPump.addEventListener('touchstart', (e) => { e.preventDefault(); startPumping(); });
    btnPump.addEventListener('touchend', stopPumping);
  }

  // --- MINIGAME 4: MEDBAY KIT (PACK 3 SUPPLIES) ---
  function renderMedbayTask(container) {
    const items = [
      { id: 'item_bandage', icon: '🩹', name: 'Vendas' },
      { id: 'item_pills', icon: '💊', name: 'Antibióticos' },
      { id: 'item_syringe', icon: '💉', name: 'Jeringa' }
    ];
    let packed = 0;

    const html = `
      <p style="font-size: 13px; color: var(--text-muted); text-align: center; margin-bottom: 12px;">
        Toca los 3 suministros médicos para guardarlos en el botiquín de primeros auxilios.
      </p>
      <div style="display: flex; justify-content: space-around; gap: 10px; margin-bottom: 14px;">
        ${items.map(it => `
          <button class="med-item-btn btn" data-id="${it.id}" style="display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 14px 18px; font-size: 24px;">
            <span>${it.icon}</span>
            <span style="font-size: 11px; font-weight: 700;">${it.name}</span>
          </button>
        `).join('')}
      </div>
      <div style="background: rgba(16, 185, 129, 0.15); border: 2px dashed var(--accent-emerald); border-radius: 12px; padding: 16px; text-align: center;">
        <span style="font-size: 14px; font-weight: 800; color: var(--accent-emerald);">📦 Botiquín: <span id="med-packed-count">0</span> / 3 Guardados</span>
      </div>
    `;
    container.innerHTML = html;

    const itemBtns = container.querySelectorAll('.med-item-btn');
    const countDisplay = container.querySelector('#med-packed-count');

    itemBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        btn.style.opacity = '0.25';
        btn.style.pointerEvents = 'none';
        btn.style.transform = 'scale(0.85)';
        packed++;
        countDisplay.textContent = packed;
        TaskAudio.click();

        if (packed === 3) {
          triggerTaskSuccess();
        }
      });
    });
  }

  // --- MINIGAME 5: FIREWOOD (STACK 3 LOGS) ---
  function renderFirewoodTask(container) {
    let stacked = 0;
    const html = `
      <p style="font-size: 13px; color: var(--text-muted); text-align: center; margin-bottom: 12px;">
        Toca los 3 leños para cortarlos y apilarlos para la hoguera central.
      </p>
      <div style="display: flex; justify-content: center; gap: 14px; margin-bottom: 14px;">
        <button class="log-btn btn" style="font-size: 32px; padding: 16px;">🪵</button>
        <button class="log-btn btn" style="font-size: 32px; padding: 16px;">🪵</button>
        <button class="log-btn btn" style="font-size: 32px; padding: 16px;">🪵</button>
      </div>
      <div style="background: rgba(245, 158, 11, 0.15); border: 2px dashed var(--accent-amber); border-radius: 12px; padding: 14px; text-align: center;">
        <span style="font-size: 14px; font-weight: 800; color: var(--accent-amber);">🔥 Leña para la Hoguera: <span id="log-stacked-count">0</span> / 3</span>
      </div>
    `;
    container.innerHTML = html;

    const logBtns = container.querySelectorAll('.log-btn');
    const countDisplay = container.querySelector('#log-stacked-count');

    logBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        btn.style.opacity = '0.2';
        btn.style.pointerEvents = 'none';
        stacked++;
        countDisplay.textContent = stacked;
        TaskAudio.click();

        if (stacked === 3) {
          triggerTaskSuccess();
        }
      });
    });
  }

  // --- MINIGAME 6: WATER FILTER (CLEAR 4 LEAVES) ---
  function renderFilterTask(container) {
    let cleared = 0;
    const html = `
      <p style="font-size: 13px; color: var(--text-muted); text-align: center; margin-bottom: 12px;">
        Toca las 4 impurezas y hojas atrapadas en la malla del filtro de agua.
      </p>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; max-width: 260px; margin: 0 auto 14px auto;">
        <button class="leaf-btn btn" style="font-size: 28px; padding: 14px;">🍂</button>
        <button class="leaf-btn btn" style="font-size: 28px; padding: 14px;">🍁</button>
        <button class="leaf-btn btn" style="font-size: 28px; padding: 14px;">🌿</button>
        <button class="leaf-btn btn" style="font-size: 28px; padding: 14px;">🌾</button>
      </div>
      <div style="background: rgba(6, 182, 212, 0.15); border: 2px dashed var(--accent-cyan); border-radius: 12px; padding: 12px; text-align: center;">
        <span style="font-size: 13px; font-weight: 800; color: var(--accent-cyan);">💧 Malla limpia: <span id="leaf-cleared-count">0</span> / 4</span>
      </div>
    `;
    container.innerHTML = html;

    const leafBtns = container.querySelectorAll('.leaf-btn');
    const countDisplay = container.querySelector('#leaf-cleared-count');

    leafBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        btn.style.opacity = '0.15';
        btn.style.pointerEvents = 'none';
        cleared++;
        countDisplay.textContent = cleared;
        TaskAudio.click();

        if (cleared === 4) {
          triggerTaskSuccess();
        }
      });
    });
  }

  global.SombrasTasks = {
    TASKS: TASK_DEFINITIONS,
    openTask,
    closeTask
  };

})(typeof window !== 'undefined' ? window : self);
