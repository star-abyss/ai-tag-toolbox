# Task 4 Review

Verdict: **NEEDS_FIXES**

Reviewed cumulative HEAD `da4c0ae` (including `00ae339`) against `task-4-brief.md`.

## Findings

### P1: Conversation Manager delete bypasses the new lifecycle confirmation

`src/app-view.js:2868-2874` still wires the manager's delete button to the old one-line confirmation and calls `assistant.deleteSession(session.id)` without `{ retainImages }`, impact counts, or the retain checkbox. The normal left session list has the new confirmation at `2514-2524`, but users can reach the manager path through “对话管理” and permanently delete conversation-owned images without any way to promote them to the gallery. Both delete entry points must use the same count/retain flow.

### P1: Gallery-to-conversation drag creates a pending attachment

`src/app-view.js:3797-3808` handles every image-id drop into a conversation context by calling `attachToConversation(..., { ..., pending: true })`. This includes existing gallery cards and drops of conversation references. The brief requires gallery references to be attached without duplicating bytes and drag/drop between gallery/conversation/Vision to have no pending side effects. A gallery drag therefore silently changes the next message payload; preserve the existing pending value and let the user explicitly toggle the card.

### P1: The 861–900px AI layout is not actually stacked or collapsible

`src/app.css:521-523` forces the AI sidebar to `width/min-width: 420px`, while `:553` changes it to `width:100%` at `max-width:900px`. The stacked grid rule does not change `.wrap` from its horizontal flex layout. At widths 861–900px (where the `max-width:860px` fixed/mobile sidebar rule does not apply), the flex-none sidebar consumes the full row and leaves the main AI conversation with effectively zero width/causes horizontal overflow. The narrow layout needs a real stack or the mobile overlay breakpoint must cover this range.

### P2: Repository controls and metadata are not localized

The new repository UI in `src/index.html:143-151` hardcodes Chinese labels for the section, count, select options, clear-pending action, and confirmation checkbox (`:774`). There are no corresponding `ui.ai`/repository keys in `locales/en-US.json`, so switching to English leaves this entire surface untranslated. Source values (`upload`, `gallery`, `comfy`) are also rendered raw at `src/app-view.js:1352-1353` rather than through localized labels.

### P2: Conversation image cards are mouse-only interactive articles

`src/app-view.js:1340-1357` creates clickable `<article>` cards but does not set `tabIndex`, `role`, keyboard handling, or an accessible state (`aria-pressed`/equivalent). The delete button is keyboard reachable, but toggling pending by clicking the card is not. The repository section itself is focusable, yet individual cards cannot be operated without a mouse. Add a semantic button/control or keyboard equivalent and expose pending/selected state.

### P2: Manager “清空当前” does not refresh the repository strip

The manager clear handler at `src/app-view.js:2858-2862` calls `clearSession` and re-renders manager/talk, but omits `renderConversationRepository()`. Since `showAi("talk")` only synchronizes the mode indicator, returning to the talk tab can leave stale cards/pending counts until another render-triggering action. Clear must refresh both repository and pending strip immediately.

### P2: Legacy `talk` collection helpers remain in the active view module

`src/app-view.js:1246-1300` still exposes the old `bucket()`/`renderImages()` collection path, and the AI DOM retains `data-image-collection="talk"` at `src/index.html:558,560,592,607`. Current send/add paths bypass it, but retaining a live-looking `talk` collection API leaves two competing sources of truth and makes future event handlers easy to route back to the removed semantics. Remove or isolate the dead path after confirming no non-AI caller needs it.

## What passed

- `npm run check` passed (`check ok: 27 JS files, 19465 tags`).
- `Assistant.deleteSession(id, options)` now forwards `retainImages` to `imageRepository.deleteSession` (`src/modules/assistant.js:1430`).
- `clearSessionContent`, `pendingConversationReferences`, `markSent`, and `resetPending` preserve refs and reset pending as intended at the repository module level.
- Comfy candidate-ready events attach generated image IDs with `source: "comfy"`, message ID, and candidate ID (`src/modules/assistant.js:1193-1202`).
- Version markers in `package.json`, `VERSION.txt`, and `src/index.html` are `1.4.186`.

## Test gap

The added checks cover repository contracts and static DOM/CSS presence, but do not execute the manager-delete branch, drag/drop pending behavior, responsive geometry, or keyboard/accessibility behavior. These need focused DOM tests or manual UI verification after fixes.
