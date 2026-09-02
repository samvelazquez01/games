/**
 * SOMBRAS DEL BOSQUE - ASSET LOADER & SPRITE PROCESSOR
 * 
 * Slices and extracts the 10 top-down characters from 'assets/characters_sheet.jpg',
 * performs real-time chroma-key background removal on offscreen canvas,
 * and creates ready-to-render sprites for living characters and corpses.
 */

(function (global) {
  'use strict';

  const CHARACTERS_METADATA = [
    { id: 'char_red', name: 'Explorador Rojo', color: '#ef4444', col: 0, row: 0, tag: 'Líder' },
    { id: 'char_blue', name: 'Mecánico Azul', color: '#3b82f6', col: 1, row: 0, tag: 'Técnico' },
    { id: 'char_green', name: 'Guardabosques', color: '#10b981', col: 2, row: 0, tag: 'Ranger' },
    { id: 'char_yellow', name: 'Constructor', color: '#eab308', col: 3, row: 0, tag: 'Minero' },
    { id: 'char_orange', name: 'Cazador', color: '#f97316', col: 4, row: 0, tag: 'Trampero' },
    { id: 'char_purple', name: 'Especialista', color: '#a855f7', col: 0, row: 1, tag: 'Comms' },
    { id: 'char_pink', name: 'Botánica', color: '#ec4899', col: 1, row: 1, tag: 'Médica' },
    { id: 'char_cyan', name: 'Científico', color: '#06b6d4', col: 2, row: 1, tag: 'Químico' },
    { id: 'char_black', name: 'Táctico', color: '#475569', col: 3, row: 1, tag: 'Sigilo' },
    { id: 'char_white', name: 'Superviviente', color: '#f8fafc', col: 4, row: 1, tag: 'Ártico' }
  ];

  const Assets = {
    isLoaded: false,
    mapImage: null,
    characterSprites: {}, // { char_id: { aliveCanvas, deadCanvas, iconDataUrl } }
    
    load: async function () {
      if (this.isLoaded) return true;

      const mapPromise = new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('No se pudo cargar assets/map_camp.jpg'));
        img.src = 'assets/map_camp.jpg';
      });

      const sheetPromise = new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('No se pudo cargar assets/characters_sheet.jpg'));
        img.src = 'assets/characters_sheet.jpg';
      });

      try {
        const [mapImg, sheetImg] = await Promise.all([mapPromise, sheetPromise]);
        this.mapImage = mapImg;
        this.processCharacterSheet(sheetImg);
        this.isLoaded = true;
        return true;
      } catch (e) {
        console.error('Error cargando assets de Sombras del Bosque:', e);
        // Fallback generator if images fail
        this.generateFallbackAssets();
        this.isLoaded = true;
        return true;
      }
    },

    processCharacterSheet: function (sheetImg) {
      const sheetW = sheetImg.width; // 1024
      const sheetH = sheetImg.height; // 1024
      const colW = sheetW / 5; // ~204.8
      const rowH = sheetH / 2; // ~512

      CHARACTERS_METADATA.forEach(meta => {
        // Crop specific character box with padding
        const sx = Math.floor(meta.col * colW + 12);
        const sy = Math.floor(meta.row * rowH + 60);
        const sw = Math.floor(colW - 24);
        const sh = Math.floor(rowH - 120);

        // 1. Living Character Canvas with Chroma-Key Background Removal
        const canvas = document.createElement('canvas');
        canvas.width = sw;
        canvas.height = sh;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(sheetImg, sx, sy, sw, sh, 0, 0, sw, sh);

        // Remove neutral grey background (#7a7a7a - #888888)
        const imgData = ctx.getImageData(0, 0, sw, sh);
        const data = imgData.data;
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          // Grey detection
          const diffRG = Math.abs(r - g);
          const diffGB = Math.abs(g - b);
          const diffRB = Math.abs(r - b);
          if (diffRG < 18 && diffGB < 18 && diffRB < 18 && r >= 100 && r <= 150) {
            data[i + 3] = 0; // Transparent
          }
        }
        ctx.putImageData(imgData, 0, 0);

        // 2. Dead Body Sprite (Horizontally fallen corpse + blood puddle mark)
        const deadCanvas = document.createElement('canvas');
        deadCanvas.width = sh + 20;
        deadCanvas.height = sw + 20;
        const dCtx = deadCanvas.getContext('2d');

        // Draw blood puddle
        dCtx.save();
        dCtx.fillStyle = 'rgba(185, 28, 28, 0.75)';
        dCtx.beginPath();
        dCtx.ellipse(deadCanvas.width / 2, deadCanvas.height / 2, deadCanvas.width * 0.45, deadCanvas.height * 0.35, 0, 0, Math.PI * 2);
        dCtx.fill();

        // Draw rotated fallen body
        dCtx.translate(deadCanvas.width / 2, deadCanvas.height / 2);
        dCtx.rotate(Math.PI / 2);
        dCtx.drawImage(canvas, -sw / 2, -sh / 2);
        dCtx.restore();

        // 3. Generate preview Data URL for Lobby UI selection
        const iconCanvas = document.createElement('canvas');
        iconCanvas.width = 72;
        iconCanvas.height = 72;
        const iCtx = iconCanvas.getContext('2d');
        iCtx.fillStyle = '#0f172a';
        iCtx.beginPath();
        iCtx.arc(36, 36, 34, 0, Math.PI * 2);
        iCtx.fill();
        iCtx.strokeStyle = meta.color;
        iCtx.lineWidth = 3;
        iCtx.stroke();
        iCtx.drawImage(canvas, 10, 6, 52, 60);

        this.characterSprites[meta.id] = {
          meta: meta,
          aliveCanvas: canvas,
          deadCanvas: deadCanvas,
          iconDataUrl: iconCanvas.toDataURL()
        };
      });
    },

    generateFallbackAssets: function () {
      // Create a dark camping map fallback if image failed to load
      const mapCanvas = document.createElement('canvas');
      mapCanvas.width = 1024;
      mapCanvas.height = 1024;
      const ctx = mapCanvas.getContext('2d');
      ctx.fillStyle = '#022c22';
      ctx.fillRect(0, 0, 1024, 1024);
      // Fire pit
      ctx.fillStyle = '#f59e0b';
      ctx.beginPath();
      ctx.arc(512, 512, 60, 0, Math.PI * 2);
      ctx.fill();
      this.mapImage = mapCanvas;

      CHARACTERS_METADATA.forEach(meta => {
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 80;
        const cCtx = canvas.getContext('2d');
        cCtx.fillStyle = meta.color;
        cCtx.beginPath();
        cCtx.arc(32, 28, 20, 0, Math.PI * 2);
        cCtx.fill();
        cCtx.fillRect(16, 35, 32, 40);

        const iconCanvas = document.createElement('canvas');
        iconCanvas.width = 64;
        iconCanvas.height = 64;
        const iCtx = iconCanvas.getContext('2d');
        iCtx.fillStyle = meta.color;
        iCtx.beginPath();
        iCtx.arc(32, 32, 28, 0, Math.PI * 2);
        iCtx.fill();

        this.characterSprites[meta.id] = {
          meta: meta,
          aliveCanvas: canvas,
          deadCanvas: canvas,
          iconDataUrl: iconCanvas.toDataURL()
        };
      });
    }
  };

  global.SombrasAssets = {
    CHARACTERS: CHARACTERS_METADATA,
    Assets: Assets
  };

})(typeof window !== 'undefined' ? window : self);
