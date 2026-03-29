const STORAGE_KEY = 'tavla_ui_prefs_v3';
const PLAYER_TOKEN_KEY = 'tavla_player_token';
const storedPrefs = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
const playerToken = localStorage.getItem(PLAYER_TOKEN_KEY) || (() => {
  const token = (crypto?.randomUUID?.() || `p_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`);
  localStorage.setItem(PLAYER_TOKEN_KEY, token);
  return token;
})();

const socket = io();

const state = {
  me: { roomCode: null, color: null, name: storedPrefs.lastName || null, playerToken },
  room: null,
  selectedFrom: null,
  possibleTargets: [],
  blockedTargets: [],
  actionMap: {},
  audioCtx: null,
  lastRoundMessage: '',
  animating: false,
  floatingChecker: null,
  diceAnimating: false,
  diceAnimationTimer: null,
  diceAnimationValues: [],
  lastRoundSummaryId: null,
  lastMatchSummaryId: null,
  chatMessages: [],
  theme: storedPrefs.theme || 'classic',
  skin: storedPrefs.skin || 'classic',
  language: storedPrefs.language || 'en',
  autoDice: storedPrefs.autoDice !== false,
  toastTimer: null
};

const I18N = window.I18N || {};
const UI = I18N[state.language] || I18N.en || {};
const SOUND_FILES = {
  roll: 'assets/sounds/roll.wav',
  move: 'assets/sounds/move.wav',
  hit: 'assets/sounds/hit.wav'
};
const THEME_OPTIONS = window.TAVLA_THEMES || [];
let SKIN_OPTIONS = Array.isArray(window.TAVLA_SKINS) ? [...window.TAVLA_SKINS] : [];
function currentSkinAsset(color) {
  const selected = SKIN_OPTIONS.find((skin) => skin.id === state.skin) || SKIN_OPTIONS[0];
  if (!selected) return `assets/checkers/${color}.svg`;
  return selected[color] || `assets/checkers/${color}.svg`;
}

function prettifySkinLabel(id = '') {
  return String(id)
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .trim() || 'Skin';
}

async function loadSkinOptions() {
  try {
    const response = await fetch('/api/skins', { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    if (!Array.isArray(payload?.skins) || !payload.skins.length) return;

    SKIN_OPTIONS = payload.skins
      .filter((skin) => skin && skin.id && skin.white && skin.black)
      .map((skin) => ({
        id: skin.id,
        label: skin.label || prettifySkinLabel(skin.id),
        labelKey: skin.labelKey || null,
        white: skin.white,
        black: skin.black
      }));

    renderSkinOptions();
    applySkin(state.skin);
  } catch (error) {
    console.warn('Could not load skins from the server. Falling back to the local list.', error);
  }
}
function getLangDict(lang = state.language) {
  return I18N[lang] || I18N.en || {};
}

function t(key, vars = {}, lang = state.language) {
  const dict = getLangDict(lang);
  let value = dict[key] ?? (I18N.en?.[key]) ?? key;
  for (const [k, v] of Object.entries(vars)) value = value.replaceAll(`{${k}}`, v);
  return value;
}

function translatePayload(payload, fallbackKey = '') {
  if (payload == null) return fallbackKey ? t(fallbackKey) : '';
  if (typeof payload === 'string') return payload;
  if (payload.textKey) return t(payload.textKey, payload.textParams || {});
  if (payload.key) return t(payload.key, payload.params || {});
  if (payload.text) return payload.text;
  return fallbackKey ? t(fallbackKey) : '';
}

function applyUIText() {
  document.documentElement.lang = state.language;
  document.title = t('appTitle');
  document.querySelectorAll('[data-text]').forEach((el) => {
    el.textContent = t(el.dataset.text);
  });
  if (createName) createName.placeholder = t('createNamePlaceholder');
  if (joinName) joinName.placeholder = t('joinNamePlaceholder');
  if (roomCodeInput) roomCodeInput.placeholder = t('roomCodePlaceholder');
  if (chatInput) chatInput.placeholder = t('chatPlaceholder');
  if (languageSelect) languageSelect.value = state.language;
}

function setLanguage(language, persist = true) {
  state.language = language === 'tr' ? 'tr' : 'en';
  applyUIText();
  renderThemeOptions();
  renderSkinOptions();
  updateAutoDiceControls();
  renderDice();
  renderChat();
  updateRoomLinkPreview();
  if (state.room) {
    const currentSummary = state.room.game?.roundSummary;
    const matchSummary = state.room.game?.matchSummary;
    if (currentSummary && !roundModal.classList.contains('hidden')) roundModalText.textContent = translatePayload(currentSummary);
    if (matchSummary && !matchModal.classList.contains('hidden')) matchModalText.textContent = translatePayload(matchSummary);
    if (state.room.game?.doubleOffer && state.room.game.doubleOffer.offeredBy !== state.me.color) showDoubleOffer(state.room.game.doubleOffer);
  }
  if (persist) savePrefs();
}

function savePrefs() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    theme: state.theme,
    skin: state.skin,
    autoDice: state.autoDice,
    language: state.language,
    lastName: state.me.name || createName.value.trim() || joinName.value.trim() || ''
  }));
}

