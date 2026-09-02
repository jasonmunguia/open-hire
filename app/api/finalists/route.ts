import { NextResponse } from "next/server";
import { sql, JOB_EXTERNAL_ID } from "@/lib/db";
import { finalists, type Decision } from "@/lib/rounds";

export const dynamic = "force-dynamic";

/**
 * The shortlist, for `scripts/book.py` to send interview invitations to.
 *
 * 409 while screening is still open, with the reason. Never a partial list:
 * the sender must not invite half a round.
 */
export async function GET() {
  const [job] = await sql`select id, title from jobs where external_id = ${JOB_EXTERNAL_ID}`;
  if (!job) return NextResponse.json({ error: "No job loaded yet." }, { status: 404 });

  const rows = await sql`select id from candidates where job_id = ${job.id} order by sort_key`;
  const all = rows.map((r) => r.id as string);
  const decisionRows = await sql`
    select d.candidate_id, d.round, d.action, d.note
    from decisions d join candidates c on c.id = d.candidate_id
    where c.job_id = ${job.id} order by d.created_at`;
  const decisions: Decision[] = decisionRows.map((d) => ({
    candidateId: d.candidate_id as string, round: d.round as number,
    action: d.action as Decision["action"], note: d.note as string | null,
  }));

  const f = finalists(all, decisions);
  if ("blocked" in f) {
    return NextResponse.json(
      { blocked: f.blocked, round: f.round, undecided: f.undecided, finalists: [] },
      { status: 409 },
    );
  }
  if (!f.ids.length) return NextResponse.json({ jobTitle: job.title, round: f.round, finalists: [] });

  const people = await sql`
    select id, candidate_id, name, email, phone, school, school_year, majors
    from candidates where id = any(${f.ids}) order by sort_key`;
  const notesFor = (id: string) =>
    decisions.filter((d) => d.candidateId === id && d.note)
             .map((d) => ({ round: d.round, text: d.note as string }));

  return NextResponse.json({
    jobTitle: job.title,
    round: f.round,
    finalists: people.map((p) => ({
      id: p.id, candidateId: p.candidate_id, name: p.name, email: p.email, phone: p.phone,
      school: p.school, schoolYear: p.school_year, majors: p.majors,
      notes: notesFor(p.id as string),
    })),
  });
}
