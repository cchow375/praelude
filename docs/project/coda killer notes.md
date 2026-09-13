# ✅ STATUS PASS — checked against the actual v2 build (2026-07-16)

> [!warning] HISTORICAL SNAPSHOT — superseded, kept for the record (banner added 2026-08-20)
> **This note is frozen at 2026-07-16 and every status claim in it is out of date.** It was
> written when the installed app was **v1.3.0** and the newest code was the unshipped v2.0.0
> source. v2.0.0 never installed — it was absorbed into the v3.0.0 frontend rework — and the app
> has shipped many releases since. **Installed current truth: v8.2.0 / schema 20 (2026-08-27),**
> including the completed Aug 8 P3–P6 train, evidence-based Universe and v8.2 UI-cleanse correction.
>
> Do **not** read the ⬜/🟡/🔴 marks below as current. Several things marked NOT BUILT here have
> since been built and shipped (the interactive Universe, auto PDF↔XML measure mapping, the app
> actually being installed); others are still open. For current truth use
> [[(C) CodaKiller Command Center]], [[(C) Roadmap]] and [[(C) Flaws]] — never this file.
>
> Kept because Christian's original July 15 notes are preserved verbatim below, and because the
> honesty of the caveat it opens with is worth keeping.

> **Read this first — the one caveat that governs every checkmark below.**
> Everything marked "built" lives in the **v2.0.0 source code** (the `~/codakiller` git repo),
> where it passed automated + fixture + fresh-adversarial-review gates. **But the app you have
> INSTALLED is still v1.3.0.** v2 is **not packaged, not installed, and never tested at your
> Steinway.** So a ✅ means "the mechanic exists and is proven in code" — **not** "you can open
> the app and use it tonight." Nothing here was *reverted*; the one interrupted overnight Codex
> build was **recovered and finished**, not rolled back.

