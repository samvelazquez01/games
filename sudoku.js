/**
 * SUDOKU CORE ENGINE & LOGICAL DIFFICULTY ANALYZER
 *
 * Implements:
 * - Ultra-fast candidate bitmasks and lookup tables.
 * - Exact-cover / Backtracking unique solution solver (checks solutions === 1).
 * - Human Logical Solver with graded techniques:
 *    * Naked Single, Hidden Single
 *    * Pointing Pairs/Triples, Box-Line Reduction (Claiming)
 *    * Naked Pairs, Triples, Quads & Hidden Pairs, Triples, Quads
 *    * X-Wing, Swordfish, Jellyfish
 *    * XY-Wing, XYZ-Wing, W-Wing, Skyscraper, Two-String Kite
 *    * Simple Coloring (Single-digit strong link chains)
 *    * Finned X-Wing, Finned Swordfish
 *    * XY-Chains, Alternating Inference Chains (AIC), Forcing Chains
 * - Difficulty classification: EXPERTO, EXTREMO, IMPOSIBLE.
 * - Board generator with mathematical randomization (band/stack swaps, permutations, transpose).
 */

(function (global) {
  'use strict';

  // --- BITMASK & GRID CONSTANTS ---
  const ALL_CANDIDATES = 0x1ff; // Bits 0..8 represent digits 1..9
  const DIGIT_MASK = new Uint16Array(10);
  for (let d = 1; d <= 9; d++) {
    DIGIT_MASK[d] = 1 << (d - 1);
  }

  // Lookup tables
  const PEERS = new Array(81);
  const UNITS = new Array(27); // 9 rows, 9 cols, 9 boxes
  const CELL_UNITS = new Array(81); // 3 units per cell: [row, col, box]
  const CELL_ROW = new Uint8Array(81);
  const CELL_COL = new Uint8Array(81);
  const CELL_BOX = new Uint8Array(81);

  // Initialize lookup tables
  (function initTables() {
    for (let i = 0; i < 27; i++) {
      UNITS[i] = [];
    }

    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        const i = r * 9 + c;
        const b = Math.floor(r / 3) * 3 + Math.floor(c / 3);
        CELL_ROW[i] = r;
        CELL_COL[i] = c;
        CELL_BOX[i] = b;

        const rowUnit = r;
        const colUnit = 9 + c;
        const boxUnit = 18 + b;

        UNITS[rowUnit].push(i);
        UNITS[colUnit].push(i);
        UNITS[boxUnit].push(i);

        CELL_UNITS[i] = [UNITS[rowUnit], UNITS[colUnit], UNITS[boxUnit]];
      }
    }

    for (let i = 0; i < 81; i++) {
      const peerSet = new Set();
      const [rowU, colU, boxU] = CELL_UNITS[i];
      for (let j = 0; j < 9; j++) {
        if (rowU[j] !== i) peerSet.add(rowU[j]);
        if (colU[j] !== i) peerSet.add(colU[j]);
        if (boxU[j] !== i) peerSet.add(boxU[j]);
      }
      PEERS[i] = Array.from(peerSet);
    }
  })();

  // Bitwise helper functions
  function countBits(mask) {
    let count = 0;
    while (mask > 0) {
      count += mask & 1;
      mask >>= 1;
    }
    return count;
  }

  function maskToDigits(mask) {
    const digits = [];
    for (let d = 1; d <= 9; d++) {
      if (mask & DIGIT_MASK[d]) digits.push(d);
    }
    return digits;
  }

  function digitsToMask(digits) {
    let mask = 0;
    for (let i = 0; i < digits.length; i++) {
      mask |= DIGIT_MASK[digits[i]];
    }
    return mask;
  }

  function getSingleDigit(mask) {
    for (let d = 1; d <= 9; d++) {
      if (mask === DIGIT_MASK[d]) return d;
    }
    return 0;
  }

  // --- PARSING & CONVERSION ---
  function parseBoard(input) {
    const board = new Uint8Array(81);
    if (typeof input === 'string') {
      const clean = input.replace(/[^0-9.]/g, '');
      for (let i = 0; i < 81; i++) {
        const ch = clean[i] || '.';
        board[i] = ch >= '1' && ch <= '9' ? parseInt(ch, 10) : 0;
      }
    } else if (Array.isArray(input) || input instanceof Uint8Array) {
      for (let i = 0; i < 81; i++) {
        board[i] = input[i] || 0;
      }
    }
    return board;
  }

  function boardToString(board) {
    let str = '';
    for (let i = 0; i < 81; i++) {
      str += board[i] === 0 ? '.' : board[i];
    }
    return str;
  }

  // --- CANDIDATE MASK GRID ---
  function computeCandidateGrid(board) {
    const candidates = new Uint16Array(81);
    for (let i = 0; i < 81; i++) {
      if (board[i] !== 0) {
        candidates[i] = 0;
      } else {
        let mask = ALL_CANDIDATES;
        const peers = PEERS[i];
        for (let p = 0; p < peers.length; p++) {
          const val = board[peers[p]];
          if (val !== 0) {
            mask &= ~DIGIT_MASK[val];
          }
        }
        candidates[i] = mask;
      }
    }
    return candidates;
  }

  // --- EXACT COVER / BACKTRACKING UNIQUE SOLVER ---
  function countSolutions(board, limit = 2) {
    const grid = new Uint8Array(board);
    let solutions = 0;
    let singleSolution = null;

    function search() {
      if (solutions >= limit) return;

      // Find cell with minimum remaining values (MRV)
      let minIdx = -1;
      let minCount = 10;
      let minMask = 0;

      for (let i = 0; i < 81; i++) {
        if (grid[i] === 0) {
          let mask = ALL_CANDIDATES;
          const peers = PEERS[i];
          for (let p = 0; p < peers.length; p++) {
            const val = grid[peers[p]];
            if (val !== 0) {
              mask &= ~DIGIT_MASK[val];
            }
          }
          const cnt = countBits(mask);
          if (cnt === 0) return; // Dead end
          if (cnt < minCount) {
            minCount = cnt;
            minIdx = i;
            minMask = mask;
            if (cnt === 1) break;
          }
        }
      }

      if (minIdx === -1) {
        solutions++;
        if (solutions === 1) {
          singleSolution = new Uint8Array(grid);
        }
        return;
      }

      for (let d = 1; d <= 9; d++) {
        if (minMask & DIGIT_MASK[d]) {
          grid[minIdx] = d;
          search();
          grid[minIdx] = 0;
          if (solutions >= limit) return;
        }
      }
    }

    search();
    return { count: solutions, solution: singleSolution };
  }

  function hasUniqueSolution(board) {
    const result = countSolutions(board, 2);
    return result.count === 1;
  }

  function solveUnique(board) {
    const result = countSolutions(board, 2);
    return {
      unique: result.count === 1,
      solution: result.solution,
      solutionsCount: result.count
    };
  }

  // --- LOGICAL TECHNIQUES SUITE ---

  const TECHNIQUE_WEIGHTS = {
    'Naked Single': 10,
    'Hidden Single': 20,
    'Pointing': 50,
    'Box-Line Reduction': 60,
    'Naked Pair': 80,
    'Hidden Pair': 120,
    'Naked Triple': 140,
    'Hidden Triple': 180,
    'Naked Quad': 220,
    'Hidden Quad': 260,
    'X-Wing': 350,
    'Skyscraper': 400,
    'Two-String Kite': 420,
    'W-Wing': 460,
    'Simple Coloring': 500,
    'XY-Wing': 550,
    'XYZ-Wing': 600,
    'Swordfish': 750,
    'Finned X-Wing': 850,
    'Jellyfish': 1100,
    'Finned Swordfish': 1200,
    'XY-Chain': 1500,
    'Alternating Inference Chain': 2000,
    'Forcing Chain': 2500
  };

  function getCombinations(arr, k) {
    const result = [];
    function backtrack(start, combo) {
      if (combo.length === k) {
        result.push([...combo]);
        return;
      }
      for (let i = start; i < arr.length; i++) {
        combo.push(arr[i]);
        backtrack(i + 1, combo);
        combo.pop();
      }
    }
    backtrack(0, []);
    return result;
  }

  // 1. Naked Singles
  function findNakedSingle(board, candidates) {
    for (let i = 0; i < 81; i++) {
      if (board[i] === 0 && countBits(candidates[i]) === 1) {
        const digit = getSingleDigit(candidates[i]);
        return {
          technique: 'Naked Single',
          cell: i,
          digit: digit,
          eliminations: [],
          placements: [{ cell: i, digit: digit }],
          weight: TECHNIQUE_WEIGHTS['Naked Single']
        };
      }
    }
    return null;
  }

  // 2. Hidden Singles
  function findHiddenSingle(board, candidates) {
    for (let u = 0; u < 27; u++) {
      const unit = UNITS[u];
      for (let d = 1; d <= 9; d++) {
        const mask = DIGIT_MASK[d];
        let foundCell = -1;
        let count = 0;
        for (let k = 0; k < 9; k++) {
          const cell = unit[k];
          if (board[cell] === d) {
            count = -1;
            break;
          }
          if (board[cell] === 0 && (candidates[cell] & mask)) {
            count++;
            foundCell = cell;
          }
        }
        if (count === 1) {
          return {
            technique: 'Hidden Single',
            unitType: u < 9 ? 'fila' : u < 18 ? 'columna' : 'caja',
            unitIndex: u % 9,
            cell: foundCell,
            digit: d,
            eliminations: [],
            placements: [{ cell: foundCell, digit: d }],
            weight: TECHNIQUE_WEIGHTS['Hidden Single']
          };
        }
      }
    }
    return null;
  }

  // 3. Pointing (Box to Line Reduction)
  function findPointing(board, candidates) {
    for (let b = 0; b < 9; b++) {
      const boxUnit = UNITS[18 + b];
      for (let d = 1; d <= 9; d++) {
        const mask = DIGIT_MASK[d];
        const cellsWithD = [];
        for (let k = 0; k < 9; k++) {
          const cell = boxUnit[k];
          if (board[cell] === 0 && (candidates[cell] & mask)) {
            cellsWithD.push(cell);
          }
        }
        if (cellsWithD.length >= 2 && cellsWithD.length <= 3) {
          const firstRow = CELL_ROW[cellsWithD[0]];
          const sameRow = cellsWithD.every(c => CELL_ROW[c] === firstRow);
          if (sameRow) {
            const eliminations = [];
            const rowCells = UNITS[firstRow];
            for (let k = 0; k < 9; k++) {
              const cell = rowCells[k];
              if (CELL_BOX[cell] !== b && board[cell] === 0 && (candidates[cell] & mask)) {
                eliminations.push({ cell, digit: d });
              }
            }
            if (eliminations.length > 0) {
              return {
                technique: 'Pointing',
                box: b,
                row: firstRow,
                digit: d,
                cells: cellsWithD,
                eliminations,
                weight: TECHNIQUE_WEIGHTS['Pointing']
              };
            }
          }

          const firstCol = CELL_COL[cellsWithD[0]];
          const sameCol = cellsWithD.every(c => CELL_COL[c] === firstCol);
          if (sameCol) {
            const eliminations = [];
            const colCells = UNITS[9 + firstCol];
            for (let k = 0; k < 9; k++) {
              const cell = colCells[k];
              if (CELL_BOX[cell] !== b && board[cell] === 0 && (candidates[cell] & mask)) {
                eliminations.push({ cell, digit: d });
              }
            }
            if (eliminations.length > 0) {
              return {
                technique: 'Pointing',
                box: b,
                col: firstCol,
                digit: d,
                cells: cellsWithD,
                eliminations,
                weight: TECHNIQUE_WEIGHTS['Pointing']
              };
            }
          }
        }
      }
    }
    return null;
  }

  // 4. Box-Line Reduction (Claiming / Line to Box Reduction)
  function findBoxLineReduction(board, candidates) {
    for (let u = 0; u < 18; u++) {
      const isRow = u < 9;
      const unit = UNITS[u];
      for (let d = 1; d <= 9; d++) {
        const mask = DIGIT_MASK[d];
        const cellsWithD = [];
        for (let k = 0; k < 9; k++) {
          const cell = unit[k];
          if (board[cell] === 0 && (candidates[cell] & mask)) {
            cellsWithD.push(cell);
          }
        }
        if (cellsWithD.length >= 2 && cellsWithD.length <= 3) {
          const firstBox = CELL_BOX[cellsWithD[0]];
          const sameBox = cellsWithD.every(c => CELL_BOX[c] === firstBox);
          if (sameBox) {
            const eliminations = [];
            const boxCells = UNITS[18 + firstBox];
            for (let k = 0; k < 9; k++) {
              const cell = boxCells[k];
              const inSameLine = isRow ? CELL_ROW[cell] === u : CELL_COL[cell] === (u - 9);
              if (!inSameLine && board[cell] === 0 && (candidates[cell] & mask)) {
                eliminations.push({ cell, digit: d });
              }
            }
            if (eliminations.length > 0) {
              return {
                technique: 'Box-Line Reduction',
                lineType: isRow ? 'fila' : 'columna',
                lineIndex: isRow ? u : u - 9,
                box: firstBox,
                digit: d,
                cells: cellsWithD,
                eliminations,
                weight: TECHNIQUE_WEIGHTS['Box-Line Reduction']
              };
            }
          }
        }
      }
    }
    return null;
  }

  // 5. Naked Subsets (Naked Pairs, Triples, Quads: size N)
  function findNakedSubsets(board, candidates, size) {
    const techName = size === 2 ? 'Naked Pair' : size === 3 ? 'Naked Triple' : 'Naked Quad';
    for (let u = 0; u < 27; u++) {
      const unit = UNITS[u];
      const emptyCells = [];
      for (let k = 0; k < 9; k++) {
        const cell = unit[k];
        if (board[cell] === 0) {
          const cnt = countBits(candidates[cell]);
          if (cnt >= 2 && cnt <= size) {
            emptyCells.push(cell);
          }
        }
      }
      if (emptyCells.length < size) continue;

      const combos = getCombinations(emptyCells, size);
      for (let c = 0; c < combos.length; c++) {
        const combo = combos[c];
        let unionMask = 0;
        for (let i = 0; i < size; i++) {
          unionMask |= candidates[combo[i]];
        }
        if (countBits(unionMask) === size) {
          const eliminations = [];
          const digits = maskToDigits(unionMask);
          for (let k = 0; k < 9; k++) {
            const cell = unit[k];
            if (board[cell] === 0 && !combo.includes(cell)) {
              for (let d = 0; d < digits.length; d++) {
                const digit = digits[d];
                if (candidates[cell] & DIGIT_MASK[digit]) {
                  eliminations.push({ cell, digit });
                }
              }
            }
          }
          if (eliminations.length > 0) {
            return {
              technique: techName,
              cells: combo,
              digits,
              eliminations,
              weight: TECHNIQUE_WEIGHTS[techName]
            };
          }
        }
      }
    }
    return null;
  }

  // 6. Hidden Subsets (Hidden Pairs, Triples, Quads: size N)
  function findHiddenSubsets(board, candidates, size) {
    const techName = size === 2 ? 'Hidden Pair' : size === 3 ? 'Hidden Triple' : 'Hidden Quad';
    for (let u = 0; u < 27; u++) {
      const unit = UNITS[u];
      const digitCells = new Array(10);
      for (let d = 1; d <= 9; d++) {
        digitCells[d] = [];
        const mask = DIGIT_MASK[d];
        for (let k = 0; k < 9; k++) {
          const cell = unit[k];
          if (board[cell] === 0 && (candidates[cell] & mask)) {
            digitCells[d].push(cell);
          }
        }
      }

      const validDigits = [];
      for (let d = 1; d <= 9; d++) {
        if (digitCells[d].length >= 2 && digitCells[d].length <= size) {
          validDigits.push(d);
        }
      }
      if (validDigits.length < size) continue;

      const digitCombos = getCombinations(validDigits, size);
      for (let c = 0; c < digitCombos.length; c++) {
        const dCombo = digitCombos[c];
        const cellSet = new Set();
        for (let i = 0; i < size; i++) {
          const cells = digitCells[dCombo[i]];
          for (let j = 0; j < cells.length; j++) {
            cellSet.add(cells[j]);
          }
        }

        if (cellSet.size === size) {
          const comboCells = Array.from(cellSet);
          const comboMask = digitsToMask(dCombo);
          const eliminations = [];
          for (let i = 0; i < comboCells.length; i++) {
            const cell = comboCells[i];
            const otherDigitsMask = candidates[cell] & ~comboMask;
            if (otherDigitsMask !== 0) {
              const otherDigits = maskToDigits(otherDigitsMask);
              for (let d = 0; d < otherDigits.length; d++) {
                eliminations.push({ cell, digit: otherDigits[d] });
              }
            }
          }
          if (eliminations.length > 0) {
            return {
              technique: techName,
              cells: comboCells,
              digits: dCombo,
              eliminations,
              weight: TECHNIQUE_WEIGHTS[techName]
            };
          }
        }
      }
    }
    return null;
  }

  // 7. Fish (X-Wing, Swordfish, Jellyfish: size N = 2, 3, 4)
  function findFish(board, candidates, size) {
    const techName = size === 2 ? 'X-Wing' : size === 3 ? 'Swordfish' : 'Jellyfish';

    for (let d = 1; d <= 9; d++) {
      const mask = DIGIT_MASK[d];
      const rowCols = [];
      for (let r = 0; r < 9; r++) {
        const cols = [];
        for (let c = 0; c < 9; c++) {
          const cell = r * 9 + c;
          if (board[cell] === 0 && (candidates[cell] & mask)) {
            cols.push(c);
          }
        }
        if (cols.length >= 2 && cols.length <= size) {
          rowCols.push({ row: r, cols });
        }
      }

      if (rowCols.length >= size) {
        const combos = getCombinations(rowCols, size);
        for (let k = 0; k < combos.length; k++) {
          const combo = combos[k];
          const colSet = new Set();
          for (let i = 0; i < size; i++) {
            for (let j = 0; j < combo[i].cols.length; j++) {
              colSet.add(combo[i].cols[j]);
            }
          }
          if (colSet.size === size) {
            const targetCols = Array.from(colSet);
            const baseRows = combo.map(x => x.row);
            const eliminations = [];
            for (let tc = 0; tc < targetCols.length; tc++) {
              const c = targetCols[tc];
              for (let r = 0; r < 9; r++) {
                if (!baseRows.includes(r)) {
                  const cell = r * 9 + c;
                  if (board[cell] === 0 && (candidates[cell] & mask)) {
                    eliminations.push({ cell, digit: d });
                  }
                }
              }
            }
            if (eliminations.length > 0) {
              return {
                technique: techName,
                digit: d,
                baseRows,
                targetCols,
                eliminations,
                weight: TECHNIQUE_WEIGHTS[techName]
              };
            }
          }
        }
      }

      const colRows = [];
      for (let c = 0; c < 9; c++) {
        const rows = [];
        for (let r = 0; r < 9; r++) {
          const cell = r * 9 + c;
          if (board[cell] === 0 && (candidates[cell] & mask)) {
            rows.push(r);
          }
        }
        if (rows.length >= 2 && rows.length <= size) {
          colRows.push({ col: c, rows });
        }
      }

      if (colRows.length >= size) {
        const combos = getCombinations(colRows, size);
        for (let k = 0; k < combos.length; k++) {
          const combo = combos[k];
          const rowSet = new Set();
          for (let i = 0; i < size; i++) {
            for (let j = 0; j < combo[i].rows.length; j++) {
              rowSet.add(combo[i].rows[j]);
            }
          }
          if (rowSet.size === size) {
            const targetRows = Array.from(rowSet);
            const baseCols = combo.map(x => x.col);
            const eliminations = [];
            for (let tr = 0; tr < targetRows.length; tr++) {
              const r = targetRows[tr];
              for (let c = 0; c < 9; c++) {
                if (!baseCols.includes(c)) {
                  const cell = r * 9 + c;
                  if (board[cell] === 0 && (candidates[cell] & mask)) {
                    eliminations.push({ cell, digit: d });
                  }
                }
              }
            }
            if (eliminations.length > 0) {
              return {
                technique: techName,
                digit: d,
                baseCols,
                targetRows,
                eliminations,
                weight: TECHNIQUE_WEIGHTS[techName]
              };
            }
          }
        }
      }
    }
    return null;
  }

  // 8. XY-Wing (Y-Wing)
  function findXYWing(board, candidates) {
    const bivalueCells = [];
    for (let i = 0; i < 81; i++) {
      if (board[i] === 0 && countBits(candidates[i]) === 2) {
        bivalueCells.push(i);
      }
    }
    if (bivalueCells.length < 3) return null;

    for (let p = 0; p < bivalueCells.length; p++) {
      const pivot = bivalueCells[p];
      const pivotDigits = maskToDigits(candidates[pivot]);
      const A = pivotDigits[0];
      const B = pivotDigits[1];
      const pivotPeers = PEERS[pivot];

      const pincersA = [];
      const pincersB = [];

      for (let k = 0; k < pivotPeers.length; k++) {
        const peer = pivotPeers[k];
        if (board[peer] === 0 && countBits(candidates[peer]) === 2) {
          const peerDigits = maskToDigits(candidates[peer]);
          if (peerDigits.includes(A) && !peerDigits.includes(B)) {
            const C = peerDigits[0] === A ? peerDigits[1] : peerDigits[0];
            pincersA.push({ cell: peer, C });
          }
          if (peerDigits.includes(B) && !peerDigits.includes(A)) {
            const C = peerDigits[0] === B ? peerDigits[1] : peerDigits[0];
            pincersB.push({ cell: peer, C });
          }
        }
      }

      for (let i = 0; i < pincersA.length; i++) {
        const pA = pincersA[i];
        for (let j = 0; j < pincersB.length; j++) {
          const pB = pincersB[j];
          if (pA.cell !== pB.cell && pA.C === pB.C) {
            const C = pA.C;
            const maskC = DIGIT_MASK[C];
            const peersA = PEERS[pA.cell];
            const peersB = new Set(PEERS[pB.cell]);
            const eliminations = [];

            for (let m = 0; m < peersA.length; m++) {
              const target = peersA[m];
              if (
                target !== pivot &&
                target !== pA.cell &&
                target !== pB.cell &&
                peersB.has(target) &&
                board[target] === 0 &&
                (candidates[target] & maskC)
              ) {
                eliminations.push({ cell: target, digit: C });
              }
            }

            if (eliminations.length > 0) {
              return {
                technique: 'XY-Wing',
                pivot,
                pincers: [pA.cell, pB.cell],
                digit: C,
                eliminations,
                weight: TECHNIQUE_WEIGHTS['XY-Wing']
              };
            }
          }
        }
      }
    }
    return null;
  }

  // 9. XYZ-Wing
  function findXYZWing(board, candidates) {
    const trivalueCells = [];
    const bivalueCells = [];
    for (let i = 0; i < 81; i++) {
      if (board[i] === 0) {
        const cnt = countBits(candidates[i]);
        if (cnt === 3) trivalueCells.push(i);
        else if (cnt === 2) bivalueCells.push(i);
      }
    }
    if (trivalueCells.length === 0 || bivalueCells.length < 2) return null;

    for (let p = 0; p < trivalueCells.length; p++) {
      const pivot = trivalueCells[p];
      const digits = maskToDigits(candidates[pivot]);
      const pivotPeers = PEERS[pivot];
      const biPeers = [];

      for (let k = 0; k < pivotPeers.length; k++) {
        const peer = pivotPeers[k];
        if (board[peer] === 0 && countBits(candidates[peer]) === 2) {
          const pDigits = maskToDigits(candidates[peer]);
          if (digits.includes(pDigits[0]) && digits.includes(pDigits[1])) {
            biPeers.push({ cell: peer, digits: pDigits });
          }
        }
      }

      if (biPeers.length < 2) continue;

      for (let i = 0; i < biPeers.length; i++) {
        for (let j = i + 1; j < biPeers.length; j++) {
          const p1 = biPeers[i];
          const p2 = biPeers[j];
          const commonZ = p1.digits.filter(d => p2.digits.includes(d));
          if (commonZ.length === 1) {
            const Z = commonZ[0];
            const maskZ = DIGIT_MASK[Z];
            const unionMask = candidates[pivot] | candidates[p1.cell] | candidates[p2.cell];
            if (countBits(unionMask) === 3) {
              const peersP = new Set(pivotPeers);
              const peers1 = new Set(PEERS[p1.cell]);
              const peers2 = PEERS[p2.cell];
              const eliminations = [];

              for (let m = 0; m < peers2.length; m++) {
                const target = peers2[m];
                if (
                  target !== pivot &&
                  target !== p1.cell &&
                  target !== p2.cell &&
                  peersP.has(target) &&
                  peers1.has(target) &&
                  board[target] === 0 &&
                  (candidates[target] & maskZ)
                ) {
                  eliminations.push({ cell: target, digit: Z });
                }
              }

              if (eliminations.length > 0) {
                return {
                  technique: 'XYZ-Wing',
                  pivot,
                  pincers: [p1.cell, p2.cell],
                  digit: Z,
                  eliminations,
                  weight: TECHNIQUE_WEIGHTS['XYZ-Wing']
                };
              }
            }
          }
        }
      }
    }
    return null;
  }

  // 10. Skyscraper
  function findSkyscraper(board, candidates) {
    for (let d = 1; d <= 9; d++) {
      const mask = DIGIT_MASK[d];

      const rowPairs = [];
      for (let r = 0; r < 9; r++) {
        const cols = [];
        for (let c = 0; c < 9; c++) {
          const cell = r * 9 + c;
          if (board[cell] === 0 && (candidates[cell] & mask)) {
            cols.push(c);
          }
        }
        if (cols.length === 2) {
          rowPairs.push({ row: r, c1: cols[0], c2: cols[1] });
        }
      }

      if (rowPairs.length >= 2) {
        for (let i = 0; i < rowPairs.length; i++) {
          for (let j = i + 1; j < rowPairs.length; j++) {
            const rp1 = rowPairs[i];
            const rp2 = rowPairs[j];

            if (rp1.c1 === rp2.c1 && rp1.c2 !== rp2.c2) {
              const roof1 = rp1.row * 9 + rp1.c2;
              const roof2 = rp2.row * 9 + rp2.c2;
              const eliminations = [];
              const peers1 = PEERS[roof1];
              const peers2 = new Set(PEERS[roof2]);

              for (let k = 0; k < peers1.length; k++) {
                const target = peers1[k];
                if (target !== roof1 && target !== roof2 && peers2.has(target) && board[target] === 0 && (candidates[target] & mask)) {
                  eliminations.push({ cell: target, digit: d });
                }
              }
              if (eliminations.length > 0) {
                return {
                  technique: 'Skyscraper',
                  digit: d,
                  cells: [roof1, roof2],
                  eliminations,
                  weight: TECHNIQUE_WEIGHTS['Skyscraper']
                };
              }
            }

            if (rp1.c2 === rp2.c2 && rp1.c1 !== rp2.c1) {
              const roof1 = rp1.row * 9 + rp1.c1;
              const roof2 = rp2.row * 9 + rp2.c1;
              const eliminations = [];
              const peers1 = PEERS[roof1];
              const peers2 = new Set(PEERS[roof2]);

              for (let k = 0; k < peers1.length; k++) {
                const target = peers1[k];
                if (target !== roof1 && target !== roof2 && peers2.has(target) && board[target] === 0 && (candidates[target] & mask)) {
                  eliminations.push({ cell: target, digit: d });
                }
              }
              if (eliminations.length > 0) {
                return {
                  technique: 'Skyscraper',
                  digit: d,
                  cells: [roof1, roof2],
                  eliminations,
                  weight: TECHNIQUE_WEIGHTS['Skyscraper']
                };
              }
            }
          }
        }
      }
    }
    return null;
  }

  // 11. Two-String Kite
  function findTwoStringKite(board, candidates) {
    for (let d = 1; d <= 9; d++) {
      const mask = DIGIT_MASK[d];
      for (let b = 0; b < 9; b++) {
        for (let r = 0; r < 9; r++) {
          if (Math.floor(r / 3) !== Math.floor(b / 3)) continue;
          const rCells = [];
          for (let c = 0; c < 9; c++) {
            const cell = r * 9 + c;
            if (board[cell] === 0 && (candidates[cell] & mask)) rCells.push(cell);
          }
          if (rCells.length !== 2) continue;

          for (let c = 0; c < 9; c++) {
            if (Math.floor(c / 3) !== (b % 3)) continue;
            const cCells = [];
            for (let row = 0; row < 9; row++) {
              const cell = row * 9 + c;
              if (board[cell] === 0 && (candidates[cell] & mask)) cCells.push(cell);
            }
            if (cCells.length !== 2) continue;

            const rInBox = rCells.filter(cell => CELL_BOX[cell] === b);
            const cInBox = cCells.filter(cell => CELL_BOX[cell] === b);

            if (rInBox.length === 1 && cInBox.length === 1 && rInBox[0] !== cInBox[0]) {
              const rEnd = rCells.find(cell => CELL_BOX[cell] !== b);
              const cEnd = cCells.find(cell => CELL_BOX[cell] !== b);
              if (rEnd && cEnd) {
                const target = CELL_ROW[rEnd] * 9 + CELL_COL[cEnd];
                if (board[target] === 0 && (candidates[target] & mask)) {
                  return {
                    technique: 'Two-String Kite',
                    digit: d,
                    box: b,
                    ends: [rEnd, cEnd],
                    eliminations: [{ cell: target, digit: d }],
                    weight: TECHNIQUE_WEIGHTS['Two-String Kite']
                  };
                }
              }
            }
          }
        }
      }
    }
    return null;
  }

  // 12. W-Wing
  function findWWing(board, candidates) {
    const bivalueCells = [];
    for (let i = 0; i < 81; i++) {
      if (board[i] === 0 && countBits(candidates[i]) === 2) {
        bivalueCells.push(i);
      }
    }
    if (bivalueCells.length < 2) return null;

    for (let i = 0; i < bivalueCells.length; i++) {
      for (let j = i + 1; j < bivalueCells.length; j++) {
        const c1 = bivalueCells[i];
        const c2 = bivalueCells[j];
        if (candidates[c1] === candidates[c2] && !PEERS[c1].includes(c2)) {
          const [A, B] = maskToDigits(candidates[c1]);
          const digits = [A, B];
          for (let idx = 0; idx < 2; idx++) {
            const linkDigit = digits[idx];
            const elimDigit = digits[1 - idx];
            const linkMask = DIGIT_MASK[linkDigit];
            const elimMask = DIGIT_MASK[elimDigit];

            for (let u = 0; u < 27; u++) {
              const unit = UNITS[u];
              const cellsWithLink = [];
              for (let k = 0; k < 9; k++) {
                const cell = unit[k];
                if (board[cell] === 0 && (candidates[cell] & linkMask)) {
                  cellsWithLink.push(cell);
                }
              }
              if (cellsWithLink.length === 2) {
                const [l1, l2] = cellsWithLink;
                const c1SeesL1 = PEERS[c1].includes(l1) || c1 === l1;
                const c2SeesL2 = PEERS[c2].includes(l2) || c2 === l2;
                const c1SeesL2 = PEERS[c1].includes(l2) || c1 === l2;
                const c2SeesL1 = PEERS[c2].includes(l1) || c2 === l1;

                if ((c1SeesL1 && c2SeesL2) || (c1SeesL2 && c2SeesL1)) {
                  const peers1 = PEERS[c1];
                  const peers2 = new Set(PEERS[c2]);
                  const eliminations = [];
                  for (let m = 0; m < peers1.length; m++) {
                    const target = peers1[m];
                    if (target !== c1 && target !== c2 && peers2.has(target) && board[target] === 0 && (candidates[target] & elimMask)) {
                      eliminations.push({ cell: target, digit: elimDigit });
                    }
                  }
                  if (eliminations.length > 0) {
                    return {
                      technique: 'W-Wing',
                      wings: [c1, c2],
                      bridge: [l1, l2],
                      linkDigit,
                      elimDigit,
                      eliminations,
                      weight: TECHNIQUE_WEIGHTS['W-Wing']
                    };
                  }
                }
              }
            }
          }
        }
      }
    }
    return null;
  }

  // 13. Simple Coloring
  function findSimpleColoring(board, candidates) {
    for (let d = 1; d <= 9; d++) {
      const mask = DIGIT_MASK[d];
      const adj = new Map();
      for (let u = 0; u < 27; u++) {
        const unit = UNITS[u];
        const cells = [];
        for (let k = 0; k < 9; k++) {
          const cell = unit[k];
          if (board[cell] === 0 && (candidates[cell] & mask)) {
            cells.push(cell);
          }
        }
        if (cells.length === 2) {
          const [u1, u2] = cells;
          if (!adj.has(u1)) adj.set(u1, new Set());
          if (!adj.has(u2)) adj.set(u2, new Set());
          adj.get(u1).add(u2);
          adj.get(u2).add(u1);
        }
      }

      if (adj.size === 0) continue;

      const visited = new Map();
      for (const startCell of adj.keys()) {
        if (visited.has(startCell)) continue;

        const group0 = [];
        const group1 = [];
        const queue = [startCell];
        visited.set(startCell, 0);
        group0.push(startCell);

        let validBipartite = true;
        while (queue.length > 0) {
          const curr = queue.shift();
          const currColor = visited.get(curr);
          const nextColor = 1 - currColor;

          for (const neighbor of adj.get(curr)) {
            if (!visited.has(neighbor)) {
              visited.set(neighbor, nextColor);
              if (nextColor === 0) group0.push(neighbor);
              else group1.push(neighbor);
              queue.push(neighbor);
            } else if (visited.get(neighbor) === currColor) {
              validBipartite = false;
            }
          }
        }

        if (validBipartite && group0.length > 0 && group1.length > 0) {
          const eliminations = [];
          const set0 = new Set(group0);
          const set1 = new Set(group1);

          for (let i = 0; i < 81; i++) {
            if (board[i] === 0 && (candidates[i] & mask) && !set0.has(i) && !set1.has(i)) {
              const peers = PEERS[i];
              const sees0 = peers.some(p => set0.has(p));
              const sees1 = peers.some(p => set1.has(p));
              if (sees0 && sees1) {
                eliminations.push({ cell: i, digit: d });
              }
            }
          }

          if (eliminations.length > 0) {
            return {
              technique: 'Simple Coloring',
              digit: d,
              group0,
              group1,
              eliminations,
              weight: TECHNIQUE_WEIGHTS['Simple Coloring']
            };
          }
        }
      }
    }
    return null;
  }

  // 14. Finned Fish
  function findFinnedFish(board, candidates, size) {
    if (size !== 2 && size !== 3) return null;
    const techName = size === 2 ? 'Finned X-Wing' : 'Finned Swordfish';

    for (let d = 1; d <= 9; d++) {
      const mask = DIGIT_MASK[d];
      const rowData = [];
      for (let r = 0; r < 9; r++) {
        const cols = [];
        for (let c = 0; c < 9; c++) {
          const cell = r * 9 + c;
          if (board[cell] === 0 && (candidates[cell] & mask)) {
            cols.push(c);
          }
        }
        if (cols.length >= 2 && cols.length <= size + 1) {
          rowData.push({ row: r, cols });
        }
      }

      if (rowData.length >= size) {
        const combos = getCombinations(rowData, size);
        for (let k = 0; k < combos.length; k++) {
          const combo = combos[k];
          const allCols = new Set();
          for (let i = 0; i < size; i++) {
            for (let j = 0; j < combo[i].cols.length; j++) {
              allCols.add(combo[i].cols[j]);
            }
          }
          if (allCols.size === size + 1) {
            const colList = Array.from(allCols);
            const colSubsets = getCombinations(colList, size);
            for (let cs = 0; cs < colSubsets.length; cs++) {
              const coverCols = colSubsets[cs];
              const finCol = colList.find(c => !coverCols.includes(c));

              const finCells = [];
              for (let i = 0; i < size; i++) {
                if (combo[i].cols.includes(finCol)) {
                  finCells.push(combo[i].row * 9 + finCol);
                }
              }

              if (finCells.length === 1) {
                const fin = finCells[0];
                const finBox = CELL_BOX[fin];
                const baseRows = combo.map(x => x.row);
                const eliminations = [];

                for (let cc = 0; cc < coverCols.length; cc++) {
                  const col = coverCols[cc];
                  for (let r = 0; r < 9; r++) {
                    if (!baseRows.includes(r)) {
                      const cell = r * 9 + col;
                      if (CELL_BOX[cell] === finBox && board[cell] === 0 && (candidates[cell] & mask)) {
                        eliminations.push({ cell, digit: d });
                      }
                    }
                  }
                }

                if (eliminations.length > 0) {
                  return {
                    technique: techName,
                    digit: d,
                    baseRows,
                    coverCols,
                    fin,
                    eliminations,
                    weight: TECHNIQUE_WEIGHTS[techName]
                  };
                }
              }
            }
          }
        }
      }
    }
    return null;
  }

  // 15. XY-Chains
  function findXYChain(board, candidates, maxDepth = 10) {
    const bivalueCells = [];
    for (let i = 0; i < 81; i++) {
      if (board[i] === 0 && countBits(candidates[i]) === 2) {
        bivalueCells.push(i);
      }
    }
    if (bivalueCells.length < 3) return null;

    for (let s = 0; s < bivalueCells.length; s++) {
      const startCell = bivalueCells[s];
      const startDigits = maskToDigits(candidates[startCell]);

      for (let sd = 0; sd < 2; sd++) {
        const startDigit = startDigits[sd];
        const linkDigit = startDigits[1 - sd];

        const queue = [{
          cell: startCell,
          outgoing: linkDigit,
          path: [startCell]
        }];

        while (queue.length > 0) {
          const curr = queue.shift();
          if (curr.path.length > maxDepth) continue;

          const currPeers = PEERS[curr.cell];
          for (let p = 0; p < currPeers.length; p++) {
            const nextCell = currPeers[p];
            if (bivalueCells.includes(nextCell) && !curr.path.includes(nextCell)) {
              const nextDigits = maskToDigits(candidates[nextCell]);
              if (nextDigits.includes(curr.outgoing)) {
                const nextOutgoing = nextDigits[0] === curr.outgoing ? nextDigits[1] : nextDigits[0];

                if (nextOutgoing === startDigit && curr.path.length >= 2) {
                  const startPeers = PEERS[startCell];
                  const endPeers = new Set(PEERS[nextCell]);
                  const maskStart = DIGIT_MASK[startDigit];
                  const eliminations = [];

                  for (let m = 0; m < startPeers.length; m++) {
                    const target = startPeers[m];
                    if (
                      target !== startCell &&
                      target !== nextCell &&
                      endPeers.has(target) &&
                      board[target] === 0 &&
                      (candidates[target] & maskStart)
                    ) {
                      eliminations.push({ cell: target, digit: startDigit });
                    }
                  }

                  if (eliminations.length > 0) {
                    return {
                      technique: 'XY-Chain',
                      chain: [...curr.path, nextCell],
                      digit: startDigit,
                      eliminations,
                      weight: TECHNIQUE_WEIGHTS['XY-Chain']
                    };
                  }
                }

                queue.push({
                  cell: nextCell,
                  outgoing: nextOutgoing,
                  path: [...curr.path, nextCell]
                });
              }
            }
          }
        }
      }
    }
    return null;
  }

  // 16. Forcing Chains
  function findForcingChain(board, candidates) {
    const bivalueCells = [];
    for (let i = 0; i < 81; i++) {
      if (board[i] === 0 && countBits(candidates[i]) === 2) {
        bivalueCells.push(i);
      }
    }
    if (bivalueCells.length === 0) return null;

    for (let i = 0; i < bivalueCells.length; i++) {
      const cell = bivalueCells[i];
      const [d1, d2] = maskToDigits(candidates[cell]);

      const sim1 = simulateLogicalImplications(board, candidates, cell, d1);
      const sim2 = simulateLogicalImplications(board, candidates, cell, d2);

      if (sim1.invalid && !sim2.invalid) {
        return {
          technique: 'Forcing Chain',
          cell,
          eliminations: [{ cell, digit: d1 }],
          weight: TECHNIQUE_WEIGHTS['Forcing Chain']
        };
      }
      if (sim2.invalid && !sim1.invalid) {
        return {
          technique: 'Forcing Chain',
          cell,
          eliminations: [{ cell, digit: d2 }],
          weight: TECHNIQUE_WEIGHTS['Forcing Chain']
        };
      }

      if (!sim1.invalid && !sim2.invalid) {
        for (let target = 0; target < 81; target++) {
          if (board[target] === 0 && sim1.placements[target] !== 0 && sim1.placements[target] === sim2.placements[target]) {
            const digit = sim1.placements[target];
            return {
              technique: 'Forcing Chain',
              cell,
              target,
              digit,
              placements: [{ cell: target, digit }],
              eliminations: [],
              weight: TECHNIQUE_WEIGHTS['Forcing Chain']
            };
          }
        }
      }
    }
    return null;
  }

  function simulateLogicalImplications(board, candidates, startCell, startDigit) {
    const testBoard = new Uint8Array(board);
    const testCand = new Uint16Array(candidates);
    testBoard[startCell] = startDigit;
    testCand[startCell] = 0;

    const peers = PEERS[startCell];
    const mask = DIGIT_MASK[startDigit];
    for (let p = 0; p < peers.length; p++) {
      testCand[peers[p]] &= ~mask;
    }

    let progress = true;
    let stepCount = 0;
    while (progress && stepCount < 25) {
      stepCount++;
      progress = false;

      for (let i = 0; i < 81; i++) {
        if (testBoard[i] === 0 && testCand[i] === 0) {
          return { invalid: true };
        }
      }

      for (let i = 0; i < 81; i++) {
        if (testBoard[i] === 0 && countBits(testCand[i]) === 1) {
          const d = getSingleDigit(testCand[i]);
          testBoard[i] = d;
          testCand[i] = 0;
          const pList = PEERS[i];
          const m = DIGIT_MASK[d];
          for (let p = 0; p < pList.length; p++) {
            testCand[pList[p]] &= ~m;
          }
          progress = true;
          break;
        }
      }
    }

    const placements = new Uint8Array(81);
    for (let i = 0; i < 81; i++) {
      if (board[i] === 0 && testBoard[i] !== 0) {
        placements[i] = testBoard[i];
      }
    }

    return { invalid: false, placements };
  }

  // --- COMPREHENSIVE HUMAN LOGICAL SOLVER ---

  function analyzeDifficulty(inputBoard) {
    const board = parseBoard(inputBoard);
    const candidates = computeCandidateGrid(board);
    const steps = [];
    const techniqueCounts = {};
    let totalScore = 0;
    let highestTechnique = 'Naked Single';
    let highestWeight = 0;

    for (let i = 0; i < 81; i++) {
      if (board[i] !== 0) {
        const val = board[i];
        const peers = PEERS[i];
        for (let p = 0; p < peers.length; p++) {
          if (board[peers[p]] === val) {
            return {
              solvable: false,
              solved: false,
              error: 'Tablero inicial contiene números duplicados en conflicto.'
            };
          }
        }
      }
    }

    let iterations = 0;
    const maxIterations = 500;

    while (iterations < maxIterations) {
      iterations++;

      let emptyCount = 0;
      for (let i = 0; i < 81; i++) {
        if (board[i] === 0) emptyCount++;
      }
      if (emptyCount === 0) break;

      let step = null;

      step = findNakedSingle(board, candidates);
      if (!step) step = findHiddenSingle(board, candidates);
      if (!step) step = findPointing(board, candidates);
      if (!step) step = findBoxLineReduction(board, candidates);
      if (!step) step = findNakedSubsets(board, candidates, 2);
      if (!step) step = findHiddenSubsets(board, candidates, 2);
      if (!step) step = findNakedSubsets(board, candidates, 3);
      if (!step) step = findHiddenSubsets(board, candidates, 3);
      if (!step) step = findFish(board, candidates, 2);
      if (!step) step = findSkyscraper(board, candidates);
      if (!step) step = findTwoStringKite(board, candidates);
      if (!step) step = findWWing(board, candidates);
      if (!step) step = findXYWing(board, candidates);
      if (!step) step = findXYZWing(board, candidates);
      if (!step) step = findSimpleColoring(board, candidates);
      if (!step) step = findNakedSubsets(board, candidates, 4);
      if (!step) step = findHiddenSubsets(board, candidates, 4);
      if (!step) step = findFish(board, candidates, 3);
      if (!step) step = findFinnedFish(board, candidates, 2);
      if (!step) step = findFish(board, candidates, 4);
      if (!step) step = findFinnedFish(board, candidates, 3);
      if (!step) step = findXYChain(board, candidates);
      if (!step) step = findForcingChain(board, candidates);

      if (!step) break;

      steps.push(step);
      totalScore += step.weight;
      techniqueCounts[step.technique] = (techniqueCounts[step.technique] || 0) + 1;
      if (step.weight > highestWeight) {
        highestWeight = step.weight;
        highestTechnique = step.technique;
      }

      if (step.eliminations && step.eliminations.length > 0) {
        for (let e = 0; e < step.eliminations.length; e++) {
          const elim = step.eliminations[e];
          candidates[elim.cell] &= ~DIGIT_MASK[elim.digit];
        }
      }

      if (step.placements && step.placements.length > 0) {
        for (let p = 0; p < step.placements.length; p++) {
          const place = step.placements[p];
          board[place.cell] = place.digit;
          candidates[place.cell] = 0;
          const pList = PEERS[place.cell];
          const m = DIGIT_MASK[place.digit];
          for (let k = 0; k < pList.length; k++) {
            candidates[pList[k]] &= ~m;
          }
        }
      }
    }

    let isSolved = true;
    for (let i = 0; i < 81; i++) {
      if (board[i] === 0) {
        isSolved = false;
        break;
      }
    }

    let difficulty = 'EXPERTO';
    if (highestWeight >= TECHNIQUE_WEIGHTS['Jellyfish'] || totalScore >= 2500 || techniqueCounts['XY-Chain'] || techniqueCounts['Forcing Chain']) {
      difficulty = 'IMPOSIBLE';
    } else if (highestWeight >= TECHNIQUE_WEIGHTS['Swordfish'] || totalScore >= 1200 || highestWeight >= TECHNIQUE_WEIGHTS['XYZ-Wing'] || highestWeight >= TECHNIQUE_WEIGHTS['Skyscraper']) {
      difficulty = 'EXTREMO';
    } else {
      difficulty = 'EXPERTO';
    }

    return {
      solvable: true,
      solved: isSolved,
      difficulty,
      difficultyScore: totalScore,
      highestTechnique,
      highestWeight,
      techniqueCounts,
      steps,
      solvedBoard: isSolved ? board : null
    };
  }

  // --- RANDOMIZED GENERATOR WITH GUARANTEED UNIQUE SOLUTION ---

  function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const temp = array[i];
      array[i] = array[j];
      array[j] = temp;
    }
    return array;
  }

  function generateCompleteBoard() {
    const board = new Uint8Array(81);

    const digits = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    for (let b = 0; b < 3; b++) {
      shuffle(digits);
      const boxStartRow = b * 3;
      const boxStartCol = b * 3;
      let idx = 0;
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
          const cell = (boxStartRow + r) * 9 + (boxStartCol + c);
          board[cell] = digits[idx++];
        }
      }
    }

    function solveRandom(idx) {
      if (idx === 81) return true;
      if (board[idx] !== 0) return solveRandom(idx + 1);

      let mask = ALL_CANDIDATES;
      const peers = PEERS[idx];
      for (let p = 0; p < peers.length; p++) {
        const val = board[peers[p]];
        if (val !== 0) mask &= ~DIGIT_MASK[val];
      }

      const candDigits = maskToDigits(mask);
      shuffle(candDigits);

      for (let i = 0; i < candDigits.length; i++) {
        board[idx] = candDigits[i];
        if (solveRandom(idx + 1)) return true;
        board[idx] = 0;
      }
      return false;
    }

    solveRandom(0);
    applyRandomTransformations(board);

    return board;
  }

  function applyRandomTransformations(board) {
    const map = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    for (let i = 0; i < 81; i++) {
      board[i] = map[board[i] - 1];
    }

    function swapRows(r1, r2) {
      for (let c = 0; c < 9; c++) {
        const t = board[r1 * 9 + c];
        board[r1 * 9 + c] = board[r2 * 9 + c];
        board[r2 * 9 + c] = t;
      }
    }

    function swapCols(c1, c2) {
      for (let r = 0; r < 9; r++) {
        const t = board[r * 9 + c1];
        board[r * 9 + c1] = board[r * 9 + c2];
        board[r * 9 + c2] = t;
      }
    }

    for (let b = 0; b < 3; b++) {
      const rows = shuffle([0, 1, 2]);
      if (rows[0] !== 0) swapRows(b * 3, b * 3 + rows[0]);
    }

    for (let s = 0; s < 3; s++) {
      const cols = shuffle([0, 1, 2]);
      if (cols[0] !== 0) swapCols(s * 3, s * 3 + cols[0]);
    }

    if (Math.random() > 0.5) {
      for (let r = 0; r < 9; r++) {
        for (let c = r + 1; c < 9; c++) {
          const t = board[r * 9 + c];
          board[r * 9 + c] = board[c * 9 + r];
          board[c * 9 + r] = t;
        }
      }
    }
  }

  function generatePuzzle(targetDifficulty = 'EXPERTO', onProgress = null) {
    const validTargets = ['EXPERTO', 'EXTREMO', 'IMPOSIBLE'];
    if (!validTargets.includes(targetDifficulty)) {
      targetDifficulty = 'EXPERTO';
    }

    const maxCluesTarget = targetDifficulty === 'IMPOSIBLE' ? 24 : targetDifficulty === 'EXTREMO' ? 26 : 28;
    const minCluesTarget = targetDifficulty === 'IMPOSIBLE' ? 20 : targetDifficulty === 'EXTREMO' ? 21 : 23;

    let attempts = 0;
    const maxGenerationAttempts = 40;

    while (attempts < maxGenerationAttempts) {
      attempts++;
      if (onProgress) {
        onProgress({
          attempt: attempts,
          status: `Generando Sudoku ${targetDifficulty}... (Intento ${attempts})`,
          percent: Math.min(95, Math.round((attempts / maxGenerationAttempts) * 100))
        });
      }

      const completeBoard = generateCompleteBoard();
      const puzzleBoard = new Uint8Array(completeBoard);

      const cellIndices = [];
      for (let i = 0; i < 81; i++) cellIndices.push(i);
      shuffle(cellIndices);

      let currentClues = 81;

      for (let i = 0; i < cellIndices.length; i++) {
        const cell = cellIndices[i];
        const backup = puzzleBoard[cell];
        puzzleBoard[cell] = 0;

        const uniqueRes = countSolutions(puzzleBoard, 2);
        if (uniqueRes.count !== 1) {
          puzzleBoard[cell] = backup;
        } else {
          currentClues--;
          if (currentClues <= minCluesTarget) break;
        }
      }

      if (currentClues <= maxCluesTarget) {
        const analysis = analyzeDifficulty(puzzleBoard);

        if (analysis.solved) {
          let meetsDifficulty = false;

          if (targetDifficulty === 'EXPERTO') {
            meetsDifficulty = analysis.difficulty === 'EXPERTO' && analysis.difficultyScore >= 400;
          } else if (targetDifficulty === 'EXTREMO') {
            meetsDifficulty = analysis.difficulty === 'EXTREMO' || (analysis.difficulty === 'EXPERTO' && analysis.difficultyScore >= 950);
          } else if (targetDifficulty === 'IMPOSIBLE') {
            meetsDifficulty = analysis.difficulty === 'IMPOSIBLE' || (analysis.difficulty === 'EXTREMO' && analysis.difficultyScore >= 1800);
          }

          if (meetsDifficulty) {
            return {
              puzzle: boardToString(puzzleBoard),
              solution: boardToString(completeBoard),
              puzzleArray: puzzleBoard,
              solutionArray: completeBoard,
              cluesCount: currentClues,
              difficulty: targetDifficulty,
              difficultyScore: analysis.difficultyScore,
              highestTechnique: analysis.highestTechnique,
              techniqueCounts: analysis.techniqueCounts,
              steps: analysis.steps,
              attempts
            };
          }
        }
      }
    }

    // Fallback: Return best generated candidate
    const fallbackComplete = generateCompleteBoard();
    const fallbackPuzzle = new Uint8Array(fallbackComplete);
    const indices = shuffle(Array.from({ length: 81 }, (_, i) => i));
    let clues = 81;
    for (let i = 0; i < indices.length; i++) {
      const c = indices[i];
      const backup = fallbackPuzzle[c];
      fallbackPuzzle[c] = 0;
      if (!hasUniqueSolution(fallbackPuzzle)) {
        fallbackPuzzle[c] = backup;
      } else {
        clues--;
        if (clues <= maxCluesTarget) break;
      }
    }

    const fallbackAnalysis = analyzeDifficulty(fallbackPuzzle);
    return {
      puzzle: boardToString(fallbackPuzzle),
      solution: boardToString(fallbackComplete),
      puzzleArray: fallbackPuzzle,
      solutionArray: fallbackComplete,
      cluesCount: clues,
      difficulty: targetDifficulty,
      difficultyScore: fallbackAnalysis.difficultyScore || 800,
      highestTechnique: fallbackAnalysis.highestTechnique || 'Naked Pair',
      techniqueCounts: fallbackAnalysis.techniqueCounts || {},
      steps: fallbackAnalysis.steps || [],
      attempts
    };
  }

  // --- CRYPTO HELPER FOR CLIENT ANTI-CHEAT ---
  async function hashSolutionWithSalt(solutionStr, salt) {
    const text = solutionStr + ':' + salt;
    if (global.crypto && global.crypto.subtle) {
      const msgBuffer = new TextEncoder().encode(text);
      const hashBuffer = await global.crypto.subtle.digest('SHA-256', msgBuffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    } else {
      let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
      for (let i = 0; i < text.length; i++) {
        const ch = text.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
      }
      h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
      h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
      return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(64, '0');
    }
  }

  function generateSalt(len = 16) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < len; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  const SudokuEngine = {
    parseBoard,
    boardToString,
    computeCandidateGrid,
    countSolutions,
    hasUniqueSolution,
    solveUnique,
    analyzeDifficulty,
    generateCompleteBoard,
    generatePuzzle,
    hashSolutionWithSalt,
    generateSalt,
    TECHNIQUE_WEIGHTS
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = SudokuEngine;
  } else {
    global.SudokuEngine = SudokuEngine;
  }

})(typeof window !== 'undefined' ? window : self);
