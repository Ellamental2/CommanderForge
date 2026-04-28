const EDHREC_WAIT = 200;

// State
let ownedCards        = null;
let selectedCommander = null;
let selectedPartner   = null;
let currentDeck       = null;
const cardImages      = {};
let allCommandersData  = [];
let partnerCandidates  = [];
let pendingCommanderData = null;
let targetLands       = null;
let deckFillFilter    = 'full';
let totalCardsCount   = 0;

// DOM refs
const fileInput      = document.getElementById('fileInput');
const fileLabelEl    = document.getElementById('fileLabel');
const fileLabelText  = document.getElementById('fileLabelText');
const cardListInput  = document.getElementById('cardListInput');
const analyzeBtn     = document.getElementById('analyzeBtn');
const clearBtn       = document.getElementById('clearBtn');
const statusText     = document.getElementById('statusText');
const errorBox       = document.getElementById('errorBox');
const commanderSection = document.getElementById('commandersSection');
const commanderGrid  = document.getElementById('commanderGrid');
const resultsCount   = document.getElementById('resultsCount');
const deckSection    = document.getElementById('deckSection');
const cardPreview          = document.getElementById('cardPreview');
const cardPreviewImg       = document.getElementById('cardPreviewImg');
const cardPreviewImg2      = document.getElementById('cardPreviewImg2');
const cardPreviewFlipHint  = document.getElementById('cardPreviewFlipHint');
const cardPreviewOracle    = document.getElementById('cardPreviewOracle');
const progressArea         = document.getElementById('progressArea');
const scryfallBar          = document.getElementById('scryfallBar');
const scryfallPct          = document.getElementById('scryfallPct');
const edhrecBar            = document.getElementById('edhrecBar');
const edhrecPct            = document.getElementById('edhrecPct');

let previewFrontUrl   = null;
let previewBackUrl    = null;
let previewShowBack   = false;

function setProgress(bar, pct, label) {
  const p = Math.round(pct * 100);
  bar.style.width = p + '%';
  label.textContent = p + '%';
}

document.addEventListener('keydown', e => {
  if (e.key === 'Alt' && previewBackUrl && cardPreview.style.display !== 'none') {
    e.preventDefault();
    previewShowBack = true;
    cardPreviewImg.src = previewBackUrl;
  }
});
document.addEventListener('keyup', e => {
  if (e.key === 'Alt' && previewFrontUrl && previewShowBack) {
    previewShowBack = false;
    cardPreviewImg.src = previewFrontUrl;
  }
});

// Game changer limit
document.querySelectorAll('input[name="gcLimit"]').forEach(radio => {
  radio.addEventListener('change', () => {
    document.querySelectorAll('input[name="gcLimit"]').forEach(r => r.closest('.gc-option').classList.remove('active'));
    radio.closest('.gc-option').classList.add('active');
    if (selectedCommander && ownedCards && !pendingCommanderData) {
      const cardEl = document.querySelector('.commander-card.selected');
      const cmdData = allCommandersData.find(d => d.name === selectedCommander);
      if (cardEl && cmdData) selectCommander(cardEl, cmdData);
    }
  });
});

// Collection fill filter
document.querySelectorAll('input[name="deckFill"]').forEach(radio => {
  radio.addEventListener('change', () => {
    document.querySelectorAll('input[name="deckFill"]').forEach(r => r.closest('.gc-option').classList.remove('active'));
    radio.closest('.gc-option').classList.add('active');
    deckFillFilter = radio.value;
    if (allCommandersData.length > 0) renderCommanders(getFilteredCommanders(), totalCardsCount);
  });
});

function getFilteredCommanders() {
  if (deckFillFilter === 'all') return allCommandersData;
  const min = deckFillFilter === 'full' ? 99 : 80;
  return allCommandersData.filter(cmd => cmd.validCardCount >= min);
}

// Land slider
const landSlider    = document.getElementById('landSlider');
const landSliderVal = document.getElementById('landSliderVal');

landSlider.addEventListener('input', () => {
  landSliderVal.textContent = landSlider.value;
});

landSlider.addEventListener('change', () => {
  targetLands = parseInt(landSlider.value, 10);
  if (selectedCommander && ownedCards) rebuildCurrentDeck();
});