**Legend**
- ✅ **BUILT (source)** — implemented + tested in v2 code. Not installed / not piano-proven yet.
- 🟡 **PARTIAL** — real progress in source, but a key piece is still missing.
- 🎛️ **DEFERRED (on purpose)** — intentionally held for a session with you at the piano.
- ⬜ **NOT BUILT** — planned only; not started.
- 🔴 **NOT FIXED / still open** — a real gap this build did *not* close (voice-over-piano can't be closed without you playing).

**Bottom line up front:** the **practice-mechanics core you cared most about is done in source**
(reset-on-imperfect, take reps away, 100%-not-50% mastery, "again" resets, undo/restart, recovery).
The **Brain got much better** (concise, remembers, knows where you are). The **20-min routine composer**
exists. The **weak spots are the physical/aesthetic ones**: voice catching "done" over the piano
(🔴 unproven), the interactive/beautiful Universe (⬜), auto PDF↔XML measure mapping (⬜), and the
whole thing actually being *installed* (⬜).

> _(Your original notes are preserved verbatim below. Each `⟶` line is my status annotation.)_

---

jul 15

- implement a lot of the stuff from the boks in the knowledge and resources folder into the mechanics of the app
  - ⟶ 🟡 **PARTIAL (source).** A `Book-to-Mechanic Evidence Catalogue` traces each mechanic to a book passage; a 4-book corpus (Roskell, Gebrian, Breth + newly-added Gieseking/Leimer) is retrievable. The biggest book-driven mechanic — *consecutive-clean mastery + recovery debt* — is built. Full utilization is ongoing.
- there needs to be a thing where if i dont play it 5 times or whatever times perfectly in a row, it resets
  - ⟶ ✅ **BUILT (source) — the headline fix.** Engine runs `PracticeContract::consecutive_clean(N)` (default configurable). A flawed/failed attempt **resets the streak**; mastery requires N *in a row*. Verified in `rep/mod.rs` + property tests.
- i need to be able to take reps away from myself and restart
  - ⟶ ✅ **BUILT (source).** Undo/correct last verdict + restart-set exist as **append-only compensating events** (history corrected, not erased). Proven by rollback/relaunch tests.
- there needs to be some sort of punishment. it cant just be play it right ten times. it needs to be played it right 100% of the time. if i played it right ten times but wrong ten times, it is essentially 50%. it needs to be right 100% of the time. the books have information on that
  - ⟶ ✅ **BUILT (source) — fixes your real data.** Tests prove a 0%-clean *and* a 50%-clean history **cannot** master; only a true consecutive-clean run can. Kills the exact bug in your live DB (a 30-rep block that was 50% clean but showed "done" on total tries). Punishment = reset/step-back/narrow/slow/clean-debt, never shame or fake point loss.
- there needs to be a system to actually make me FOCUS
  - ⟶ ⬜ **NOT BUILT.** The explicit focus loop (intention → short timed set → self-report → break/switch, P5) is designed in the brief but not implemented.
- cant only push repetition it has to also push quality and focus
  - ⟶ 🟡 **PARTIAL.** Quality is now first-class (consecutive-clean beats raw volume). Focus not built.
- THE Ui needs to be much clearer. there is no way to tell if you actually like added a oractice rep to a session because right now after you finish you just click X and there is no indication it was logged
  - ⟶ 🟡 **BUILT (source), not installed.** Every write now produces a durable **save receipt** (success/failure impossible to miss) via a Receipt Center. The "click X, no idea if it saved" gap is closed in v2 code — but you won't see it until v2 installs.
- UI generally needs to be much much cleaner. Id like you to include features from these sites: motion primitives
manus.im
haikei.app
realtimecolors.com


skill ui
impeccable
ui/ux pro max
playright cli

UI verse
animejs
shadcn ui

motion primitives
haikei
componentry
watermelon ui
10x
  - ⟶ 🟡 **PARTIAL (source design language).** New design language folds these in *as ingredients, not templates*: **Manus** = editorial calm/whitespace, **Motion Primitives/Uiverse** = restrained micro-responses, **Haikei** = procedural SVG, **Realtime Colors** = palette discipline. All 5 workspaces render (browser QA, zero console errors). **But:** not installed, and whether it's actually *beautiful* is still your call (native design gates X1–X3 unproven).
- The PDF measure numbers needs to be mapped so i don't have to manually type in the measure numbers and I can just immediately make a selection box to show which section im practicing and then it knows exactly where im gonna practice. this will save os much time from counting what measure numbers and will make it much easier to configure new practice sections
  - ⟶ 🟡 **PARTIAL — the important half is missing.** You *can* now drag a box on the score to create a target draft (Score Atlas, saved transactionally). **But auto-mapping the box to real measure numbers via the XML is NOT done** — the box marks *page geometry*, not understood measures. So drag-to-select exists; "it knows exactly which measures" does not yet.
- overall the system to show what practice has been done EXACTLy must be cleaner. it isn;t optimized for lots of practice sessions and tons of different specific measures and there is no easy way to see what has actually been done. too much scrolling, etc
  - ⟶ 🟡 **PARTIAL (source).** Ledger now exposes exact per-set truth (tries, cleans, current/best streak, accuracy, tempo path, corrections). **But** scaling-to-hundreds-without-scroll (virtualization/filters, flaw B25) is *not* built — the architecture still doesn't scale.
- everything has to be organized in like button styled things so i can click and things will drop down which wil allow for many more sessions
  - ⟶ ⬜ **NOT BUILT.** Disclosure/dropdown/filter organization (H1) is planned only.
- it is really really messy, no organization is present. it needs to be much easier to navigate
  - ⟶ 🟡 **PARTIAL.** A proper 5-workspace shell replaces the old single dashboard, but deep organization/scaling is still open (B25).
- you shouldn't ever have to scroll as much as you need to
  - ⟶ ⬜ **NOT BUILT.** Virtualization/disclosure is planned, not done.
- it needs to be much better with the selection boxes for choosing practice sections. come up with a way more efficient system that makes it quicker for me to log practice sessions
  - ⟶ 🟡 **PARTIAL.** Drag-to-create target draft is built; "quicker & more efficient" not proven natively yet.
- an example is if i am just practicing like a transition where it is just two measures and i am just practicing the two measures cuz im tryna target and fix a specific note, it shouldn;t be that I have to find the measure numbers and type them, i should really quickly just be ale to drag a box over the section on the PDF and add a note if i want and just do it and it knows the general practice section and will add it to that practice section
  - ⟶ 🟡 **PARTIAL (source).** Drag-box → target draft with an optional note, plus a target *hierarchy* (Piece → section → sub-target, nest/overlap) is built. The "it knows the general practice section" auto-placement exists as hierarchy logic; native + exact-measure resolution not proven.
- So it should divide the piece into practice sections and it can have a ton of different sub sections that i create with boxes
  - ⟶ 🟡 **PARTIAL (source).** Nested target hierarchy is built + tested; on-score native interaction is not.
- brainstorm what im really tryignt o achieve because I don;t know how to explain it well
  - ⟶ ✅ **DONE.** That's exactly what the `v2 Transformation Brief` is — your notes synthesized into a 5-system product boundary (Score Atlas, Protocol Engine, Ledger/Composer, two-lane Voice+Brain, earned Universe).
- less input. still there is too much friction to select pracice sections
  - ⟶ 🟡 **PARTIAL.** Addressed in the Atlas design; friction reduction not proven at the piano.
- again, you need to be able to frictionlessly see what you did before. frictionlessly doesn't mean putting everyting on one window. it means not cluttering main screens and putting features behind buttons so you can see different things ond emand
  - ⟶ 🟡 **PARTIAL (source).** The ledger's principle is exactly this (summary rows, detail on demand). The on-demand disclosure UI itself (H1) is still planned.
- the unvierse that you grow needs to be more comprehensive and interactive. practice sessions that have a lot of reps should grow the universe and it should be clear that each thing is being grown to give user more insentive and little side motivation
  - ⟶ 🟡 **PARTIAL (source).** The Universe now derives **honest** growth signals (focused time, active days, coverage, completed mastery contracts, recovery, retention), and the anti-gaming rule ("raw clean-clicks alone can't buy beauty") is shown in the UI. **But** the *interactive* part isn't built.
- the unverse should be beautiful and more interactive and scrollable to see how it works(similar to like how obsidian graphs work)
  - ⟶ ⬜ **NOT BUILT.** The zoom/pan Obsidian-style interactive graph (U1) is planned only; renders static right now.
- efficient way to organize practice sessions
  - ⟶ 🟡 **PARTIAL** (see ledger/scaling notes above).
- you need to be able to edit the titles of everything
  - ⟶ 🟡 **MOSTLY NOT BUILT.** Atlas targets can be retitled in the design, but "edit titles *everywhere* through one canonical record" (H3) is a planned row, not implemented.
- the selection boxes need to be more aesthetic
  - ⟶ 🟡 **PARTIAL.** Tied to the new design language (source); native aesthetic pass unproven.
- you need to be able to choose your previous practice section and continue it just by frictionlessly clicking on the selection box
  - ⟶ 🟡 **PARTIAL (source).** "Selecting an existing target exposes **Resume** as the primary action" is designed and in the model; the frictionless on-score click isn't natively proven.
- there needs to be a way to organize
  - ⟶ 🟡 **PARTIAL** (same organization thread).
- I need to be able to annotate the PDF and add notes on what to focus on
  - ⟶ 🟡 **BUILT but approximate.** Boxes/highlights/text notes can be placed over a page and moved/resized/recolored/deleted (since v0.3.0). Honest limit (B10): they mark *page geometry*, not auto-understood measures, and don't rewrite the source PDF. Needs at-piano validation.
- voice recognition needs to be much improved. it is missing a lot when i say "done" maybe because it is not hearing me over the piano
  - ⟶ 🔴 **NOT FIXED — and this can't be fixed from a desk.** The full narrated corpus (1,309 segments) proves the firewall never *false-fires* on ambient talk. But your actual complaint — **missing a real "done" over the Steinway** (a false *negative*) — is the explicitly unproven risk (B24/V4). It needs you playing over the real piano; no automated gate can close it. Honestly: still open.
- sloppy reps and again should honetsly, maybe if its again, reset the counter again.
  - ⟶ ✅ **BUILT (source).** "again" resets the clean streak — proven in the narrated replay (a spoken "again" correctly drops the streak).
- the most important thing is to implement all the knoiwledge and practice mechanics into the app from the knowledge and resources book. carefully parse it and see crucial mechanics and implement them(ex. if you get it wrong, you need to ensure you play it a certain amount of times)
  - ⟶ 🟡 **PARTIAL, core done (source).** Your exact example — get it wrong → owe more clean reps — is built as **recovery debt / streak reset**. Broader book-mechanic coverage is catalogued and ongoing.
- the brain needs to be a lot lot better when i ask questions. right now it makes me scroll through a ton of info instead of giving. me the correct answer and it also does'nt use it's knowledge of the XML AND the sources. i should be able to tell it the measure i am having trouble with, my problem, and it should be able to lok at the XML, see what notes im talking about, see my problem, and go thoruhg the resources and see exactly what will help. it should also have memory to know what I asked and be able to chat back and forth
  - ⟶ 🟡 **LARGELY BUILT (source).** The Brain now: answers **one-glance** by default; **remembers per-piece conversation across relaunch** (back-and-forth chat); and joins **selected measures + MusicXML + the book corpus + your retention/ledger state**. Real improvement. Caveats: not installed, and it still can't *prove* it interpreted a passage correctly (grounding reduces error, doesn't make prose true — B12).
