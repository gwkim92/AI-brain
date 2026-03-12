# Narrative World Model Engine Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a bounded world-model engine that turns geopolitical and macro events into evidence-backed investment narratives with competing hypotheses, invalidation rules, and watch items.

**Architecture:** Add a new world-model layer on top of the existing research and memory pipeline. The layer stores normalized entities, events, observations, constraints, mechanisms, hypotheses, counter-hypotheses, invalidation conditions, and outcomes. Research artifacts become inputs to a state-estimation loop, not the final product.

**Tech Stack:** TypeScript, Fastify, Postgres, JSONB, pgvector, existing retrieval/research pipeline, Vitest

---

## 1. Scope

The first version must stay narrow.

- Domain: Middle East geopolitical shocks -> LNG -> shipping/insurance -> inflation/rates -> beneficiary industries and names
- Core question: Is the current event a headline-only narrative or a real structural reallocation of contracts, logistics, funding, and pricing power?
- Output: competing hypotheses, confidence, invalidation conditions, watch items, affected industries, affected names
- Non-goals: universal market intelligence, hidden intent certainty, cross-domain omniscience, fully autonomous trading

## 2. Core Principles

- Store arrows, not just documents.
- Separate observed facts from inferred links and speculative narratives.
- Keep counter-hypotheses alive until they are invalidated.
- Prefer event-driven incremental updates over full recomputation.
- Make "expected but missing" evidence a first-class signal.
- Optimize for calibration and invalidation speed, not prose quality alone.

## 3. Core Objects

### Entity

Canonical actor or object in the world model.

- Types: state, regulator, producer, buyer, terminal, route, ship class, benchmark, currency, bank, sector, company, ticker
- Required fields: id, type, canonical_name, aliases, region, tags, active_status

### Event

World change that may update hidden state.

- Types: strike, sanction, outage, contract_signing, capacity_expansion, policy_change, earnings_signal, spread_move
- Required fields: id, type, title, happened_at, observed_at, involved_entities, source_ids, confidence

### Observation

Measured or reported signal.

- Types: price, rate, spread, freight, inventory, traffic, utilization, headline, filing, transcript, guidance
- Required fields: id, metric_type, subject_entity_id, value, unit, observed_at, source_id, quality

### Constraint

Binding or potentially binding bottleneck.

- Types: capacity, insurance, routing, financing, collateral, regulatory, settlement, inventory
- Required fields: id, type, subject_entity_id, severity, start_at, expected_end_at, evidence_ids

### Mechanism

Reusable causal template.

- Example: shock -> route_risk -> freight/insurance spike -> contract preference shift -> capex support
- Required fields: id, name, domain_tags, preconditions, expected_observations, lag_profile, invalidators

### Hypothesis

Current explanation assembled from mechanisms and state.

- Required fields: id, thesis, status, confidence, horizon, regime_tags, supporting_event_ids, supporting_observation_ids, mechanism_ids
- Status values: active, weakening, invalidated, confirmed, archived

### CounterHypothesis

Competing explanation for the same trigger.

- Required fields: id, thesis, confidence, linked_hypothesis_id, distinguishing_signals

### InvalidationCondition

Condition that must weaken a hypothesis.

- Required fields: id, hypothesis_id, description, expected_by, severity, observed_status

### WatchItem

Actionable monitor tied to a hypothesis.

- Required fields: id, hypothesis_id, target_type, target_id, trigger_text, review_cadence, action_hint

### Outcome

Forward result used for calibration.

- Required fields: id, hypothesis_id, evaluated_at, result, error_notes, horizon_realized, missed_invalidators

## 4. Storage Layers

### Raw Evidence Store

Keep source documents, source snapshots, metadata, and extractable text.

### Semantic Store

Store canonical entities, events, observations, aliases, and evidence links.

### Temporal Graph

Store typed edges with channel, lag, confidence, and provenance.

- Channels: physical, contractual, financial, political, narrative

### Hypothesis Ledger

Store active and historical hypotheses, counter-hypotheses, invalidators, and watch items.

### Outcome Journal

Store forward checks, misses, edge failures, and confidence calibration history.

## 5. State Model

Do not model the whole world. Model bounded hidden state.

- Route risk
- Freight pressure
- Insurance pressure
- Contract urgency
- Capex support probability
- Inflation pass-through risk
- Rate repricing pressure
- Beneficiary confidence by sector/name

Each state variable needs:

- current_value
- confidence
- last_updated_at
- supporting_evidence_count
- contradicting_evidence_count

## 6. Data Inputs For V1

Keep the first set small and high-signal.