async function rebuildCurrentDeck() {
  if (!selectedCommander || !ownedCards) return;
  deckSection.style.display = 'none';
  setStatus('<span class="spinner"></span>Rebuilding deck...');
  try {
    await _buildAndRender(selectedCommander, selectedPartner);
  } catch (e) {
    showError('Error: ' + e.message);
    setStatus('');
  }
}

// File load
fileInput.addEventListener('change', () => {
  const file = fileInput.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    cardListInput.value = e.target.result;
    fileLabelText.textContent = file.name;
    fileLabelEl.classList.add('has-file');
    checkReady();
  };
  reader.readAsText(file);
});

cardListInput.addEventListener('input', checkReady);

function checkReady() {
  analyzeBtn.disabled = cardListInput.value.trim().length === 0;
}

clearBtn.addEventListener('click', () => {
  cardListInput.value = '';
  fileInput.value = '';
  fileLabelText.textContent = 'Load File';
  fileLabelEl.classList.remove('has-file');
  commanderSection.style.display = 'none';
  deckSection.style.display = 'none';
  statusText.textContent = '';
  progressArea.style.display = 'none';
  hideError();
  checkReady();
  ownedCards = null;
  selectedCommander = null;
  selectedPartner = null;
  targetLands = null;
  allCommandersData = [];
  partnerCandidates = [];
  pendingCommanderData = null;
});

// Analyse
analyzeBtn.addEventListener('click', analyse);

async function analyse() {
  const content = cardListInput.value.trim();
  if (!content) return;

  analyzeBtn.disabled = true;
  hideError();
  commanderSection.style.display = 'none';
  deckSection.style.display = 'none';

  // Reset and show progress bars
  setProgress(scryfallBar, 0, scryfallPct);
  setProgress(edhrecBar, 0, edhrecPct);
  progressArea.style.display = '';

  setStatus('<span class="spinner"></span>Fetching card data from Scryfall...');

  try {
    const parsed = parseCardList(content);
    if (parsed.length === 0) {
      showError('Could not parse any cards from the provided list.');
      setStatus(''); progressArea.style.display = 'none'; return;
    }

    const cards = await fetchCardsBatch(parsed, pct => setProgress(scryfallBar, pct, scryfallPct));
    setProgress(scryfallBar, 1, scryfallPct);
    ownedCards = cards;
    totalCardsCount = cards.length;

    const seenCmdNames = new Set();
    const commanders = cards.filter(oc => {
      if (!isLegalCommander(oc.card)) return false;
      const key = oc.card.name.toLowerCase();
      if (seenCmdNames.has(key)) return false;
      seenCmdNames.add(key);
      return true;
    });

    if (commanders.length === 0) {
      showError('No legal commanders found in your collection.');
      setStatus(''); progressArea.style.display = 'none'; return;
    }

    setStatus('<span class="spinner"></span>Scoring ' + commanders.length + ' commander(s) via EDHRec...');
    const scores = [];
    for (let i = 0; i < commanders.length; i++) {
      scores.push(await scoreCommander(commanders[i].card, cards));
      await sleep(EDHREC_WAIT);
      setProgress(edhrecBar, (i + 1) / commanders.length, edhrecPct);
    }

    const { pairs, pairedNames } = buildPairResults(scores, cards);
    const soloScores = scores.filter(s => !pairedNames.has(s.name.toLowerCase()));
    allCommandersData = [...pairs, ...soloScores].sort((a, b) => b.matchPercent - a.matchPercent);
    partnerCandidates = findPartnerCandidates(cards);

    renderCommanders(getFilteredCommanders(), totalCardsCount);
    setStatus('Analysed ' + cards.length + ' card(s) — found ' + commanders.length + ' potential commander(s)');
    progressArea.style.display = 'none';
  } catch (e) {
    showError('Error: ' + e.message);
    setStatus('');
    progressArea.style.display = 'none';
  } finally {
    analyzeBtn.disabled = false;
  }
}

