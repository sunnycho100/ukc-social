---
target: 일정 (schedule tab)
total_score: 24
p0_count: 0
p1_count: 2
timestamp: 2026-08-04T05-05-51Z
slug: app-tabs-schedule-page-tsx
---
⚠️ DEGRADED: single-context (no sub-agent tool exposed; Agent tool disabled by user config)

Target: app/(tabs)/schedule/page.tsx + components/ScheduleDayView.tsx

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | No "now" anchor on the page; data-current only fires during a live session |
| 2 | Match System / Real World | 3 | Agenda reads naturally; day chips are the right metaphor |
| 3 | User Control and Freedom | 3 | Jump to any day, no trapped state |
| 4 | Consistency and Standards | 2 | tablist without panels or roving tabindex; 홈 uses a wordmark where every other tab used a kicker |
| 5 | Error Prevention | 3 | n/a for a read-only surface |
| 6 | Recognition Rather Than Recall | 3 | All days visible at once |
| 7 | Flexibility and Efficiency | 1 | Three tab stops, no arrow-key navigation on a tablist |
| 8 | Aesthetic and Minimalist Design | 2 | Conference name printed twice on screen simultaneously |
| 9 | Error Recovery | 3 | Empty-schedule state handled and well worded |
| 10 | Help and Documentation | 2 | title= tooltip is the only overflow affordance, unreachable on touch |
| **Total** | | **24/40** | Acceptable |

## Anti-Patterns Verdict

Deterministic scan: detect.mjs returned [] (exit 0) on both files. Clean.

LLM assessment: the detector cannot see the app-wide pattern. `.page-kicker` is a 12px
uppercase 0.08em-tracked accent eyebrow rendered on six surfaces, always printing the
same conference name. That is the "tiny uppercase tracked eyebrow above every section"
ban, and it duplicates the sticky day bar directly above it.

## Priority Issues

- [P1] Conference name on screen twice at once (sticky bar + kicker). FIXED, PR #33.
- [P1] tablist announced but not wired: 3 tabs, 0 tabpanels, no aria-controls,
  tabIndex [0,0,0]. FIXED, PR #32.
- [P2] The page never establishes when "now" is. Before the conference starts no chip is
  marked today and no row is current. OPEN.
- [P2] Clamped titles are only recoverable via title= tooltip, which does not exist on
  touch. OPEN.
- [P3] With three days the chip row is stranded in the left third of a wide column. OPEN.

## Persona Red Flags

Sam (accessibility): the tablist defect above; one tab stop per conference day.
Casey (mobile): truncated titles unrecoverable without hover.

## Questions to Consider

- Should the agenda mark "now" before the conference starts, or is the D-N bar enough?
- Do the day chips want to fill the column at desktop width, or stay compact left?
