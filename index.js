/**
 * Character Card Tracker – index.js
 * A SillyTavern extension for group chats that lets you manually track
 * per-character stats, likes/hates, and outfit, then injects a clean
 * context block before each of that character's messages so the model
 * always knows their current state.
 *
 * Install: paste the repo URL in Extensions → Install Extension.
 */

import {
  saveSettingsDebounced,
  eventSource,
  event_types,
  getContext,
} from '../../../../script.js';

import { extension_settings, getExtensionPromptByName, saveMetadataDebounced } from '../../../extensions.js';

// ── Constants ──────────────────────────────────────────────────────────────

const EXT_NAME = 'char-card-tracker';
const INJECT_KEY = 'cct_char_context';
const DEFAULT_SETTINGS = {
  enabled: true,
  theme: 'dark',
  position: 'right',
  autoInject: true,
  showPreview: false,
};

// ── State ──────────────────────────────────────────────────────────────────

/**
 * characters: { [charName]: CharData }
 * CharData = {
 *   name: string,
 *   stats: { height: string, weight: string, [custom]: string },
 *   likes: string[],
 *   hates: string[],
 *   wearing: string[],
 *   collapsed: bool,
 * }
 */
let characters = {};
let settings = { ...DEFAULT_SETTINGS };

// ── Helpers ────────────────────────────────────────────────────────────────

function log(...args) { console.log(`[${EXT_NAME}]`, ...args); }

function getSettings() {
  extension_settings[EXT_NAME] = extension_settings[EXT_NAME] || { ...DEFAULT_SETTINGS };
  return extension_settings[EXT_NAME];
}

/**
 * Persist character data in chat metadata so it survives page reloads.
 */
function saveCharacters() {
  const ctx = getContext();
  if (!ctx || !ctx.chatMetadata) return;
  ctx.chatMetadata[EXT_NAME + '_chars'] = JSON.stringify(characters);
  saveMetadataDebounced();
}

function loadCharacters() {
  const ctx = getContext();
  if (!ctx || !ctx.chatMetadata) return;
  const raw = ctx.chatMetadata[EXT_NAME + '_chars'];
  if (raw) {
    try { characters = JSON.parse(raw); } catch(e) { characters = {}; }
  } else {
    characters = {};
  }
}

/**
 * Build the context string that will be prepended to the model's
 * system prompt when a character speaks.
 */
function buildContextBlock(charName) {
  const c = characters[charName];
  if (!c) return '';

  const stats = c.stats || {};
  const lines = [
    `[Character status for ${charName}]`,
    `Height: ${stats.height || 'unknown'} | Weight: ${stats.weight || 'unknown'}`,
  ];

  // Extra stats
  Object.entries(stats).forEach(([k, v]) => {
    if (k !== 'height' && k !== 'weight' && v) {
      lines.push(`${capitalize(k)}: ${v}`);
    }
  });

  if (c.likes && c.likes.length) {
    lines.push(`Currently likes: ${c.likes.join(', ')}`);
  }
  if (c.hates && c.hates.length) {
    lines.push(`Currently dislikes: ${c.hates.join(', ')}`);
  }
  if (c.wearing && c.wearing.length) {
    lines.push(`Currently wearing: ${c.wearing.join(', ')}`);
  }

  lines.push(`[End of ${charName}'s status]`);
  return lines.join('\n');
}

function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

/**
 * Inject context for ALL characters into the prompt before generation.
 * We use SillyTavern's extension_prompt mechanism.
 */
function buildFullInjection() {
  if (!settings.enabled || !settings.autoInject) return '';
  const blocks = Object.keys(characters).map(name => buildContextBlock(name)).filter(Boolean);
  if (!blocks.length) return '';
  return '\n\n' + blocks.join('\n\n') + '\n';
}

// ── SillyTavern Hook ────────────────────────────────────────────────────────

/**
 * Called before each AI generation. Rebuilds the injected context.
 */
function onGenerationBeforeAny() {
  if (!settings.enabled || !settings.autoInject) return;

  const ctx = getContext();
  if (!ctx) return;

  // SillyTavern extension_prompt API (same slot used by many extensions)
  const injection = buildFullInjection();
  // setExtensionPrompt(key, value, position, depth)
  // position 1 = after system prompt, depth 0 = top of context
  ctx.setExtensionPrompt?.(INJECT_KEY, injection, 1, 0);
}

// ── UI Rendering ────────────────────────────────────────────────────────────

