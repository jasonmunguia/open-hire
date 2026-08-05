import { describe, it, expect } from "vitest";
import { roundState, TOP_N, type Decision } from "../lib/rounds";

const ids = (n: number) => Array.from({ length: n }, (_, i) => `c${i}`);
const decide = (list: string[], round: number, action: Decision["action"]): Decision[] =>
  list.map((candidateId) => ({ candidateId, round, action, note: null }));

describe("round gating", () => {
  it("round 1 stack is everyone", () => {
    expect(roundState(ids(5), []).stack).toHaveLength(5);
    expect(roundState(ids(5), []).round).toBe(1);
  });
  it("does NOT advance while anyone is undecided", () => {
    const all = ids(5);
    const s = roundState(all, decide(all.slice(0, 3), 1, "next_round"));
    expect(s.round).toBe(1);
    expect(s.stack).toEqual(["c3", "c4"]);
  });
  it("advances only once every candidate has a decision", () => {
    const all = ids(5);
    const done = [...decide(all.slice(0, 3), 1, "next_round"), ...decide(all.slice(3), 1, "reject")];
    const s = roundState(all, done);
    expect(s.round).toBe(2);
    expect(s.stack).toEqual(["c0", "c1", "c2"]);
  });
});

describe("mid-round pool counts", () => {
  it("reports ZERO in every pool before any decision is made", () => {
    const s = roundState(ids(1289), []);
    expect(s.survivors).toHaveLength(0);
    expect(s.held).toHaveLength(0);
    expect(s.rejected).toHaveLength(0);
    expect(s.stack).toHaveLength(1289);
  });

  it("counts only what has actually been decided so far this round", () => {
    const all = ids(100);
    const partial = [
      ...decide(all.slice(0, 7), 1, "next_round"),
      ...decide(all.slice(7, 10), 1, "auto_bid"),
      ...decide(all.slice(10, 25), 1, "reject"),
    ];
    const s = roundState(all, partial);
    expect(s.survivors).toHaveLength(7);
    expect(s.held).toHaveLength(3);
    expect(s.rejected).toHaveLength(15);
    expect(s.stack).toHaveLength(75);
  });

  it("keeps earlier-round pools while a later round is in progress", () => {
    // 100 survivors + 5 held = 105, safely above the cap, so no merge fires
    // and the auto-bid pile is still visibly held during round 2.
    const all = ids(200);
    const r1 = [
      ...decide(all.slice(0, 100), 1, "next_round"),
      ...decide(all.slice(100, 105), 1, "auto_bid"),
      ...decide(all.slice(105), 1, "reject"),
    ];
    const r2 = decide(all.slice(0, 10), 2, "next_round");
    const s = roundState(all, [...r1, ...r2]);
    expect(s.round).toBe(2);
    expect(s.held).toHaveLength(5);        // carried from round 1
    expect(s.survivors).toHaveLength(10);  // hearted so far in round 2
    expect(s.rejected).toHaveLength(95);
    expect(s.stack).toHaveLength(90);      // still to review in round 2
  });
});

describe("auto-bid holding", () => {
  it("held candidates stay out of intermediate rounds", () => {
    const all = ids(200);
    const done = [
      ...decide(all.slice(0, 100), 1, "next_round"),
      ...decide(all.slice(100, 110), 1, "auto_bid"),
      ...decide(all.slice(110), 1, "reject"),
    ];
    const s = roundState(all, done);
    expect(s.round).toBe(2);
    expect(s.held).toHaveLength(10);
    expect(s.stack).toHaveLength(100);
    expect(s.stack).not.toContain("c105");
    expect(s.isFinal).toBe(false);
  });
});

describe("hard cap of 50 INCLUDING auto-bids", () => {
  it("does not merge when survivors + held exceeds 50", () => {
    const all = ids(80);
    const done = [
      ...decide(all.slice(0, 30), 1, "next_round"),
      ...decide(all.slice(30, 55), 1, "auto_bid"),
      ...decide(all.slice(55), 1, "reject"),
    ];
    const s = roundState(all, done);
    expect(s.stack).toHaveLength(30);
    expect(s.isFinal).toBe(false);
  });
  it("merges once survivors + held fits under 50", () => {
    const all = ids(80);
    const r1 = [
      ...decide(all.slice(0, 30), 1, "next_round"),
      ...decide(all.slice(30, 55), 1, "auto_bid"),
      ...decide(all.slice(55), 1, "reject"),
    ];
    const r2 = [...decide(all.slice(0, 20), 2, "next_round"), ...decide(all.slice(20, 30), 2, "reject")];
    const s = roundState(all, [...r1, ...r2]);
    expect(s.round).toBe(3);
    expect(s.stack).toHaveLength(45);
    expect(s.stack.length).toBeLessThanOrEqual(TOP_N);
    expect(s.isFinal).toBe(true);
    expect(s.autoBidOverflow).toBe(false);
  });
  it("HARD STOPS and aims the round at the auto-bid pool when it alone exceeds the cap", () => {
    const all = ids(120);
    const done = [
      ...decide(all.slice(0, 6), 1, "next_round"),
      ...decide(all.slice(6, 58), 1, "auto_bid"),
      ...decide(all.slice(58), 1, "reject"),
    ];
    const s = roundState(all, done);
    expect(s.isFinal).toBe(false);
    expect(s.autoBidOverflow).toBe(true);
    expect(s.stack).toHaveLength(52);
    expect(s.stack).toContain("c6");
    expect(s.stack).not.toContain("c0");
  });
  it("resumes normal merging once the auto-bid pool is cut under the cap", () => {
    const all = ids(120);
    const r1 = [
      ...decide(all.slice(0, 6), 1, "next_round"),
      ...decide(all.slice(6, 58), 1, "auto_bid"),
      ...decide(all.slice(58), 1, "reject"),
    ];
    const r2 = [...decide(all.slice(6, 18), 2, "reject"), ...decide(all.slice(18, 58), 2, "auto_bid")];
    const s = roundState(all, [...r1, ...r2]);
    expect(s.autoBidOverflow).toBe(false);
    expect(s.isFinal).toBe(true);
    expect(s.stack).toHaveLength(46);
    expect(s.stack.length).toBeLessThanOrEqual(TOP_N);
  });
});

describe("reversibility", () => {
  it("a later decision on the same candidate in the same round wins", () => {
    const all = ids(3);
    const done: Decision[] = [
      ...decide(all, 1, "reject"),
      { candidateId: "c1", round: 1, action: "next_round", note: "changed my mind" },
    ];
    const s = roundState(all, done);
    expect(s.rejected).toEqual(["c0", "c2"]);
    expect(s.stack).toEqual(["c1"]);
  });
});
