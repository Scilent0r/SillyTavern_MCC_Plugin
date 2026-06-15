/**
 * Character Card Tracker – index.js  v1.3.0
 *
 * Key fixes vs v1.2:
 *  - No ES imports (IIFE only)
 *  - Context injection via window.setExtensionPrompt called from
 *    eventSource.on(GENERATE_BEFORE_COMBINE_PROMPTS) — the correct ST hook
 *    (the old jQuery 'generate_before_any_action' event does not exist in ST)
 *  - Settings stored in window.extension_settings[EXT_NAME] directly
 *    (the global ST exposes for extensions)
 *  - Character data stored in chatMetadata via getContext()
 *  - Fallback: if setExtensionPrompt isn't available, we prepend to
 *    the system prompt via the oai_settings / generate hook
 */

(function () {
  'use strict';

  const EXT_NAME    = 'char-card-tracker';
  const INJECT_KEY  = 'cct_char_context';
  const INJECT_POS  = 0;   // 0 = IN_PROMPT (before system prompt); resolved at runtime below
  const INJECT_DEPTH = 0;

  const DEFAULT_SETTINGS = {
    enabled:     true,
    theme:       'dark',
    position:    'right',
    autoInject:  true,
    showPreview: false,
  };

  let characters = {};
  let settings   = { ...DEFAULT_SETTINGS };
  let panelEl    = null;

  // ── ST accessors ──────────────────────────────────────────────────────────

  function ctx()     { return window.SillyTavern?.getContext?.(); }
  function extSet()  {
    // ST exposes extension_settings as a global AND on the context
    return window.extension_settings ?? ctx()?.extensionSettings;
  }

  // ── Settings ──────────────────────────────────────────────────────────────

  function loadSettings() {
    const ext = extSet();
    if (!ext) return;
    if (!ext[EXT_NAME]) ext[EXT_NAME] = {};
    Object.assign(settings, DEFAULT_SETTINGS, ext[EXT_NAME]);
  }

  function saveSettings() {
    const ext = extSet();
    if (ext) ext[EXT_NAME] = { ...settings };
    // Try both known save paths
    ctx()?.saveSettingsDebounced?.();
    if (typeof window.saveSettingsDebounced === 'function')
      window.saveSettingsDebounced();
  }

  // ── Character persistence (chat metadata) ─────────────────────────────────

  function saveCharacters() {
    const c = ctx();
    if (!c?.chatMetadata) return;
    c.chatMetadata[EXT_NAME + '_chars'] = JSON.stringify(characters);
    // saveMetadataDebounced is a global in ST
    if (typeof window.saveMetadataDebounced === 'function')
      window.saveMetadataDebounced();
    else
      c.saveMetadataDebounced?.();
  }

  function loadCharacters() {
    const c = ctx();
    if (!c?.chatMetadata) { characters = {}; return; }
    const raw = c.chatMetadata[EXT_NAME + '_chars'];
    try { characters = raw ? JSON.parse(raw) : {}; }
    catch { characters = {}; }
  }

  // ── Import / Export ───────────────────────────────────────────────────────

  function exportCharacters() {
    const payload = {
      version: 1,
      exported: new Date().toISOString(),
      characters,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    const date = new Date().toISOString().slice(0, 10);
    a.href     = url;
    a.download = `char-cards-${date}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function importCharacters(file) {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const parsed = JSON.parse(e.target.result);
        const incoming = parsed.version === 1 ? parsed.characters : parsed;
        if (typeof incoming !== 'object' || Array.isArray(incoming))
          throw new Error('Unexpected format');
        const count = Object.keys(incoming).length;
        if (!count) { alert('No characters found in file.'); return; }
        const mode = Object.keys(characters).length
          ? confirm(`Merge with existing characters?\nOK = merge (keep existing + add new)\nCancel = replace all`)
          : false; // no existing chars → always replace
        if (mode) {
          // Merge: incoming wins on conflict
          Object.assign(characters, incoming);
        } else {
          characters = incoming;
        }
        saveCharacters();
        renderPanel();
        updatePreview();
        alert(`Imported ${count} character(s).`);
      } catch (err) {
        alert('Failed to import: ' + err.message);
      }
    };
    reader.readAsText(file);
  }

  // ── Context injection ─────────────────────────────────────────────────────

  function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  function buildBlock(name) {
    const d = characters[name];
    if (!d) return '';
    const s = d.stats || {};
    const lines = [
      `[Character status for ${name}]`,
      `Height: ${s.height || 'unknown'} | Weight: ${s.weight || 'unknown'}`,
    ];
    Object.entries(s).forEach(([k, v]) => {
      if (k !== 'height' && k !== 'weight' && v)
        lines.push(`${capitalize(k.replace(/_/g, ' '))}: ${v}`);
    });
    if (d.likes?.length)   lines.push(`Currently likes: ${d.likes.join(', ')}`);
    if (d.hates?.length)   lines.push(`Currently dislikes: ${d.hates.join(', ')}`);
    if (d.wearing?.length) lines.push(`Currently wearing: ${d.wearing.join(', ')}`);
    lines.push(`[End of ${name}'s status]`);
    return lines.join('\n');
  }

  function buildInjection() {
    if (!settings.enabled || !settings.autoInject) return '';
    const blocks = Object.keys(characters).map(buildBlock).filter(Boolean);
    return blocks.length ? '\n\n' + blocks.join('\n\n') + '\n' : '';
  }

  function doInject() {
    const text = buildInjection();

    // Resolve injection position from ST's enum at call time (safer than a hardcoded int)
    const pos = window.extension_prompt_types?.IN_PROMPT ?? 0;

    // Primary path: ST's setExtensionPrompt global (works in ST >= 1.11)
    if (typeof window.setExtensionPrompt === 'function') {
      window.setExtensionPrompt(INJECT_KEY, text, pos, INJECT_DEPTH);
      return;
    }
    // Secondary path: via context
    const c = ctx();
    if (typeof c?.setExtensionPrompt === 'function') {
      c.setExtensionPrompt(INJECT_KEY, text, pos, INJECT_DEPTH);
      return;
    }
    console.warn(`[${EXT_NAME}] setExtensionPrompt not found — injection skipped`);
  }

  // ── Drag ─────────────────────────────────────────────────────────────────

  function makeDraggable(el, handle) {
    let ox, oy, sx, sy;
    handle.style.cursor = 'grab';
    handle.addEventListener('mousedown', e => {
      if (e.target.closest('button,input,select')) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      ox = r.left; oy = r.top; sx = e.clientX; sy = e.clientY;
      el.style.right = 'auto'; el.style.bottom = 'auto';
      el.style.left = ox + 'px'; el.style.top = oy + 'px';
      handle.style.cursor = 'grabbing';
      const mv = e => { el.style.left=(ox+e.clientX-sx)+'px'; el.style.top=(oy+e.clientY-sy)+'px'; };
      const up = () => { handle.style.cursor='grab'; document.removeEventListener('mousemove',mv); document.removeEventListener('mouseup',up); };
      document.addEventListener('mousemove', mv);
      document.addEventListener('mouseup', up);
    });
  }

  // ── HTML helpers ──────────────────────────────────────────────────────────

  function esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function themeClass() { return 'cct-theme-' + (settings.theme || 'dark'); }

  function statItemHTML(name, key, val) {
    return `<div class="cct-stat-item">
      <p class="cct-stat-label">${esc(capitalize(key.replace(/_/g,' ')))}</p>
      <div class="cct-stat-value" contenteditable="false"
           data-char="${esc(name)}" data-stat-key="${esc(key)}"
           title="Double-click to edit">${esc(val||'')}</div>
    </div>`;
  }

  function tagHTML(name, cat, val) {
    const cls = cat==='likes'?'like':cat==='hates'?'hate':'wear';
    return `<span class="cct-tag ${cls}">${esc(val)}<button class="cct-tag-del"
      data-char="${esc(name)}" data-category="${cat}" data-value="${esc(val)}" title="Remove">×</button></span>`;
  }

  function updatePreview() {
    const el = panelEl?.querySelector('#cct-context-preview');
    if (!el) return;
    el.textContent = buildInjection().trim();
    el.classList.toggle('cct-visible', !!settings.showPreview);
  }

  function updateSubtitle(card, name) {
    const el = card.querySelector('.cct-char-subtitle');
    if (el) { const s=characters[name]?.stats||{}; el.textContent=`${s.height||'?'} · ${s.weight||'?'}`; }
  }

  function toggleCollapse(name) {
    if (!characters[name]) return;
    characters[name].collapsed = !characters[name].collapsed;
    const card = panelEl?.querySelector(`[data-char-name="${name}"]`);
    if (!card) return;
    card.querySelector(`[data-body]`)?.classList.toggle('cct-collapsed', !!characters[name].collapsed);
    const btn = card.querySelector('[data-collapse]');
    if (btn) btn.textContent = characters[name].collapsed ? '▶' : '▼';
    saveCharacters();
  }

  function bindTagDel(tagEl, name, cat, val) {
    tagEl?.querySelector('.cct-tag-del')?.addEventListener('click', e => {
      e.stopPropagation();
      const arr = characters[name]?.[cat];
      if (Array.isArray(arr)) { const i=arr.indexOf(val); if(i>-1) arr.splice(i,1); }
      tagEl.remove();
      saveCharacters(); updatePreview();
    });
  }

  // ── Build character card ──────────────────────────────────────────────────

  function buildCard(name, data) {
    const card = document.createElement('div');
    card.className = 'cct-card';
    card.dataset.charName = name;

    const c = ctx();
    let avatar = '';
    if (c?.characters) {
      const found = c.characters.find(x => x.name === name);
      if (found?.avatar) avatar = `/characters/${found.avatar}`;
    }

    const stats   = data.stats   || {};
    const likes   = data.likes   || [];
    const hates   = data.hates   || [];
    const wearing = data.wearing || [];
    const coll    = !!data.collapsed;

    card.innerHTML = `
      <div class="cct-card-header">
        ${avatar ? `<img class="cct-char-avatar" src="${esc(avatar)}" alt="${esc(name)}"
          onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">` : ''}
        <div class="cct-avatar-placeholder"${avatar?' style="display:none"':''}>${esc(name[0].toUpperCase())}</div>
        <div class="cct-char-name-area">
          <p class="cct-char-name">${esc(name)}</p>
          <p class="cct-char-subtitle">${esc(stats.height||'?')} · ${esc(stats.weight||'?')}</p>
        </div>
        <button class="cct-delete-char" title="Remove">✕</button>
        <button class="cct-collapse-btn" data-collapse="${esc(name)}">${coll?'▶':'▼'}</button>
      </div>
      <div class="cct-card-body${coll?' cct-collapsed':''}" data-body="${esc(name)}">
        <div>
          <p class="cct-section-label">📊 Stats</p>
          <div class="cct-stats-grid">
            ${statItemHTML(name,'height',stats.height)}
            ${statItemHTML(name,'weight',stats.weight)}
            ${Object.entries(stats).filter(([k])=>k!=='height'&&k!=='weight').map(([k,v])=>statItemHTML(name,k,v)).join('')}
          </div>
          <div style="display:flex;gap:5px;margin-top:6px">
            <input class="cct-tag-input cct-stat-key" placeholder="New stat name" style="flex:1">
            <button class="cct-tag-add-btn cct-add-stat">+ Stat</button>
          </div>
        </div>
        ${['likes','hates','wearing'].map(cat => `
        <div class="cct-tags-section">
          <p class="cct-section-label">${cat==='likes'?'💚 Likes':cat==='hates'?'🔴 Hates':'👗 Wearing'}</p>
          <div class="cct-tags-wrap" data-tags="${esc(name)}-${cat}">
            ${(data[cat]||[]).map(v=>tagHTML(name,cat,v)).join('')}
          </div>
          <div class="cct-tag-add-row">
            <input class="cct-tag-input cct-tag-new" placeholder="${cat==='likes'?'Add something they like…':cat==='hates'?'Add something they hate…':'Add clothing item…'}">
            <button class="cct-tag-add-btn cct-add-tag" data-cat="${cat}">+</button>
          </div>
        </div>`).join('')}
        <p class="cct-inject-info">ℹ️ Status injected into AI context automatically</p>
      </div>`;

    // Collapse
    card.querySelector('.cct-card-header').addEventListener('click', e => {
      if (e.target.closest('button')) return; toggleCollapse(name);
    });
    card.querySelector('[data-collapse]').addEventListener('click', () => toggleCollapse(name));

    // Delete
    card.querySelector('.cct-delete-char').addEventListener('click', () => {
      if (!confirm(`Remove ${name}?`)) return;
      delete characters[name]; saveCharacters(); renderPanel();
    });

    // Stat edit
    card.querySelectorAll('.cct-stat-value').forEach(el => {
      el.addEventListener('dblclick', () => {
        el.contentEditable = 'true'; el.focus();
        const r = document.createRange(); r.selectNodeContents(el); r.collapse(false);
        const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
      });
      el.addEventListener('blur', () => {
        el.contentEditable = 'false';
        const k = el.dataset.statKey;
        if (k && characters[name]) {
          characters[name].stats = characters[name].stats || {};
          characters[name].stats[k] = el.textContent.trim();
          updateSubtitle(card, name); saveCharacters(); updatePreview();
        }
      });
      el.addEventListener('keydown', e => { if (e.key==='Enter'){e.preventDefault();el.blur();} });
    });

    // Add stat
    card.querySelector('.cct-add-stat').addEventListener('click', () => {
      const inp = card.querySelector('.cct-stat-key');
      const key = inp.value.trim().toLowerCase().replace(/\s+/g,'_');
      if (!key) return;
      characters[name].stats = characters[name].stats||{};
      if (!(key in characters[name].stats)) characters[name].stats[key]='';
      inp.value=''; saveCharacters(); renderPanel();
    });

    // Add tags
    card.querySelectorAll('.cct-tags-section').forEach(sec => {
      const cat  = sec.querySelector('.cct-add-tag')?.dataset.cat;
      const btn  = sec.querySelector('.cct-add-tag');
      const inp  = sec.querySelector('.cct-tag-new');
      if (!cat||!btn||!inp) return;
      const add = () => {
        const val = inp.value.trim(); if (!val) return;
        characters[name][cat] = characters[name][cat]||[];
        if (!characters[name][cat].includes(val)) characters[name][cat].push(val);
        inp.value = '';
        saveCharacters();
        const wrap = card.querySelector(`[data-tags="${name}-${cat}"]`);
        if (wrap) {
          const tmp = document.createElement('div');
          tmp.innerHTML = tagHTML(name, cat, val);
          const node = tmp.firstElementChild;
          bindTagDel(node, name, cat, val);
          wrap.appendChild(node);
        }
        updatePreview();
      };
      btn.addEventListener('click', add);
      inp.addEventListener('keydown', e => { if(e.key==='Enter') add(); });
    });

    // Existing tag deletes
    card.querySelectorAll('.cct-tag').forEach(t => {
      const b = t.querySelector('.cct-tag-del');
      if (b) bindTagDel(t, b.dataset.char, b.dataset.category, b.dataset.value);
    });

    return card;
  }

  // ── Panel render ──────────────────────────────────────────────────────────

  function renderPanel() {
    if (!panelEl) return;
    panelEl.className = themeClass();
    const cards = panelEl.querySelector('#cct-cards');
    if (!cards) return;
    cards.innerHTML = '';
    Object.entries(characters).forEach(([n,d]) => cards.appendChild(buildCard(n,d)));
    updatePreview();
  }

  // ── Panel creation ────────────────────────────────────────────────────────

  function createPanel() {
    document.getElementById('cct-panel')?.remove();

    panelEl = document.createElement('div');
    panelEl.id = 'cct-panel';
    panelEl.className = themeClass();
    const side = settings.position==='left' ? 'left:10px;right:auto' : 'right:10px;left:auto';
    panelEl.style.cssText = `position:fixed;top:70px;${side};width:320px;max-height:calc(100vh - 90px);overflow-y:auto;overflow-x:hidden;z-index:10000;display:flex;flex-direction:column;gap:10px;`;

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
        <div class="cct-form-row"><span class="cct-form-label">Name</span>
          <input class="cct-form-input" id="cct-new-char-name" placeholder="Character name"></div>
        <div class="cct-form-row"><span class="cct-form-label">Height</span>
          <input class="cct-form-input" id="cct-new-height" placeholder="e.g. 185 cm"></div>
        <div class="cct-form-row"><span class="cct-form-label">Weight</span>
          <input class="cct-form-input" id="cct-new-weight" placeholder="e.g. 55 kg"></div>
        <div class="cct-form-actions">
          <button class="cct-btn" id="cct-add-cancel">Cancel</button>
          <button class="cct-btn primary" id="cct-add-confirm">Add</button>
        </div>
      </div>
      <div id="cct-settings-panel">
        <p class="cct-settings-title">Settings</p>
        <div class="cct-settings-row"><label>Enabled</label>
          <label class="cct-toggle"><input type="checkbox" id="cct-toggle-enabled" ${settings.enabled?'checked':''}><span class="cct-toggle-slider"></span></label></div>
        <div class="cct-settings-row"><label>Auto-inject context</label>
          <label class="cct-toggle"><input type="checkbox" id="cct-toggle-inject" ${settings.autoInject?'checked':''}><span class="cct-toggle-slider"></span></label></div>
        <div class="cct-settings-row"><label>Show context preview</label>
          <label class="cct-toggle"><input type="checkbox" id="cct-toggle-preview" ${settings.showPreview?'checked':''}><span class="cct-toggle-slider"></span></label></div>
        <div class="cct-settings-row"><label>Theme</label>
          <select id="cct-select-theme">
            <option value="dark" ${settings.theme==='dark'?'selected':''}>Dark</option>
            <option value="fantasy" ${settings.theme==='fantasy'?'selected':''}>Fantasy</option>
            <option value="light" ${settings.theme==='light'?'selected':''}>Light</option>
            <option value="minimal" ${settings.theme==='minimal'?'selected':''}>Minimal</option>
          </select></div>
        <div class="cct-settings-row"><label>Panel side</label>
          <select id="cct-select-position">
            <option value="right" ${settings.position==='right'?'selected':''}>Right</option>
            <option value="left" ${settings.position==='left'?'selected':''}>Left</option>
          </select></div>
        <div class="cct-settings-row" style="gap:6px">
          <button class="cct-btn" id="cct-export-chars" style="flex:1">📤 Export</button>
          <button class="cct-btn" id="cct-import-chars" style="flex:1">📥 Import</button>
          <input type="file" id="cct-import-file" accept=".json" style="display:none">
        </div>
        <div class="cct-settings-row">
          <button class="cct-btn" id="cct-clear-chars" style="width:100%;color:#ef4444">🗑 Clear all characters</button>
        </div>
      </div>
      <div class="cct-context-preview" id="cct-context-preview"></div>
      <div id="cct-cards"></div>`;

    document.body.appendChild(panelEl);
    makeDraggable(panelEl, panelEl.querySelector('#cct-panel-header'));

    const $ = id => panelEl.querySelector('#'+id);

    $('cct-btn-add').addEventListener('click', () => {
      $('cct-add-form').classList.toggle('cct-visible');
      $('cct-settings-panel').classList.remove('cct-visible');
    });
    $('cct-btn-settings').addEventListener('click', () => {
      $('cct-settings-panel').classList.toggle('cct-visible');
      $('cct-add-form').classList.remove('cct-visible');
    });
    $('cct-add-cancel').addEventListener('click', () => $('cct-add-form').classList.remove('cct-visible'));
    $('cct-add-confirm').addEventListener('click', () => {
      const name = $('cct-new-char-name').value.trim(); if (!name) return;
      const h = $('cct-new-height').value.trim();
      const w = $('cct-new-weight').value.trim();
      if (!characters[name]) {
        characters[name] = { name, stats:{height:h,weight:w}, likes:[], hates:[], wearing:[], collapsed:false };
      } else {
        if (h) characters[name].stats.height = h;
        if (w) characters[name].stats.weight = w;
      }
      $('cct-new-char-name').value=''; $('cct-new-height').value=''; $('cct-new-weight').value='';
      $('cct-add-form').classList.remove('cct-visible');
      saveCharacters(); renderPanel();
    });
    $('cct-new-char-name').addEventListener('keydown', e => { if(e.key==='Enter') $('cct-add-confirm').click(); });
    $('cct-toggle-enabled').addEventListener('change', e => { settings.enabled=e.target.checked; saveSettings(); });
    $('cct-toggle-inject').addEventListener('change', e => { settings.autoInject=e.target.checked; saveSettings(); });
    $('cct-toggle-preview').addEventListener('change', e => { settings.showPreview=e.target.checked; updatePreview(); saveSettings(); });
    $('cct-select-theme').addEventListener('change', e => { settings.theme=e.target.value; panelEl.className=themeClass(); saveSettings(); });
    $('cct-select-position').addEventListener('change', e => {
      settings.position=e.target.value;
      if (settings.position==='left'){panelEl.style.right='auto';panelEl.style.left='10px';}
      else{panelEl.style.left='auto';panelEl.style.right='10px';}
      saveSettings();
    });
    $('cct-export-chars').addEventListener('click', exportCharacters);
    $('cct-import-chars').addEventListener('click', () => $('cct-import-file').click());
    $('cct-import-file').addEventListener('change', e => {
      const file = e.target.files[0];
      if (file) { importCharacters(file); e.target.value = ''; }
    });
    $('cct-clear-chars').addEventListener('click', () => {
      if (!confirm('Clear all character cards for this chat?')) return;
      characters={}; saveCharacters(); renderPanel();
    });
  }

  // ── Boot ──────────────────────────────────────────────────────────────────

  function init() {
    loadSettings();
    createPanel();
    loadCharacters();
    renderPanel();
    updatePreview();

    // ── Injection hook via ST's eventSource (correct method) ──
    // GENERATE_BEFORE_COMBINE_PROMPTS fires reliably before every send.
    try {
      const es = ctx()?.eventSource ?? window.eventSource;
      const et = ctx()?.eventTypes  ?? window.event_types;
      if (es && et) {
        const ev = et.GENERATE_BEFORE_COMBINE_PROMPTS;
        if (ev) {
          es.on(ev, doInject);
          console.log(`[${EXT_NAME}] hooked into ${ev}`);
        } else {
          console.warn(`[${EXT_NAME}] GENERATE_BEFORE_COMBINE_PROMPTS not in eventTypes — trying fallback`);
        }
      }
    } catch(e) { console.warn(`[${EXT_NAME}] eventSource hook failed:`, e); }

    // Fallback: hook the send button directly if eventSource binding failed
    $(document).on('click', '#send_but, #send_textarea', function() {
      setTimeout(doInject, 0); // yield so ST's generate pipeline has started
    });

    // Reload on chat change
    $(document).on('chatLoaded chat_changed', () => {
      loadCharacters(); renderPanel(); updatePreview();
    });

    console.log(`[${EXT_NAME}] v1.3.0 loaded ✓`);
  }

  // Wait for jQuery + ST to be ready
  function boot() {
    if (window.jQuery && window.SillyTavern?.getContext) {
      init();
    } else {
      setTimeout(boot, 300);
    }
  }
  boot();

})();
