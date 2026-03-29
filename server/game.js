function cloneState(state) {
  return JSON.parse(JSON.stringify(state));
}

function createInitialState() {
  const points = Array(24).fill(0);
  // Positive = white, Negative = black
  // Standard backgammon layout matching the screenshot.
  points[23] = 2;  // 24
  points[12] = 5;  // 13
  points[7] = 3;   // 8
  points[5] = 5;   // 6

  points[0] = -2;  // 1
  points[11] = -5; // 12
  points[16] = -3; // 17
  points[18] = -5; // 19

  return {
    points,
    bar: { white: 0, black: 0 },
    off: { white: 0, black: 0 }
  };
}

function createMatch(targetScore = 5) {
  return {
    state: createInitialState(),
    pendingState: null,
    turn: 'white',
    dice: [],
    rolledPair: null,
    scores: { white: 0, black: 0 },
    targetScore,
    winner: null,
    movedThisTurn: false,
    turnStartState: null,
    turnStartDice: [],
    roundSummary: null,
    matchSummary: null,
    animating: false,
    autoRollTimer: null,
    roundMultiplier: 1,
    doubleOffer: null
  };
}

function opponent(player) {
  return player === 'white' ? 'black' : 'white';
}

function colorSign(player) {
  return player === 'white' ? 1 : -1;
}

function homeRange(player) {
  return player === 'white' ? [0, 5] : [18, 23];
}

function isOwnChecker(value, player) {
  return player === 'white' ? value > 0 : value < 0;
}

function isOpponentChecker(value, player) {
  return player === 'white' ? value < 0 : value > 0;
}

function canLandOnPoint(state, player, pointIndex) {
  const val = state.points[pointIndex];
  return !(player === 'white' ? val <= -2 : val >= 2);
}

function allCheckersInHome(state, player) {
  if (state.bar[player] > 0) return false;
  const [start, end] = homeRange(player);
  for (let i = 0; i < 24; i++) {
    if (i < start || i > end) {
      if (isOwnChecker(state.points[i], player)) return false;
    }
  }
  return true;
}

function furthestOccupiedHomePoint(state, player) {
  if (player === 'white') {
    for (let i = 5; i >= 0; i--) {
      if (state.points[i] > 0) return i;
    }
  } else {
    for (let i = 18; i <= 23; i++) {
      if (state.points[i] < 0) return i;
    }
  }
  return null;
}

function applyMove(state, player, move) {
  const s = cloneState(state);
  const sign = colorSign(player);

  if (move.from === 'bar') {
    s.bar[player] -= 1;
  } else {
    s.points[move.from] -= sign;
  }

  if (move.to === 'off') {
    s.off[player] += 1;
    return s;
  }

  const current = s.points[move.to];
  if (player === 'white' && current === -1) {
    s.points[move.to] = 0;
    s.bar.black += 1;
  } else if (player === 'black' && current === 1) {
    s.points[move.to] = 0;
    s.bar.white += 1;
  }

  s.points[move.to] += sign;
  return s;
}

function entryPoint(player, die) {
  return player === 'white' ? 24 - die : die - 1;
}

function destinationPoint(from, player, die) {
  return player === 'white' ? from - die : from + die;
}

function canBearOffFrom(state, player, from, die) {
  if (!allCheckersInHome(state, player)) return false;
  if (player === 'white') {
    const exact = from - die === -1;
    if (exact) return true;
    if (from - die < -1) {
      const furthest = furthestOccupiedHomePoint(state, player);
      return furthest === from;
    }
    return false;
  }

  const exact = from + die === 24;
  if (exact) return true;
  if (from + die > 24) {
    const furthest = furthestOccupiedHomePoint(state, player);
    return furthest === from;
  }
  return false;
}

function generateSingleDieMoves(state, player, die, dieIndex) {
  const moves = [];

  if (state.bar[player] > 0) {
    const target = entryPoint(player, die);
    if (canLandOnPoint(state, player, target)) {
      moves.push({
        from: 'bar',
        to: target,
        die,
        dieIndex
      });
    }
    return moves;
  }

  for (let i = 0; i < 24; i++) {
    if (!isOwnChecker(state.points[i], player)) continue;
    const target = destinationPoint(i, player, die);

    if (target >= 0 && target <= 23) {
      if (canLandOnPoint(state, player, target)) {
        moves.push({ from: i, to: target, die, dieIndex });
      }
    } else if (canBearOffFrom(state, player, i, die)) {
      moves.push({ from: i, to: 'off', die, dieIndex });
    }
  }

  return moves;
}