let panelEl = null;

function getThemeClass() { return 'cct-theme-' + settings.theme; }

function renderPanel() {
  if (!panelEl) return;

  // Apply theme + position
  panelEl.className = getThemeClass();
  if (settings.position === 'left') panelEl.classList.add('cct-left');

  // Re-render all cards
  const cardsContainer = panelEl.querySelector('#cct-cards');
  if (!cardsContainer) return;
  cardsContainer.innerHTML = '';

  Object.entries(characters).forEach(([name, data]) => {
    cardsContainer.appendChild(buildCharCard(name, data));
  });

  updatePreview();
}

function buildCharCard(name, data) {
  const card = document.createElement('div');
  card.className = 'cct-card';
  card.dataset.charName = name;

  // Try to find the character's avatar from ST context
  const ctx = getContext();
  let avatarSrc = '';
  if (ctx && ctx.characters) {
    const found = ctx.characters.find(c => c.name === name);
    if (found && found.avatar) {
      avatarSrc = `/characters/${found.avatar}`;
    }
  }

  const avatarHTML = avatarSrc
    ? `<img class="cct-char-avatar" src="${avatarSrc}" alt="${name}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
    : '';
  const placeholderStyle = avatarSrc ? 'style="display:none"' : '';

  const stats = data.stats || {};
  const likes = data.likes || [];
  const hates = data.hates || [];
  const wearing = data.wearing || [];
  const collapsed = data.collapsed || false;

  card.innerHTML = `
    <div class="cct-card-header" data-toggle="${name}">
      ${avatarHTML}
      <div class="cct-avatar-placeholder" ${placeholderStyle}>${name.charAt(0).toUpperCase()}</div>
      <div class="cct-char-name-area">
        <p class="cct-char-name">${name}</p>
        <p class="cct-char-subtitle">${stats.height || '?'} · ${stats.weight || '?'}</p>
      </div>
      <button class="cct-delete-char" data-char="${name}" title="Remove character">✕</button>
      <button class="cct-collapse-btn" data-collapse="${name}">${collapsed ? '▶' : '▼'}</button>
    </div>

    <div class="cct-card-body ${collapsed ? 'cct-collapsed' : ''}" data-body="${name}">

      <!-- Stats -->
      <div>
        <p class="cct-section-label">📊 Stats</p>
        <div class="cct-stats-grid" data-stats-grid="${name}">
          ${renderStatItem(name, 'height', stats.height)}
          ${renderStatItem(name, 'weight', stats.weight)}
          ${Object.entries(stats)
            .filter(([k]) => k !== 'height' && k !== 'weight')
            .map(([k, v]) => renderStatItem(name, k, v))
            .join('')}
        </div>
        <div style="display:flex;gap:5px;margin-top:6px">
          <input class="cct-tag-input cct-stat-key" placeholder="Stat name" data-for="${name}" style="flex:1">
          <button class="cct-tag-add-btn cct-add-stat" data-for="${name}">+ Stat</button>
        </div>
      </div>

      <!-- Likes -->
      <div class="cct-tags-section">
        <p class="cct-section-label">💚 Likes</p>
        <div class="cct-tags-wrap" data-tags="${name}-likes">
          ${likes.map(l => renderTag(name, 'likes', l)).join('')}
        </div>
        <div class="cct-tag-add-row">
          <input class="cct-tag-input" placeholder="Add something they like…" data-for="${name}-likes">
          <button class="cct-tag-add-btn" data-add-tag="${name}-likes">+</button>
        </div>
      </div>

      <!-- Hates -->
      <div class="cct-tags-section">
        <p class="cct-section-label">❤️ Hates</p>
        <div class="cct-tags-wrap" data-tags="${name}-hates">
          ${hates.map(h => renderTag(name, 'hates', h)).join('')}
        </div>
        <div class="cct-tag-add-row">
          <input class="cct-tag-input" placeholder="Add something they hate…" data-for="${name}-hates">
          <button class="cct-tag-add-btn" data-add-tag="${name}-hates">+</button>
        </div>
      </div>

      <!-- Wearing -->
      <div class="cct-tags-section">
        <p class="cct-section-label">👗 Currently wearing</p>
        <div class="cct-tags-wrap" data-tags="${name}-wearing">
          ${wearing.map(w => renderTag(name, 'wearing', w)).join('')}
        </div>
        <div class="cct-tag-add-row">
          <input class="cct-tag-input" placeholder="Add clothing item…" data-for="${name}-wearing">
          <button class="cct-tag-add-btn" data-add-tag="${name}-wearing">+</button>
        </div>
      </div>

      <p class="cct-inject-info">ℹ️ Status is injected into AI context automatically</p>
    </div>
  `;

  // ── Event delegation on this card ─────────────────────────────────────

  // Toggle collapse
  card.querySelector('.cct-card-header').addEventListener('click', e => {
    if (e.target.closest('.cct-delete-char') || e.target.closest('.cct-collapse-btn')) return;
    toggleCollapse(name);
  });
  card.querySelector('.cct-collapse-btn').addEventListener('click', () => toggleCollapse(name));

  // Delete character
  card.querySelector('.cct-delete-char').addEventListener('click', () => {
    if (confirm(`Remove ${name} from the tracker?`)) {
      delete characters[name];
      saveCharacters();
      renderPanel();
    }
  });

  // Editable stats (contenteditable)
  card.querySelectorAll('.cct-stat-value').forEach(el => {
    el.addEventListener('dblclick', () => {
      el.contentEditable = 'true';
      el.focus();
    });
    el.addEventListener('blur', () => {
      el.contentEditable = 'false';
      const key = el.dataset.statKey;
      const char = el.dataset.char;
      if (char && key) {
        characters[char].stats = characters[char].stats || {};
        characters[char].stats[key] = el.textContent.trim();
        updateSubtitle(card, char);
        saveCharacters();
        updatePreview();
      }
    });
    el.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); el.blur(); }
    });
  });

  // Add stat
  card.querySelector('.cct-add-stat').addEventListener('click', () => {
    const keyInput = card.querySelector(`.cct-stat-key[data-for="${name}"]`);
    const key = keyInput.value.trim().toLowerCase().replace(/\s+/g, '_');
    if (!key) return;
    characters[name].stats = characters[name].stats || {};
    if (!characters[name].stats[key]) {
      characters[name].stats[key] = '';
    }
    keyInput.value = '';
    saveCharacters();
    renderPanel();
  });

  // Add tag buttons
  card.querySelectorAll('[data-add-tag]').forEach(btn => {
    const key = btn.dataset.addTag; // e.g. "Elara-likes"
    const input = card.querySelector(`[data-for="${key}"]`);
    btn.addEventListener('click', () => {
      const val = input.value.trim();
      if (!val) return;
      const [charName, category] = splitTagKey(key);
      characters[charName][category] = characters[charName][category] || [];
      if (!characters[charName][category].includes(val)) {
        characters[charName][category].push(val);
      }
      input.value = '';
      saveCharacters();

      // Append tag without full re-render
      const wrap = card.querySelector(`[data-tags="${key}"]`);
      const tagEl = document.createElement('span');
      tagEl.innerHTML = renderTag(charName, category, val);
      const tagNode = tagEl.firstElementChild;
      bindTagDelete(tagNode, charName, category, val);
      wrap.appendChild(tagNode);
      updatePreview();
    });

    input.addEventListener('keydown', e => { if (e.key === 'Enter') btn.click(); });
  });

  // Delete tags (delegated)
  card.querySelectorAll('.cct-tag-del').forEach(btn => {
    const { char, category, value } = btn.dataset;
    bindTagDelete(btn.parentElement, char, category, value);
  });

  return card;
}

function splitTagKey(key) {
  // key = "CharName-likes" / "CharName-hates" / "CharName-wearing"
  const idx = key.lastIndexOf('-');
  return [key.slice(0, idx), key.slice(idx + 1)];
}

function renderStatItem(charName, key, value) {
  return `
    <div class="cct-stat-item">
      <p class="cct-stat-label">${capitalize(key.replace(/_/g, ' '))}</p>
      <div class="cct-stat-value" contenteditable="false"
           data-char="${charName}" data-stat-key="${key}"
           title="Double-click to edit">${value || ''}</div>
    </div>`;
}

function renderTag(charName, category, value) {
  const cls = category === 'likes' ? 'like' : category === 'hates' ? 'hate' : 'wear';
  return `<span class="cct-tag ${cls}">
    ${escapeHtml(value)}
    <button class="cct-tag-del" data-char="${charName}" data-category="${category}" data-value="${escapeHtml(value)}" title="Remove">×</button>
  </span>`;
}

function bindTagDelete(tagEl, charName, category, value) {
  const btn = tagEl.querySelector?.('.cct-tag-del') || tagEl;
  btn.addEventListener('click', e => {
    e.stopPropagation();
    const arr = characters[charName]?.[category];
    if (arr) {
      const i = arr.indexOf(value);
      if (i > -1) arr.splice(i, 1);
    }
    tagEl.remove();
    saveCharacters();
    updatePreview();
  });
}

function toggleCollapse(name) {
  characters[name].collapsed = !characters[name].collapsed;
  // No full re-render – just toggle classes
  const card = panelEl.querySelector(`[data-char-name="${name}"]`);
  if (!card) return;
  const body = card.querySelector(`[data-body="${name}"]`);
  const btn = card.querySelector(`[data-collapse="${name}"]`);
  body.classList.toggle('cct-collapsed', characters[name].collapsed);
  btn.textContent = characters[name].collapsed ? '▶' : '▼';
  saveCharacters();
}

function updateSubtitle(card, charName) {
  const sub = card.querySelector('.cct-char-subtitle');
  if (!sub) return;
  const s = characters[charName].stats || {};
  sub.textContent = `${s.height || '?'} · ${s.weight || '?'}`;
}

function updatePreview() {
  if (!panelEl) return;
  const prev = panelEl.querySelector('#cct-context-preview');
  if (!prev) return;
  prev.textContent = buildFullInjection().trim();
  if (settings.showPreview) prev.classList.add('cct-visible');
  else prev.classList.remove('cct-visible');
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Panel Bootstrap ─────────────────────────────────────────────────────────

function createPanel() {
  panelEl = document.createElement('div');
  panelEl.id = 'cct-panel';
  panelEl.classList.add(getThemeClass());
  if (settings.position === 'left') panelEl.classList.add('cct-left');

  panelEl.innerHTML = `
    <!-- Panel Header -->
    <div id="cct-panel-header">
      <span id="cct-panel-title">🃏 Character Cards</span>
      <div class="cct-header-btns">
        <button class="cct-icon-btn" id="cct-btn-add" title="Add character">+ Add</button>
        <button class="cct-icon-btn" id="cct-btn-settings" title="Settings">⚙</button>
      </div>
    </div>

    <!-- Add Character Form -->
    <div id="cct-add-form">
      <p class="cct-settings-title">Add / load character</p>
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
        <button class="cct-btn primary" id="cct-add-confirm">Add Character</button>
      </div>
    </div>

    <!-- Settings Panel -->
    <div id="cct-settings-panel">
      <p class="cct-settings-title">Settings</p>

      <div class="cct-settings-row">
        <label>Enabled</label>
        <label class="cct-toggle">
          <input type="checkbox" id="cct-toggle-enabled" ${settings.enabled ? 'checked' : ''}>
          <span class="cct-toggle-slider"></span>
        </label>
      </div>

      <div class="cct-settings-row">
        <label>Auto-inject context</label>
        <label class="cct-toggle">
          <input type="checkbox" id="cct-toggle-inject" ${settings.autoInject ? 'checked' : ''}>
          <span class="cct-toggle-slider"></span>
        </label>
      </div>

      <div class="cct-settings-row">
        <label>Show context preview</label>
        <label class="cct-toggle">
          <input type="checkbox" id="cct-toggle-preview" ${settings.showPreview ? 'checked' : ''}>
          <span class="cct-toggle-slider"></span>
        </label>
      </div>

      <div class="cct-settings-row">
        <label>Theme</label>
        <select id="cct-select-theme">
          <option value="dark" ${settings.theme==='dark'?'selected':''}>Dark</option>
          <option value="fantasy" ${settings.theme==='fantasy'?'selected':''}>Fantasy</option>
          <option value="light" ${settings.theme==='light'?'selected':''}>Light</option>
          <option value="minimal" ${settings.theme==='minimal'?'selected':''}>Minimal</option>
        </select>
      </div>

      <div class="cct-settings-row">
        <label>Panel side</label>
        <select id="cct-select-position">
          <option value="right" ${settings.position==='right'?'selected':''}>Right</option>
          <option value="left" ${settings.position==='left'?'selected':''}>Left</option>
        </select>
      </div>

      <div class="cct-settings-row">
        <button class="cct-btn" id="cct-clear-chars" style="width:100%;color:#ef4444">
          🗑 Clear all characters
        </button>
      </div>
    </div>

    <!-- Context preview -->
    <div class="cct-context-preview ${settings.showPreview ? 'cct-visible' : ''}" id="cct-context-preview"></div>

    <!-- Character cards -->
    <div id="cct-cards"></div>
  `;

  document.body.appendChild(panelEl);

  // ── Button wiring ──────────────────────────────────────────────────────

  // Add form toggle
  panelEl.querySelector('#cct-btn-add').addEventListener('click', () => {
    panelEl.querySelector('#cct-add-form').classList.toggle('cct-visible');
    panelEl.querySelector('#cct-settings-panel').classList.remove('cct-visible');
  });

  // Settings toggle
  panelEl.querySelector('#cct-btn-settings').addEventListener('click', () => {
    panelEl.querySelector('#cct-settings-panel').classList.toggle('cct-visible');
    panelEl.querySelector('#cct-add-form').classList.remove('cct-visible');
  });

  // Cancel add
  panelEl.querySelector('#cct-add-cancel').addEventListener('click', () => {
    panelEl.querySelector('#cct-add-form').classList.remove('cct-visible');
  });

  // Confirm add
  panelEl.querySelector('#cct-add-confirm').addEventListener('click', () => {
    const name = panelEl.querySelector('#cct-new-char-name').value.trim();
    if (!name) return;
    const height = panelEl.querySelector('#cct-new-height').value.trim();
    const weight = panelEl.querySelector('#cct-new-weight').value.trim();

    if (!characters[name]) {
      characters[name] = {
        name,
        stats: { height, weight },
        likes: [],
        hates: [],
        wearing: [],
        collapsed: false,
      };
    } else {
      // Merge – update stats only if filled
      characters[name].stats.height = height || characters[name].stats.height;
      characters[name].stats.weight = weight || characters[name].stats.weight;
    }

    panelEl.querySelector('#cct-new-char-name').value = '';
    panelEl.querySelector('#cct-new-height').value = '';
    panelEl.querySelector('#cct-new-weight').value = '';
    panelEl.querySelector('#cct-add-form').classList.remove('cct-visible');

    saveCharacters();
    renderPanel();
  });

  // Enter key in name field
  panelEl.querySelector('#cct-new-char-name').addEventListener('keydown', e => {
    if (e.key === 'Enter') panelEl.querySelector('#cct-add-confirm').click();
  });

  // Settings controls
  panelEl.querySelector('#cct-toggle-enabled').addEventListener('change', e => {
    settings.enabled = e.target.checked;
    saveSettingsDebounced();
  });

  panelEl.querySelector('#cct-toggle-inject').addEventListener('change', e => {
    settings.autoInject = e.target.checked;
    saveSettingsDebounced();
  });

  panelEl.querySelector('#cct-toggle-preview').addEventListener('change', e => {
    settings.showPreview = e.target.checked;
    updatePreview();
    saveSettingsDebounced();
  });

  panelEl.querySelector('#cct-select-theme').addEventListener('change', e => {
    settings.theme = e.target.value;
    panelEl.className = getThemeClass();
    if (settings.position === 'left') panelEl.classList.add('cct-left');
    saveSettingsDebounced();
  });

  panelEl.querySelector('#cct-select-position').addEventListener('change', e => {
    settings.position = e.target.value;
    panelEl.classList.toggle('cct-left', settings.position === 'left');
    saveSettingsDebounced();
  });

  panelEl.querySelector('#cct-clear-chars').addEventListener('click', () => {
    if (confirm('Clear all character cards for this chat?')) {
      characters = {};
      saveCharacters();
      renderPanel();
    }
  });
}

// ── SillyTavern Extension Entry Point ──────────────────────────────────────

jQuery(async () => {
  // Load saved extension settings
  extension_settings[EXT_NAME] = extension_settings[EXT_NAME] || {};
  Object.assign(settings, DEFAULT_SETTINGS, extension_settings[EXT_NAME]);

  // Create the sidebar panel
  createPanel();
  renderPanel();

  // Load characters from current chat metadata
  loadCharacters();
  renderPanel();
  updatePreview();

  // Hook into generation to inject context
  eventSource.on(event_types.GENERATE_BEFORE_COMBINE_PROMPTS, onGenerationBeforeAny);

  // Reload characters when a chat is switched or loaded
  eventSource.on(event_types.CHAT_CHANGED, () => {
    loadCharacters();
    renderPanel();
    updatePreview();
  });

  // Also reload after a message is received (metadata may have updated)
  eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, () => {
    // Persist any in-flight changes
    saveCharacters();
  });

  log('Loaded ✓');
});
