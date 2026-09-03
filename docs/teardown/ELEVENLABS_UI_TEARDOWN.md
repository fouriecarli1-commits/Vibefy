# ElevenLabs UI teardown — element-by-element reference

**Purpose.** A reference capture of a mature generative-media product, screen by screen, so that
when we build the equivalent Vibefy surfaces we can be *simpler* without being *poorer*. Nothing in
here is a mandate to copy the visual design. Every row is a capability question: *do we have an
answer for this, and is our answer easier to use?*

**How to read it.** Each screen lists: (1) the chrome, (2) every control and its options, (3) the
AI-assist behaviour on that screen. The last section, [Copilot parity](#copilot-parity), is the rule
we hold ourselves to: whatever the reference does with AI on a given function, our copilot does at
least as much, in fewer steps.

**Status:** living document. Screens are appended as they are captured.

| # | Screen | Captured |
|---|--------|----------|
| 1 | Home | ✅ |
| 2 | Voices → Explore | ✅ |
| 3 | Studio | ✅ |
| 4 | Flows | ✅ |
| 5 | Templates | ✅ |
| 6 | Assets | ✅ |
| 7 | Text to Speech | ✅ |
| 8 | Sound Effects → Explore | ✅ |
| 9 | Image & Video → Explore | ✅ |
| 10 | Voice Isolator | ✅ |
| 11 | Voice Changer | ✅ |
| 12 | Music → Marketplace | ✅ |
| 13 | Speech to Text → Transcriptions | ✅ |
| 14 | Dubbing | ✅ |
| 15 | Ads Engine | ✅ |
| — | Audiobooks, Upscale, remaining *More tools*, settings, billing | pending |

---

## 0. Global chrome (present on every screen)

**Left rail (top → bottom)**

- Wordmark, top-left.
- Primary nav: Home, Voices, Studio, Flows, Templates, Assets.
  - `Voices` carries a `+` quick-create affordance on the row itself (create without navigating).
- Section label `Pinned`, then the user's pinned tools: Text to Speech, Sound Effects, Image &
  Video, Voice Isolator, Voice Changer, Music, Speech to Text, Dubbing, Audiobooks.
  - **The pinned list is user-editable.** The tool list is not a fixed menu — it is a personal
    shortlist. This is the single most practical idea on the screen.
- `··· More tools` with a chevron → the full tool catalogue (overflow, so the rail never grows
  unbounded).
- Bottom block:
  - Contextual promo/utility card, e.g. *"Invite team members — Bring your team in to collaborate
    and share your creations."*
  - `Developers` link (API/docs entry point) — appears on tool screens.
  - Workspace switcher: colour-chip avatar + workspace name (`ElevenCreative`) + a `Switch` button
    revealed on hover.
- The active nav row is filled/highlighted; the rail scrolls independently of the canvas.

**Top bar**

- Sidebar collapse toggle (icon, far left).
- Breadcrumb: `Section` or `Section › Sub-section` (e.g. `Voices › Explore`). Clickable.
- Centre: global search — *"Search everything…"* with a visible `⌘` `K` shortcut chip.
  Searches across voices, assets, generations, docs, and navigation.
- Right cluster: `Feedback`, `Docs`, `Ask` (AI help, distinct from Docs), a folder icon
  (asset/library quick access), a bell (notifications), user avatar.

**Cross-cutting patterns**

| Pattern | Where it appears | Why it matters |
|---|---|---|
| **Generation dock** | Every tool screen | The composer is a persistent floating card, not a page. You can browse results and keep composing. |
| **Explore / History / Favourites tabs** | Sound Effects, Image & Video, Voices, Templates | Every tool has a *library* dimension, not just a generator. |
| **Inline option pills** | Every dock | Model, ratio, resolution, duration, variants are shown as one-line pills with current value, each a dropdown. Never buried in a settings modal. |
| **Cost at the point of action** | Every dock | Always `<cost for this run> / <remaining>` — e.g. `68 credits / 587,356 credits`, `120 left`. Never a separate billing page trip. |
| **AI suggestion chips** | Above/next to every prompt input | 3 tappable prompt seeds, contextual to the tool. |
| **First-run "Introducing X" modal** | Flows, Templates | 3 bullets + hero image + one primary CTA. |
| **Progressive fade on long lists** | Voice Isolator history | Rows fade toward the bottom edge instead of a hard cut. |
| **`@` mention inside prompts** | Image & Video | Reference your own assets/avatars from inside the prompt text. |

---

## 1. Home

The unified composer. One card that can drive *every* modality.

**Modality tab row (inside the card):** `Speech` · `Image` · `Video` · `Sound Effects` · `Music` ·
`Voice Changer` · `Voice Isolator` · `Upscale` · `More tools`
— each with its own icon. Switching a tab reconfigures the whole card (attachments, placeholder,
suggestions, option pills) without leaving Home.

**With `Video` selected:**

| Control | Type | Observed value / options |
|---|---|---|
| Start frame | `+` attachment chip | image upload |
| End frame | `+` attachment chip | image upload |
| Reference image | `+` attachment chip | image upload |
| Prompt | multiline textarea | placeholder *"Describe a video…"* |
| Suggestion chips | AI seeds | `Surreal Dreamscape`, `Cyberpunk Alley`, `Enchanted Forest` |
| Model | pill dropdown | `Gemini Omni Flash 1.1` |
| Aspect ratio | pill dropdown | `16:9` |
| Resolution | pill dropdown | `720p` |
| Duration | pill dropdown | `8s` |
| Variants | pill dropdown | `1 variant` |
| More options | expander `›` | the long tail of settings, hidden by default |
| Quota | read-only | `120 left` |
| Generate | primary button | **disabled until the prompt is non-empty** |

**Below the composer**

- Feature promo banner: *Try Dubbing **V2** (alpha)* — a benefit bullet list
  (92 languages · sync-aware translations · end-to-end · automatic voice cloning · preserves emotion
  and delivery) with illustrative language chips (हिन्दी, Русский, Español, Português, العربية, 中文).
- `Templates` section with a `View all` link and a horizontal card grid.

**Practicality note for Vibefy.** The tab-driven single composer is the strongest idea here: one
mental model, nine tools. The weakness is that the option pills change silently between tabs — a user
loses their bearings. Our version should keep the pill row *positionally stable* and label what
changed.

---

## 2. Voices → Explore

| Element | Detail |
|---|---|
| Title | `Voices` |
| Tabs | `Explore` \| `My Voices` |
| Actions (right) | `Earnings` (creators are paid for voice usage), `+ Create Voice` (primary) |
| Search | *"Search library voices…"* — with an **audio-search icon** at the right of the field (find a voice by uploading/humming a sample) |
| Filters | `Filters` button (sliders icon) + a separate **sort** button |
| Filter chips | `Language ⌄` (dropdown) · `Conversational` · `Narration` · `Characters` · `Social Media` · `Educational` · `Advertisement` · `Entertainment` |

**`Trending voices ›` — card grid (3 across)**

Each card: circular avatar with a **verified tick**, name + descriptor in one line
(*"Russ – Deep, Smooth and Articulate"*), use-case label (*Educational* / *Narration* /
*Conversational*), and a language row: flag + language name + an overflow chip (`+21`, `+18`, `+14`,
`+7`, `+15`) for additional languages.

**`Handpicked for your use case` — carousel** with `‹` `›` arrows. Editorially curated collections:
*Best voices for Eleven v3*, *Popular Tiktok voices*, *Studio-Quality Conversational Voices*, and
more off-screen. Large illustrated tiles, not thumbnails.

**Do not lose:** verification state, per-voice language coverage with overflow count, use-case
taxonomy, search-by-audio, creator earnings, and the editorial curation layer. Curation is what makes
a 10,000-voice library usable; search alone does not.

---

## 3. Studio

The long-form / project surface.

| Element | Detail |
|---|---|
| Title | `Studio` |
| Actions | `Upload` (secondary, folder-in icon) · `+ New blank project` (primary) |
| Hero | Full-width gradient panel containing a centred prompt card |
| Prompt card | placeholder *"Make a faceless news video about…"*; a **paperclip** (attach source material) and a **clock** (recent/history) icon; primary `Create video` |
| Gallery | Horizontal scroller of portrait example projects with a `›` arrow. One tile carries flag chips (🇺🇸 🇫🇷 🇪🇸 🇩🇪) = a localisation/dubbing example |

**Read:** Studio is "project" scope — it produces a timeline/document, whereas the tool screens
produce a single asset. The two-entry design (prompt-to-project *or* blank project *or* upload) is
worth keeping; three doors into the same editor.

---

## 4. Flows

Node-graph canvas. The power-user surface.

| Element | Detail |
|---|---|
| Title | `Flows` |
| Action | `+ New Flow` (primary) |
| `Get started` | Row of starter-flow cards with a `›` arrow: *Selfie to character sheet*, …, *Explainer video* |

**First-run modal — "Introducing Flows"** (hero image + 3 icon bullets + one CTA `Get started`):

1. Add & connect nodes for image, video, and audio generation
2. Visually create your content on an infinite canvas
3. Access to all the popular AI models without switching tools

**What the hero image reveals about the canvas itself** (worth capturing, it is the actual spec):

- Nodes are typed and titled: `Image`, `Remove background`, `Image Generator`, `Product video`,
  and a text/LLM node (`GPT 5.x`) that *writes the prompt* for a downstream node.
- Connections are curved edges with numbered ports; a node can fan out to several consumers.
- Each node carries its own inline option pills — e.g. the image node shows `Seedream 4`, `3:4`,
  `1080p`, a download icon; the video node shows `Veo 3.1 Fast`, `16:9`, `720p`, `4s`, audio toggle,
  download.
- Each node has a `+` add-port and a badge showing attached reference count (`+3`).
- Per-node `Run ⌄` button — you can execute one node, not only the whole graph.
- A node's prompt is a full editable text block (the product-video node shows a long cinematic
  prompt), so a graph is also a prompt document.