- answers should be consice and not full of words - directly to the point because pianists are on time rush and they need immediate answers
  - ⟶ ✅ **BUILT (source).** One-glance (1–2 sentence) default is the shared policy across both the Claude and Gemini paths, expanding only when a drill needs exact reps/tempo.
- AI should have a very efficient way of diagnosing problems only using the knowledge and resources books and sources
  - ⟶ 🟡 **PARTIAL (source).** Retrieval is grounded to the 4-book corpus + your score/history; citations allowlisted; uncited answers fall back. But retrieval is lexical (not embeddings) and diagnosis quality is heuristic, not guaranteed.
- this is also important: i should be able to start new practice sections and sessions just by voice. This is where a truly good voice model is absolutely crucial. I should be able to say "I want to play measure 492- 512 starting at tempo 50 and get to 64 ish and im gonna play it 15 times and speed it up or whatever" and it should be able to start a practice section without me having to manually input the exact numbers
  - ⟶ ⬜ **NOT BUILT (deferred).** The natural-language range/tempo/reps parser (V2) is planned. The wake-cue voice "first cut" that shipped in source only does 4 things (record clean / set metronome / undo / restart) — **not** creating a section from a spoken range. Next voice slice.
- the ai should also be able to organize everything perfectly as well by recognizing exactly WHERE i am practicing and addint it and organizing it
  - ⟶ ⬜ **NOT BUILT.** Depends on the same V2 natural-language layer.