// Build deck helpers
async function _buildAndRender(commanderName, partnerName) {
  const gcLimit = document.querySelector('input[name="gcLimit"]:checked')?.value ?? 'unlimited';
  const commanderOwned = ownedCards.find(oc => oc.card.name.toLowerCase() === commanderName.toLowerCase());
  if (!commanderOwned) { showError('Commander "' + commanderName + '" not found in collection.'); setStatus(''); return; }
  let partnerCard;
  if (partnerName) {
    const partnerOwned = ownedCards.find(oc => oc.card.name.toLowerCase() === partnerName.toLowerCase());
    if (!partnerOwned) { showError('Partner "' + partnerName + '" not found in collection.'); setStatus(''); return; }
    partnerCard = partnerOwned.card;
  }
  const deck = await buildDeck(commanderOwned.card, ownedCards, partnerCard, gcLimit, targetLands !== null ? targetLands : undefined);
  renderDeck(deck);
  setStatus('Deck built — ' + deck.totalCards + '/100 cards');
}

async function buildDeckSingle(commanderName) {
  selectedPartner = null;
  deckSection.style.display = 'none';
  setStatus('<span class="spinner"></span>Building deck...');
  try { await _buildAndRender(commanderName, null); }
  catch (e) { showError('Error: ' + e.message); setStatus(''); }
}

async function buildDeckWithPair(commanderName, partnerName) {
  selectedPartner = partnerName;
  deckSection.style.display = 'none';
  setStatus('<span class="spinner"></span>Building deck...');
  try { await _buildAndRender(commanderName, partnerName); }
  catch (e) { showError('Error: ' + e.message); setStatus(''); }
}

// Render commander grid
function renderCommanders(commanders, totalCards) {
  commanderGrid.innerHTML = '';

  if (commanders.length === 0) {
    const msg = allCommandersData.length > 0
      ? 'No commanders match the current filter — try a less strict Collection Fill setting.'
      : 'No legal commanders found in your collection.';
    commanderGrid.innerHTML = `<p style="color:var(--text-dim);font-style:italic;grid-column:1/-1;">${msg}</p>`;
  }

  commanders.forEach((cmd, i) => {
    const card = document.createElement('div');
    card.className = 'commander-card';
    card.style.animationDelay = `${i * 40}ms`;

    const pct = cmd.matchPercent;
    const barClass  = pct >= 40 ? 'match-bar-high'  : pct >= 20 ? 'match-bar-mid'  : 'match-bar-low';
    const textClass = pct >= 40 ? 'match-high'       : pct >= 20 ? 'match-mid'       : 'match-low';

    const pipsHtml = cmd.colorIdentity.map(c => `<span class="pip pip-${c}" title="${colorName(c)}">${c}</span>`).join('');

    const isPair = !!cmd.partner;

    const artHtml = isPair
      ? `<div class="art-half art-left">${cmd.imageUrl ? `<img src="${escHtml(cmd.imageUrl)}" alt="${escHtml(cmd.name)}" loading="lazy" />` : ''}</div>
         <div class="art-half art-right">${cmd.partner.imageUrl ? `<img src="${escHtml(cmd.partner.imageUrl)}" alt="${escHtml(cmd.partner.name)}" loading="lazy" />` : ''}</div>`
      : (cmd.imageUrl
          ? `<img src="${escHtml(cmd.imageUrl)}" alt="${escHtml(cmd.name)}" loading="lazy" />`
          : `<div class="card-art-placeholder">🃏</div>`);

    const nameHtml = isPair
      ? `<div class="card-name pair-name">${escHtml(cmd.name)}<span class="pair-amp">&amp; ${escHtml(cmd.partner.name)}</span></div>`
      : `<div class="card-name">${escHtml(cmd.name)}</div>`;

    card.innerHTML = `
      <div class="card-art${isPair ? ' card-art-pair' : ''}">
        ${artHtml}
      </div>
      <div class="card-body">
        ${nameHtml}
        <div class="card-meta">
          <div class="pips">${pipsHtml || '<span style="color:var(--text-dim);font-size:11px;">Colorless</span>'}</div>
          <div class="match-score ${textClass}">${pct}%</div>
        </div>
        <div class="match-bar-wrap"><div class="match-bar ${barClass}" style="width:${pct}%"></div></div>
        <div class="valid-count">${cmd.matchCount} / ${Math.min(99, cmd.validCardCount)} EDHRec matches</div>
      </div>`;

    card.dataset.commanderName = cmd.name;
    card.addEventListener('click', () => selectCommander(card, cmd));

    if (cmd.imageUrl || cmd.partner?.imageUrl) {
      card.addEventListener('mouseenter', e => showCardPreview(
        cmd.imageUrl,
        isPair ? null : cmd.imageUrlBack,
        isPair ? null : cmd.oracleText,
        e,
        isPair ? (cmd.partner?.imageUrl ?? null) : null
      ));
      card.addEventListener('mousemove',  e => movePreview(e));
      card.addEventListener('mouseleave', hidePreview);
    }

    commanderGrid.appendChild(card);
  });

  const filteredLabel = commanders.length !== allCommandersData.length
    ? `${commanders.length} of ${allCommandersData.length} · sorted by EDHRec match`
    : `${commanders.length} found · sorted by EDHRec match`;
  resultsCount.textContent = commanders.length ? filteredLabel : '';
  commanderSection.style.display = '';
}

