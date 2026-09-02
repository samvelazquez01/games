/**
 * SUDOKU WEB WORKER
 * Runs puzzle generation and heavy logical difficulty analysis in background thread
 * to guarantee smooth 60fps UI performance even for IMPOSIBLE difficulty generation.
 */

/* global importScripts, SudokuEngine */

try {
  importScripts('sudoku.js');
} catch (e) {
  console.warn('Worker importScripts failed:', e);
}

self.onmessage = function (e) {
  const { type, id, targetDifficulty, board } = e.data;

  try {
    if (type === 'GENERATE_PUZZLE') {
      const result = SudokuEngine.generatePuzzle(targetDifficulty, progress => {
        self.postMessage({
          type: 'PROGRESS',
          id,
          attempt: progress.attempt,
          status: progress.status,
          percent: progress.percent
        });
      });

      self.postMessage({
        type: 'PUZZLE_GENERATED',
        id,
        result: {
          puzzle: result.puzzle,
          solution: result.solution,
          cluesCount: result.cluesCount,
          difficulty: result.difficulty,
          difficultyScore: result.difficultyScore,
          highestTechnique: result.highestTechnique,
          techniqueCounts: result.techniqueCounts,
          stepsCount: result.steps ? result.steps.length : 0,
          attempts: result.attempts
        }
      });
    } else if (type === 'ANALYZE_BOARD') {
      const analysis = SudokuEngine.analyzeDifficulty(board);
      self.postMessage({
        type: 'BOARD_ANALYZED',
        id,
        result: analysis
      });
    }
  } catch (err) {
    self.postMessage({
      type: 'ERROR',
      id,
      error: err.message || 'Error en Worker de generación de Sudoku'
    });
  }
};