function removeDieAtIndex(dice, index) {
  return dice.filter((_, i) => i !== index);
}

function serializeMove(move) {
  return `${move.from}->${move.to}|${move.die}|${move.dieIndex}`;
}

function bestSequences(state, player, dice) {
  const sequences = [];
  let maxLen = 0;

  function dfs(currentState, remainingDice, seq) {
    let allMoves = [];
    remainingDice.forEach((die, idx) => {
      allMoves.push(...generateSingleDieMoves(currentState, player, die, idx));
    });

    if (allMoves.length === 0) {
      if (seq.length > maxLen) maxLen = seq.length;
      sequences.push(seq);
      return;
    }

    for (const move of allMoves) {
      const nextState = applyMove(currentState, player, move);
      const nextDice = removeDieAtIndex(remainingDice, move.dieIndex);
      dfs(nextState, nextDice, [...seq, move]);
    }
  }

  dfs(state, dice, []);

  let filtered = sequences.filter(seq => seq.length === maxLen);

  if (maxLen === 1 && dice.length === 2 && dice[0] !== dice[1]) {
    const highest = Math.max(...filtered.map(seq => seq[0].die));
    filtered = filtered.filter(seq => seq[0].die === highest);
  }

  return filtered;
}

function legalFirstMoves(state, player, dice) {
  if (!dice || dice.length === 0) return [];
  const sequences = bestSequences(state, player, dice);
  const unique = new Map();
  for (const seq of sequences) {
    if (!seq.length) continue;
    const move = seq[0];
    unique.set(serializeMove(move), move);
  }
  return [...unique.values()];
}

function moveOptionId(path) {
  return path.map((m) => `${m.from}>${m.to}>${m.die}>${m.dieIndex}`).join('~');
}

function legalMoveOptions(state, player, dice) {
  if (!dice || !dice.length) return [];
  const sequences = bestSequences(state, player, dice);
  const unique = new Map();

  for (const seq of sequences) {
    if (!seq.length) continue;
    let currentFrom = seq[0].from;
    let previousTo = null;
    let path = [];

    for (let i = 0; i < seq.length; i++) {
      const move = seq[i];
      if (i === 0) {
        path = [move];
        currentFrom = move.from;
        previousTo = move.to;
      } else if (move.from === previousTo) {
        path = [...path, move];
        previousTo = move.to;
      } else {
        break;
      }

      const option = {
        id: moveOptionId(path),
        from: currentFrom,
        to: path[path.length - 1].to,
        steps: path.length,
        diceUsed: path.map((m) => m.die),
        path: path.map((m) => ({ ...m }))
      };

      const key = `${option.from}->${option.to}`;
      const existing = unique.get(key);
      if (!existing) {
        unique.set(key, option);
      } else if (option.to === 'off') {
        const preferNext = option.steps < existing.steps
          || (option.steps === existing.steps && Math.max(...option.diceUsed) > Math.max(...existing.diceUsed));
        if (preferNext) unique.set(key, option);
      } else if (existing.steps < option.steps) {
        unique.set(key, option);
      }
    }
  }

  return [...unique.values()];
}

function rollDice() {
  const a = 1 + Math.floor(Math.random() * 6);
  const b = 1 + Math.floor(Math.random() * 6);
  return a === b ? { pair: [a, b], dice: [a, a, a, a] } : { pair: [a, b], dice: [a, b] };
}

function hasAnyLegalMove(state, player, dice) {
  return legalFirstMoves(state, player, dice).length > 0;
}

function isGameWon(state) {
  if (state.off.white >= 15) return 'white';
  if (state.off.black >= 15) return 'black';
  return null;
}

function getRoundPoints(state, winner) {
  const loser = winner === 'white' ? 'black' : 'white';
  return state.off[loser] === 0 ? 3 : 1;
}

function arePlayersSeparated(state) {
  if (state.bar.white > 0 || state.bar.black > 0) return false;
  let maxWhite = -1;
  let minBlack = 24;
  for (let i = 0; i < 24; i++) {
    if (state.points[i] > 0) maxWhite = i;
    if (state.points[i] < 0 && minBlack === 24) minBlack = i;
  }
  if (maxWhite === -1 || minBlack === 24) return true;
  return maxWhite < minBlack;
}

module.exports = {
  createMatch,
  createInitialState,
  cloneState,
  opponent,
  rollDice,
  legalFirstMoves,
  legalMoveOptions,
  applyMove,
  hasAnyLegalMove,
  isGameWon,
  entryPoint,
  destinationPoint,
  canLandOnPoint,
  canBearOffFrom,
  getRoundPoints,
  arePlayersSeparated
};