**Do not lose:** per-node model choice, per-node run, an LLM node that generates prompts for other
nodes, and starter flows. **Simplify:** the graph should be generated *from* a copilot conversation,
not drawn by hand as the only entry point.

---

## 5. Templates

Packaged, one-click workflows — the bridge between Home (one shot) and Flows (build it yourself).

| Element | Detail |
|---|---|
| Breadcrumb | `Templates › Explore` |
| Tabs | `Explore` \| `My Templates` |
| Action | `+ New Template` (primary, repeated at the bottom of the page) |
| Search | *"Search templates…"* |
| Filter | `+ Category ⌄` |
| Cards | thumbnail · title · one-line description · tag chips (`Image Tools`, `Style Transfer`, `Video effects`) |
| Examples | *Make it giant or tiny — Turn any subject into a giant or tiny … realistically in the real world*; *Sound effects — Generate sound effects from a text prompt* |
| Bottom band | *"Create your own template — Build a custom template and tailor every step to your creative workflow."* + `+ New Template` |

**First-run modal — "Introducing Templates":**

1. Run ready-made creative workflows with a single click
2. Customize inputs for image, video, and audio generation
3. Create and share your own, or browse templates from Explore

**Note the ladder:** Home → Templates → Flows is a deliberate skill ramp, and each rung is
shareable. We should keep the ladder and make the rungs closer together.