// Partner selection helpers
function isCompatiblePartner(pendingCmd, candidateCmd) {
  if (candidateCmd.partner) return false;
  const pType = pendingCmd.partnerType;
  const cType = candidateCmd.partnerType;
  if (!pType) return false;
  if (pType === 'partner' && cType === 'partner') return true;
  if (pType === 'friends-forever' && cType === 'friends-forever') return true;
  if (pType === 'partner-with' && pendingCmd.partnerWith &&
      pendingCmd.partnerWith.toLowerCase() === candidateCmd.name.toLowerCase()) return true;
  if (pType === 'doctor' && cType === 'doctors-companion') return true;
  if (pType === 'doctors-companion' && cType === 'doctor') return true;
  return false;
}

function enterPartnerSelectionMode(cmd) {
  pendingCommanderData = cmd;

  const banner = document.createElement('div');
  banner.className = 'partner-banner';
  banner.id = 'partnerBanner';
  const label = cmd.partnerType === 'chooses-background'
    ? 'Choose a Background enchantment to pair'
    : cmd.partnerType === 'doctor'
      ? "Select a Doctor's Companion to pair"
      : cmd.partnerType === 'doctors-companion'
        ? 'Select a Doctor to pair'
        : 'Select a partner commander';
  banner.innerHTML = `<span>${escHtml(label)}</span><button onclick="skipPartner()">Build without partner</button>`;
  commanderGrid.insertBefore(banner, commanderGrid.firstChild);

  document.querySelectorAll('.commander-card').forEach(c => {
    if (c.classList.contains('selected')) return;
    const cName = c.dataset.commanderName;
    const cData = allCommandersData.find(d => d.name === cName);
    if (cData && isCompatiblePartner(cmd, cData)) {
      c.classList.add('partner-eligible');
    } else {
      c.classList.add('partner-ineligible');
    }
  });

  if (cmd.partnerType === 'chooses-background' && partnerCandidates.length > 0) {
    const bgSection = document.createElement('div');
    bgSection.id = 'backgroundSection';
    bgSection.style.cssText = 'grid-column:1/-1;margin-top:4px;';
    bgSection.innerHTML = '<div style="font-size:11px;letter-spacing:1px;color:var(--text-dim);margin-bottom:8px;">BACKGROUNDS IN YOUR COLLECTION</div>';
    const bgGrid = document.createElement('div');
    bgGrid.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;';
    for (const bg of partnerCandidates) {
      const bgCard = document.createElement('div');
      bgCard.className = 'background-card';
      bgCard.textContent = bg.name;
      bgCard.addEventListener('click', () => {
        const commanderName = pendingCommanderData.name;
        clearPartnerSelection();
        buildDeckWithPair(commanderName, bg.name);
      });
      if (bg.imageUrl) {
        bgCard.addEventListener('mouseenter', e => showCardPreview(bg.imageUrl, bg.imageUrlBack, bg.oracleText, e));
        bgCard.addEventListener('mousemove',  e => movePreview(e));
        bgCard.addEventListener('mouseleave', hidePreview);
      }
      bgGrid.appendChild(bgCard);
    }
    bgSection.appendChild(bgGrid);
    commanderGrid.appendChild(bgSection);
  }
}

function clearPartnerSelection() {
  pendingCommanderData = null;
  document.querySelectorAll('.commander-card').forEach(c =>
    c.classList.remove('selected', 'partner-eligible', 'partner-ineligible'));
  document.getElementById('partnerBanner')?.remove();
  document.getElementById('backgroundSection')?.remove();
}

