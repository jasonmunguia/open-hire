"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type PriorNote = { round: number; text: string };
type Candidate = {
  id: string; name: string; school: string | null; schoolYear: string | null;
  majors: string | null; email: string; phone: string | null;
  pageCount: number; imageUrls: string[]; autoBid: boolean; priorNotes: PriorNote[];
};
type Feed = {
  round: number; position: number; total: number; done: boolean;
  isFinal: boolean; autoBidOverflow: boolean; canUndo: boolean;
  counts: { next: number; auto: number; rejected: number };
  candidate: Candidate | null;
};
type PoolPerson = {
  id: string; name: string; school: string | null; schoolYear: string | null;
  majors: string | null; email: string; phone: string | null;
  autoBid: boolean; notes: PriorNote[];
};

const ACCENT = "#E0703A";

export default function Page() {
  const [feed, setFeed] = useState<Feed | null>(null);
  const [note, setNote] = useState("");
  const [page] = useState(0);
  const [reader, setReader] = useState(false);
  const [panel, setPanel] = useState(false);
  const [pool, setPool] = useState<"next" | "auto" | "rejected">("next");
  const [poolPeople, setPoolPeople] = useState<PoolPerson[]>([]);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(0);
  const [showPrior, setShowPrior] = useState(false);
  const [howto, setHowto] = useState(false);
  const dragging = useRef(false);
  const dragged = useRef(false);
  const startX = useRef(0);

  const load = useCallback(async () => {
    const r = await fetch("/api/candidates", { cache: "no-store" });
    setFeed(await r.json());
    setNote("");
    setShowPrior(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const loadPool = useCallback(async (name: string) => {
    const r = await fetch(`/api/pools?name=${name}`, { cache: "no-store" });
    setPoolPeople((await r.json()).candidates ?? []);
  }, []);

  useEffect(() => { if (panel) loadPool(pool); }, [panel, pool, loadPool]);

  const decide = useCallback(async (action: "reject" | "auto_bid" | "next_round") => {
    if (!feed?.candidate || busy) return;
    setBusy(true);
    setDrag(action === "reject" ? -700 : action === "next_round" ? 700 : 0);
    await fetch("/api/decisions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidateId: feed.candidate.id, round: feed.round, action, note }),
    });
    await load();
    setDrag(0);
    setBusy(false);
  }, [feed, note, busy, load]);

  const undo = useCallback(async () => {
    if (busy || !feed?.canUndo) return;
    setBusy(true);
    await fetch("/api/undo", { method: "POST" });
    await load();
    setBusy(false);
  }, [busy, feed, load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (reader && e.key === "Escape") { setReader(false); return; }
      if (document.activeElement?.tagName === "TEXTAREA") return;
      if (e.key === "ArrowLeft") decide("reject");
      if (e.key === "ArrowRight") decide("next_round");
      if (e.key === "ArrowUp") decide("auto_bid");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [decide, reader]);

  const c = feed?.candidate ?? null;

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden px-3 pb-3 pt-3 lg:px-6 lg:pb-5">
      <div className="flex h-11 flex-none items-center justify-between">
        <nav className="flex items-center gap-1">
          <button className="rounded-full px-4 py-2 text-[17px] font-bold text-white" style={{ background: ACCENT }}>FDE</button>
          <button disabled className="rounded-full px-3.5 py-2 text-[17px] font-semibold text-[#7E7E88] opacity-55">Role 2</button>
          <button disabled className="rounded-full px-3.5 py-2 text-[17px] font-semibold text-[#7E7E88] opacity-55">Role 3</button>
        </nav>
        <div className="flex items-center gap-2">
        <button onClick={() => setHowto(true)} aria-label="How it works"
                className="rounded-full border border-white/15 px-3 py-1.5 text-[12px] font-medium text-[#B4B4BE] hover:border-white/30 hover:text-white">
          How it works
        </button>
        <button onClick={() => setPanel(true)} aria-label="View pools"
                className="relative grid place-items-center rounded-lg p-2 hover:bg-white/10">
          <span className="block h-0.5 w-5 rounded bg-[#F2F1EF]" />
          <span className="mt-[5px] block h-0.5 w-5 rounded bg-[#F2F1EF]" />
          <span className="mt-[5px] block h-0.5 w-5 rounded bg-[#F2F1EF]" />
          {feed && feed.counts.next + feed.counts.auto > 0 && (
            <em className="absolute -right-1 -top-1 min-w-[17px] rounded-full px-1 text-center font-mono text-[10px] not-italic leading-[17px] text-white"
                style={{ background: ACCENT }}>{feed.counts.next + feed.counts.auto}</em>
          )}
        </button>
        </div>
      </div>

      {feed?.autoBidOverflow && (
        <div className="mt-1 flex-none rounded-lg border border-[#E0703A]/40 bg-[#E0703A]/15 px-3 py-2 text-[12.5px] leading-snug">
          {feed.counts.auto} auto-bids exceed the 50 cap. Cut this pool before the finals — ✗ is the only button that removes anyone right now.
        </div>
      )}

      {!feed && <div className="grid flex-1 place-items-center text-sm text-[#7E7E88]">Loading…</div>}

      {feed?.done && (
        <div className="grid flex-1 place-items-center px-6 text-center">
          <div>
            <div className="text-2xl font-bold">Round {feed.round} complete</div>
            <p className="mt-3 max-w-sm text-sm leading-relaxed text-[#9A9AA4]">
              {feed.counts.next} moving on{feed.counts.auto ? `, ${feed.counts.auto} held as auto-bid` : ""}.
              {feed.isFinal ? " This is the final pool." : ""}
            </p>
            <button onClick={load} className="mt-6 rounded-full px-6 py-3 font-semibold text-white" style={{ background: ACCENT }}>
              {feed.isFinal ? "View finals" : "Start next round"}
            </button>
          </div>
        </div>
      )}

      {c && !feed?.done && (
        <div className="flex min-h-0 flex-1 flex-col lg:grid lg:grid-cols-[1fr_372px] lg:gap-x-7">
          <div className="flex min-h-0 flex-col lg:col-start-1">
            <div className="flex h-3 flex-none items-center justify-center gap-1.5">
              {Array.from({ length: c.pageCount }, (_, i) => (
                <i key={i} className={`block h-[3px] w-[22px] rounded ${i === page ? "bg-[#F2F1EF]" : "bg-white/20"}`} />
              ))}
            </div>
            <div className="min-h-0 flex-1 pt-1.5">
              <div
                role="button"
                tabIndex={0}
                aria-label="Open full resume"
                onClick={() => { if (!dragged.current) setReader(true); }}
                onKeyDown={(e) => { if (e.key === "Enter") setReader(true); }}
                onPointerDown={(e) => {
                  dragging.current = true; dragged.current = false; startX.current = e.clientX;
                  (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
                }}
                onPointerMove={(e) => {
                  if (!dragging.current) return;
                  const dx = e.clientX - startX.current;
                  if (Math.abs(dx) > 6) dragged.current = true;
                  setDrag(dx);
                }}
                onPointerUp={() => {
                  if (!dragging.current) return;
                  dragging.current = false;
                  if (drag < -110) decide("reject");
                  else if (drag > 110) decide("next_round");
                  else setDrag(0);
                }}
                className="relative grid h-full cursor-zoom-in select-none place-items-center overflow-hidden rounded-2xl bg-[#F7F6F3] shadow-2xl"
                style={{
                  transform: `translateX(${drag}px) rotate(${drag * 0.05}deg)`,
                  opacity: Math.abs(drag) > 400 ? 0 : 1,
                  transition: dragging.current ? "none" : "transform .28s cubic-bezier(.22,.9,.3,1), opacity .28s",
                }}
              >
                {drag < -40 && (
                  <div className="absolute left-4 top-5 z-10 -rotate-12 rounded-lg border-[3px] border-[#33333A] px-3.5 py-1.5 text-xl font-extrabold text-[#33333A]">REJECT</div>
                )}
                {drag > 40 && (
                  <div className="absolute right-4 top-5 z-10 rotate-12 rounded-lg border-[3px] border-[#E5252D] px-3.5 py-1.5 text-xl font-extrabold text-[#E5252D]">ADVANCE</div>
                )}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={c.imageUrls[page]} alt={`${c.name} resume page ${page + 1}`}
                     draggable={false} className="max-h-full max-w-full object-contain" />
              </div>
            </div>
          </div>

          <div className="flex flex-none flex-col lg:col-start-2 lg:min-h-0 lg:pt-1.5">
            <div className="px-1 pb-1.5 pt-2.5">
              <div className="flex items-center gap-2 text-[19px] font-bold leading-tight tracking-tight">
                <span data-testid="candidate-name">{c.name}</span>
                {c.autoBid && <span className="rounded px-1.5 py-0.5 text-[9px] font-bold tracking-wider text-[#7BADEA] ring-1 ring-[#7BADEA]">★ AUTO-BID</span>}
              </div>
              <div className="mt-0.5 text-[13px] leading-snug text-[#9A9AA4]">
                {[c.schoolYear, c.school, c.majors].filter(Boolean).join(" · ") || c.email}
              </div>
            </div>

            {c.priorNotes.length > 0 && (
              <div className="mb-2" data-testid="prior-notes">
                <button onClick={() => setShowPrior((v) => !v)}
                        className="w-full rounded-[10px] border border-[#E0703A]/40 bg-[#E0703A]/12 px-2.5 py-1.5 text-left">
                  <div className="font-mono text-[8.5px] uppercase tracking-[0.14em]" style={{ color: ACCENT }}>
                    {c.priorNotes.length === 1 ? `Round ${c.priorNotes[0].round} note` : `${c.priorNotes.length} earlier notes`}
                  </div>
                  <div className={`text-[12px] leading-snug text-[#DBDBE2] ${showPrior ? "" : "line-clamp-2"}`}>
                    {showPrior
                      ? c.priorNotes.map((n) => `R${n.round}: ${n.text}`).join("  ·  ")
                      : c.priorNotes[c.priorNotes.length - 1].text}
                  </div>
                </button>
              </div>
            )}

            <div className="grid flex-none grid-cols-5 items-start pb-2 lg:mt-auto">
              <div className="col-start-1 flex flex-col items-center gap-[7px]">
                <button onClick={undo} disabled={busy || !feed?.canUndo} aria-label="Go back"
                        className="grid h-[46px] w-[46px] place-items-center rounded-full border border-white/10 bg-[#1C1C20] transition-transform hover:scale-105 active:scale-95 disabled:opacity-25">
                  <svg viewBox="0 0 24 24" fill="none" stroke="#C9C9D2" strokeWidth="2.2"
                       strokeLinecap="round" strokeLinejoin="round" className="h-[22px] w-[22px]">
                    <path d="M3 9h11a5 5 0 0 1 0 10h-3" /><path d="M7 5L3 9l4 4" />
                  </svg>
                </button>
                <span className="whitespace-nowrap font-mono text-[9px] uppercase tracking-[0.12em] text-[#8A8A94]">Go Back</span>
              </div>
              <ActionButton col="col-start-2" label="Reject" onClick={() => decide("reject")} disabled={busy}>
                <svg viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2.6" strokeLinecap="round" className="h-7 w-7"><path d="M5 5l14 14M19 5L5 19" /></svg>
              </ActionButton>
              <ActionButton col="col-start-3" label="Auto-Bid" onClick={() => decide("auto_bid")} disabled={busy}>
                <svg viewBox="0 0 24 24" fill="#7BADEA" className="h-7 w-7"><path d="M12 2.6l2.9 5.9 6.5.95-4.7 4.6 1.1 6.45L12 17.45 6.2 20.5l1.1-6.45-4.7-4.6 6.5-.95z" /></svg>
              </ActionButton>
              <ActionButton col="col-start-5" label="Next Round" onClick={() => decide("next_round")} disabled={busy}>
                <svg viewBox="0 0 24 24" fill="#E5252D" className="h-7 w-7"><path d="M12 20.5l-1.4-1.3C5.4 14.5 2 11.4 2 7.7 2 4.7 4.4 2.4 7.4 2.4c1.7 0 3.3.8 4.6 2.2 1.3-1.4 2.9-2.2 4.6-2.2 3 0 5.4 2.3 5.4 5.3 0 3.7-3.4 6.8-8.6 11.5z" /></svg>
              </ActionButton>
            </div>

            <div className="relative h-[106px] flex-none lg:h-[150px]">
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                aria-label="Notes on this candidate"
                placeholder="Notes on this candidate…"
                className="h-full w-full resize-none rounded-2xl border border-white/10 bg-[#161619] p-3 text-[13px] leading-snug text-[#F2F1EF] outline-none placeholder:text-[#65656F] focus:border-[#E0703A]"
              />
              <div className="pointer-events-none absolute inset-x-0 bottom-1.5 text-center font-mono text-[9px] tracking-[0.14em] text-[#5A5A64]">
                ROUND {feed!.round} · {feed!.position} / {feed!.total}
              </div>
            </div>
          </div>
        </div>
      )}

      {howto && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-6"
             onClick={() => setHowto(false)}>
          <div data-testid="howto" onClick={(e) => e.stopPropagation()}
               className="max-h-[88dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-white/10 bg-[#141417] p-6 sm:rounded-2xl">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <div className="font-mono text-[9px] uppercase tracking-[0.18em]" style={{ color: ACCENT }}>
                  Screening
                </div>
                <h2 className="mt-1.5 text-xl font-bold leading-tight">How this works</h2>
              </div>
              <button onClick={() => setHowto(false)} aria-label="Close how it works"
                      className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#25252B] text-lg">✕</button>
            </div>

            <p className="text-[13.5px] leading-relaxed text-[#B4B4BE]">
              {feed?.total ?? "Many"} people applied. Too many to read properly, so you cut the pile
              down in passes — a fast gut call on everyone, then a slower look at whoever survives.
            </p>

            <h3 className="mb-2 mt-6 font-mono text-[9px] uppercase tracking-[0.16em] text-[#7E7E88]">
              The three buttons
            </h3>
            <div className="space-y-2.5">
              <Row swatch="#FFFFFF" title="Reject" body="Out of the running. They stay listed under the menu, so a mis-tap is fixable." />
              <Row swatch="#E5252D" title="Next Round" body="They survive into the next pass, and you'll see them again with a smaller pile." />
              <Row swatch="#7BADEA" title="Auto-Bid" body="You already know you want them. They're set aside and skip every middle round — you won't see them again until the finals." />
            </div>
            <p className="mt-3 text-[12.5px] leading-relaxed text-[#7E7E88]">
              You can also drag the resume left to reject or right to advance, or use the ← ↑ → arrow keys.
              Tap the resume to open it full-page. <b className="text-white">Go Back</b> undoes your
              last decision and brings that person straight back.
            </p>

            <h3 className="mb-2 mt-6 font-mono text-[9px] uppercase tracking-[0.16em] text-[#7E7E88]">
              How the rounds work
            </h3>
            <ol className="space-y-2 text-[13.5px] leading-relaxed text-[#B4B4BE]">
              <li><b className="text-white">1.</b> Go through everyone. A new round can&apos;t start until every candidate has a decision.</li>
              <li><b className="text-white">2.</b> Everyone you hearted comes back as a smaller stack. Look closer this time.</li>
              <li><b className="text-white">3.</b> Repeat. Each pass is shorter than the last.</li>
              <li>
                <b className="text-white">4.</b> Once the survivors would fit under 50, your auto-bids get
                added back in and that&apos;s the final pool — capped at 50 people total.
              </li>
            </ol>

            <h3 className="mb-2 mt-6 font-mono text-[9px] uppercase tracking-[0.16em] text-[#7E7E88]">
              Notes
            </h3>
            <p className="text-[13.5px] leading-relaxed text-[#B4B4BE]">
              A note is kept only if you advance someone — heart or star. Reject and it&apos;s thrown away
              with them. Kept notes come back stamped with the round you wrote them in, so by the finals
              you can see what you thought the first time and what changed.
            </p>

            <h3 className="mb-2 mt-6 font-mono text-[9px] uppercase tracking-[0.16em] text-[#7E7E88]">
              Two things worth knowing
            </h3>
            <p className="text-[13.5px] leading-relaxed text-[#B4B4BE]">
              <b className="text-white">Nothing is ever deleted.</b> The ☰ menu holds every pool — Next Round,
              Auto-Bid, Rejected — with emails and phone numbers for booking.
            </p>
            <p className="mt-2 text-[13.5px] leading-relaxed text-[#B4B4BE]">
              <b className="text-white">Your place is saved.</b> Stop at 300, close the laptop, come back
              tomorrow and you&apos;ll land on 301.
            </p>

            <button onClick={() => setHowto(false)}
                    className="mt-7 w-full rounded-full py-3 font-semibold text-white"
                    style={{ background: ACCENT }}>
              Got it
            </button>
          </div>
        </div>
      )}

      {reader && c && (
        <div data-testid="resume-reader" className="fixed inset-0 z-30 flex flex-col bg-[#0C0C0E]">
          <div className="flex flex-none items-center justify-between gap-3 px-4 py-3">
            <div>
              <div className="text-[15px] font-semibold">{c.name}</div>
              <div className="mt-0.5 font-mono text-[10px] tracking-wider text-[#8A8A94]">
                {c.pageCount} PAGE{c.pageCount > 1 ? "S" : ""} · SCROLL
              </div>
            </div>
            <button onClick={() => setReader(false)} aria-label="Close resume"
                    className="grid h-8 w-8 place-items-center rounded-full bg-[#25252B] text-lg">✕</button>
          </div>
          <div className="flex-1 cursor-zoom-out overflow-y-auto px-2 pb-8" onClick={() => setReader(false)}>
            {c.imageUrls.map((u, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={i} src={u} alt={`${c.name} page ${i + 1}`} className="mx-auto mb-3 w-full max-w-3xl" />
            ))}
          </div>
        </div>
      )}

      {panel && (
        <>
          <div className="fixed inset-0 z-40 bg-black/55" onClick={() => setPanel(false)} />
          <div data-testid="pools-panel" className="fixed inset-y-0 right-0 z-50 flex w-[340px] max-w-[92vw] flex-col border-l border-white/10 bg-[#141417] pt-4">
            <div className="flex items-center justify-between px-4 pb-3">
              <strong className="text-[15px]">Pools</strong>
              <button onClick={() => setPanel(false)} aria-label="Close pools"
                      className="grid h-8 w-8 place-items-center rounded-full bg-[#25252B] text-lg">✕</button>
            </div>
            <div className="flex gap-1.5 px-4 pb-3">
              {([["next", "Next Round", feed?.counts.next], ["auto", "Auto-Bid", feed?.counts.auto],
                 ["rejected", "Rejected", feed?.counts.rejected]] as const).map(([key, label, n]) => (
                <button key={key} onClick={() => setPool(key)}
                        className={`rounded-full border px-2.5 py-1.5 font-mono text-[9.5px] uppercase tracking-wider ${
                          pool === key ? "border-transparent text-white" : "border-white/15 text-[#9A9AA4]"}`}
                        style={pool === key ? { background: ACCENT } : undefined}>
                  {label} {n ?? 0}
                </button>
              ))}
            </div>
            {pool === "auto" && (
              <p className="mx-4 mb-3 rounded-[10px] border border-[#E0703A]/35 bg-[#E0703A]/12 px-2.5 py-2 text-[11.5px] leading-snug text-[#E8D7CC]">
                Held out of the review stack. Auto-bids skip every intermediate round and rejoin the main list once the pool reaches the top 50.
              </p>
            )}
            <div className="flex-1 overflow-y-auto px-4 pb-5">
              {poolPeople.length === 0 && (
                <p className="py-4 text-[12px] leading-relaxed text-[#5E5E68]">
                  Nothing here yet. Nothing is ever deleted — anyone in these lists can be moved back.
                </p>
              )}
              {poolPeople.map((p) => (
                <div key={p.id} className="mb-2 rounded-xl border border-white/10 bg-[#1A1A1E] p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-[13px] font-semibold leading-tight">{p.name}</div>
                    {p.autoBid && <span className="shrink-0 rounded px-1 text-[8px] font-bold tracking-wider text-[#7BADEA] ring-1 ring-[#7BADEA]">★</span>}
                  </div>
                  <div className="mt-0.5 text-[11px] text-[#8A8A94]">
                    {[p.schoolYear, p.school].filter(Boolean).join(" · ")}
                  </div>
                  <div className="mt-1 break-all font-mono text-[10.5px] text-[#7E7E88]">
                    {p.email}{p.phone ? ` · ${p.phone}` : ""}
                  </div>
                  {p.notes.map((n, i) => (
                    <div key={i} className="mt-2 border-t border-dashed border-white/15 pt-2 text-[11.5px] leading-snug text-[#CFCFD6]">
                      <b className="mb-0.5 block font-mono text-[8.5px] uppercase tracking-[0.14em]" style={{ color: ACCENT }}>Round {n.round}</b>
                      {n.text}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Row({ swatch, title, body }: { swatch: string; title: string; body: string }) {
  return (
    <div className="flex gap-3">
      <span className="mt-[5px] h-3 w-3 shrink-0 rounded-full" style={{ background: swatch }} />
      <div className="text-[13.5px] leading-relaxed">
        <b className="text-white">{title}</b>
        <span className="text-[#B4B4BE]"> — {body}</span>
      </div>
    </div>
  );
}

function ActionButton({ col, label, onClick, disabled, children }: {
  col: string; label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode;
}) {
  return (
    <div className={`${col} flex flex-col items-center gap-[7px]`}>
      <button onClick={onClick} disabled={disabled} aria-label={label}
              className="grid h-[62px] w-[62px] place-items-center rounded-full border border-white/10 bg-[#1C1C20] transition-transform hover:scale-105 active:scale-95 disabled:opacity-40">
        {children}
      </button>
      <span className="whitespace-nowrap font-mono text-[9px] uppercase tracking-[0.12em] text-[#8A8A94]">{label}</span>
    </div>
  );
}
