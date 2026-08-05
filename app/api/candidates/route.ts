import { NextResponse } from "next/server";
import { sql, JOB_EXTERNAL_ID } from "@/lib/db";
import { roundState, type Decision } from "@/lib/rounds";

export const dynamic = "force-dynamic";

export async function GET() {
  const [job] = await sql`select id, label, title from jobs where external_id = ${JOB_EXTERNAL_ID}`;
  if (!job) return NextResponse.json({ error: "No job loaded yet." }, { status: 404 });

  const rows = await sql`
    select id from candidates where job_id = ${job.id} order by sort_key`;
  const all = rows.map((r) => r.id as string);

  const decisionRows = await sql`
    select d.candidate_id, d.round, d.action, d.note
    from decisions d join candidates c on c.id = d.candidate_id
    where c.job_id = ${job.id}
    order by d.created_at`;
  const decisions: Decision[] = decisionRows.map((d) => ({
    candidateId: d.candidate_id as string,
    round: d.round as number,
    action: d.action as Decision["action"],
    note: d.note as string | null,
  }));

  const state = roundState(all, decisions);
  const canUndo = decisions.length > 0;
  const total = state.round === 1 ? all.length : state.stack.length + countDecidedThisRound(decisions, state.round);
  const nextId = state.stack[0] ?? null;

  if (!nextId) {
    return NextResponse.json({
      round: state.round, position: 0, total: 0, done: true, canUndo,
      isFinal: state.isFinal, autoBidOverflow: state.autoBidOverflow,
      counts: poolCounts(state), candidate: null,
    });
  }

  const [c] = await sql`
    select id, name, school, school_year, majors, email, phone, page_count, image_urls, grad_date
    from candidates where id = ${nextId}`;

  const priorNotes = decisions
    .filter((d) => d.candidateId === nextId && d.round < state.round && d.note)
    .map((d) => ({ round: d.round, text: d.note as string }));

  return NextResponse.json({
    round: state.round,
    position: total - state.stack.length + 1,
    total,
    done: false,
    isFinal: state.isFinal,
    autoBidOverflow: state.autoBidOverflow,
    canUndo,
    counts: poolCounts(state),
    candidate: {
      id: c.id, name: c.name, school: c.school, schoolYear: c.school_year,
      majors: c.majors, email: c.email, phone: c.phone,
      gradDate: c.grad_date, pageCount: c.page_count,
      imageUrls: c.image_urls as string[],
      autoBid: state.held.includes(nextId as string),
      priorNotes,
    },
  });
}

function countDecidedThisRound(decisions: Decision[], round: number) {
  return new Set(decisions.filter((d) => d.round === round).map((d) => d.candidateId)).size;
}

function poolCounts(s: ReturnType<typeof roundState>) {
  return { next: s.survivors.length, auto: s.held.length, rejected: s.rejected.length };
}