---

## 6. Assets

| Element | Detail |
|---|---|
| Title | `Assets` |
| Actions | `New folder` (secondary) · `Upload` (primary, dark) |
| Search | *"Start typing to search"* |
| View toggle | list / grid (two icons, right of search) |
| Filter | `+ Owner ⌄` |
| Table columns | `Name` · `Added` · `Type` · `File size` |
| Rows | Folders first, with type-specific icons — `My Avatars` (avatar-folder icon, system-created) and `Uploads` (plain folder). Empty metadata renders as `—`, not blank |

**Do not lose:** system folders that the tools write into automatically (`My Avatars`, `Uploads`),
the owner filter (matters the moment a workspace has more than one member), and the em-dash
convention for "not applicable" rather than an empty cell.

---

## 7. Text to Speech

The richest options screen, and the clearest example of the AI-assist pattern.

**Canvas (centre)** — a distraction-free text editor, full width, no visible chrome.

- The text itself carries inline directives: `Make a song, synthwave: Make a song about love`.
- A small **floating inline toolbar** appears at the cursor (two icons, one carrying a `1` badge) —
  in-context actions on the selection (insert audio tag / enhance).

**Editor footer bar**

| Element | Detail |
|---|---|
| Credits | `587,356 credits remaining` with a refresh/progress ring |
| Character counter | `46 / 5,000 characters` — limit visible before you hit it |
| Download | icon button |
| Primary | `Generate speech` |

**Right settings panel (top → bottom)**