function applyTheme(themeId = state.theme) {
  const exists = THEME_OPTIONS.some((theme) => theme.id === themeId);
  state.theme = exists ? themeId : (THEME_OPTIONS[0]?.id || 'classic');
  document.body.dataset.theme = state.theme;
  document.querySelectorAll('[data-theme-option]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.themeOption === state.theme);
  });
  savePrefs();
}

function applySkin(skinId = state.skin) {
  const exists = SKIN_OPTIONS.some((skin) => skin.id === skinId);
  state.skin = exists ? skinId : (SKIN_OPTIONS[0]?.id || 'classic');
  document.querySelectorAll('[data-skin-option]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.skinOption === state.skin);
  });
  savePrefs();
  renderBoard();
}

function renderThemeOptions() {
  if (!themeOptionsEl) return;
  themeOptionsEl.innerHTML = '';
  for (const theme of THEME_OPTIONS) {
    const btn = document.createElement('button');
    btn.className = 'optionButton';
    btn.dataset.themeOption = theme.id;
    const label = theme.labelKey ? t(theme.labelKey) : (theme.label || prettifySkinLabel(theme.id));
    btn.innerHTML = `${label} <span class="miniPreview"><span style="background:${theme.id === 'dark' ? '#121722' : theme.id === 'forest' ? '#4a7b4f' : '#d39a63'}"></span><span style="background:${theme.id === 'dark' ? '#7d95ff' : theme.id === 'forest' ? '#2c8f58' : '#367cff'}"></span></span>`;
    btn.addEventListener('click', () => applyTheme(theme.id));
    themeOptionsEl.appendChild(btn);
  }
}

function renderSkinOptions() {
  if (!skinOptionsEl) return;
  skinOptionsEl.innerHTML = '';
  for (const skin of SKIN_OPTIONS) {
    const btn = document.createElement('button');
    btn.className = 'optionButton';
    btn.dataset.skinOption = skin.id;
    const label = skin.labelKey ? t(skin.labelKey) : (skin.label || prettifySkinLabel(skin.id));
    btn.innerHTML = `${label} <span class="miniPreview"><span style="background-image:url(${skin.white}); background-size:cover; background-position:center;"></span><span style="background-image:url(${skin.black}); background-size:cover; background-position:center;"></span></span>`;
    btn.addEventListener('click', () => applySkin(skin.id));
    skinOptionsEl.appendChild(btn);
  }
}

function getRoomShareUrl(roomCode = state.me.roomCode) {
  if (!roomCode) return '';
  const url = new URL(window.location.href);
  url.searchParams.set('room', roomCode);
  return url.toString();
}

function updateRoomLinkPreview() {
  if (roomLinkPreview) roomLinkPreview.textContent = state.me.roomCode ? getRoomShareUrl(state.me.roomCode) : '';
}

function prefillLobbyFromPrefs() {
  if (state.me.name) {
    createName.value = state.me.name;
    joinName.value = state.me.name;
  }
  const url = new URL(window.location.href);
  const roomCode = (url.searchParams.get('room') || '').trim().toUpperCase();
  if (roomCode) roomCodeInput.value = roomCode.slice(0, 5);
}

const $ = (id) => document.getElementById(id);
const lobbyScreen = $('lobbyScreen');
const gameScreen = $('gameScreen');
const createRoomBtn = $('createRoomBtn');
const joinRoomBtn = $('joinRoomBtn');
const createName = $('createName');
const joinName = $('joinName');
const roomCodeInput = $('roomCodeInput');
const targetScoreSelect = $('targetScore');
const lobbyMessage = $('lobbyMessage');
const roomCodeLabel = $('roomCodeLabel');
const copyRoomBtn = $('copyRoomBtn');
const board = $('board');
const statusText = $('statusText');
const turnBadge = $('turnBadge');
const whiteName = $('whiteName');
const blackName = $('blackName');
const whiteScore = $('whiteScore');
const blackScore = $('blackScore');
const targetLabel = $('targetLabel');
const rollDiceBtn = $('rollDiceBtn');
const confirmBtn = $('confirmBtn');
const resetTurnBtn = $('resetTurnBtn');
const diceArea = $('diceArea');
const roundModal = $('roundModal');
const roundModalText = $('roundModalText');
const closeRoundModalBtn = $('closeRoundModalBtn');
const whiteCard = $('whiteCard');
const blackCard = $('blackCard');
const tableWrap = $('tableWrap');
const chatMessagesEl = $('chatMessages');
const chatInput = $('chatInput');
const sendChatBtn = $('sendChatBtn');
const matchModal = $('matchModal');
const matchModalText = $('matchModalText');
const rematchBtn = $('rematchBtn');
const roomLinkPreview = $('roomLinkPreview');
const themeOptionsEl = $('themeOptions');
const skinOptionsEl = $('skinOptions');
const autoDiceCheckbox = $('autoDiceCheckbox');
const autoDiceLabelText = $('autoDiceLabelText');
const doubleOfferBtn = $('doubleOfferBtn');
const doubleStatusText = $('doubleStatusText');
const doubleModal = $('doubleModal');
const doubleModalText = $('doubleModalText');
const acceptDoubleBtn = $('acceptDoubleBtn');
const declineDoubleBtn = $('declineDoubleBtn');
const toastLayer = $('toastLayer');
const languageSelect = $('languageSelect');


