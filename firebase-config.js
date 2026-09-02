/**
 * FIREBASE CONFIGURATION & INITIALIZATION
 *
 * Provides Firebase Realtime Database and Anonymous Auth setup.
 * Supports:
 * - Direct static configuration in this file.
 * - Dynamic configuration via Settings UI stored in localStorage.
 * - Offline/Demo warning assistant for local testing.
 */

(function (global) {
  'use strict';

  // DEFAULT / TEMPLATE FIREBASE CONFIG
  // Puedes pegar tus credenciales de Firebase directamente aquí o configurarlas en la interfaz web:
  const DEFAULT_FIREBASE_CONFIG = {
    apiKey: "AIzaSyD5S5hi9a6SZIOHiyn-PExCKKvucXmRz6w",
    authDomain: "games-a17e2.firebaseapp.com",
    databaseURL: "https://games-a17e2-default-rtdb.firebaseio.com",
    projectId: "games-a17e2",
    storageBucket: "games-a17e2.firebasestorage.app",
    messagingSenderId: "363133587031",
    appId: "1:363133587031:web:483864db03d75b2c9ddd12",
    measurementId: "G-87RDDD85G9"
  };

  const STORAGE_KEY = 'sudoku_firebase_custom_config';

  function getStoredConfig() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed && (parsed.databaseURL || parsed.projectId)) {
          return parsed;
        }
      }
    } catch (e) {
      console.warn('Error leyendo configuración de Firebase desde localStorage:', e);
    }
    return null;
  }

  function getActiveConfig() {
    const custom = getStoredConfig();
    if (custom && custom.databaseURL) {
      return custom;
    }
    return DEFAULT_FIREBASE_CONFIG;
  }

  function saveCustomConfig(config) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
      return true;
    } catch (e) {
      console.error('Error guardando configuración:', e);
      return false;
    }
  }

  function clearCustomConfig() {
    try {
      localStorage.removeItem(STORAGE_KEY);
      return true;
    } catch (e) {
      return false;
    }
  }

  function isConfigured() {
    const cfg = getActiveConfig();
    return !!(cfg && cfg.databaseURL && cfg.apiKey);
  }

  let firebaseApp = null;
  let firebaseAuth = null;
  let firebaseDb = null;
  let initError = null;

  function initFirebase() {
    const cfg = getActiveConfig();
    if (!isConfigured()) {
      initError = 'Firebase no está configurado aún. Configura tus claves en Ajustes para jugar en tiempo real.';
      return { initialized: false, error: initError };
    }

    try {
      if (!global.firebase) {
        throw new Error('SDK de Firebase no cargado en la página.');
      }

      if (!firebaseApp) {
        if (!global.firebase.apps || global.firebase.apps.length === 0) {
          firebaseApp = global.firebase.initializeApp(cfg);
        } else {
          firebaseApp = global.firebase.app();
        }
      }

      firebaseAuth = global.firebase.auth();
      firebaseDb = global.firebase.database();

      return {
        initialized: true,
        app: firebaseApp,
        auth: firebaseAuth,
        db: firebaseDb
      };
    } catch (err) {
      console.error('Error al inicializar Firebase:', err);
      initError = err.message;
      return { initialized: false, error: err.message };
    }
  }

  const FirebaseService = {
    DEFAULT_CONFIG: DEFAULT_FIREBASE_CONFIG,
    getActiveConfig,
    saveCustomConfig,
    clearCustomConfig,
    isConfigured,
    initFirebase,
    getApp: () => firebaseApp,
    getAuth: () => firebaseAuth,
    getDb: () => firebaseDb,
    getInitError: () => initError
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = FirebaseService;
  } else {
    global.FirebaseService = FirebaseService;
  }

})(typeof window !== 'undefined' ? window : self);