- it should be able to organize and reflect my practice sessions and add onto the general progress log and stuff of what has been accomplished
  - ⟶ ⬜ **NOT BUILT (deferred).** Text/voice updating a piece's state + Markdown history is designed (as a ledger projection) but not implemented.
- needs to be way more visually appealing(see the sources above for motion inspo and HUD inspo)
  - ⟶ 🟡 **PARTIAL (source).** New design language + micro-motion in code; not installed, aesthetic pass still yours.
- organization is absolutely crucial for this
  - ⟶ 🟡 **PARTIAL** (organization thread, B25 still open).
- PDF measure numbers need to be perfectly mapped and synced to the XML for fritnionless AI interaction brain
  - ⟶ ⬜ **NOT DONE.** This specific ask — perfect PDF↔XML measure sync — is *not* solved (S2 planned; B10 confirms PDF marks are still geometry, per-edition, manual). One of the harder open items.
- the AI brain shouldn't rely on cloud though, a very very fine tuned specialized memory RAG LLM should also be able to answer questions on demand. this one should heavily rely on the knowledge given so that it doesn't make stupid mistakes  and use its stupidity. it should be like a very sophisticated search librarian, not the actual brain itself
  - ⟶ 🟡 **PARTIAL (source).** The "librarian" framing is exactly the design: local retrieval + structured memory + templates as the offline baseline. Honest constraint: on your 8GB Mac there's **no always-resident local LLM** — a small external model handles parsing, deeper questions route out. So "doesn't rely on cloud" is only partly true: retrieval is local, generation still calls out.