function showToast(message, variant = 'info') {
  if (!toastLayer || !message) return;
  const toast = document.createElement('div');
  toast.className = `toast ${variant}`;
  toast.textContent = message;
  toastLayer.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('visible'));
  const remove = () => {
    toast.classList.remove('visible');
    setTimeout(() => toast.remove(), 240);
  };
  setTimeout(remove, 2600);
}

function updateBoardScale() {
  if (!board || !tableWrap) return;
  const mobile = window.innerWidth <= 860;
  board.style.removeProperty('--board-scale');
  tableWrap.style.removeProperty('--board-height');
  if (!mobile) {
    board.classList.remove('mobileScaled');
    return;
  }
  board.classList.add('mobileScaled');
  const available = tableWrap.clientWidth - 12;
  const naturalWidth = window.innerWidth <= 420 ? 430 : window.innerWidth <= 640 ? 480 : 560;
  const naturalHeight = window.innerWidth <= 420 ? 332 : window.innerWidth <= 640 ? 370 : 430;
  const scale = Math.min(1, Math.max(0.74, available / naturalWidth));
  board.style.setProperty('--board-scale', String(scale));
  tableWrap.style.setProperty('--board-height', `${naturalHeight * scale + 8}px`);
}

window.addEventListener('resize', updateBoardScale);

function playSound(type = 'move') {

  const src = SOUND_FILES[type];
  if (!src) return;
  try {
    const audio = new Audio(src);
    audio.volume = type === 'hit' ? 0.6 : 0.45;
    audio.play().catch(() => {});
  } catch {}
}

function setLobbyMessage(text, error = true) {
  lobbyMessage.textContent = translatePayload(text);
  lobbyMessage.style.color = error ? '#cc4158' : '#2d8a52';
}

function updateAutoDiceControls() {
  if (autoDiceCheckbox) autoDiceCheckbox.checked = !!state.autoDice;
  if (autoDiceLabelText) autoDiceLabelText.textContent = state.autoDice ? t('autoDiceOn') : t('autoDiceOff');
  if (rollDiceBtn) {
    rollDiceBtn.textContent = state.autoDice ? t('autoDiceButton') : t('rollDice');
    rollDiceBtn.classList.toggle('isAuto', !!state.autoDice);
  }
}

function setAutoDice(enabled, syncServer = true) {
  state.autoDice = !!enabled;
  updateAutoDiceControls();
  savePrefs();
  if (syncServer) socket.emit('settings:autoDice', { enabled: state.autoDice });
}

function clearSelection() {
  state.selectedFrom = null;
  state.possibleTargets = [];
  state.blockedTargets = [];
  state.actionMap = {};
}

function isWhite() {
  return state.me.color === 'white';
}

function topPlayerColor() {
  return state.me.color === 'black' ? 'white' : 'black';
}

function bottomPlayerColor() {
  return state.me.color || 'white';
}

function perspectiveTopIndices() {
  return state.me.color === 'black'
    ? [11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0]
    : [12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23];
}

function perspectiveBottomIndices() {
  return state.me.color === 'black'
    ? [12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]
    : [11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0];
}

function ownCheckerAt(pointIndex) {
  const value = state.room?.game?.state?.points?.[pointIndex] || 0;
  return isWhite() ? value > 0 : value < 0;
}

function blockedByOpponent(pointIndex) {
  const value = state.room?.game?.state?.points?.[pointIndex] || 0;
  return isWhite() ? value <= -2 : value >= 2;
}

function destinationPoint(from, die) {
  if (from === 'bar') return isWhite() ? 24 - die : die - 1;
  return isWhite() ? from - die : from + die;
}

function getMyMoveOptions() {
  if (!state.room || state.animating) return [];
  if (state.room.game.turn !== state.me.color) return [];
  return state.room.game.moveOptions || [];
}

function countByValue(values) {
  const counts = new Map();
  values.forEach((v) => counts.set(v, (counts.get(v) || 0) + 1));
  return counts;
}

function showRoundSummary(summary) {
  if (!summary || state.lastRoundSummaryId === summary.id) return;
  state.lastRoundSummaryId = summary.id;
  roundModalText.textContent = translatePayload(summary);
  roundModal.classList.remove('hidden');
}

function showMatchSummary(summary) {
  if (!summary || state.lastMatchSummaryId === summary.id) return;
  state.lastMatchSummaryId = summary.id;
  matchModalText.textContent = translatePayload(summary);
  matchModal.classList.remove('hidden');
}


function closeDoubleModal() {
  doubleModal?.classList.add('hidden');
}

function showDoubleOffer(offer) {
  if (!offer || !state.room) return;
  const offerer = state.room.players?.[offer.offeredBy]?.name || t('player2');
  if (offer.offeredBy === state.me.color) return;
  doubleModalText.textContent = t('doubleOfferModal', { offerer });
  doubleModal?.classList.remove('hidden');
}

function formatChatTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString(state.language === 'tr' ? 'tr-TR' : 'en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderChat() {
  if (!chatMessagesEl) return;
  chatMessagesEl.innerHTML = '';
  const messages = state.chatMessages || [];
  if (!messages.length) {
    chatMessagesEl.innerHTML = `<div class="muted">${escapeHtml(t('noMessages'))}</div>`;
    return;
  }
  for (const msg of messages.slice(-80)) {
    const row = document.createElement('div');
    row.className = `chatMessage ${msg.color === state.me.color ? 'mine' : ''} ${msg.color === 'system' ? 'system' : ''}`;
    row.innerHTML = `
      <div class="chatMeta">
        <span class="chatName">${escapeHtml(msg.nameKey ? t(msg.nameKey, msg.nameParams || {}) : (msg.name || t('system')))}</span>
        <span class="chatTime">${formatChatTime(msg.timestamp)}</span>
      </div>
      <div class="chatBubble">${escapeHtml(msg.textKey ? t(msg.textKey, msg.textParams || {}) : (msg.text || ''))}</div>
    `;
    chatMessagesEl.appendChild(row);
  }
  chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
}

function sendChat() {
  const text = (chatInput?.value || '').trim();
  if (!text) return;
  socket.emit('chat:send', { text });
  chatInput.value = '';
}

function createRoom() {
  const name = createName.value.trim() || t('player1');
  state.me.name = name;
  savePrefs();
  socket.emit('room:create', { name, targetScore: targetScoreSelect.value, playerToken: state.me.playerToken, autoDice: state.autoDice });
}

function joinRoom() {
  const name = joinName.value.trim() || t('player2');
  const roomCode = roomCodeInput.value.trim().toUpperCase();
  state.me.name = name;
  if (!roomCode) {
    setLobbyMessage(t('needRoomCode'));
    return;
  }
  savePrefs();
  socket.emit('room:join', { roomCode, name, playerToken: state.me.playerToken, autoDice: state.autoDice });
}

createRoomBtn.addEventListener('click', createRoom);
joinRoomBtn.addEventListener('click', joinRoom);
roomCodeInput.addEventListener('input', () => {
  roomCodeInput.value = roomCodeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
});
copyRoomBtn.addEventListener('click', async () => {
  if (!state.me.roomCode) return;
  await navigator.clipboard.writeText(getRoomShareUrl());
  copyRoomBtn.textContent = t('copied');
  setTimeout(() => (copyRoomBtn.textContent = t('copy')), 1000);
});
rollDiceBtn.addEventListener('click', () => {
  if (state.autoDice) return;
  socket.emit('dice:roll');
});
autoDiceCheckbox?.addEventListener('change', (event) => {
  setAutoDice(!!event.target.checked);
});
confirmBtn.addEventListener('click', () => socket.emit('turn:confirm'));
resetTurnBtn.addEventListener('click', () => socket.emit('turn:reset'));
doubleOfferBtn?.addEventListener('click', () => {
  if (!state.room || !state.me.color) return;
  socket.emit('double:offer');
});
acceptDoubleBtn?.addEventListener('click', () => {
  socket.emit('double:respond', { accept: true });
  closeDoubleModal();
});
declineDoubleBtn?.addEventListener('click', () => {
  socket.emit('double:respond', { accept: false });
  closeDoubleModal();
});
closeRoundModalBtn.addEventListener('click', () => roundModal.classList.add('hidden'));
sendChatBtn?.addEventListener('click', sendChat);
languageSelect?.addEventListener('change', (event) => setLanguage(event.target.value));
chatInput?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') sendChat();
});
rematchBtn?.addEventListener('click', () => {
  matchModal.classList.add('hidden');
  socket.emit('match:rematch');
});
setLanguage(state.language, false);
renderThemeOptions();
renderSkinOptions();
applyTheme(state.theme);
applySkin(state.skin);
loadSkinOptions();
updateAutoDiceControls();
prefillLobbyFromPrefs();

if (state.me.playerToken) {
  socket.emit('player:reconnect', { playerToken: state.me.playerToken, autoDice: state.autoDice });
}

socket.on('dice:rolling', ({ duration = 900 }) => {
  startDiceAnimation(duration);
});

socket.on('room:joined', ({ roomCode, color }) => {
  state.lastMatchSummaryId = null;
  state.lastRoundSummaryId = null;
  state.me.roomCode = roomCode;
  state.me.color = color;
  updateRoomLinkPreview();
  lobbyScreen.classList.add('hidden');
  gameScreen.classList.remove('hidden');
  roomCodeLabel.textContent = roomCode;
  setLobbyMessage('', false);
  matchModal.classList.add('hidden');
  socket.emit('settings:autoDice', { enabled: state.autoDice });
});

socket.on('room:error', (message) => setLobbyMessage(message, true));

socket.on('chat:message', (message) => {
  state.chatMessages = [...(state.chatMessages || []), message];
  renderChat();
});

socket.on('move:animate', async ({ color, path }) => {
  if (!path?.length) return;
  state.animating = true;
  clearSelection();
  renderBoard();
  await animateMove(color, path);
});

