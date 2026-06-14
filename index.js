/**
 * Character Card Tracker – index.js  v1.2.0
 *
 * Uses SillyTavern's globally-exposed API only (no ES import statements).
 * ST extensions must access the API via window.SillyTavern.getContext()
 * and the globally registered event system / extension_settings.
 */

(function () {
  'use strict';

  // ── Wait for ST to be ready ──────────────────────────────────────────────
  // ST extensions run before the app is fully initialised; we defer with a
  // short poll until the key globals exist.

  function waitForST(cb) {
    if (window.SillyTavern?.getContext) { cb(); return; }
    const id = setInterval(() => {
      if (window.SillyTavern?.getContext) { clearInterval(id); cb(); }
    }, 250);
  }

  // ── Constants ────────────────────────────────────────────────────────────

  const EXT_NAME   = 'char-card-tracker';
  const INJECT_KEY = 'cct_char_context';
  const INJECT_POS = 1; // after system prompt

  const DEFAULT_SETTINGS = {
    enabled:     true,
    theme:       'dark',
    position:    'right',
    autoInject:  true,
    showPreview: false,
  };

  // ── Runtime state ────────────────────────────────────────────────────────

  let characters = {};
  let settings   = { ...DEFAULT_SETTINGS };
  let panelEl    = null;

  // ── ST API accessors ─────────────────────────────────────────────────────
  // We pull these lazily so we never cache stale references.

  function getSTContext()    { return window.SillyTavern?.getContext?.(); }
  function getExtSettings()  { return getSTContext()?.extensionSettings; }
  function getEventSource()  { return getSTContext()?.eventSource; }
  function getEventTypes()   { return getSTContext()?.eventTypes; }

  // ── Settings persistence ─────────────────────────────────────────────────

  function loadSettings() {
    const ext = getExtSettings();
    if (!ext) return;
    ext[EXT_NAME] = ext[EXT_NAME] || {};
    Object.assign(settings, DEFAULT_SETTINGS, ext[EXT_NAME]);
  }

  function saveSettings() {
    const ext = getExtSettings();
    if (!ext) return;
    ext[EXT_NAME] = { ...settings };
    // ST exposes saveSettingsDebounced on the context
    getSTContext()?.saveSettingsDebounced?.();
  }

  // ── Character data persistence (chat metadata) ───────────────────────────

  function saveCharacters() {
    const ctx = getSTContext();
    if (!ctx?.chatMetadata) return;
    ctx.chatMetadata[EXT_NAME + '_chars'] = JSON.stringify(characters);
    ctx.saveMetadataDebounced?.();
  }

  function loadCharacters() {
    const ctx = getSTContext();
    if (!ctx?.chatMetadata) { characters = {}; return; }
    const raw = ctx.chatMetadata[EXT_NAME + '_chars'];
    try { characters = raw ? JSON.parse(raw) : {}; }
    catch { characters = {}; }
  }

  // ── Context injection ────────────────────────────────────────────────────

  function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

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
        lines.push(`${capitalize(k.replace(/_/g, ' '))}: ${v}`);
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
    const ctx = getSTContext();
    if (!ctx) return;
    // setExtensionPrompt(key, value, position, depth)
    ctx.setExtensionPrompt?.(INJECT_KEY, buildFullInjection(), INJECT_POS, 0);
  }

  // ── Drag-to-move ─────────────────────────────────────────────────────────

  function makeDraggable(el, handle) {
    let ox = 0, oy = 0, sx = 0, sy = 0;
    handle.style.cursor = 'grab';
    handle.addEventListener('mousedown', e => {
      if (e.target.closest('button, input, select')) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      ox = r.left; oy = r.top; sx = e.clientX; sy = e.clientY;
      el.style.right = 'auto'; el.style.bottom = 'auto';
      el.style.left  = ox + 'px'; el.style.top = oy + 'px';
      handle.style.cursor = 'grabbing';
      const onMove = ev => {
        el.style.left = (ox + ev.clientX - sx) + 'px';
        el.style.top  = (oy + ev.clientY - sy) + 'px';
      };
      const onUp = () => {
        handle.style.cursor = 'grab';
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  // ── HTML helpers ──────────────────────────────────────────────────────────

  function esc(str) {
    return String(str)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function themeClass() { return 'cct-theme-' + (settings.theme || 'dark'); }

  function renderStatItem(charName, key, value) {
    return `<div class="cct-stat-item">
      <p class="cct-stat-label">${esc(capitalize(key.replace(/_/g,' ')))}</p>
      <div class="cct-stat-value" contenteditable="false"
           data-char="${esc(charName)}" data-stat-key="${esc(key)}"
           title="Double-click to edit">${esc(value || '')}</div>
    </div>`;
  }

  function renderTag(charName, category, value) {
    const cls = category === 'likes' ? 'like' : category === 'hates' ? 'hate' : 'wear';
    return `<span class="cct-tag ${cls}">
      ${esc(value)}
      <button class="cct-tag-del"
        data-char="${esc(charName)}" data-category="${category}" data-value="${esc(value)}"
        title="Remove">×</button>
    </span>`;
  }

  function splitTagKey(key) {
    const i = key.lastIndexOf('-');
    return [key.slice(0, i), key.slice(i + 1)];
  }

  // ── Preview ───────────────────────────────────────────────────────────────

  function updatePreview() {
    if (!panelEl) return;
    const el = panelEl.querySelector('#cct-context-preview');
    if (!el) return;
    el.textContent = buildFullInjection().trim();
    el.classList.toggle('cct-visible', !!settings.showPreview);
  }

  // ── Card subtitle ─────────────────────────────────────────────────────────

  function updateSubtitle(card, name) {
    const el = card.querySelector('.cct-char-subtitle');
    if (el) {
      const s = characters[name]?.stats || {};
      el.textContent = `${s.height || '?'} · ${s.weight || '?'}`;
    }
  }

  // ── Collapse toggle ───────────────────────────────────────────────────────

  function toggleCollapse(name) {
    if (!characters[name]) return;
    characters[name].collapsed = !characters[name].collapsed;
    const card = panelEl?.querySelector(`[data-char-name="${name}"]`);
    if (!card) return;
    card.querySelector(`[data-body="${name}"]`)
        ?.classList.toggle('cct-collapsed', !!characters[name].collapsed);
    const btn = card.querySelector(`[data-collapse="${name}"]`);
    if (btn) btn.textContent = characters[name].collapsed ? '▶' : '▼';
    saveCharacters();
  }

  // ── Tag delete binding ────────────────────────────────────────────────────

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

  // ── Build one character card ───────────────────────────────────────────────

  function buildCharCard(name, data) {
    const card = document.createElement('div');
    card.className  = 'cct-card';
    card.dataset.charName = name;

    const ctx = getSTContext();
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
      ? `<img class="cct-char-avatar" src="${esc(avatarSrc)}" alt="${esc(name)}"
             onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
      : '';
    const phStyle = avatarSrc ? 'style="display:none"' : '';

    card.innerHTML = `
      <div class="cct-card-header">
        ${avatarHTML}
        <div class="cct-avatar-placeholder" ${phStyle}>${esc(name.charAt(0).toUpperCase())}</div>
        <div class="cct-char-name-area">
          <p class="cct-char-name">${esc(name)}</p>
          <p class="cct-char-subtitle">${esc(stats.height||'?')} · ${esc(stats.weight||'?')}</p>
        </div>
        <button class="cct-delete-char" title="Remove character">✕</button>
        <button class="cct-collapse-btn" data-collapse="${esc(name)}">${collapsed?'▶':'▼'}</button>
      </div>

      <div class="cct-card-body${collapsed?' cct-collapsed':''}" data-body="${esc(name)}">
        <div>
          <p class="cct-section-label">📊 Stats</p>
          <div class="cct-stats-grid">
            ${renderStatItem(name,'height',stats.height)}
            ${renderStatItem(name,'weight',stats.weight)}
            ${Object.entries(stats)
                .filter(([k])=>k!=='height'&&k!=='weight')
                .map(([k,v])=>renderStatItem(name,k,v)).join('')}
          </div>
          <div style="display:flex;gap:5px;margin-top:6px">
            <input class="cct-tag-input cct-stat-key" placeholder="New stat name" style="flex:1">
            <button class="cct-tag-add-btn cct-add-stat">+ Stat</button>
          </div>
        </div>

        <div class="cct-tags-section">
          <p class="cct-section-label">💚 Likes</p>
          <div class="cct-tags-wrap" data-tags="${esc(name)}-likes">
            ${likes.map(l=>renderTag(name,'likes',l)).join('')}
          </div>
          <div class="cct-tag-add-row">
            <input class="cct-tag-input cct-tag-new" placeholder="Add something they like…">
            <button class="cct-tag-add-btn cct-add-tag" data-cat="likes">+</button>
          </div>
        </div>

        <div class="cct-tags-section">
          <p class="cct-section-label">🔴 Hates</p>
          <div class="cct-tags-wrap" data-tags="${esc(name)}-hates">
            ${hates.map(h=>renderTag(name,'hates',h)).join('')}
          </div>
          <div class="cct-tag-add-row">
            <input class="cct-tag-input cct-tag-new" placeholder="Add something they hate…">
            <button class="cct-tag-add-btn cct-add-tag" data-cat="hates">+</button>
          </div>
        </div>

        <div class="cct-tags-section">
          <p class="cct-section-label">👗 Wearing</p>
          <div class="cct-tags-wrap" data-tags="${esc(name)}-wearing">
            ${wearing.map(w=>renderTag(name,'wearing',w)).join('')}
          </div>
          <div class="cct-tag-add-row">
            <input class="cct-tag-input cct-tag-new" placeholder="Add clothing item…">
            <button class="cct-tag-add-btn cct-add-tag" data-cat="wearing">+</button>
          </div>
        </div>

        <p class="cct-inject-info">ℹ️ Status injected into AI context automatically</p>
      </div>`;

    // Header → collapse
    card.querySelector('.cct-card-header').addEventListener('click', e => {
      if (e.target.closest('button')) return;
      toggleCollapse(name);
    });
    card.querySelector('[data-collapse]').addEventListener('click', () => toggleCollapse(name));

    // Delete character
    card.querySelector('.cct-delete-char').addEventListener('click', () => {
      if (!confirm(`Remove ${name} from the tracker?`)) return;
      delete characters[name];
      saveCharacters();
      renderPanel();
    });

    // Inline stat editing (double-click)
    card.querySelectorAll('.cct-stat-value').forEach(el => {
      el.addEventListener('dblclick', () => {
        el.contentEditable = 'true';
        el.focus();
        const range = document.createRange();
        range.selectNodeContents(el); range.collapse(false);
        const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
      });
      el.addEventListener('blur', () => {
        el.contentEditable = 'false';
        const k = el.dataset.statKey;
        if (k && characters[name]) {
          characters[name].stats = characters[name].stats || {};
          characters[name].stats[k] = el.textContent.trim();
          updateSubtitle(card, name);
          saveCharacters(); updatePreview();
        }
      });
      el.addEventListener('keydown', e => { if (e.key==='Enter'){e.preventDefault();el.blur();} });
    });

    // Add custom stat
    card.querySelector('.cct-add-stat').addEventListener('click', () => {
      const inp = card.querySelector('.cct-stat-key');
      const key = inp.value.trim().toLowerCase().replace(/\s+/g,'_');
      if (!key) return;
      characters[name].stats = characters[name].stats || {};
      if (!(key in characters[name].stats)) characters[name].stats[key] = '';
      inp.value = '';
      saveCharacters(); renderPanel();
    });

    // Add tag per section
    card.querySelectorAll('.cct-tags-section').forEach(section => {
      const cat    = section.querySelector('.cct-add-tag')?.dataset.cat;
      const addBtn = section.querySelector('.cct-add-tag');
      const inp    = section.querySelector('.cct-tag-new');
      if (!cat || !addBtn || !inp) return;

      const addTag = () => {
        const val = inp.value.trim();
        if (!val) return;
        characters[name][cat] = characters[name][cat] || [];
        if (!characters[name][cat].includes(val)) characters[name][cat].push(val);
        inp.value = '';
        saveCharacters();
        // Append without full re-render
        const wrap = card.querySelector(`[data-tags="${name}-${cat}"]`);
        if (wrap) {
          const tmp = document.createElement('div');
          tmp.innerHTML = renderTag(name, cat, val);
          const tagNode = tmp.firstElementChild;
          bindTagDel(tagNode, name, cat, val);
          wrap.appendChild(tagNode);
        }
        updatePreview();
      };
      addBtn.addEventListener('click', addTag);
      inp.addEventListener('keydown', e => { if (e.key==='Enter') addTag(); });
    });

    // Bind delete on pre-rendered tags
    card.querySelectorAll('.cct-tag').forEach(tagEl => {
      const btn = tagEl.querySelector('.cct-tag-del');
      if (btn) bindTagDel(tagEl, btn.dataset.char, btn.dataset.category, btn.dataset.value);
    });

    return card;
  }

  // ── Panel renderer ────────────────────────────────────────────────────────

  function renderPanel() {
    if (!panelEl) return;
    panelEl.className = themeClass();
    const cards = panelEl.querySelector('#cct-cards');
    if (!cards) return;
    cards.innerHTML = '';
    Object.entries(characters).forEach(([name, data]) => {
      cards.appendChild(buildCharCard(name, data));
    });
    updatePreview();
  }

  // ── Panel creation ────────────────────────────────────────────────────────

  function createPanel() {
    // Remove any leftover panel from a previous load
    document.getElementById('cct-panel')?.remove();

    panelEl = document.createElement('div');
    panelEl.id = 'cct-panel';
    panelEl.className = themeClass();

    // Inline styles so ST's own stylesheets can't override them
    const side = settings.position === 'left' ? 'left:10px;right:auto' : 'right:10px;left:auto';
    panelEl.style.cssText = `position:fixed;top:70px;${side};width:320px;` +
      `max-height:calc(100vh - 90px);overflow-y:auto;overflow-x:hidden;` +
      `z-index:10000;display:flex;flex-direction:column;gap:10px;`;

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

    // Attach to body — safest cross-version anchor
    document.body.appendChild(panelEl);
    makeDraggable(panelEl, panelEl.querySelector('#cct-panel-header'));

    // ── Wire controls ──────────────────────────────────────────────────────
    const $ = id => panelEl.querySelector('#' + id);

    $('cct-btn-add').addEventListener('click', () => {
      $('cct-add-form').classList.toggle('cct-visible');
      $('cct-settings-panel').classList.remove('cct-visible');
    });
    $('cct-btn-settings').addEventListener('click', () => {
      $('cct-settings-panel').classList.toggle('cct-visible');
      $('cct-add-form').classList.remove('cct-visible');
    });
    $('cct-add-cancel').addEventListener('click', () => {
      $('cct-add-form').classList.remove('cct-visible');
    });
    $('cct-add-confirm').addEventListener('click', () => {
      const name   = $('cct-new-char-name').value.trim();
      if (!name) return;
      const height = $('cct-new-height').value.trim();
      const weight = $('cct-new-weight').value.trim();
      if (!characters[name]) {
        characters[name] = { name, stats:{height,weight}, likes:[], hates:[], wearing:[], collapsed:false };
      } else {
        if (height) characters[name].stats.height = height;
        if (weight) characters[name].stats.weight = weight;
      }
      $('cct-new-char-name').value = '';
      $('cct-new-height').value    = '';
      $('cct-new-weight').value    = '';
      $('cct-add-form').classList.remove('cct-visible');
      saveCharacters(); renderPanel();
    });
    $('cct-new-char-name').addEventListener('keydown', e => {
      if (e.key === 'Enter') $('cct-add-confirm').click();
    });

    $('cct-toggle-enabled').addEventListener('change', e => {
      settings.enabled = e.target.checked; saveSettings();
    });
    $('cct-toggle-inject').addEventListener('change', e => {
      settings.autoInject = e.target.checked; saveSettings();
    });
    $('cct-toggle-preview').addEventListener('change', e => {
      settings.showPreview = e.target.checked; updatePreview(); saveSettings();
    });
    $('cct-select-theme').addEventListener('change', e => {
      settings.theme = e.target.value;
      panelEl.className = themeClass();
      saveSettings();
    });
    $('cct-select-position').addEventListener('change', e => {
      settings.position = e.target.value;
      if (settings.position === 'left') {
        panelEl.style.right = 'auto'; panelEl.style.left = '10px';
      } else {
        panelEl.style.left = 'auto'; panelEl.style.right = '10px';
      }
      saveSettings();
    });
    $('cct-clear-chars').addEventListener('click', () => {
      if (!confirm('Clear all character cards for this chat?')) return;
      characters = {}; saveCharacters(); renderPanel();
    });
  }

  // ── Event hooks ───────────────────────────────────────────────────────────

  function hookEvents() {
    const es = getEventSource();
    const et = getEventTypes();
    if (!es || !et) return;

    // Inject character context before every generation
    const genEvent = et.GENERATE_BEFORE_ANY_ACTION
                  || et.GENERATE_BEFORE_COMBINE_PROMPTS
                  || 'generate_before_any_action';
    es.on(genEvent, onBeforeGeneration);

    // Reload cards when the active chat changes
    const chatEvent = et.CHAT_CHANGED || 'chatChanged';
    es.on(chatEvent, () => {
      loadCharacters(); renderPanel(); updatePreview();
    });
  }

  // ── Boot ──────────────────────────────────────────────────────────────────

  waitForST(() => {
    loadSettings();
    createPanel();
    loadCharacters();
    renderPanel();
    updatePreview();
    hookEvents();
    console.log(`[${EXT_NAME}] Loaded ✓`);
  });

})();
