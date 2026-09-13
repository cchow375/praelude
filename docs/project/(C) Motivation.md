# Praelude — Motivation

**Last updated: 2026-09-13.** Praelude v11.1.0/schema 21 is shipped/installed on Mac. v11 implements Christian's ranked practice-room direction and v11.1 adds escalating visual/audio practice resonance. Native Studio, retained practice projection and real Score/Variants are verified; Christian's sustained motivation and native audible-quality verdict remain open.

## Who it serves

Christian is the design authority and first user: an NEC-prep pianist practicing an acoustic Steinway baby grand with a MacBook Air. His teacher identifies pulse as his primary weakness. He needs to repeat hard passages, keep tempo and remember what happened while his hands are occupied. The same generic app should let another pianist start with a blank Library and their own PDFs, without Christian's files or copyrighted teaching content.

## The lesson inherited from PianoCoach

The predecessor tried to hear and grade acoustic piano using a laptop microphone. The project's recorded experiments showed 35–52% note accuracy and timing errors in whole seconds. Wrong input produced wrong judgments and unreliable schedules. Four versions accumulated patches around the wrong premise.

Praelude inherits the mission and the lesson, not the old code or UI: **the user is the sensor; the app is the memory.** Christian gives every verdict. The app counts, times, preserves history and runs the metronome. Voice recognition may still miss or misroute spoken commands; those are interaction defects requiring correction and hardware evidence, never grounds to invent a musical judgment.

Rust owns the deterministic practice and metronome work; Tauri/React supplies the desktop interface. An LLM does not sit in the hot loop. The Assistant remains off. Optional Listen Back is for the user's ears and optional loudness metering does not evaluate correctness.

## The motivation pivot: a room that grows with practice

Earlier galaxies were decorative, and the v8 evidence dashboard made progress more legible without satisfying Christian's request for meaningful gamification. The September 7 handwritten brief defines a more concrete reward: build a dream practice room from a sparse room, digital piano and cardboard seat. Progress should be visible in something the pianist owns and improves.

v11 Studio implements that local-first direction. Musical ranks mark commitment, earned coins buy increasingly costly furnishings and room/palette options, and retained evidence explains how each step was earned. Inspiration comes from ranked progression and earned gym-app cosmetics, while the artwork and economics are original to Praelude. The room must make returning to practice appealing; it must never demand attention during a difficult passage.

The reward rules are explicit:

- **1 XP for each 600 focused seconds** in retained practice. The timer is an event-based estimate with idle gaps excluded; merely leaving the app open is not practice.
- **Completed-set milestones within one session:** cumulative totals of 1 XP at 3 sets, 2 at 5, 4 at 7 and 6 at 10. This interprets “sets in a row” as session momentum. Unfinished sets do not count; the milestones do not repeatedly pay or sum to 13 XP.
- **Ten divisions per rank:** Prelude, Etude, Arabesque, Nocturne, Scherzo, Sonata, Rhapsody, Concerto, Cadenza and Opus, followed by continuing Encore ranks. Each division needs 100 XP in Prelude, 150 in Etude, then 50 more per rank, and earns 25 coins.
- **Retained history counts.** Corrections may lower projected XP or available coins; owned items remain. New spending waits until earned coins cover prior spending. Resting a piece preserves its history and progress.
- **No real-money purchases, random rewards or false ability ranking.** The room has 25 initial catalog items and one equipped item per slot. Rank progression continues; further catalog expansion remains future work.

The local name is personalization, not an account. Email/password login, cloud sync, friends, practice presence and leaderboards are still unbuilt because no service is configured. The app does not pretend those features work or collect credentials without a destination.

## What success looks like

Christian opens Score, returns to a meaningful passage, practices with minimal screen friction, and sees his own honest record become a room he wants to build. The app must respect unfinished work, corrections, rest and the difference between repeating something and mastering it. Glass belongs on navigation and controls; music remains clear and readable. Keyboard access, small windows and reduced-motion/transparency preferences are basic practicality.

A second pianist should be able to install the same blank product, add a local PDF and start without an account. Windows remains a separate unsigned candidate with keyboard/mouse scope and pending native acceptance.

Correct math, passing tests and attractive screenshots prove implementation properties. Only Christian's sustained real use can establish whether this room improves motivation or the interface feels professional at the piano. That verdict stays open until he gives it.

## Next steps

Complete the custom-cover picker acceptance, then observe a real practice session, audible reward quality and sustained motivation. Native Score/Variants, Studio/Library/Settings and exact data preservation already pass. Keep accounts, Windows, microphone/Steinway and real-provider mapping as explicit independent acceptance lanes.