socket.on('state:update', (roomState) => {
  const previousDice = JSON.stringify(state.room?.game?.rolledPair || []);
  const nextDice = JSON.stringify(roomState.game.rolledPair || []);
  const prevPoints = JSON.stringify(state.room?.game?.state?.points || []);
  const nextPoints = JSON.stringify(roomState.game.state.points || []);
  const prevBars = JSON.stringify(state.room?.game?.state?.bar || {});
  const nextBars = JSON.stringify(roomState.game.state.bar || {});
  const previousDoubleOffer = state.room?.game?.doubleOffer || null;
  const previousMultiplier = state.room?.game?.roundMultiplier || 1;

  state.room = roomState;
  updateRoomLinkPreview();
  savePrefs();
  state.animating = !!roomState.game.animating;

  if (roomState.game.rolledPair) stopDiceAnimation();

  if (previousDice !== nextDice && roomState.game.rolledPair) playSound('roll');
  if (prevPoints !== nextPoints) playSound('move');
  if (prevBars !== nextBars) playSound('hit');

  whiteName.textContent = roomState.players.white?.name || t('player1');
  blackName.textContent = roomState.players.black?.name || t('player2');
  whiteScore.textContent = roomState.game.scores.white;
  blackScore.textContent = roomState.game.scores.black;
  targetLabel.textContent = roomState.game.targetScore;
  const targetLabelSuffix = $('targetLabelSuffix');
  if (targetLabelSuffix) targetLabelSuffix.textContent = t('targetSuffix');

  const myTurn = roomState.game.turn === state.me.color;
  const bothPlayersReady = !!roomState.players.white && !!roomState.players.black;
  const enemyConnected = state.me.color === 'white'
    ? roomState.players.black?.connected
    : roomState.players.white?.connected;

  whiteCard.classList.remove('active-turn');
  blackCard.classList.remove('active-turn');
  tableWrap?.classList.toggle('active-turn-board', myTurn && !roomState.game.winner && bothPlayersReady);
  state.chatMessages = roomState.chat || state.chatMessages || [];

  turnBadge.textContent = roomState.game.winner
    ? t('wonMatch', { name: roomState.game.winner === 'white' ? (roomState.players.white?.name || t('white')) : (roomState.players.black?.name || t('black')) })
    : myTurn ? t('yourTurn') : t('enemyTurn');

  if (!bothPlayersReady) {
    statusText.textContent = t('waitingRoom');
  } else if (enemyConnected === false) {
    statusText.textContent = t('enemyDisconnected');
  } else if (roomState.game.winner) {
    statusText.textContent = t('matchWon');
  } else if (roomState.game.animating) {
    statusText.textContent = t('animating');
  } else if (state.diceAnimating) {
    statusText.textContent = t('rollingDice');
  } else if (roomState.game.waitingForRoll) {
    const autoTurn = roomState.game.turn === state.me.color ? state.autoDice : !!roomState.players?.[roomState.game.turn]?.autoDice;
    statusText.textContent = myTurn
      ? (state.autoDice ? t('autoRollingSoon') : t('yourTurnRoll'))
      : (autoTurn ? t('enemyAutoRollingSoon') : t('enemyTurnRoll'));
  } else if (roomState.game.noMovesAvailable) {
    statusText.textContent = myTurn ? t('noMovesYou') : t('noMovesEnemy');
  } else if (roomState.game.state.bar[state.me.color] > 0 && myTurn) {
    statusText.textContent = t('barFirst');
  } else if (roomState.game.movedThisTurn && roomState.game.moveOptions.length > 0 && myTurn) {
    statusText.textContent = t('useRemaining');
  } else {
    statusText.textContent = myTurn ? t('selectHint') : t('enemyWaiting');
  }

  updateAutoDiceControls();
  rollDiceBtn.disabled = state.autoDice || !myTurn || !roomState.game.waitingForRoll || roomState.game.winner || roomState.game.animating || state.diceAnimating || !!roomState.game.doubleOffer;
  confirmBtn.disabled = !myTurn || !roomState.game.canConfirm || roomState.game.winner || roomState.game.animating || !!roomState.game.doubleOffer;
  resetTurnBtn.disabled = !myTurn || !roomState.game.hasRolled || !roomState.game.movedThisTurn || roomState.game.winner || roomState.game.animating || !!roomState.game.doubleOffer;

  if (doubleStatusText) {
    if (roomState.game.doubleOffer) {
      const offererName = roomState.players?.[roomState.game.doubleOffer.offeredBy]?.name || t('player2');
      doubleStatusText.textContent = roomState.game.doubleOffer.offeredBy === state.me.color
        ? t('doublePendingSelf')
        : t('doublePendingEnemy', { offerer: offererName });
    } else if (!roomState.game.noContactPhase) {
      doubleStatusText.textContent = t('doubleOnlyWhenSeparated');
    } else if (roomState.game.roundMultiplier > 1) {
      doubleStatusText.textContent = t('doubleCurrentMultiplier', { multiplier: roomState.game.roundMultiplier });
    } else if (roomState.game.canOfferDouble) {
      doubleStatusText.textContent = t('doubleNowAvailable');
    } else {
      doubleStatusText.textContent = t('doubleWaitTurn');
    }
  }
  if (doubleOfferBtn) {
    doubleOfferBtn.disabled = !myTurn || !roomState.game.canOfferDouble || !!roomState.game.doubleOffer || roomState.game.winner || roomState.game.animating;
  }

  if (previousDoubleOffer && !roomState.game.doubleOffer) {
    const offererName = roomState.players?.[previousDoubleOffer.offeredBy]?.name || t('player2');
    if ((roomState.game.roundMultiplier || 1) > previousMultiplier) {
      showToast(t('doubleAcceptedToast'), 'success');
    } else if (!roomState.game.roundSummary && !roomState.game.matchSummary) {
      showToast(t('doubleDeclinedToast', { offerer: offererName }), 'warning');
    }
  }

  if (roomState.game.doubleOffer && roomState.game.doubleOffer.offeredBy !== state.me.color) showDoubleOffer(roomState.game.doubleOffer);
  else closeDoubleModal();

  if (roomState.game.roundSummary) showRoundSummary(roomState.game.roundSummary);
  else roundModal.classList.add('hidden');

  if (roomState.game.matchSummary) showMatchSummary(roomState.game.matchSummary);
  else matchModal.classList.add('hidden');
  pruneSelection();
  autoSelectBarIfNeeded();
  renderDice();
  renderBoard();
  renderChat();
});