- the AI brain needs to also have full control over the user's ecosystem so it can complete tasks like "wait i messed that up, i keep getting this wrong, im just gonna do the elft hand so pause the other session or restart it and make a new session for just practicing mny right hand on these two notes on ex measure to ex measure" and iut should be able to handle tasks like that verbally
  - ⟶ 🟡 **FIRST CUT ONLY (source).** Tool authority exists as a **confirm-gated** wake-cue path — but only 4 narrow actions so far. The complex verbal orchestration ("pause that, make a new RH-only session on mm.X–Y") is **not** built (B4). Deliberately confirm-first so the model is never in the instant loop.
- this is where a highly effective voice recognition model is needed to understand exactly when i am done with a rep by voice and be able to also add new practice sessions, sections, add notes
  - ⟶ 🔴 / ⬜ **NOT FIXED.** Same physical "done over piano" gap (unproven) + voice-driven add-session/section/note (not built).
- full back and forth interactiveness is the key though - i should be able to correct it immediately
  - ⟶ 🟡 **PARTIAL.** Brain back-and-forth memory is built; correcting a *voice action* rides a confirm card whose hands-free FEEL is deliberately deferred to a piano session with you.
- gemini or Local is good or any other API key but it shouldn't use a model that will be overkill, . recognize the scope of the requests and if it really is simple and doesn't need to much thinking and just has to reference it's own data, maybe it can be a smaller model that is much quicker
  - ⟶ 🟡 **PARTIAL (source).** Provider policy routes narrow parsing to a small/fast model and only escalates deeper questions — matches your right-sizing ask. Not tuned/measured live.
- the voice model should also probably become AI but it needs to be very very consice. i like how right now it just explicitely says "metronome to x tempo" or "this out of this masny reps". it should honestly stay that consice so fine tuning is neccessary for that and then obviously i should just be able to activate it and ask additional questions like "i keep messing this note up and im afraid im gonna reinforce a bad habit" and it should be able to diagnose it by cross refereicn ght XML and the books and then telling me maybe what is wrong
  - ⟶ 🟡 **PARTIAL (source).** The terse deterministic voice ("metronome to X", "N of M") is preserved; the Brain is concise and cross-references XML+books. The always-terse *AI* voice + at-piano diagnosis loop isn't fully wired/tuned.
- thisbrain thing should be implemented into like a chat bot on the side that i can quickly open that shows the transcripts so maybe i can also type to it and it can respond with text instead but there needs to be an efficient system that is quick and error proof for activating the brain and understanding what is actually going on. it is getting closer to what my original pianocoach app was trynt to achieve but still, i don't want it to listen to anything yet because the system isn't slphisticated enough
  - ⟶ 🟡 **PARTIAL (source).** A Brain workspace/drawer exists — typed Q&A, transcripts, per-piece memory, wake-cue ("Coda, …") activation. And it still does **not** ambiently listen (by design — matches "don't want it listening yet").
- again, this must be flawless
  - ⟶ _(aspiration, not a checkable item.)_
- sophisticated understanding in technique is very important for the brain and making sure it understands how the hand works through the knowledge and library stuff
  - ⟶ 🟡 **PARTIAL / mostly deferred.** Book grounding helps, but a real technique/fingering understanding engine is deferred; the Brain cannot infer physical cause from notation (B12).
- look at old pianocoach docs i made earlier to take inspiration from some of the older ideas i TRIEd to achieve with that old app but obviously improve it tenfold
  - ⟶ ✅ **DONE.** The whole project is framed as PianoCoach's successor — it inherits the *lessons* (mic can't grade an acoustic piano → stop grading, start tracking) with zero shared code/UI.
