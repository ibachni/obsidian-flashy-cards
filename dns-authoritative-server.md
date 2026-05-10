---
type: flashcard
topic: dns
section: foundations
created: 2026-04-27
modified: 2026-04-28
fsrs_due: 2026-04-28
fsrs_stability: 1.2931
fsrs_difficulty: 5.11217071
fsrs_elapsed_days: 0
fsrs_scheduled_days: 0
fsrs_reps: 1
fsrs_lapses: 0
fsrs_state: learning
fsrs_last_review: 2026-04-28T09:55:47.748Z
tags:
  - flashcard
  - dns
  - authoritative
related: []
fsrs_learning_steps: 0
---
# Question

What is an authoritative DNS server?

# Answer
- A server that gives the **official answer** for a zone.
- e.g. if Cloudflare hosts the `example.com` zone, Cloudflare's nameservers are authoritative for that zone.
- Contrast with a *recursive resolver*, which looks answers up on behalf of clients but doesn't own them.
