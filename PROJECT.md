# RallyScore — Project Plan

Volleyball-first scoreboard ecosystem built as two products: a free universal scorekeeper for the App Store, and a Pro subscription that broadcasts live video and stats to family members.

---

## Files in this folder

| File | What it is | Open with |
|---|---|---|
| `index.html` | Project hub — entry point linking the three demos | Browser |
| `rallyscore-lite.html` | Universal multi-sport scoreboard, free with ads + IAP | Mobile browser |
| `rallyscore-demo.html` | Pro fan companion — live scoreboard, team page, season stats | Mobile browser |
| `rallyscore-pro-live.html` | Pro live broadcast viewer with real device camera | Mobile browser (with camera) |
| `rallyscore-pro-broadcaster.html` | Pro broadcaster (scorer side) — setup, camera, scoring controls | Mobile browser (with camera) |
| `PROJECT.md` | This file — plan and roadmap | Any text editor |

All HTML files are self-contained, mobile-first, and require no backend. They can be hosted on Vercel/Netlify by dragging the folder into their web UI.

---

## Strategic positioning

Volleyball is a massive but digitally underserved sport. Existing tools (DataVolley, MaxPreps) target coaches, not parents and fans. The opportunity is the **family layer** — parents will pay almost anything to follow their kid playing.

The product split solves the classic startup tension between **distribution and monetization**:

- **Lite** is the top of the funnel — App Store volume, ad revenue, brand familiarity
- **Pro** is the monetization engine — recurring subscriptions, clubs as B2B anchors

Conversion funnel target: 4-7% of Lite active users upgrade to Pro within 60 days of first use.

---

## Product 1 — RallyScore Lite

**What it is:** universal scoreboard for any phone or tablet. Volleyball, basketball and soccer in a single tap. Works fully offline. Built for refs, coaches, parents and casual scorekeepers.

**Key features (built in prototype):**

- Sport selector with auto-reconfigured controls
- Volleyball: best of 3, sets to 25, 2-point lead, set 3 to 15, auto-advance
- Basketball: 4 quarters, +1/+2/+3 buttons, 10-minute countdown clock
- Soccer: 2 halves, +1 goal, 45-minute count-up clock
- Editable team names, undo, swap sides, reset
- Match-winner overlay with replay action
- Banner ads (rotating mock) + $1.99 IAP to remove
- "Go Live with Pro" upgrade CTA at the bottom

**Pricing:** Free with banner ads. **$1.99** one-time IAP removes ads.

**Distribution:** Apple App Store + Google Play. Wrap the HTML in Capacitor or React Native to ship native binaries.

**Goal first 30 days:** 1,000 downloads, 50 IAPs, 4.6+ star rating.

---

## Product 2 — RallyScore Pro

**What it is:** the connected version. The club's scorer keeps score during the match, and family members watch live from anywhere with notifications, video and auto-clipped highlights.

### Three interfaces (three prototypes)

**Fan companion (`rallyscore-demo.html`)**
The fan experience without video — live scoreboard with simulation, team page (roster, schedule, results), followed-player feed with notifications, season highlights, league standings, premium plan upsell.

**Live broadcast viewer (`rallyscore-pro-live.html`)**
The killer feature on the family side. Real device camera serves as the demo's live source. Floating scoreboard overlay on top of video, network quality indicator, 5 cheer reactions with floating emojis, ambient cheer simulation, family chat with mock parents, auto-generated highlights timeline, COPPA-compliant verified family member badge.

**Broadcaster / Scorer (`rallyscore-pro-broadcaster.html`)**
The other end of the live stream — the iPhone-on-tripod app for the club's scorer. Setup screen with team names, sport selector, best-of-3/5 format and pre-flight checklist (camera angle, lighting, battery, network). 3-2-1-LIVE countdown transition. Live screen with compact camera preview, REC indicator, viewer counter, set indicator, two team panels with massive +1 buttons, player attribution chips for the home team, undo, swap, force-end-set, and match-end summary with auto-clip count.

### Pricing tiers

| Tier | Price | Audience |
|---|---|---|
| Family | $4.99/month or $39.99/year | Parents and family of one player |
| Club | $30-80/month | Schools, leagues and volleyball clubs |
| Sponsor placements | $50-300/season | Local businesses on club's broadcast |

7-day free trial on Family tier.

### Distribution

- Web/PWA first (no App Store delays)
- Apple App Store + Google Play after Month 3
- Direct sales to clubs (B2B is faster cash than D2C)

---

## Live video architecture

**Decisions confirmed in design:**

- Privacy: only families approved by the club (COPPA/GDPR-K compliant for minors)
- Latency: standard 5-15s HLS (good enough for amateur sports, ~10x cheaper than WebRTC)
- Demo: real device camera for maximum impact in client meetings

**Production stack recommendation:**

| Layer | Choice | Why |
|---|---|---|
| Mobile capture (broadcaster) | `getUserMedia` + `MediaRecorder` → RTMPS | Native, no SDK |
| Live ingest + transcoding | AWS IVS Real-Time or Mux Live | RTMPS in, HLS out, auto-scale |
| Playback (viewer) | hls.js + native HTML5 video | Works on iOS Safari & Chrome |
| Auth | JWT signed by backend, validated by CDN | Keeps stream private |
| Storage / VOD | Same provider's recording feature | For highlight clips |

