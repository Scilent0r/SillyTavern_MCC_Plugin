/**
 * Character Card Tracker – index.js  v1.1.0
 *
 * Fixes vs v1.0.0:
 *  - Panel now attaches to #movingDivs so ST's CSS doesn't clobber it
 *  - Theme class applied correctly; panel gets explicit bg so it's visible
 *  - Uses correct ST event (GENERATE_BEFORE_ANY_ACTION)
 *  - setExtensionPrompt imported directly from extensions.js
 *  - Removed unused getExtensionPromptByName import
 *  - z-index bumped above ST's own panels (10000)
 *  - Added drag-to-move handle so users can reposition the panel
 */

import {
  saveSettingsDebounced,
  eventSource,
  event_types,
  getContext,
} from '../../../../script.js';

import {
  extension_settings,
  setExtensionPrompt,
  saveMetadataDebounced,
} from '../../../extensions.js';

// ── Constants ──────────────────────────────────────────────────────────────

const EXT_NAME  = 'char-card-tracker';
const INJECT_KEY = 'cct_char_context';
// Position enum expected by setExtensionPrompt: 1 = after system prompt
const INJECT_POSITION = 1;

const DEFAULT_SETTINGS = {
  enabled:     true,
  theme:       'dark',
  position:    'right',
  autoInject:  true,
  showPreview: false,
};

// ── State ──────────────────────────────────────────────────────────────────

let characters = {};
let settings   = { ...DEFAULT_SETTINGS };
let panelEl    = null;

// ── Helpers ────────────────────────────────────────────────────────────────

function log(...a) { console.log(`[${EXT_NAME}]`, ...a); }
function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

function saveCharacters() {
  const ctx = getContext();
  if (!ctx?.chatMetadata) return;
  ctx.chatMetadata[EXT_NAME + '_chars'] = JSON.stringify(characters);
  saveMetadataDebounced();
}

function loadCharacters() {
  const ctx = getContext();
  if (!ctx?.chatMetadata) { characters = {}; return; }
  const raw = ctx.chatMetadata[EXT_NAME + '_chars'];
  try { characters = raw ? JSON.parse(raw) : {}; } catch { characters = {}; }
}

// ── Context injection ──────────────────────────────────────────────────────

function buildContextBlock(name) {
  const c = characters[name];
  if (!c) return '';
  const s = c.stats || {};
  const lines = [
    `[Character status for ${name}]`,
    `Height: ${s.height || 'unknown'} | Weight: ${s.weight || 'unknown'}`,
  ];
  Object.entries(s).forEach(([k, v]) => {
    if (k !== 'height' && k !== 'weight' && v)
      lines.push(`${capitalize(k.replace(/_/g,' '))}: ${v}`);
  });
  if (c.likes?.length)   lines.push(`Currently likes: ${c.likes.join(', ')}`);
  if (c.hates?.length)   lines.push(`Currently dislikes: ${c.hates.join(', ')}`);
  if (c.wearing?.length) lines.push(`Currently wearing: ${c.wearing.join(', ')}`);
  lines.push(`[End of ${name}'s status]`);
  return lines.join('\n');
}

function buildFullInjection() {
  if (!settings.enabled || !settings.autoInject) return '';
  const blocks = Object.keys(characters).map(buildContextBlock).filter(Boolean);
  return blocks.length ? '\n\n' + blocks.join('\n\n') + '\n' : '';
}

function onBeforeGeneration() {
  // setExtensionPrompt(key, value, position, depth, scan, role)
  setExtensionPrompt(INJECT_KEY, buildFullInjection(), INJECT_POSITION, 0, false, 'system');
}

// ── Drag-to-move ───────────────────────────────────────────────────────────