- biggest emphasis is ensuring that knowledge and library resources books are fully utilized to every little text so maybe making a very efficient system and extracting crucial information and storing it in a library for quick diagnosis, ensuring the grounding and emphasis are on the notes
  - ⟶ 🟡 **PARTIAL (source).** 4-book corpus indexed + retrievable + the Book-to-Mechanic catalogue. Honest limit: lexical retrieval, capped hits — "every little text" is not literally guaranteed.
- for me right now specifically, a lot of my problems are stemming from practicing something a lot and getting it to a tempo, and then coming back the next day and i lost my progress because maybe i didn't do anything to fortify it
  - ⟶ 🟡 **DESIGNED + partly wired, NOT a working feature yet.** Retention is first-class (a tempo reached once = a historical peak, not permanent mastery), and the Brain now *sees* what's due for review. **But** the actual next-day retention check flow (confirm / lower / reopen a target — P6) is a *planned* row, not built. Your exact pain point is understood but not yet solved end-to-end.
- structure is key, organization is key
  - ⟶ 🟡 **PARTIAL** (organization is still the weakest built area).
- the universe looks ugly as shit right now it needs to be way more aesthetic. picture an end result. it should look absolutely fascinating. when a piece is performance ready and stated from zero, literally it should be like a full galaxy with tons of different stars and system seach representing reps, days, sessions I had and it should be fully fully packed. and i should be able to zoom in and interact with this stuff as well. colorful, beautiful. use UI inspo. this is for when i have practiced pieces for a while though and it needs to be deserved
  - ⟶ 🟡 / ⬜ **PARTIAL.** The **"deserved/earned"** logic is built (growth only from real signals, anti-gaming enforced). The **beautiful, zoomable, colorful interactive galaxy** is **not** built — it still renders static. So: earned ✅, gorgeous+interactive ⬜.
- but motivation mechanics from the books are also important and it is crucial you implement the practice mechaniocs and motivation mechanics into how the app works as well
  - ⟶ 🟡 **PARTIAL.** Practice mechanics: largely built (source). Motivation mechanics: mostly still design (Motivation doc + earned-universe signals), not a felt in-app system yet.
- honestly it should spike a ton of dopamine even more than you would without using an app. there should be a reason to keep going even if the pianist is getting bored
  - ⟶ ⬜ **NOT BUILT.** The dopamine payoff lives in the interactive Universe, which isn't built.
- progress per session needs to be measured in a visual and tangible way(maybe for each practice session you grow a mini star that gets added, and if the session was a good one with actual good reps, lots of success, it grows into a beautiful system but if it was clearly a bad session with lots of bad reps maybe it becomes a darker less aesthetic system)
  - ⟶ 🟡 **PARTIAL (source).** Growth-reflects-quality is built as *logic* (good vs. weak sessions grow differently, honestly). The literal per-session "mini star grows into a system" visual isn't built.
- but there has to be a way to also fit in quick sessions. if i have 20 minutes to practice or something, it should be able to give me a full routine based on the state of the piece and tell me generally what to do and i should be able to modify and edit everyting with the clean UI
  - ⟶ ✅ **BUILT (source).** The **Session Composer** is mounted in the Today view: it proposes a small editable routine from due retention / goals / unresolved targets / available time; you edit it; **Start** is the only write (receipted). Exactly this ask.
- use plugins accordingly
  - ⟶ ✅ **(process).** Built subagent-driven with per-task fresh-context adversarial verifier gates — the process that caught real bugs (e.g. a mastered set being flipped back to active).
- use the same test recordings from my old practice sessions to see if they generally match it and see if the app would have helped me get more done more efficiently
  - ⟶ 🟡 **PARTIAL — used, but for a different question.** All 4 of your narrated recordings (1,309 segments) are now regression fixtures. **They prove the voice firewall (zero false mutations over 91 min of real talk).** They do **not** yet answer "would the app have helped me get more done" — that counterfactual-value analysis wasn't done.
