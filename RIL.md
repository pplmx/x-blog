# Repository Intelligence Layer (RIL)

> **Pointer only.** The historical free-form RIL ledger (session logs and
> earlier debt lists) was consolidated into the typed engineering graph on
> 2026-08-10 (loop rounds 1-18). The archived copy is preserved at
> `docs/archive/RIL-legacy-ledger-2026-07.md` and in git history.

The live, authoritative engineering knowledge for X-Blog lives in the **typed
repository graph**:

- Store: `.planning/ril/graph.json` — the single source of truth.
- CLI: `.agents/skills/graph-engineering/scripts/ril.py` — the only supported
  way to read and write the graph (typed nodes + directed edges, optimistic
  locking, lifecycle, consistency checks). Never edit `graph.json` by hand.
- Process: the autonomous loop defined in
  `.agents/skills/graph-engineering/SKILL.md`
  (OBSERVE → MODEL → EVALUATE → SELECT → EXECUTE → VERIFY → LEARN → REPEAT).

Outstanding work is tracked as `task`/`issue` nodes in the graph, not in this
file.

## Graph quick reference

Node types: `component`, `issue`, `hypothesis`, `evidence`, `decision`,
`change`, `task`. Lifecycle status: `active | stale | resolved | superseded |
abandoned`. Decisions are immutable (history via `supersedes`); evidence is
append-only.

Useful commands:

```bash
ril.py check                     # orphans / cycles / unproven hypotheses
ril.py tasks --top 10            # active tasks by priority_score
ril.py show --id TASK-001 --hops 2
ril.py round                     # advance the loop counter
ril.py stale --rounds 10         # mark untouched nodes stale
```

Priority score:

```text
priority_score = category_weight × severity × confidence × (1 / √effort) × unlock_factor
```

Commits reference node ids, e.g. `fix(core): ... (RIL TASK-005, ISS-006)`.

See `.agents/skills/graph-engineering/SKILL.md` for the full schema, CLI, and
stop conditions.
