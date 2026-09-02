/**
 * SOMBRAS DEL BOSQUE - ASSET LOADER & SPRITE PROCESSOR
 * 
 * Accurately extracts the 10 characters from 'assets/characters_sheet.jpg' with transparent background,
 * and loads the 1024x1024 camp map.
 */

(function (global) {
  'use strict';

  // Exact pixel coordinates for the 10 characters in the 1024x1024 sprite sheet
  const CHARACTERS_METADATA = [
    { id: 'char_red', name: 'Explorador Rojo', color: '#ef4444', sx: 40, sy: 115, sw: 165, sh: 335, tag: 'Líder' },
    { id: 'char_blue', name: 'Mecánico Azul', color: '#3b82f6', sx: 228, sy: 140, sw: 160, sh: 310, tag: 'Técnico' },
    { id: 'char_green', name: 'Guardabosques', color: '#10b981', sx: 412, sy: 125, sw: 165, sh: 325, tag: 'Ranger' },
    { id: 'char_yellow', name: 'Constructor', color: '#eab308', sx: 595, sy: 135, sw: 165, sh: 315, tag: 'Minero' },
    { id: 'char_orange', name: 'Cazador', color: '#f97316', sx: 778, sy: 130, sw: 170, sh: 320, tag: 'Trampero' },
    { id: 'char_purple', name: 'Especialista', color: '#a855f7', sx: 40, sy: 575, sw: 165, sh: 325, tag: 'Comms' },
    { id: 'char_pink', name: 'Botánica', color: '#ec4899', sx: 228, sy: 575, sw: 160, sh: 325, tag: 'Médica' },
    { id: 'char_cyan', name: 'Científico', color: '#06b6d4', sx: 412, sy: 585, sw: 165, sh: 315, tag: 'Químico' },
    { id: 'char_black', name: 'Táctico', color: '#64748b', sx: 595, sy: 585, sw: 165, sh: 315, tag: 'Sigilo' },
    { id: 'char_white', name: 'Superviviente', color: '#e2e8f0', sx: 778, sy: 575, sw: 170, sh: 325, tag: 'Ártico' }
  ];

  const Assets = {
    isLoaded: false,
    mapImage: null,
    sheetImage: null,
    characterSprites: {}, // { [charId]: { meta, aliveCanvas, deadCanvas, iconDataUrl } }

    load: function () {
      if (this.isLoaded) return Promise.resolve(true);

      return new Promise((resolve) => {
        let loadedCount = 0;
        const total = 2;

        const checkDone = () => {
          loadedCount++;
          if (loadedCount >= total) {
            this.processAllSprites();
            this.isLoaded = true;
            resolve(true);
          }
        };

        // Load Map Image
        const map = new Image();
        map.onload = () => {
          this.mapImage = map;
          checkDone();
        };
        map.onerror = () => {
          console.warn('Fallback map used.');
          this.mapImage = this.createFallbackMap();
          checkDone();
        };
        map.src = 'assets/map_camp.jpg';

        // Load Characters Sheet Image
        const sheet = new Image();
        sheet.onload = () => {
          this.sheetImage = sheet;
          checkDone();
        };
        sheet.onerror = () => {
          console.warn('Fallback sheet used.');
          this.sheetImage = null;
          checkDone();
        };
        sheet.src = 'assets/characters_sheet.jpg';
      });
    },

    processAllSprites: function () {
      CHARACTERS_METADATA.forEach(meta => {
        let aliveCanvas, deadCanvas, iconDataUrl;

        if (this.sheetImage) {
          // 1. Extract Character Sprite
          aliveCanvas = document.createElement('canvas');
          aliveCanvas.width = meta.sw;
          aliveCanvas.height = meta.sh;
          const ctx = aliveCanvas.getContext('2d');

          ctx.drawImage(
            this.sheetImage,
            meta.sx, meta.sy, meta.sw, meta.sh,
            0, 0, meta.sw, meta.sh
          );

          // 2. Chroma-key remove the grey background
          const imgData = ctx.getImageData(0, 0, meta.sw, meta.sh);
          const d = imgData.data;
          for (let i = 0; i < d.length; i += 4) {
            const r = d[i];
            const g = d[i + 1];
            const b = d[i + 2];
            const maxDiff = Math.max(Math.abs(r - g), Math.abs(g - b), Math.abs(r - b));
            // Grey background detection
            if (maxDiff < 22 && r >= 95 && r <= 155) {
              d[i + 3] = 0; // Make transparent
            }
          }
          ctx.putImageData(imgData, 0, 0);

          // 3. Create Fallen Dead Body Sprite
          deadCanvas = document.createElement('canvas');
          deadCanvas.width = meta.sh + 20;
          deadCanvas.height = meta.sw + 20;
          const dCtx = deadCanvas.getContext('2d');

          // Blood puddle
          dCtx.fillStyle = 'rgba(185, 28, 28, 0.8)';
          dCtx.beginPath();
          dCtx.ellipse(deadCanvas.width / 2, deadCanvas.height / 2, deadCanvas.width * 0.42, deadCanvas.height * 0.32, 0, 0, Math.PI * 2);
          dCtx.fill();

          // Fallen rotated body
          dCtx.save();
          dCtx.translate(deadCanvas.width / 2, deadCanvas.height / 2);
          dCtx.rotate(Math.PI / 2);
          dCtx.drawImage(aliveCanvas, -meta.sw / 2, -meta.sh / 2);
          dCtx.restore();

          // 4. Create Icon for Lobby & UI
          const iconCanvas = document.createElement('canvas');
          iconCanvas.width = 96;
          iconCanvas.height = 96;
          const iCtx = iconCanvas.getContext('2d');
          
          iCtx.fillStyle = '#0f172a';
          iCtx.beginPath();
          iCtx.arc(48, 48, 44, 0, Math.PI * 2);
          iCtx.fill();
          iCtx.strokeStyle = meta.color;
          iCtx.lineWidth = 4;
          iCtx.stroke();

          // Draw head and body centered in circle
          const aspect = meta.sw / meta.sh;
          const drawH = 74;
          const drawW = drawH * aspect;
          iCtx.drawImage(aliveCanvas, 48 - drawW / 2, 12, drawW, drawH);
          iconDataUrl = iconCanvas.toDataURL('image/png');

        } else {
          // Fallback if sheet image not loaded
          aliveCanvas = document.createElement('canvas');
          aliveCanvas.width = 64;
          aliveCanvas.height = 80;
          const cCtx = aliveCanvas.getContext('2d');
          cCtx.fillStyle = meta.color;
          cCtx.beginPath();
          cCtx.arc(32, 28, 18, 0, Math.PI * 2);
          cCtx.fill();
          cCtx.fillRect(16, 32, 32, 40);

          deadCanvas = aliveCanvas;
          iconDataUrl = aliveCanvas.toDataURL();
        }

        this.characterSprites[meta.id] = {
          meta: meta,
          aliveCanvas: aliveCanvas,
          deadCanvas: deadCanvas,
          iconDataUrl: iconDataUrl
        };
      });
    },

    createFallbackMap: function () {
      const c = document.createElement('canvas');
      c.width = 1024;
      c.height = 1024;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#064e3b';
      ctx.fillRect(0, 0, 1024, 1024);
      ctx.fillStyle = '#b45309';
      ctx.beginPath();
      ctx.arc(512, 512, 50, 0, Math.PI * 2);
      ctx.fill();
      return c;
    }
  };

  // Start preloading immediately
  Assets.load().then(() => {
    // Notify if SombrasGame is already initialized
    if (global.SombrasGame && global.SombrasGame.onAssetsReady) {
      global.SombrasGame.onAssetsReady();
    }
  });

  global.SombrasAssets = {
    CHARACTERS: CHARACTERS_METADATA,
    Assets: Assets
  };

})(typeof window !== 'undefined' ? window : self);