- for starting pieces or for any pieces i should always be able to tell the engine the state of the piece through just text or talking "this section is bad, i can play this section ok, i have trouble finding notes, i need it ready by this time" and it should be able to adust the MD document of that piece's history immediately(old piano coach but way better)
  - ⟶ ⬜ **NOT BUILT (deferred).** Text/voice-to-state + immediate Markdown history update is designed as a ledger projection, not implemented.
- the UI buttons need to feel way more interactive and have way more flow as well
  - ⟶ 🟡 **PARTIAL (source).** Physical micro-response motion is in the design language + code; not installed, feel unproven.
- I don't like the UI feel right now. :**"Act as a master UI/UX designer. Build a high-fidelity interface that avoids all 'generic AI' aesthetics. Strictly adhere to these design laws:**

1. **Typography:** Use a high-personality, non-standard typeface (e.g., editorial serif or structured industrial monospace). Do NOT use Inter, Roboto, Arial, or Space Grotesk.
    
2. **Color:** Use a 'Cloud Dancer' off-white base. Avoid all violet/purple gradients. Use only one high-saturation, intentional accent color (e.g., deep terracotta or industrial green) for primary actions.
    
3. **Layout:** Abandon the '3-card' symmetry. Use a complex, asymmetrical grid. Prioritize dynamic negative space, overlapping elements, and broken-out typography.
    
4. **Tactile UI:** No generic glowing light effects or thin border-only components. Components must feel like physical, matte-textured artifacts. Every hover state must feel like a deliberate physical interaction (e.g., subtle Z-index changes or color-fill shifts).
    
5. **Motion:** Eliminate constant looping animations. Implement one singular, elegant, staggered reveal on page load. All other interactions should be micro-responses, fast and functional, with an 'eased-out' human-tempo curve.
    

**Goal:** Create a UI that feels like it was meticulously hand-crafted by a human, prioritizing readability, physical presence, and unconventional structure over algorithmic efficiency."

  - ⟶ 🟡 **ADOPTED IN SOURCE — matches your laws almost verbatim.** The v2 interface language is: **Cloud Dancer off-white + ink black + one deep terracotta accent** (no violet), **editorial serif display + structured mono** (never Inter/Roboto/Arial/Space Grotesk), **asymmetrical editorial layout** (no 3-card symmetry), **matte tactile surfaces** (no glassmorphism/glow), **one staggered entrance + fast micro-responses, no ambient loops**. Renders across all 5 workspaces in browser QA. **Still:** not installed, native design gates (X1–X3) unproven, and whether it truly clears the apple.com-grade bar is your call.


ensure the Ui is perfect. theme should be mainly just black and white honetsly and then the universe and other things can be the animated colored elements. everything should be animated.
  - ⟶ 🟡 **MOSTLY MATCHES (source).** The theme is deliberately near-monochrome (off-white/ink) with color reserved for **score marks + the Universe** — exactly your black-and-white-with-colored-universe ask. One honest divergence: **not** "everything animated" — the design intentionally avoids constant looping animation (motion = one entrance + fast micro-responses), because ambient loops read as AI-slop. If you truly want more motion, that's a dial we set together.

---

### Blunt summary

- **Genuinely handled (v2 source, gated):** the practice-truth core (reset-on-imperfect, 100%-not-50% mastery, undo/take-away/restart, "again" resets, recovery debt), a concise Brain with memory + score/book/ledger context, the 20-minute routine composer, save receipts, and a design language that matches your UI laws.
- **Still open / weak:** voice catching "done" over the piano (🔴 unprovable from a desk), the beautiful interactive Universe (⬜), auto PDF↔XML measure mapping (⬜), organization-at-scale/no-scroll (⬜), the next-day retention flow (🟡 designed not built), and natural-language "start a section by voice" (⬜/deferred).
- **Gating reality:** none of the good stuff is installed. Next milestone = **package v2, migrate your live schema-7 data safely, install it, then a piano session** to tune voice + judge the aesthetics. Until then every ✅ is "proven in code," not "in your hands."
