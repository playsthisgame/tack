# Context-Aware Routing & Compaction Advisor

## Why

Tack routes per prompt based on complexity, but a prompt's complexity and its
context size are independent. A simple prompt ("fix this typo") riding on a large
accumulated conversation cannot actually run on a cheap-tier model if that model's
context window is smaller than the conversation. Two problems follow:

1. **Correctness:** routing a large context to a model that can't hold it fails or
   silently truncates. Routing must never send more tokens than the chosen model's
   window allows.
2. **Economics:** when context size repeatedly forces simple prompts up to a more
   expensive tier, the user is overpaying — and has no visibility into why or what
   to do about it.

This change makes context-window size a hard routing constraint, and adds a
passive advisor that surfaces when compacting the conversation would unlock cheaper
routing — leaving the decision and the action with the user.

## What Changes

- The scorer's complexity result becomes a *preferred* tier. A new feasibility
  step may escalate the tier so the chosen model's context window can hold the
  full measured context (plus response headroom).
- Each tier model gains a configured context-window size and a response-headroom
  reserve.
- Routing decisions record when and why an escalation occurred, as an inspectable
  contribution ("escalated: context 150k exceeds cheap window 128k").
- Per session, Tack tracks how often a prompt's preferred tier was overridden
  solely due to context size, and the estimated extra cost incurred.
- When that crosses a threshold, the client surfaces a dismissible advisory that
  compacting could restore cheaper routing, with an estimated saving.
- When the context exceeds *every* tier model's window, routing cannot proceed at
  all. Tack surfaces this as a **blocking** advisory requiring user action
  (compaction), distinct from the cost-saving advisory. Performing the compaction
  remains out of scope; this change only detects and reports the condition.

## Out of Scope

- **Automatic compaction.** Compaction is lossy; Tack must never summarize or drop
  context on its own to save money. This change only *advises*. Performing a
  compaction (even user-initiated) is a separate future change. This holds even in
  the blocking case where no model can hold the context: Tack reports that
  compaction is required, but does not perform it here.
- **Proxy mode.** This applies to tack-as-client only.
- The summarization model call itself.

## Impact

- Affected: `@tack/core` (scorer, config, types), CLI output, session tracking.
- No breaking change to the `Scorer` interface shape; `RoutingDecision` gains
  escalation context within its existing `contributions` list.