function makeDraggable(el, handle) {
  let ox = 0, oy = 0, sx = 0, sy = 0;
  handle.style.cursor = 'grab';
  handle.addEventListener('mousedown', e => {
    if (e.target.closest('button, input, select')) return;
    e.preventDefault();
    sx = e.clientX; sy = e.clientY;
    const r = el.getBoundingClientRect();
    ox = r.left; oy = r.top;
    // Switch to absolute positioning once dragged
    el.style.right  = 'auto';
    el.style.left   = ox + 'px';
    el.style.top    = oy + 'px';
    el.style.bottom = 'auto';
    handle.style.cursor = 'grabbing';
    const move = ev => {
      el.style.left = (ox + ev.clientX - sx) + 'px';
      el.style.top  = (oy + ev.clientY - sy) + 'px';
    };
    const up = () => {
      handle.style.cursor = 'grab';
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  });
}

// ── UI helpers ─────────────────────────────────────────────────────────────

function getThemeClass() { return 'cct-theme-' + (settings.theme || 'dark'); }

function escapeHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function renderStatItem(charName, key, value) {
  return `<div class="cct-stat-item">
    <p class="cct-stat-label">${capitalize(key.replace(/_/g,' '))}</p>
    <div class="cct-stat-value" contenteditable="false"
         data-char="${escapeHtml(charName)}" data-stat-key="${escapeHtml(key)}"
         title="Double-click to edit">${escapeHtml(value || '')}</div>
  </div>`;
}

function renderTag(charName, category, value) {
  const cls = category === 'likes' ? 'like' : category === 'hates' ? 'hate' : 'wear';
  return `<span class="cct-tag ${cls}">
    ${escapeHtml(value)}
    <button class="cct-tag-del"
      data-char="${escapeHtml(charName)}"
      data-category="${category}"
      data-value="${escapeHtml(value)}"
      title="Remove">×</button>
  </span>`;
}

function splitTagKey(key) {
  const idx = key.lastIndexOf('-');
  return [key.slice(0, idx), key.slice(idx + 1)];
}

function updatePreview() {
  if (!panelEl) return;
  const prev = panelEl.querySelector('#cct-context-preview');
  if (!prev) return;
  prev.textContent = buildFullInjection().trim();
  prev.classList.toggle('cct-visible', !!settings.showPreview);
}

function updateSubtitle(card, charName) {
  const sub = card.querySelector('.cct-char-subtitle');
  if (!sub) return;
  const s = characters[charName]?.stats || {};
  sub.textContent = `${s.height || '?'} · ${s.weight || '?'}`;
}

function toggleCollapse(name) {
  if (!characters[name]) return;
  characters[name].collapsed = !characters[name].collapsed;
  const card = panelEl?.querySelector(`[data-char-name="${name}"]`);
  if (!card) return;
  card.querySelector(`[data-body="${name}"]`)
      ?.classList.toggle('cct-collapsed', characters[name].collapsed);
  const btn = card.querySelector(`[data-collapse="${name}"]`);
  if (btn) btn.textContent = characters[name].collapsed ? '▶' : '▼';
  saveCharacters();
}

// ── Card builder ───────────────────────────────────────────────────────────

function buildCharCard(name, data) {
  const card = document.createElement('div');
  card.className = 'cct-card';
  card.dataset.charName = name;

  // Try to pull the avatar from ST's character list
  const ctx = getContext();
  let avatarSrc = '';
  if (ctx?.characters) {
    const found = ctx.characters.find(c => c.name === name);
    if (found?.avatar) avatarSrc = `/characters/${found.avatar}`;
  }

  const stats    = data.stats   || {};
  const likes    = data.likes   || [];
  const hates    = data.hates   || [];
  const wearing  = data.wearing || [];
  const collapsed = !!data.collapsed;

  const avatarHTML = avatarSrc
    ? `<img class="cct-char-avatar" src="${escapeHtml(avatarSrc)}" alt="${escapeHtml(name)}"
           onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
    : '';
  const placeholderStyle = avatarSrc ? 'style="display:none"' : '';

  card.innerHTML = `
    <div class="cct-card-header" data-toggle="${escapeHtml(name)}">
      ${avatarHTML}
      <div class="cct-avatar-placeholder" ${placeholderStyle}>${escapeHtml(name.charAt(0).toUpperCase())}</div>
      <div class="cct-char-name-area">
        <p class="cct-char-name">${escapeHtml(name)}</p>
        <p class="cct-char-subtitle">${escapeHtml(stats.height||'?')} · ${escapeHtml(stats.weight||'?')}</p>
      </div>
      <button class="cct-delete-char" data-char="${escapeHtml(name)}" title="Remove">✕</button>
      <button class="cct-collapse-btn" data-collapse="${escapeHtml(name)}">${collapsed ? '▶' : '▼'}</button>
    </div>

    <div class="cct-card-body ${collapsed ? 'cct-collapsed' : ''}" data-body="${escapeHtml(name)}">

      <div>
        <p class="cct-section-label">📊 Stats</p>
        <div class="cct-stats-grid">
          ${renderStatItem(name, 'height', stats.height)}
          ${renderStatItem(name, 'weight', stats.weight)}
          ${Object.entries(stats)
              .filter(([k]) => k !== 'height' && k !== 'weight')
              .map(([k,v]) => renderStatItem(name, k, v)).join('')}
        </div>
        <div style="display:flex;gap:5px;margin-top:6px">
          <input class="cct-tag-input cct-stat-key" placeholder="New stat name" data-for="${escapeHtml(name)}" style="flex:1">
          <button class="cct-tag-add-btn cct-add-stat" data-for="${escapeHtml(name)}">+ Stat</button>
        </div>
      </div>

      <div class="cct-tags-section">
        <p class="cct-section-label">💚 Likes</p>
        <div class="cct-tags-wrap" data-tags="${escapeHtml(name)}-likes">
          ${likes.map(l => renderTag(name,'likes',l)).join('')}
        </div>
        <div class="cct-tag-add-row">
          <input class="cct-tag-input" placeholder="Add something they like…" data-for="${escapeHtml(name)}-likes">
          <button class="cct-tag-add-btn" data-add-tag="${escapeHtml(name)}-likes">+</button>
        </div>
      </div>

      <div class="cct-tags-section">
        <p class="cct-section-label">🔴 Hates</p>
        <div class="cct-tags-wrap" data-tags="${escapeHtml(name)}-hates">
          ${hates.map(h => renderTag(name,'hates',h)).join('')}
        </div>
        <div class="cct-tag-add-row">
          <input class="cct-tag-input" placeholder="Add something they hate…" data-for="${escapeHtml(name)}-hates">
          <button class="cct-tag-add-btn" data-add-tag="${escapeHtml(name)}-hates">+</button>
        </div>
      </div>

      <div class="cct-tags-section">
        <p class="cct-section-label">👗 Wearing</p>
        <div class="cct-tags-wrap" data-tags="${escapeHtml(name)}-wearing">
          ${wearing.map(w => renderTag(name,'wearing',w)).join('')}
        </div>
        <div class="cct-tag-add-row">
          <input class="cct-tag-input" placeholder="Add clothing item…" data-for="${escapeHtml(name)}-wearing">
          <button class="cct-tag-add-btn" data-add-tag="${escapeHtml(name)}-wearing">+</button>
        </div>
      </div>

      <p class="cct-inject-info">ℹ️ Status injected into AI context automatically</p>
    </div>`;

  // Header click → collapse (ignore button clicks)
  card.querySelector('.cct-card-header').addEventListener('click', e => {
    if (e.target.closest('button')) return;
    toggleCollapse(name);
  });
  card.querySelector(`[data-collapse]`).addEventListener('click', () => toggleCollapse(name));

  // Delete character
  card.querySelector('.cct-delete-char').addEventListener('click', () => {
    if (!confirm(`Remove ${name} from the tracker?`)) return;
    delete characters[name];
    saveCharacters();
    renderPanel();
  });

  // Editable stat values (double-click)
  card.querySelectorAll('.cct-stat-value').forEach(el => {
    el.addEventListener('dblclick', () => {
      el.contentEditable = 'true';
      el.focus();
      // move cursor to end
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      window.getSelection().removeAllRanges();
      window.getSelection().addRange(range);
    });
    el.addEventListener('blur', () => {
      el.contentEditable = 'false';
      const key  = el.dataset.statKey;
      const cName = el.dataset.char;
      if (cName && key && characters[cName]) {
        characters[cName].stats = characters[cName].stats || {};
        characters[cName].stats[key] = el.textContent.trim();
        updateSubtitle(card, cName);
        saveCharacters();
        updatePreview();
      }
    });
    el.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); el.blur(); } });
  });

  // Add custom stat
  card.querySelector('.cct-add-stat').addEventListener('click', () => {
    const keyInput = card.querySelector(`.cct-stat-key[data-for="${name}"]`);
    const key = keyInput.value.trim().toLowerCase().replace(/\s+/g,'_');
    if (!key) return;
    characters[name].stats = characters[name].stats || {};
    if (!(key in characters[name].stats)) characters[name].stats[key] = '';
    keyInput.value = '';
    saveCharacters();
    renderPanel();
  });

  // Add tag buttons
  card.querySelectorAll('[data-add-tag]').forEach(btn => {
    const tagKey = btn.dataset.addTag;
    const input  = card.querySelector(`[data-for="${tagKey}"]`);
    const addTag = () => {
      const val = input?.value.trim();
      if (!val) return;
      const [cName, cat] = splitTagKey(tagKey);
      if (!characters[cName]) return;
      characters[cName][cat] = characters[cName][cat] || [];
      if (!characters[cName][cat].includes(val)) characters[cName][cat].push(val);
      input.value = '';
      saveCharacters();
      // Append tag without full re-render
      const wrap = card.querySelector(`[data-tags="${tagKey}"]`);
      if (wrap) {
        const tmp = document.createElement('span');
        tmp.innerHTML = renderTag(cName, cat, val);
        const tagNode = tmp.firstElementChild;
        bindTagDel(tagNode, cName, cat, val);
        wrap.appendChild(tagNode);
      }
      updatePreview();
    };
    btn.addEventListener('click', addTag);
    input?.addEventListener('keydown', e => { if (e.key === 'Enter') addTag(); });
  });

  // Remove existing tags
  card.querySelectorAll('.cct-tag-del').forEach(btn => {
    bindTagDel(btn.closest('.cct-tag'), btn.dataset.char, btn.dataset.category, btn.dataset.value);
  });

  return card;
}

function bindTagDel(tagEl, charName, category, value) {
  const btn = tagEl?.querySelector('.cct-tag-del');
  if (!btn) return;
  btn.addEventListener('click', e => {
    e.stopPropagation();
    const arr = characters[charName]?.[category];
    if (Array.isArray(arr)) {
      const i = arr.indexOf(value);
      if (i > -1) arr.splice(i, 1);
    }
    tagEl.remove();
    saveCharacters();
    updatePreview();
  });
}

// ── Panel renderer ─────────────────────────────────────────────────────────

function renderPanel() {
  if (!panelEl) return;

  // Reapply theme class (keep id)
  panelEl.className = getThemeClass();

  const cards = panelEl.querySelector('#cct-cards');
  if (!cards) return;
  cards.innerHTML = '';
  Object.entries(characters).forEach(([name, data]) => {
    cards.appendChild(buildCharCard(name, data));
  });
  updatePreview();
}

// ── Panel creation ─────────────────────────────────────────────────────────

function createPanel() {
  panelEl = document.createElement('div');
  panelEl.id = 'cct-panel';
  panelEl.className = getThemeClass();

  // Default position: top-right corner, on top of everything
  panelEl.style.cssText = [
    'position:fixed',
    'top:70px',
    settings.position === 'left' ? 'left:10px' : 'right:10px',
    'width:320px',
    'max-height:calc(100vh - 90px)',
    'overflow-y:auto',
    'overflow-x:hidden',
    'z-index:10000',
    'display:flex',
    'flex-direction:column',
    'gap:10px',
  ].join(';');

  panelEl.innerHTML = `
    <div id="cct-panel-header">
      <span id="cct-panel-title">🃏 Character Cards</span>
      <div class="cct-header-btns">
        <button class="cct-icon-btn" id="cct-btn-add">+ Add</button>
        <button class="cct-icon-btn" id="cct-btn-settings">⚙</button>
      </div>
    </div>

    <div id="cct-add-form">
      <p class="cct-settings-title">Add character</p>
      <div class="cct-form-row">
        <span class="cct-form-label">Name</span>
        <input class="cct-form-input" id="cct-new-char-name" placeholder="Character name">
      </div>
      <div class="cct-form-row">
        <span class="cct-form-label">Height</span>
        <input class="cct-form-input" id="cct-new-height" placeholder="e.g. 165 cm">
      </div>
      <div class="cct-form-row">
        <span class="cct-form-label">Weight</span>
        <input class="cct-form-input" id="cct-new-weight" placeholder="e.g. 55 kg">
      </div>
      <div class="cct-form-actions">
        <button class="cct-btn" id="cct-add-cancel">Cancel</button>
        <button class="cct-btn primary" id="cct-add-confirm">Add</button>
      </div>
    </div>

    <div id="cct-settings-panel">
      <p class="cct-settings-title">Settings</p>

      <div class="cct-settings-row">
        <label>Enabled</label>
        <label class="cct-toggle">
          <input type="checkbox" id="cct-toggle-enabled" ${settings.enabled?'checked':''}>
          <span class="cct-toggle-slider"></span>
        </label>
      </div>
      <div class="cct-settings-row">
        <label>Auto-inject context</label>
        <label class="cct-toggle">
          <input type="checkbox" id="cct-toggle-inject" ${settings.autoInject?'checked':''}>
          <span class="cct-toggle-slider"></span>
        </label>
      </div>
      <div class="cct-settings-row">
        <label>Show context preview</label>
        <label class="cct-toggle">
          <input type="checkbox" id="cct-toggle-preview" ${settings.showPreview?'checked':''}>
          <span class="cct-toggle-slider"></span>
        </label>
      </div>
      <div class="cct-settings-row">
        <label>Theme</label>
        <select id="cct-select-theme">
          <option value="dark"    ${settings.theme==='dark'   ?'selected':''}>Dark</option>
          <option value="fantasy" ${settings.theme==='fantasy'?'selected':''}>Fantasy</option>
          <option value="light"   ${settings.theme==='light'  ?'selected':''}>Light</option>
          <option value="minimal" ${settings.theme==='minimal'?'selected':''}>Minimal</option>
        </select>
      </div>
      <div class="cct-settings-row">
        <label>Panel side</label>
        <select id="cct-select-position">
          <option value="right" ${settings.position==='right'?'selected':''}>Right</option>
          <option value="left"  ${settings.position==='left' ?'selected':''}>Left</option>
        </select>
      </div>
      <div class="cct-settings-row">
        <button class="cct-btn" id="cct-clear-chars" style="width:100%;color:#ef4444">
          🗑 Clear all characters
        </button>
      </div>
    </div>

    <div class="cct-context-preview" id="cct-context-preview"></div>
    <div id="cct-cards"></div>`;

  // ── Attach to ST's movingDivs container (same as other ST panels).
  // Fall back to document.body if movingDivs doesn't exist.
  const host = document.getElementById('movingDivs') || document.body;
  host.appendChild(panelEl);

  // Make header draggable
  makeDraggable(panelEl, panelEl.querySelector('#cct-panel-header'));

  // ── Wire buttons ──────────────────────────────────────────────────────

  const $  = sel => panelEl.querySelector(sel);

  $('#cct-btn-add').addEventListener('click', () => {
    $('#cct-add-form').classList.toggle('cct-visible');
    $('#cct-settings-panel').classList.remove('cct-visible');
  });

  $('#cct-btn-settings').addEventListener('click', () => {
    $('#cct-settings-panel').classList.toggle('cct-visible');
    $('#cct-add-form').classList.remove('cct-visible');
  });

  $('#cct-add-cancel').addEventListener('click', () => {
    $('#cct-add-form').classList.remove('cct-visible');
  });

  $('#cct-add-confirm').addEventListener('click', () => {
    const name   = $('#cct-new-char-name').value.trim();
    if (!name) return;
    const height = $('#cct-new-height').value.trim();
    const weight = $('#cct-new-weight').value.trim();

    if (!characters[name]) {
      characters[name] = { name, stats: { height, weight }, likes: [], hates: [], wearing: [], collapsed: false };
    } else {
      if (height) characters[name].stats.height = height;
      if (weight) characters[name].stats.weight = weight;
    }

    $('#cct-new-char-name').value = '';
    $('#cct-new-height').value    = '';
    $('#cct-new-weight').value    = '';
    $('#cct-add-form').classList.remove('cct-visible');
    saveCharacters();
    renderPanel();
  });

  $('#cct-new-char-name').addEventListener('keydown', e => {
    if (e.key === 'Enter') $('#cct-add-confirm').click();
  });

  $('#cct-toggle-enabled').addEventListener('change', e => {
    settings.enabled = e.target.checked;
    extension_settings[EXT_NAME].enabled = settings.enabled;
    saveSettingsDebounced();
  });

  $('#cct-toggle-inject').addEventListener('change', e => {
    settings.autoInject = e.target.checked;
    extension_settings[EXT_NAME].autoInject = settings.autoInject;
    saveSettingsDebounced();
  });

  $('#cct-toggle-preview').addEventListener('change', e => {
    settings.showPreview = e.target.checked;
    extension_settings[EXT_NAME].showPreview = settings.showPreview;
    updatePreview();
    saveSettingsDebounced();
  });

  $('#cct-select-theme').addEventListener('change', e => {
    settings.theme = e.target.value;
    extension_settings[EXT_NAME].theme = settings.theme;
    panelEl.className = getThemeClass();
    saveSettingsDebounced();
  });

  $('#cct-select-position').addEventListener('change', e => {
    settings.position = e.target.value;
    extension_settings[EXT_NAME].position = settings.position;
    if (settings.position === 'left') {
      panelEl.style.right = 'auto';
      panelEl.style.left  = '10px';
    } else {
      panelEl.style.left  = 'auto';
      panelEl.style.right = '10px';
    }
    saveSettingsDebounced();
  });

  $('#cct-clear-chars').addEventListener('click', () => {
    if (!confirm('Clear all character cards for this chat?')) return;
    characters = {};
    saveCharacters();
    renderPanel();
  });
}

// ── Entry point ────────────────────────────────────────────────────────────

jQuery(async () => {
  // Merge saved settings
  extension_settings[EXT_NAME] = extension_settings[EXT_NAME] || {};
  Object.assign(settings, DEFAULT_SETTINGS, extension_settings[EXT_NAME]);

  createPanel();
  loadCharacters();
  renderPanel();
  updatePreview();

  // GENERATE_BEFORE_ANY_ACTION fires before every generation attempt
  eventSource.on(event_types.GENERATE_BEFORE_ANY_ACTION, onBeforeGeneration);

  // Reload cards when the active chat changes
  eventSource.on(event_types.CHAT_CHANGED, () => {
    loadCharacters();
    renderPanel();
    updatePreview();
  });

  log('Loaded ✓');
});
