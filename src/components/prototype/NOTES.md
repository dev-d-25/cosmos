# Prototype Notes: Frontend Base Layout

**Question:** What should the new app layout look like with agent-first, shared shell, floating widget?

**Date:** 2026-07-04
**Branch:** `mail-ui-experiment`
**Status:** Prototype ready for review

---

## How to Run

```bash
# Start the dev server (already running in another terminal)
# Then visit:
http://localhost:3000/mail                    # Default layout (no variant)
http://localhost:3000/mail?variant=A          # Variant A: Current layout (baseline)
http://localhost:3000/mail?variant=B          # Variant B: Agent-first shell
http://localhost:3000/mail?variant=C          # Variant C: Daily brief + widget
```

Use the floating bottom bar or arrow keys to switch between variants.

---

## Three Variants

### Variant A — Current Layout (baseline)
- **What it is:** The existing 3-panel mail layout exactly as it is today
- **Tabs:** Mail → Calendar → Agent (old order)
- **Sidebar:** All 14 Gmail labels (Inbox, Starred, Sent, Drafts, Archive, Spam, All Mail, Important, Unread, Social, Updates, Promotions, Forums)
- **No floating widget**
- **Purpose:** Baseline for comparison

### Variant B — Agent-First Shell
- **What it is:** New layout with agent as primary, floating chat widget, repurposed sidebar
- **Tabs:** Agent → Mail → Calendar (new order, Agent first)
- **Sidebar:** Reduced labels (Inbox, Starred, Sent, Drafts, Archive) + Queue (with badge) + Memory + Important + Unread
- **Floating chat widget:** Bottom-right, HubSpot-style, toggleable
- **Quick actions:** "Summarize today", "Draft a reply", "Find important emails", "Show my queue"
- **Removed:** Social, Updates, Promotions, Forums, Spam, All Mail (low-value labels)

### Variant C — Daily Brief + Widget
- **What it is:** Same as B but with a summary panel at the top
- **Daily brief panel:** Shows "Good afternoon, Dev" + 4 cards:
  - 3 unread emails (2 from Naukri, 1 from HR)
  - 2 meetings today (Team standup at 3pm, Code review at 5pm)
  - 3 items in queue (Draft email, Meeting invite, Follow-up)
  - 1 action needed (Reply to project allocation email)
- **Everything else:** Same as Variant B

---

## What We Learned

### Layout Decisions
1. **The 3-panel mail layout is full** — adding another panel cramps the UI. A floating widget is the right approach.
2. **The sidebar can be repurposed** — Social, Updates, Promotions, Forums are low-value. Queue and Memory are higher-value.
3. **Tab order matters** — Agent first signals that the AI is the primary interface.
4. **Daily brief is valuable** — it gives users a reason to open the app even when they don't have specific emails to check.

### Open Questions
1. **Daily brief data source:** Where does the summary data come from? AI generation vs raw API data?
2. **Queue implementation:** How are pending drafts stored? In DB or TanStack Query cache?
3. **Memory schema:** What fields does user memory contain? How is it structured?
4. **Widget state:** Should the widget open/closed state persist across page loads?
5. **Shared layout:** Should we use Next.js route groups (`(app)`) for the shared shell?

---

## Files Changed (PROTOTYPE — delete when done)

```
src/components/prototype/variant-switcher.tsx  — Floating bottom bar for variant switching
src/components/prototype/variant-a.tsx         — Variant A: Current layout (baseline)
src/components/prototype/variant-b.tsx         — Variant B: Agent-first shell + widget
src/components/prototype/variant-c.tsx         — Variant C: Daily brief + widget
src/app/mail/_client.tsx                       — Modified: added variant switching logic
```

---

## Next Steps

1. **Review all 3 variants** in the browser
2. **Pick a winner** (or mix-and-match features from different variants)
3. **Capture the decision** in this NOTES.md
4. **Delete the prototype** and implement the winning variant as the real layout