function pruneSelection() {
  if (!state.room || state.selectedFrom == null) return;
  if (state.selectedFrom === 'bar' && state.room.game.state.bar[state.me.color] > 0) return;
  if (state.selectedFrom !== 'bar' && ownCheckerAt(state.selectedFrom)) return;
  clearSelection();
}

function autoSelectBarIfNeeded() {
  if (!state.room || state.animating) return;
  if (state.room.game.turn !== state.me.color) return;
  if (state.room.game.state.bar[state.me.color] > 0) selectPoint('bar');
}

function canSelectPoint(pointIndex) {
  if (!state.room) return false;
  if (state.room.game.turn !== state.me.color) return false;
  if (!state.room.game.hasRolled || state.room.game.winner || state.animating) return false;
  if (state.room.game.state.bar[state.me.color] > 0) return false;
  return ownCheckerAt(pointIndex);
}

function shouldPreferOption(next, current) {
  if (!current) return true;
  if (next.to === 'off' && current.to === 'off') {
    if (next.steps !== current.steps) return next.steps < current.steps;
    return Math.max(...next.diceUsed) > Math.max(...current.diceUsed);
  }
  if (next.steps !== current.steps) return next.steps > current.steps;
  return next.diceUsed.reduce((a, b) => a + b, 0) > current.diceUsed.reduce((a, b) => a + b, 0);
}

function selectPoint(from) {
  if (state.animating) return;
  if (state.selectedFrom === from) {
    clearSelection();
    renderBoard();
    return;
  }

  const options = getMyMoveOptions().filter((m) => String(m.from) === String(from));
  state.selectedFrom = from;
  state.possibleTargets = [];
  state.blockedTargets = [];
  state.actionMap = {};

  for (const option of options) {
    const key = String(option.to);
    const existing = state.actionMap[key];
    if (!existing || shouldPreferOption(option, existing)) state.actionMap[key] = option;
    if (!state.possibleTargets.includes(key)) state.possibleTargets.push(key);
  }

  state.blockedTargets = getBlockedTargetsForSelection(from, Object.values(state.actionMap));
  renderBoard();
}

function getBlockedTargetsForSelection(from, options) {
  const blocked = [];
  const added = new Set();
  const dice = state.room?.game?.dice || [];
  const possible = new Set(options.map((o) => String(o.to)));
  if (!dice.length) return blocked;

  for (const die of dice) {
    const target = destinationPoint(from, die);
    if (target >= 0 && target <= 23 && blockedByOpponent(target) && !possible.has(String(target)) && !added.has(String(target))) {
      blocked.push(String(target));
      added.add(String(target));
    }
  }

  return blocked;
}

function playMove(to) {
  if (state.selectedFrom == null || state.animating) return;
  const option = state.actionMap[String(to)];
  if (!option) return;
  socket.emit('move:play', { actionId: option.id, from: state.selectedFrom, to });
  clearSelection();
}

function renderBoard() {
  if (!state.room) return;
  const { points, off, bar: bars } = state.room.game.state;
  board.innerHTML = '';

  const leftColumn = document.createElement('div');
  leftColumn.className = 'halfColumn';
  leftColumn.appendChild(createHalf(perspectiveTopIndices().slice(0, 6), 'top', points));
  leftColumn.appendChild(createHalf(perspectiveBottomIndices().slice(0, 6), 'bottom', points));

  const rightColumn = document.createElement('div');
  rightColumn.className = 'halfColumn';
  rightColumn.appendChild(createHalf(perspectiveTopIndices().slice(6), 'top', points));
  rightColumn.appendChild(createHalf(perspectiveBottomIndices().slice(6), 'bottom', points));

  const middle = document.createElement('div');
  middle.className = 'middleBar';
  middle.appendChild(createBarZone(topPlayerColor(), 'top', bars[topPlayerColor()]));
  middle.appendChild(createBarZone(bottomPlayerColor(), 'bottom', bars[bottomPlayerColor()]));

  board.appendChild(createOffTray(topPlayerColor(), off[topPlayerColor()], 'top-right'));
  board.appendChild(createOffTray(bottomPlayerColor(), off[bottomPlayerColor()], 'bottom-right'));
  board.appendChild(leftColumn);
  board.appendChild(middle);
  board.appendChild(rightColumn);

  if (state.floatingChecker) board.appendChild(state.floatingChecker);
  updateBoardScale();
}