| Control | Type | Value / range |
|---|---|---|
| Promo card | dismissible (`×`) | *Try Voice Design for v3 — Create expressive voices for the Eleven v3 Text to Speech model* |
| **Voice** | selector row + **`✨ Recommend`** | avatar + `Roger - Laid-Back, Casual, Resonant` + `›` to open the picker |
| **Model** | selector row | `V2 Eleven Multilingual v2` + `›`; with an inline upsell strip *"The most expressive Text to Speech model"* + `Try Eleven v3` |
| Speed | slider | `Slower` ↔ `Faster` |
| Stability | slider | `More variable` ↔ `More stable` |
| Similarity | slider | `Low` ↔ `High` |
| Style Exaggeration | slider | `None` ↔ `Exaggerated` |
| Language Override | toggle | off |
| Output Format | dropdown | `MP3 44.1 kHz (128kbps)` |
| Speaker boost | toggle | on |
| Reset values | `↺` text action | restores panel defaults |

**Every slider is labelled at both ends in plain language, not with numbers.** `More variable ↔ More
stable` tells a non-expert what the control does; `0.0–1.0` does not. This is the cheapest
practicality win in the whole product and we should apply it everywhere.

**`✨ Recommend` next to Voice** is the copilot pattern in miniature: an AI action attached to a
specific field, that reads the current context (the script) and fills that field. See
[Copilot parity](#copilot-parity).

---

## 8. Sound Effects → Explore

| Element | Detail |
|---|---|
| Title | `Sound Effects` |
| Tabs | `Explore` \| `History` \| `Favorites` |
| Action | `Soundboard` (right) — assemble effects into a playable pad set |
| Category carousel | Image tiles, each with an icon + label: `Animals`, `Bass`, `Booms`, `Braams`, `Brass`, `Cymbals`, `Devices`, … with a `›` arrow |
| Search | *"Search sound effects…"* |
| Sort | dropdown, `Trending` |
| Filter chips | `Looping` (toggle chip) · `+ Duration` (range) |

**Results table** — columns `Description` · (waveform) · `Duration` · `Downloads`

Each row: play button · the generating prompt as the description · a taxonomy breadcrumb beneath it
(`User Interface › Click`, `Designed › Riser`, `Animals`, `Human › Heartbeat`,
`Swooshes › Whoosh`, `Ambience › Forest`) · a mini waveform preview · duration (`2s`–`10s`) ·
download count (`528`, `453`, `698`, `664`, `117`, `507`) · and three row actions: **share**,
**download**, **favourite (star)**.

**Floating generation dock** (overlays the list, dismissible via `×`)

| Element | Detail |
|---|---|
| Suggestion chips | `Footsteps on gravel` · `Rain on window` · `Cat purring` |
| Prompt | *"Describe a sound…"* |
| Looping | `∞ Off` |
| Duration | `🕐 Auto` |
| Prompt influence | `◔ 30%` — how literally the model follows the prompt |
| (trim/clean) | `✂ On` |
| Cost | `68 credits / 587,356 credits` — **this run's cost and the balance, together** |
| Submit | circular `↑` |

**Footer disclosure:** *"Generations may be shared to Explore page for other users to download."*
with a `Disable` link — the sharing default is stated at the point of generation, with the opt-out
inline. Copy this behaviour exactly; it is the honest pattern.

---

## 9. Image & Video → Explore

| Element | Detail |
|---|---|
| Title | `Image & Video` |
| Tabs | `Explore` \| `History` |
| **Avatars panel** | *"Avatars — Keep characters consistent"* · `View all` · a strip beginning with a `+ New` tile then named avatar tiles (`Laura`, `Huang`, `Jada`, `Sofia`, `Sem`, `Larry`) with a `›` arrow |
| Search | *"Search images, videos, and lip syncs"* |
| Filter chips | `+ Image` · `+ Video` · `+ Lip sync` |
| Gallery | Masonry grid, mixed aspect ratios; video tiles carry a play badge |

**Floating dock**

| Element | Detail |
|---|---|
| Mode | segmented control `Image` \| `Video` \| `Lip sync` |
| Attachments | `Start frame` · `End frame` · `Image refs` · `Video refs` (all disabled/greyed until relevant) |
| Prompt | ***"Describe your video or reference by using `@`…"*** — `@`-mention pulls in your own assets and avatars |
| Settings | a sliders icon at the dock's top-right → full settings |
| Option pills | `Gemini Omni Flash 1.1` · `16:9` · `720p` · `6s` · `1` (variants) · `✂ On` |
| Quota | `160 left` |
| Submit | circular `↑` |

**Do not lose:** the avatar/character-consistency concept (a named, reusable identity across
generations) and `@`-referencing assets from inside the prompt. Those two together are what turn a
gallery of one-offs into a body of work.

---

## 10. Voice Isolator

The simplest tool screen — and therefore the template for how a *simple* Vibefy tool should look.

| Element | Detail |
|---|---|
| Title | `Voice Isolator` |
| Input | Large dashed drop area — *"Drop files here"* |
| Input actions | upload icon · **microphone icon (record directly)** |
| Cost | `0 credits / 60,000 credits` — cost is `0` until a file is attached, then it reflects duration |
| Submit | circular `↑` |
| History search | *"Search history"* |
| History table | `Name` · `Duration` · `Format` · per-row download |
| Rows | `Podcast Interview - Clean Vocals` (3m 5s, mp3) · `YouTube Tutorial - Remove Background` (4m 2s, mp4, video icon) · `Lecture Recording - Speaker Only` (5m 17s, mp3) · `Music Track - Vocals Only` (3m 21s, wav) · `Zoom Call - Isolated Voice` (mp3) |
| Detail | Rows **fade progressively** toward the bottom of the list; the icon differs per source type (waveform vs. video frame) |

**Do not lose:** record-in-place as a first-class input alongside upload, source-type icons in
history, and format shown per item (mp3/mp4/wav) so the user knows what they will get back.

---

## Copilot parity

The reference product attaches AI assistance to functions in four distinct ways. **Our copilot must
do all four, on every function, or the function is not finished.** This is the acceptance checklist.

### The four observed patterns

1. **Prompt seeds** — three tappable, contextual example prompts sitting directly above the prompt
   field, different per tool (`Surreal Dreamscape` for video; `Footsteps on gravel` for sound
   effects). They solve the blank-page problem in one tap.
2. **Field-level recommendation** — `✨ Recommend` beside the Voice selector: an AI action bound to
   *one field*, which reads the current context and fills it. Not a chat window; a button in the
   right place.
3. **Prompt authoring inside a workflow** — the Flows LLM node writes the prompt that a downstream
   generator consumes. AI as a *component*, not only as an assistant.
4. **Contextual help** — the global `Ask` button, separate from `Docs`: ask about the product from
   anywhere.

### The Vibefy rule

For **every** generative function we ship, the copilot provides:

| # | Obligation | Acceptance test |
|---|---|---|
| C1 | **Seeds.** ≥3 contextual starter prompts before any input exists, regenerable. | Land on the screen cold; can a user produce something good without typing? |
| C2 | **Field recommendations.** Every non-trivial setting (model, voice, duration, ratio, style) has a one-tap AI recommendation **with a one-line reason.** | Tap Recommend; does it say *why* this voice, not just *which*? |
| C3 | **Prompt improvement.** Take what the user typed and offer a stronger version, showing the diff, never silently rewriting. | Type three vague words; is the improved version offered, reversible, and explained? |
| C4 | **Cost forecast before commitment.** This run's cost and remaining balance, at the button. | Can the user see the price without leaving the composer? |
| C5 | **Result critique + next step.** After generation: what to change to fix the most likely complaint, and the one-tap action to do it. | Generate something mediocre; does the copilot name the fix? |
| C6 | **Plain-language controls.** Every slider labelled at both ends in words; every option pill states its current value on its face. | Show it to someone who has never used the tool; can they predict what each control does? |
| C7 | **Explain-this.** Any control can be interrogated ("what does Stability do?") in place, without opening docs. | Is the answer in the panel, or in a new tab? |

**Where we go further than the reference.** The four patterns above are unconnected there — seeds
don't know about your settings, and Recommend doesn't know about your seeds. Ours share one context:
the copilot sees the brief, the current settings, the assets in scope, and the history of what the
user rejected, and every suggestion is consistent with all of it. That coherence is the practicality
advantage, not fewer buttons.

### Anti-patterns to avoid (observed)

- Option pills that **silently change meaning** when the modality tab changes.
- Sharing defaults disclosed **only** in fine print (Sound Effects does disclose it inline — good —
  but the default is still on).
- Upsell strips **inside** the settings panel, between two controls (Text to Speech): it interrupts
  a settings task with a sales task.
- First-run modals that **block** the screen the user came to see; prefer a dismissible inline strip.
- Two similar entry points with no stated difference (`Docs` vs. `Ask`, `Upload` vs. drag-and-drop
  onto the canvas).

---

## 11. Voice Changer

Same settings vocabulary as Text to Speech, but the input is audio, not text — and **the option set is
deliberately different**. That difference is the lesson.

| Region | Detail |
|---|---|
| Right panel tabs | `Settings` \| `History` — history lives *in the panel*, not as a page tab |
| Input | Centred dashed card: icon · *"Click to upload, or drag and drop"* · **constraint stated up front: "Audio or video files up to 50MB each"** · an `or` divider · `🎤 Record audio` button |
| Footer bar | `587,356 credits remaining` · `0:00 total duration` · download icon · **delete/clear icon** · `Generate speech` (disabled while empty) |

**Settings panel**

| Control | Value | vs. Text to Speech |
|---|---|---|
| Promo card | *Try Voice Design for v3* (dismissible) | same |
| Voice | `Roger - Laid-Back, Casual, Resonant` `›` | same — but **no `✨ Recommend` here** |
| Model | `V2 Eleven English v2` `›` | different model family (English, not Multilingual) |
| Stability | `More variable` ↔ `More stable` | same |
| Similarity | `Low` ↔ `High` | same |
| Style Exaggeration | `None` ↔ `Exaggerated` | same |
| **Remove Background Noise** | toggle, off | **new — input-specific** |
| Output Format | `MP3 44.1 kHz (128kbps)` | same |
| Speaker boost | toggle, on | same |
| Reset values | `↺` | same |
| ~~Speed~~ | — | **absent** — you cannot re-time a performance you are converting |
| ~~Language Override~~ | — | **absent** |

**Two findings we must act on.**

1. **The option set is tailored per tool, not copy-pasted.** Speed is meaningless here, so it is gone
   rather than greyed out. We do the same: never show a control that cannot apply.
2. **`✨ Recommend` is missing on this screen** even though voice choice matters just as much. That is
   an inconsistency, and exactly the kind of gap the user asked us not to repeat — see
   [Copilot parity](#copilot-parity), C2. **Every voice/model/style field in Vibefy carries the same
   recommendation affordance, on every screen.**

---

## 12. Music → Marketplace

The most commercially interesting tool screen: a *licensed catalogue* and a *generator* in one place.

| Element | Detail |
|---|---|
| Breadcrumb | `Music › Marketplace` |
| Tabs (left) | `Marketplace` \| `Generations` \| `Saved` |
| Tabs (right) | `Finetunes` \| `Published` — your trained models and your released tracks |
| Category carousel | `Corporate` · `Cinematic` · `Podcast` · `Advertising` · `Education` · `Social` · `Lifestyle` · `Fitness` with a `›` arrow. **Note the taxonomy is by *use case*, not by genre** |
| Facet chips | `Genre` · `Instrument` · `Mood` (each icon-led, each a dropdown) |
| Search | *"Search by title, genre or description"* |
| Filters | `Filters` button for the long tail |

**Catalogue table** — columns `Track` · (waveform) · `Duration` · `BPM`

Each row: a mood emoji + track title in two parts (`Horizon Ascent — Glossy Innovation Showcase`), a
second line with **artist attribution** (`Bright Path`) and descriptor tags
(`Corporate, Advertising Background, Electronic`), a dotted waveform, duration (`30s`), **`BPM`
(`117`, `114`)**, then row actions: **loop/variation**, **download**, **`+` add to project**, `···`
overflow.

**Generation dock**

| Element | Detail |
|---|---|
| Suggestion chips | `Upbeat Pop Anthem` · `Melancholy Piano Ballad` · `Driving Rock Track` |
| Mode row | `♪ Generate` (selected) + two icon modes (extend/cover, and stems/remix) |
| Prompt | free text, being typed |
| Model | `♪ v2` — **outlined in red**, i.e. the pill doubles as a validation/attention state |
| Variants | `2` |
| Duration | `🕐 1:00` |
| Structure | `Auto` |
| Finetune | `No Finetune` — you can generate *through* one of your trained models |
| (trim) | `✂ On` |
| Cost | **`1,800 credits`** with a coin icon — an order of magnitude above sound effects (`68`); the price is honest about how expensive music is |
| Submit | circular `↑` |

**Footer, permanently visible:** *"Built in partnership with artists, labels, and publishers. For
terms and conditions click here."*

**Do not lose:** BPM and duration as first-class sortable columns (a marketer editing to a cut needs
both), artist attribution on every row, use-case categories alongside genre facets, `+ add to
project` straight from the catalogue, and the licensing statement at the point of download. The
licensing line is not decoration — it is what makes the catalogue usable in a paid ad.

---

## 13. Speech to Text → Transcriptions

| Element | Detail |
|---|---|
| Breadcrumb | `Speech to text › Transcriptions` |
| Title + subtitle | *"Transcribe audio and video files with our industry-leading ASR model."* — the model name is a link |
| Action | `Transcribe files` (primary, dark, top-right) |
| Tabs | `Transcriptions` \| **`Speakers`** |
| Promo card | *Try Scribe Realtime v2 — Experience lightning fast transcription with unmatched accuracy, across 92 languages* + `Try the demo` |
| Search | *"Search transcripts…"* — searches **inside transcript text**, not just titles |
| Filter | `+ Created by` |
| Table | `Title` · `Created at` · `···` per row |
| Rows | `Product Launch Presentation` (2 hours ago) · `Quarterly Business Review Meeting` (5 hours ago) · `Customer Interview Session` (yesterday) · `Podcast Episode 42: Future of AI` (3 days ago) · `Team Training Workshop` (last week) — **relative timestamps**, progressive fade at the list edge |

**`Speakers` is the one to notice.** A persistent speaker library — diarised voices recognised across
files — turns transcription from a one-off conversion into an accumulating archive you can query
("everything Sarah said about pricing"). **Do not lose it.**

---

## 14. Dubbing

| Element | Detail |
|---|---|
| Title | `Dubbing` |
| Input card | two stacked icons at left: **upload** and **🌐 globe (import from a URL)** · `Select files` button · *"or drop them here"* |
| Model | `v2` pill (outlined) |
| `Choose languages` | multi-select — one source, many target languages in a single run |
| `Speaker similarity` | option — preserve each original speaker's voice in the dub |
| Submit | circular `↑` |
| `Manual mode` | small link beneath the card, right-aligned — the full transcript/timing editor for when automatic is not good enough |
| Search | *"Search your previous dubs…"* + sort `Newest ⌄` |
| Filter chips | `+ Created by` · `+ Status` · `+ Model` · `+ Source` · `+ Language` — **five facets, the richest filter row in the product** |
| Table | `Name` · `Languages` · `Duration` · `Format` · `···` |
| Rows | `Product Launch Video` (1 hour ago) 🇪🇸 Spanish · 2m · .mp4 · `Customer Testimonial` (3 hours ago) 🇫🇷 French · `Training Tutorial` (6 hours ago) 🇩🇪 German · `Marketing Campaign` (2 days ago) 🇮🇹 Italian · `Educational Content` 🇯🇵 Japanese. Name and relative time stack on two lines; a source-type icon (video frame vs. waveform) leads each row |

**Do not lose:** URL import (a marketer pastes a YouTube link, not a file), one-to-many language
selection in a single job, `Status` as a filter (dubbing is slow — the queue is part of the UI), and
the automatic/manual escape hatch. **Simplify:** `Manual mode` is a tiny grey link for the moment
automatic output is wrong; ours should be offered *at the result*, when the user can see the problem.

---

## 15. Ads Engine  ⭐ *priority for Vibefy*

Found under `··· More tools`. Shown here in its **gated empty state** — there is no self-serve
product behind it, only `Contact Sales`. That is the opening.

**The pitch, verbatim**

> **Welcome to Ads Engine**
> Localize, launch, and optimize your ad creatives across platforms.
>
> 🌐 **Localize your creatives** — Translate and adapt your ad creatives for any market in minutes.
> 🚀 **Launch across platforms** — Push ads to Meta, Google, LinkedIn and more without leaving ElevenLabs.
> ↗ **Optimize performance** — Use insights to find and scale your best-performing ads.
>
> `Contact Sales`

**The artwork is the specification.** A 3×3 grid of the *same* ad creative — a product hero shot with
a headline and a CTA button — rendered in market after market: `Nano Banana 2 is now in ElevenLabs` /
`… ist jetzt in ElevenLabs` / `… est maintenant chez ElevenLabs` / Korean / Japanese, each with its
own translated CTA (`DOWNLOAD FREE NOW` / `JETZT KOSTENLOS DOWNLOADEN` / `TÉLÉCHARGER MAINTENANT`).
Backgrounds change with the market (desert, city, Paris). The top row renders sharp; the rows below
fade — the visual promise is *one creative, N markets, generated*.

**What the loop actually is:** creative → localise (copy + voice + background) → publish to ad
platforms → read performance back → scale the winner. It is a full marketing cycle, not a generator.

### The Vibefy position

Three deliberate differences, and they are the whole product argument:

| | ElevenLabs Ads Engine | Vibefy Ads |
|---|---|---|
| Access | `Contact Sales`, enterprise only | **Self-serve from the first ad.** A one-person business gets the same loop |
| Starting point | You bring a finished creative to localise | **Copilot-led brief.** Answer a few questions about the product, audience and offer; it drafts the creative, the copy, the voice-over and the variants |
| Optimisation | "insights" behind an enterprise contract | **Plain-language read-out** — what is winning, why, and the one change to make next, with a button that makes it |

**Capability checklist for our version (nothing on this list is optional):**

1. **Brief intake** — product, audience, offer, tone, market(s), budget. Copilot-guided, never a bare form.
2. **Creative generation** — image/video + headline + body + CTA, produced as a set, not one at a time.
3. **Voice-over** — reuse our TTS voices, with the same `✨ Recommend` affordance for picking one that fits the market.
4. **Localisation** — copy, voice, on-image text and culturally appropriate backgrounds per market; the source creative stays the master and markets are derived, so a fix to the master re-flows everywhere.
5. **Format matrix** — one creative auto-cut to every placement (feed, story, reel, square, banner) with per-placement safe areas respected.
6. **Variant sets for testing** — n variants with the differing axis named (headline / hook / CTA / voice), so a test is readable.
7. **Platform publishing** — Meta, Google, LinkedIn, TikTok. **Where a connection is not yet built, export a correctly specced package** rather than showing a dead button.
8. **Performance read-back** — spend, impressions, CTR, CPA per variant, with the copilot's plain-language verdict and a one-tap "scale this / kill this / make three more like this".
9. **Compliance sanity check** — platform ad-policy warnings *before* publishing (text-in-image, prohibited claims, disclosure requirements), and our own honest-claims lint applied to generated ad copy.
10. **Brand kit** — logo, palette, fonts, tone-of-voice and mandatory legal lines, applied to every generated creative automatically.

**Copilot obligations here** (on top of C1–C7): propose the media plan, propose the test matrix,
explain each result in one sentence, and always name the next action.

---

## Vibefy-only pillars — these are not in the reference and must not be lost

Everything above is a *reference*. The following are ours, they predate this teardown, and no
simplification pass may quietly drop them. They are listed here precisely so that "we matched the
reference" can never become an excuse for having lost them.

### Collab

Multi-person creative work as a first-class mode, not the "Invite team members" afterthought the
reference relegates to a sidebar card. Requirements to keep in view as the tool screens are
designed:

- Shared workspace scope on **every** tool surface, not just projects.
- Roles and permissions that reach the individual asset and the individual generation.
- Comment / review / approve on a generation, in place.
- Attribution: who generated what, with what settings, at what cost.
- Handover without loss: another person can open a generation and see the full brief, settings and
  history that produced it.
- The shared library and the personal library are distinguishable at a glance.

*(Detailed spec to be linked here — see the open question at the end of this document.)*

### ProBooth

A named Vibefy surface that stays. Same rule: no teardown-driven redesign removes it, and every
cross-cutting decision in this document (copilot parity C1–C7, cost-at-the-point-of-action, plain
language controls, pinned-tool rail) applies to it as it does to any other function.

*(Detailed spec to be linked here — see the open question at the end of this document.)*

**Rule of thumb for both:** when a screen in this teardown has an equivalent in Collab or ProBooth,
the teardown informs the *layout*, never the *scope*. Scope only ever grows.

---

## Open questions

1. **Collab and ProBooth have no written spec in this repository yet.** They are recorded above as
   fixed pillars, but the detail — screens, permissions model, what ProBooth actually does — needs to
   be captured before we design around them.
2. **This repository is `VibefyCode`, the app-rating and verification product.** The surfaces in this
   teardown are a generative-media studio. Confirm whether these become a new area of this product,
   a separate app in `apps/`, or a separate repository, before any implementation begins.
3. **Reuse of ElevenLabs' own templates** — see the licensing note in the accompanying answer; the
   short version is that we can rebuild the *workflows*, not ship their *content*.
