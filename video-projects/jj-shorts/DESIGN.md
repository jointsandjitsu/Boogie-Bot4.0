# Joints & Jitsu — Brand Design Spec
> Reference this every time you build or modify a J&J composition.

---

## 1. Brand Identity

**Brand:** Joints & Jitsu | **Handle:** @jointsandjitsu
**Tagline:** *Roll Hard. Smoke Smart.*
**Audience:** BJJ practitioners, cannabis culture, combat sports fans, 18–35
**Tone:** Fun, irreverent, authentic, high-energy. Never corporate, never preachy.

---

## 2. Color System

| Token | Hex | Usage |
|---|---|---|
| `--jj-bg` | `#0a0a0f` | Canvas background |
| `--jj-accent` | `#00ffcc` | Primary — headlines, glows, brand badge |
| `--jj-accent2` | `#ff6b35` | Secondary — CTAs, energy beats |
| `--jj-green` | `#39d353` | Tertiary — cannabis accent, use sparingly |
| `--jj-text` | `#e0e0f0` | Body copy, captions |
| `--jj-muted` | `#6b6b8a` | Secondary labels |

**Rules:** One dominant accent per scene. Never two saturated colors side-by-side. Orange for action/CTA only.

---

## 3. Typography

| Role | Font | Size (1080×1920) | Weight |
|---|---|---|---|
| Hook / hero headline | `--jj-font-display` (Impact) | 96–120px | 900 |
| Body headline | Impact | 72–88px | 900 |
| Caption / karaoke | Courier New | 48–56px | 700 |
| Brand badge | Impact | 36–40px, letter-spacing 4px | 900 |

**Rules:** Uppercase for display. Max 18 chars/line at 96px. Glow on accent-colored text. Min weight 600.

---

## 4. Motion Principles

- Scene transitions: 0.3s cut or 0.4s fade. No slow dissolves.
- Hook: 0.4–0.5s scale(0.95→1) + opacity reveal.
- Text pops: 0.25s ease-out.
- CTA: 0.5s slide-up from y:40 with glow bloom.
- Background stays still. One element moves at a time. Exit before enter.

---

## 5. Layout (1080 × 1920)

```
y:0     Status bar (80px)
y:80    Brand badge
y:160   ── content safe zone top ──
        SCENE CONTENT
y:1560  ── caption bar ──
y:1700  Handle / CTA
y:1840  Home indicator
y:1920
```

---

## 6. What NOT to Do

- ❌ White or light backgrounds
- ❌ More than 2 accent colors simultaneously
- ❌ Slow dissolves (>0.5s)
- ❌ Animating width/height/top/left on `<video>` (wrap in div)
- ❌ Text disappearing in under 1.5s
- ❌ Hashtags or handles during the hook