**Cost estimate per match (90 minutes, 30 viewers):**

- IVS Real-Time encoding: ~$0.20 per hour-viewer
- IVS playback: ~$0.005 per minute-viewer
- Total: **~$3-5 per match**

If a club pays $50/month and plays 4 matches, ~$30-35 margin remains for backend, CDN, support and engineering.

---

## 90-day roadmap

### Month 1 — Lite live on the stores
- Wrap `rallyscore-lite.html` in Capacitor (2 weeks)
- Add real Settings screen, clock customization, exportable match summary
- Apple Developer account ($99/yr) and Google Play ($25 once)
- Submit for review (Apple usually 24-48h)
- **Goal:** 1,000 downloads, 4.5+ star rating, 50 paying IAPs ($100 in revenue)

### Month 2 — Pro MVP backend
- Firebase Realtime DB or Supabase for live score sync
- AWS IVS Real-Time for video pipeline
- Closed beta with 3-5 pilot clubs (free during pilot)
- Web/PWA shell hosted on Vercel
- Pre-flight checklist UI for the broadcaster (camera angle, lighting)
- **Goal:** 100 active beta users, 5 piloted matches end-to-end

### Month 3 — Pro public launch
- App Store submission for Pro (subscription configured in App Store Connect)
- $4.99/mo, $39.99/yr, 7-day free trial
- Auto-clip engine v1 — slice 8-12 seconds around each scored point
- In-app referrals: Lite users see "Your team is on Pro — try free for 7 days"
- First B2B sales push: 20 club outreach emails per week
- **Goal:** 50 paying families ($250 MRR) + 5 paying clubs ($300 MRR) = ~$550 MRR

---

## Risks to watch

**Apple's review** is strict with apps that look like demos. Lite needs real settings (clock duration, custom rules, PDF export) before submission, otherwise it gets rejected as "thin content."

**Privacy and minors.** Live video of underage players is a legal minefield. COPPA in the US, GDPR-K in Europe, plus state-level rules in some places. Always require club approval and parental consent. The verified family member badge in the live viewer is the visual proof you need to show coordinators.

**Bandwidth costs spike.** A viral match with 500 concurrent viewers can blow a month's budget. Cap concurrent viewers per match in the Family tier (e.g., 50), upgrade Club tier to allow more.

**Ads degrading rating.** Start with one banner only, no interstitials. Test the IAP funnel carefully before adding more ad placements.

**Cannibalization.** If Lite is too good, no one upgrades to Pro. Keep features focused: Lite is "score this match alone," Pro is "share this match with family."

---

## Things still to build

- Real backend (Firebase or Supabase + IVS/Mux) for the connected stack
- Auto-clip engine (background job that listens to score events and slices video)
- Club admin dashboard — manage approved family list, team roster, season schedule
- Soccer sport: review UX (buttons, swipe gestures) to match volleyball/basketball patterns
- Swipe-left gesture for volleyball (currently implemented for basketball, could extend)
- Settings screen (clock duration, custom rules, PDF export) — required for App Store

---

## Session log — 2026-05-31

### Cambios realizados en `rallyscore-lite.html`

#### Layout general
- Panels de equipos ahora en grid lado a lado (`grid-template-columns: 1fr 2px 1fr`)
- Números del marcador llenan la pantalla con `font-size: min(32vw, 50vh)`

#### Basketball — display LED 7 segmentos
- Cargada la fuente **DSEG7-Classic** desde CDN: `https://cdn.jsdelivr.net/npm/dseg@0.46.0/css/dseg.min.css`
- ⚠️ Nombre correcto de la fuente usa guiones: `'DSEG7-Classic'` (NO espacios)
- Dígitos siempre dobles: `padStart(2, '0')` en `renderScores()`
- Color rojo para Home, azul para Away con glow effect (`text-shadow`)
- Fondo oscuro `#111115` para ambos paneles en basketball
- Tamaño final: `clamp(60px, 21vw, 128px)`
- Botón −1 oculto en basketball; se usa Undo en su lugar

#### Volleyball — UX limpia sin botones
- Eliminados los botones +1 de la vista de volleyball (CSS `display: none`)
- Eliminado el botón −1 de volleyball
- **Toque en el panel** → suma 1 punto al equipo correspondiente
- **Swipe izquierda en el panel** → resta 1 punto (basketball; fácilmente extensible a volleyball)

#### Gestos táctiles implementados
```javascript
// touchstart / touchend en cada panel de equipo
// Swipe izquierda (dx < -50, |dy| < 60) → subtractPoint (basketball)
// Tap (|dx| < 20, |dy| < 20)            → addPoints +1 (volleyball)
```

### Pendiente para próxima sesión
- [ ] Limpiar código muerto: constante `_S7` y función `seg7SVG()` que quedaron en el archivo
- [ ] Revisar gestos en Soccer (actualmente sin botones ni gestos especiales)
- [ ] Considerar swipe-izquierda para restar en volleyball también
- [ ] Ajustar tamaño de números si se prueba en dispositivo físico
- [ ] Agregar feedback visual/haptic al tocar el panel de volleyball