- Major real-time geopolitical news wires
- Official sanctions and policy notices
- Henry Hub, TTF, JKM
- Brent or WTI
- US 2Y, US 10Y, DXY
- LNG shipping or freight proxies
- Chokepoint traffic or route proxies
- LNG terminal outage and expansion news
- Long-term SPA contract announcements
- Company filings and investor-relations releases for exporters, shipbuilders, insulation suppliers, carriers
- Earnings call transcripts for a small target list
- Sector ETF and target-name price/volume reactions
- Gas storage and inventory data

## 7. Inference Loop

### Trigger

Start from contradiction or shock, not from an open-ended request.

Example:

- "War risk up, but spot gas move is muted"
- "Supply shock narrative up, but contract signings are absent"

### Normalize

- Resolve entities and aliases
- Normalize time and units
- Deduplicate source reports

### Update

- Attach new observations to entities and events
- Update relevant constraints
- Wake only mechanisms that match the trigger and current regime

### Compete

- Score the primary hypothesis
- Score at least one counter-hypothesis
- Generate expected next observations for both

### Validate

- Increase confidence when expected signals appear on time
- Decrease confidence when expected signals do not appear
- Flag weak edges explicitly

### Compile

Generate narrative only after state update.

Output sections:

- contradiction
- surface explanation
- structural hypothesis
- counter-hypothesis
- key bottlenecks
- evidence anchors
- invalidation conditions
- watch items
- affected industries and names

## 8. Implementation Tranches

### Tranche 1: World Model Schema

**Files:**
- Modify: `docs/db-schema-v1.sql`
- Create: `backend/src/world-model/types.ts`
- Create: `backend/src/world-model/store.ts`
- Create: `backend/src/world-model/__tests__/types.test.ts`

Deliverables:

- world-model tables or JSONB-backed store contracts
- typed domain objects for entities, events, observations, constraints, mechanisms, hypotheses, outcomes

### Tranche 2: Normalization Pipeline

**Files:**
- Modify: `backend/src/jarvis/research.ts`
- Create: `backend/src/world-model/normalizer.ts`
- Create: `backend/src/world-model/entity-resolution.ts`
- Create: `backend/src/world-model/__tests__/normalizer.test.ts`

Deliverables:

- research artifacts converted into normalized events and observations
- canonical entity resolution for a bounded entity set

### Tranche 3: Mechanism Library

**Files:**
- Create: `backend/src/world-model/mechanisms.ts`
- Create: `backend/src/world-model/regimes.ts`
- Create: `backend/src/world-model/__tests__/mechanisms.test.ts`

Deliverables:

- v1 mechanism templates
- regime gating and expected-signal definitions

### Tranche 4: Hypothesis Ledger

**Files:**
- Create: `backend/src/world-model/hypotheses.ts`
- Create: `backend/src/world-model/scoring.ts`
- Create: `backend/src/world-model/__tests__/hypotheses.test.ts`

Deliverables:

- active hypothesis tracking
- counter-hypothesis support
- invalidation logic
- watch item generation

### Tranche 5: Outcome Journal

**Files:**
- Create: `backend/src/world-model/outcomes.ts`
- Create: `backend/src/world-model/__tests__/outcomes.test.ts`

Deliverables:

- delayed evaluation of prior hypotheses
- edge failure reporting
- calibration metrics

### Tranche 6: API and UI Integration

**Files:**
- Modify: `backend/src/routes/reports.ts`
- Modify: `backend/src/routes/research.ts`
- Create: `backend/src/routes/world-model.ts`
- Modify: `web/src/components/modules/DossierModule.tsx`
- Create: `web/src/components/ui/HypothesisLedgerPanel.tsx`

Deliverables:

- world-model dossier view
- confidence, invalidation, and watch-item display

## 9. Guardrails

- Never collapse observed fact and inferred motive into one confidence score.
- Never delete counter-hypotheses when the primary narrative is attractive.
- Never emit a final investment implication without an invalidation section.
- Never treat absence of price reaction as proof without checking the expected lag.

## 10. Success Metrics

- Hypothesis calibration over 1 week, 1 month, and 1 quarter horizons
- Median time to invalidate a weak narrative
- Watch-item precision
- Sector/name relevance judged by later realized follow-through
- Reduction in unsupported narrative claims per dossier

## 11. Reality Check

This is feasible only as a bounded system.

- Feasible: one domain, 15-20 data inputs, 10-20 mechanism templates, human-curated entity set
- Not feasible: global real-time hidden-intent oracle
- The first useful version should behave like a disciplined analyst's evolving notebook, not a universal truth machine