function createHalf(indices, side, points) {
  const half = document.createElement('div');
  half.className = 'half';

  indices.forEach((pointIndex, visualIndex) => {
    const point = document.createElement('div');
    const alt = visualIndex % 2 === 1 ? 'alt' : '';
    point.className = `point ${side} ${alt}`.trim();
    point.dataset.point = pointIndex;

    const label = document.createElement('div');
    label.className = 'pointLabel';
    label.textContent = pointIndex + 1;
    point.appendChild(label);

    const stack = document.createElement('div');
    stack.className = 'stack';
    const value = points[pointIndex];
    const count = Math.abs(value);
    const color = value > 0 ? 'white' : value < 0 ? 'black' : null;
    const canSelectPointNow = canSelectPoint(pointIndex);
    const visibleCount = Math.min(count, 5);

    for (let i = 0; i < visibleCount; i++) {
      const checker = document.createElement('div');
      checker.className = `checker ${color || ''}`.trim();
      checker.style.setProperty('--checker-image', color ? `url(${currentSkinAsset(color)})` : 'none');
      if (i === visibleCount - 1 && canSelectPointNow) {
        checker.classList.add('clickable');
        checker.addEventListener('click', (event) => {
          event.stopPropagation();
          selectPoint(pointIndex);
        });
      }
      stack.appendChild(checker);
    }

    if (count > 5) {
      const badge = document.createElement('div');
      badge.className = 'stackCountBadge';
      badge.textContent = count;
      stack.appendChild(badge);
    }

    point.appendChild(stack);
    if (String(state.selectedFrom) === String(pointIndex)) point.classList.add('selected');

    if (state.possibleTargets.includes(String(pointIndex))) {
      point.classList.add('possible');
      const option = state.actionMap[String(pointIndex)];
      if (option?.steps > 1) point.dataset.steps = option.steps;
      point.addEventListener('click', () => playMove(pointIndex));
    } else if (canSelectPointNow) {
      point.classList.add('selectableColumn');
      point.addEventListener('click', () => selectPoint(pointIndex));
    }

    if (state.blockedTargets.includes(String(pointIndex))) point.classList.add('blocked');
    half.appendChild(point);
  });

  return half;
}

function createBarZone(color, placement, count) {
  const zone = document.createElement('div');
  zone.className = `barZone ${placement}`;
  zone.dataset.color = color;
  if (count > 0) {
    const checker = document.createElement('div');
    checker.className = `checker ${color} barChecker`;
    checker.style.setProperty('--checker-image', `url(${currentSkinAsset(color)})`);
    zone.appendChild(checker);
    if (count > 1) {
      const badge = document.createElement('div');
      badge.className = 'barBadge';
      badge.textContent = count;
      zone.appendChild(badge);
    }
  }
  if (state.selectedFrom === 'bar' && color === state.me.color) zone.classList.add('selectedCounter');
  if (color === state.me.color && count > 0 && getMyMoveOptions().some((m) => String(m.from) === 'bar')) {
    zone.classList.add('actionable');
    zone.addEventListener('click', () => selectPoint('bar'));
  }
  return zone;
}

function createOffTray(color, count, placement) {
  const tray = document.createElement('div');
  tray.className = `offTray ${placement}`;
  tray.dataset.color = color;
  const visible = Math.min(count, 6);
  for (let i = 0; i < visible; i++) {
    const checker = document.createElement('div');
    checker.className = `checker ${color} offChecker`;
    checker.style.setProperty('--checker-image', `url(${currentSkinAsset(color)})`);
    checker.style.setProperty('--off-index', i);
    tray.appendChild(checker);
  }
  if (count > 6) {
    const more = document.createElement('div');
    more.className = 'offCountBadge';
    more.textContent = count;
    tray.appendChild(more);
  }
  if (color === state.me.color && state.possibleTargets.includes('off')) {
    tray.classList.add('possible', 'selectedCounter', 'actionable');
    tray.addEventListener('click', () => playMove('off'));
  }
  return tray;
}

function renderDice() {
  const game = state.room?.game;
  diceArea.innerHTML = '';
  const showRolling = state.diceAnimating && !game?.hasRolled && !(game?.dice?.length);
  if (!showRolling && state.diceAnimating) stopDiceAnimation();
  const baseDice = showRolling ? state.diceAnimationValues : (game?.turnStartDice || []);
  if (!baseDice.length) {
    diceArea.innerHTML = `<div class="muted">${t('waitingForDice')}</div>`;
    return;
  }

  if (showRolling) {
    baseDice.forEach((value, idx) => {
      const die = createDieCube(value, false, true, idx);
      diceArea.appendChild(die);
    });
    return;
  }

  const remaining = countByValue(game?.dice || []);
  baseDice.forEach((value) => {
    const current = remaining.get(value) || 0;
    const die = createDieFlat(value, current <= 0);
    diceArea.appendChild(die);
    if (current > 0) remaining.set(value, current - 1);
  });
}

