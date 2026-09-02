/**
 * Pure round arithmetic. No database, no React.
 *
 * Two rules carry all the weight:
 *   1. A round never advances until every candidate in it has a decision.
 *   2. Auto-bids sit out intermediate rounds and rejoin only when
 *      survivors + held fits inside TOP_N — a hard cap *including* them.
 *
 * The cap is never exceeded. If the auto-bid pile alone reaches TOP_N, the
 * next round is aimed at that pile so it can be cut, rather than merging over
 * the cap or looping on survivors who cannot fix the total.
 */
export const TOP_N = 50;

export type Action = "reject" | "auto_bid" | "next_round";
export type Decision = {
  candidateId: string;
  round: number;
  action: Action;
  note: string | null;
};

/** The last decision recorded for each candidate in a given round. */
function latestByCandidate(decisions: Decision[], round: number): Map<string, Action> {
  const out = new Map<string, Action>();
  for (const d of decisions) {
    if (d.round === round) out.set(d.candidateId, d.action);
  }
  return out;
}

export function roundState(all: string[], decisions: Decision[]) {
  let alive = [...all];
  let held: string[] = [];
  let trimming = false;
  let isFinal = false;
  let round = 1;
  const rejected: string[] = [];

  const maxRound = decisions.reduce((m, d) => Math.max(m, d.round), 1);

  for (; round <= maxRound; round++) {
    const pool = trimming ? held : alive;
    const decided = latestByCandidate(decisions, round);
    const remaining = pool.filter((id) => !decided.has(id));
    if (remaining.length > 0) {
      // Round still open. Report the pools as they stand *right now* — counting
      // everyone still alive as "next round" would badge the whole applicant pool
      // before a single decision had been made.
      if (trimming) {
        return {
          round, stack: remaining, survivors: alive,
          held: pool.filter((id) => decided.get(id) !== "reject"),
          rejected: [...rejected, ...pool.filter((id) => decided.get(id) === "reject")],
          isFinal, autoBidOverflow: true,
        };
      }
      const survivorsSoFar: string[] = [];
      const heldSoFar = [...held];
      const rejectedSoFar = [...rejected];
      for (const id of pool) {
        const a = decided.get(id);
        if (a === "next_round") survivorsSoFar.push(id);
        else if (a === "auto_bid") { if (!heldSoFar.includes(id)) heldSoFar.push(id); }
        else if (a === "reject") rejectedSoFar.push(id);
      }
      return { round, stack: remaining, survivors: survivorsSoFar, held: heldSoFar,
               rejected: rejectedSoFar, isFinal, autoBidOverflow: false };
    }

    if (trimming) {
      const kept: string[] = [];
      for (const id of pool) {
        if (decided.get(id) === "reject") rejected.push(id);
        else kept.push(id);
      }
      held = kept;
      trimming = false;
    } else {
      const survivors: string[] = [];
      for (const id of pool) {
        const action = decided.get(id);
        if (action === "next_round") survivors.push(id);
        else if (action === "auto_bid") { if (!held.includes(id)) held.push(id); }
        else rejected.push(id);
      }
      alive = survivors;
    }

    if (isFinal) continue;

    if (held.length >= TOP_N) {
      trimming = true;
    } else if (held.length > 0 && alive.length + held.length <= TOP_N) {
      alive = [...alive, ...held];
      held = [];
      isFinal = true;
    }
  }

  return { round, stack: trimming ? held : alive, survivors: alive, held,
           rejected, isFinal, autoBidOverflow: trimming };
}

/**
 * Who to interview, once screening is over.
 *
 * Answered only from a settled state. Screening is over when the survivors
 * and auto-bids have merged into the final pool (`isFinal`), or when nobody
 * was auto-bid and the survivors already fit under TOP_N; and, either way,
 * the current round has not been started. A round that is half-decided is
 * refused rather than guessed at: "who made it" must never come from a
 * pile someone is still swiping through.
 */
export type Finalists =
  | { ids: string[]; round: number }
  | { blocked: string; round: number; undecided: number };

export function finalists(all: string[], decisions: Decision[]): Finalists {
  const s = roundState(all, decisions);
  const decidedThisRound = new Set(
    decisions.filter((d) => d.round === s.round).map((d) => d.candidateId),
  ).size;
  const settled = s.isFinal || (s.held.length === 0 && s.survivors.length > 0 && s.survivors.length <= TOP_N);

  if (s.autoBidOverflow) {
    return { blocked: "the auto-bid pile is at the cap and must be cut first", round: s.round, undecided: s.stack.length };
  }
  if (decidedThisRound > 0 && s.stack.length > 0) {
    return { blocked: "the current round is half-finished", round: s.round, undecided: s.stack.length };
  }
  if (!settled) {
    return { blocked: "the pool is still above the cap", round: s.round, undecided: s.stack.length };
  }
  return { ids: s.survivors, round: s.round };
}
