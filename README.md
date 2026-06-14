# Character Card Tracker – SillyTavern Extension

A lightweight extension for **group chats** that lets you manually maintain
per-character cards (stats, outfit, likes/hates) and automatically injects
their current state into the AI context before every generation — so your
characters never forget who they are or what they're wearing.

---

## ✨ Features

| Feature | Details |
|---|---|
| **Per-character cards** | One collapsible card per character, lives in a floating side panel |
| **Stats** | Height, weight, plus unlimited custom stats (double-click to edit inline) |
| **Likes & Hates** | Tag-based, add/remove at any time during the session |
| **Currently wearing** | Tag-based outfit tracker |
| **Context injection** | Builds a clean status block and injects it into the system prompt before every generation |
| **Per-chat persistence** | Character data is stored in chat metadata — each chat keeps its own characters |
| **Themes** | Dark · Fantasy · Light · Minimal |
| **Panel position** | Attach the panel to the left or right side of the screen |

---

## 📥 Installation

1. Open SillyTavern.
2. Click the **Extensions** tab (cube icon).
3. Click **Install extension**.
4. Paste your repository URL and press **Install**.

Or, for manual install: drop the entire folder into
`SillyTavern/public/scripts/extensions/third-party/char-card-tracker/`.

---

## 🚀 Quick start

1. Open or create a **group chat**.
2. Click **+ Add** in the Character Card panel to create a card for each
   character. Give them a name, height, and weight.
3. Expand a card and add likes, hates, and outfit tags.
4. Chat normally — the extension injects a status block before every
   generation automatically. No extra steps needed.

---

## 🧩 What the injected context looks like

```
[Character status for Elara]
Height: 168 cm | Weight: 54 kg
Currently likes: warm tea, reading by the fire
Currently dislikes: loud noises, crowded markets
Currently wearing: green linen dress, brown leather boots
[End of Elara's status]

[Character status for Kael]
Height: 185 cm | Weight: 80 kg
Currently likes: sparring, rare meat
Currently dislikes: magic users, bureaucracy
Currently wearing: chainmail, dark cloak
[End of Kael's status]
```

This is appended directly after the system prompt so the model reads it on
every turn before generating responses.

---

## ✏️ Editing data

| Element | How to edit |
|---|---|
| **Stat value** (height, weight, custom) | Double-click the value → type → press Enter or click away |
| **Add custom stat** | Type the stat name in the stat field → click **+ Stat** |
| **Like / hate / outfit tag** | Type in the input field → press Enter or click **+** |
| **Remove a tag** | Click the **×** on the tag |
| **Remove a character** | Click **✕** in the card header |

---

## ⚙️ Settings (⚙ button on the panel)

| Setting | Description |
|---|---|
| **Enabled** | Toggle the whole extension on/off |
| **Auto-inject context** | When off, nothing is added to the prompt (useful for testing) |
| **Show context preview** | Displays the raw injected text below the panel header |
| **Theme** | Dark / Fantasy / Light / Minimal |
| **Panel side** | Left or Right |
| **Clear all characters** | Wipes all cards for the current chat |

---

## 🛠️ Technical notes

- Character data is stored in `chatMetadata` (the same place ST itself uses
  for per-chat data). It persists across page reloads and ST restarts.
- Context is injected via `setExtensionPrompt` at position 1 (after system
  prompt), depth 0. This is identical to the approach used by the RPG
  Companion extension.
- No external API calls are made — all data is local.
- Compatible with any AI backend (OpenAI, Claude, Kobold, Ollama, etc.).
- Requires SillyTavern ≥ 1.11.0.

---

## 📜 License

AGPL-3.0 — same as SillyTavern itself.