function buildPips(face, value) {
  const patterns = {
    1: [5],
    2: [1, 9],
    3: [1, 5, 9],
    4: [1, 3, 7, 9],
    5: [1, 3, 5, 7, 9],
    6: [1, 3, 4, 6, 7, 9]
  };
  const positions = patterns[value] || [];
  for (const pos of positions) {
    const pip = document.createElement('span');
    pip.className = `pip p${pos}`;
    face.appendChild(pip);
  }
}

function faceRotationForValue(value) {
  const map = {
    1: 'rotateX(0deg) rotateY(0deg)',
    2: 'rotateX(-90deg) rotateY(0deg)',
    3: 'rotateY(90deg)',
    4: 'rotateY(-90deg)',
    5: 'rotateX(90deg)',
    6: 'rotateY(180deg)'
  };
  return map[value] || map[1];
}


function createDieFlat(value, used = false) {
  const wrap = document.createElement('div');
  wrap.className = `dieFlat ${used ? 'used' : ''}`;
  const img = document.createElement('img');
  img.className = 'dieImage static';
  img.alt = t('dieAlt', { value });
  img.src = `assets/dice/${value}.svg`;
  wrap.appendChild(img);
  return wrap;
}

function createDieCube(value, used = false, rolling = false, index = 0) {
  const wrap = document.createElement('div');
  wrap.className = `dieWrap ${used ? 'used' : ''} ${rolling ? 'rollingWrap' : ''}`;
  const cube = document.createElement('div');
  cube.className = `dieCube ${rolling ? 'rolling' : ''}`;
  if (!rolling) {
    cube.style.transform = faceRotationForValue(value);
  } else {
    cube.style.setProperty('--spin-x', `${900 + Math.floor(Math.random()*360) + index*120}deg`);
    cube.style.setProperty('--spin-y', `${720 + Math.floor(Math.random()*360) + index*160}deg`);
    cube.style.setProperty('--spin-z', `${540 + Math.floor(Math.random()*360)}deg`);
  }

  const faces = [
    ['front', 1], ['back', 6], ['right', 3], ['left', 4], ['top', 5], ['bottom', 2]
  ];
  for (const [name, faceValue] of faces) {
    const face = document.createElement('div');
    face.className = `dieFace ${name}`;
    buildPips(face, faceValue);
    cube.appendChild(face);
  }
  wrap.appendChild(cube);
  return wrap;
}

function randomDieValue() {
  return 1 + Math.floor(Math.random() * 6);
}

function stopDiceAnimation() {
  state.diceAnimating = false;
  if (state.diceAnimationTimer) {
    clearInterval(state.diceAnimationTimer);
    state.diceAnimationTimer = null;
  }
}

function startDiceAnimation(duration = 1850) {
  stopDiceAnimation();
  state.diceAnimating = true;
  state.diceAnimationValues = [randomDieValue(), randomDieValue()];
  renderDice();
  playSound('roll');

  state.diceAnimationTimer = setInterval(() => {
    state.diceAnimationValues = [randomDieValue(), randomDieValue()];
    renderDice();
  }, 280);

  setTimeout(() => {
    stopDiceAnimation();
    renderDice();
  }, duration);
}

function getAnchorForLocation(loc, color) {
  let el;
  if (loc === 'bar') {
    el = board.querySelector(`.barZone[data-color="${color}"]`);
  } else if (loc === 'off') {
    el = board.querySelector(`.offTray[data-color="${color}"]`);
  } else {
    el = board.querySelector(`.point[data-point="${loc}"]`);
  }
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  const boardRect = board.getBoundingClientRect();
  return {
    x: rect.left - boardRect.left + rect.width / 2,
    y: rect.top - boardRect.top + rect.height / 2
  };
}

function makeFloatingChecker(color, fromPos) {
  const checker = document.createElement('div');
  checker.className = `checker ${color} floatingChecker`;
  checker.style.setProperty('--checker-image', `url(${currentSkinAsset(color)})`);
  checker.style.left = `${fromPos.x - 28}px`;
  checker.style.top = `${fromPos.y - 28}px`;
  return checker;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function animateMove(color, path) {
  if (!board.isConnected) return;
  let currentPos = getAnchorForLocation(path[0].from, color);
  if (!currentPos) return;
  const floating = makeFloatingChecker(color, currentPos);
  state.floatingChecker = floating;
  board.appendChild(floating);

  for (const step of path) {
    const targetPos = getAnchorForLocation(step.to, color);
    if (!targetPos) continue;
    floating.style.transition = 'left 260ms ease, top 260ms ease';
    requestAnimationFrame(() => {
      floating.style.left = `${targetPos.x - 28}px`;
      floating.style.top = `${targetPos.y - 28}px`;
    });
    await wait(280);
    currentPos = targetPos;
  }

  await wait(80);
  floating.remove();
  state.floatingChecker = null;
}


requestAnimationFrame(updateBoardScale);