function skipPartner() {
  if (!pendingCommanderData) return;
  const name = pendingCommanderData.name;
  clearPartnerSelection();
  buildDeckSingle(name);
}

// Select a commander & build deck
async function selectCommander(cardEl, cmd) {
  const name = cmd.name;

  if (pendingCommanderData?.name === name) {
    clearPartnerSelection();
    selectedCommander = null;
    return;
  }

  if (pendingCommanderData) {
    if (isCompatiblePartner(pendingCommanderData, cmd)) {
      const commanderName = pendingCommanderData.name;
      clearPartnerSelection();
      cardEl.classList.add('selected');
      selectedCommander = name;
      await buildDeckWithPair(commanderName, name);
      return;
    }
    clearPartnerSelection();
  }

  if (name !== selectedCommander) targetLands = null;
  selectedCommander = name;
  document.querySelectorAll('.commander-card').forEach(c => c.classList.remove('selected'));
  cardEl.classList.add('selected');

  if (cmd.partner) {
    await buildDeckWithPair(name, cmd.partner.name);
    return;
  }

  if (cmd.partnerType) {
    enterPartnerSelectionMode(cmd);
  } else {
    await buildDeckSingle(name);
  }
}

// Export to Moxfield
function exportToMoxfield() {
  if (!currentDeck) return;
  const lines = [
    'Commander',
    `1 ${currentDeck.commander.name}`,
    ...(currentDeck.partner ? [`1 ${currentDeck.partner.name}`] : []),
    '',
    'Deck',
  ];
  for (const c of currentDeck.cards) {
    lines.push(`${c.quantity} ${c.name}`);
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `${currentDeck.commander.name.replace(/[^a-z0-9]/gi, '_')}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

// Render deck
function renderDeck(deck) {
  currentDeck = deck;

  landSlider.max = deck.deckSize;
  if (targetLands === null) {
    landSlider.value = deck.targetLands;
    landSliderVal.textContent = deck.targetLands;
  } else {
    landSlider.value = targetLands;
    landSliderVal.textContent = targetLands;
  }

  const imgEl = document.getElementById('deckCommanderImg');
  imgEl.src = deck.commander.imageUrl || '';
  imgEl.style.display = deck.commander.imageUrl ? '' : 'none';

  const img2El = document.getElementById('deckCommanderImg2');
  if (deck.partner) {
    img2El.src = deck.partner.imageUrl || '';
    img2El.style.display = deck.partner.imageUrl ? '' : 'none';
    document.getElementById('deckCommanderName').textContent =
      deck.commander.name + ' & ' + deck.partner.name;
  } else {
    img2El.style.display = 'none';
    document.getElementById('deckCommanderName').textContent = deck.commander.name;
  }

  const deckHeader = document.querySelector('.deck-header');
  deckHeader.onmouseenter = e => showCardPreview(
    deck.commander.imageUrl,
    deck.partner ? null : deck.commander.imageUrlBack,
    deck.partner ? null : deck.commander.oracleText,
    e,
    deck.partner ? deck.partner.imageUrl : null
  );
  deckHeader.onmousemove  = e => movePreview(e);
  deckHeader.onmouseleave = hidePreview;

  const pipsEl = document.getElementById('deckCommanderPips');
  const combinedColors = deck.partner
    ? [...new Set([...deck.commander.colorIdentity, ...deck.partner.colorIdentity])]
    : deck.commander.colorIdentity;
  pipsEl.innerHTML = combinedColors.map(c => `<span class="pip pip-${c}">${c}</span>`).join('');

  document.getElementById('deckTotal').textContent = deck.totalCards;

  const slotsEl = document.getElementById('deckSlotsStat');
  const warnEl  = document.getElementById('slotsWarning');
  if (deck.slotsRemaining > 0) {
    slotsEl.textContent = '';
    warnEl.textContent = `⚠ ${deck.slotsRemaining} slot(s) unfilled — not enough eligible cards`;
    warnEl.style.display = '';
  } else {
    slotsEl.innerHTML = `<span style="color:#6dba7d">Complete deck ✓</span>`;
    warnEl.style.display = 'none';
  }

  for (const c of deck.cards) {
    if (c.imageUrl) cardImages[c.name] = c.imageUrl;
  }

  const groups = {};
  const ORDER = ['Creatures','Planeswalkers','Instants','Sorceries','Enchantments','Artifacts','Lands','Other'];
  for (const cat of ORDER) groups[cat] = [];

  for (const c of deck.cards) {
    const cat = categorise(c.typeLine);
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(c);
  }

  const categoriesEl = document.getElementById('deckCategories');
  categoriesEl.innerHTML = '';

  for (const cat of ORDER) {
    if (!groups[cat] || groups[cat].length === 0) continue;
    const group = document.createElement('div');
    group.className = 'category-group';
    group.innerHTML = `<h3>${cat} <span style="color:var(--text-dim);font-size:10px;letter-spacing:1px;">(${groups[cat].reduce((s,c) => s+c.quantity, 0)})</span></h3>`;

    for (const c of groups[cat]) {
      const row = document.createElement('div');
      row.className = 'deck-card-row';
      const dotHtml = c.isGameChanger
        ? '<span class="game-changer-dot" title="EDHRec game changer"></span>'
        : c.isRecommended
          ? '<span class="rec-dot" title="EDHRec recommended"></span>'
          : '<span style="width:5px"></span>';
      const nameClass = c.isGameChanger ? 'game-changer' : c.isRecommended ? 'recommended' : '';
      row.innerHTML = `
        <span class="deck-card-qty">${c.quantity > 1 ? c.quantity : ''}</span>
        ${dotHtml}
        <span class="deck-card-name ${nameClass}">${escHtml(c.name)}</span>`;

      if (c.imageUrl) {
        row.addEventListener('mouseenter', e => showCardPreview(c.imageUrl, c.imageUrlBack, null, e));
        row.addEventListener('mousemove',  e => movePreview(e));
        row.addEventListener('mouseleave', hidePreview);
      }
      group.appendChild(row);
    }
    categoriesEl.appendChild(group);
  }

  deckSection.style.display = '';
  deckSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Card preview tooltip
function showCardPreview(frontUrl, backUrl, oracleText, e, front2Url = null) {
  if (!frontUrl && !front2Url) return;
  previewFrontUrl = frontUrl;
  previewShowBack = false;
  cardPreviewImg.src = frontUrl || '';
  cardPreviewImg.style.display = frontUrl ? '' : 'none';

  if (front2Url) {
    cardPreviewImg2.src = front2Url;
    cardPreviewImg2.style.display = '';
    cardPreview.style.width = '448px';
    previewBackUrl = null;
    cardPreviewFlipHint.style.display = 'none';
  } else {
    cardPreviewImg2.style.display = 'none';
    cardPreview.style.width = '220px';
    previewBackUrl = backUrl || null;
    cardPreviewFlipHint.style.display = backUrl ? '' : 'none';
  }

  if (oracleText) {
    cardPreviewOracle.textContent = oracleText;
    cardPreviewOracle.style.display = '';
  } else {
    cardPreviewOracle.style.display = 'none';
  }
  cardPreview.style.display = 'block';
  movePreview(e);
}

function movePreview(e) {
  const x = e.clientX + 16;
  const y = e.clientY - 60;
  const maxX = window.innerWidth - cardPreview.offsetWidth - 8;
  const maxY = window.innerHeight - 520;
  cardPreview.style.left = Math.min(x, maxX) + 'px';
  cardPreview.style.top  = Math.max(10, Math.min(y, maxY)) + 'px';
}

function hidePreview() { cardPreview.style.display = 'none'; }

// Helpers
function categorise(typeLine) {
  if (!typeLine) return 'Other';
  if (typeLine.includes('Creature'))     return 'Creatures';
  if (typeLine.includes('Planeswalker')) return 'Planeswalkers';
  if (typeLine.includes('Land'))         return 'Lands';
  if (typeLine.includes('Enchantment'))  return 'Enchantments';
  if (typeLine.includes('Artifact'))     return 'Artifacts';
  if (typeLine.includes('Instant'))      return 'Instants';
  if (typeLine.includes('Sorcery'))      return 'Sorceries';
  return 'Other';
}

function colorName(c) {
  return { W:'White', U:'Blue', B:'Black', R:'Red', G:'Green', C:'Colorless' }[c] ?? c;
}

function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function setStatus(html) { statusText.innerHTML = html; }
function showError(msg)  { errorBox.textContent = msg; errorBox.style.display = ''; }
function hideError()     { errorBox.style.display = 'none'; }
