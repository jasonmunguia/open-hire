import { NextResponse } from "next/server";
import { sql, JOB_EXTERNAL_ID } from "@/lib/db";
import { roundState, type Decision } from "@/lib/rounds";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const name = new URL(request.url).searchParams.get("name") ?? "next";
  const [job] = await sql`select id from jobs where external_id = ${JOB_EXTERNAL_ID}`;
  if (!job) return NextResponse.json({ candidates: [] });

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

  const s = roundState(all, decisions);
  const ids = name === "auto" ? s.held : name === "rejected" ? s.rejected : s.survivors;
  if (!ids.length) return NextResponse.json({ candidates: [] });

  const people = await sql`
    select id, name, school, school_year, majors, email, phone
    from candidates where id = any(${ids}) order by sort_key`;

  const notesFor = (id: string) =>
    decisions.filter((d) => d.candidateId === id && d.note)
             .map((d) => ({ round: d.round, text: d.note as string }));

  return NextResponse.json({
    candidates: people.map((p) => ({
      id: p.id, name: p.name, school: p.school, schoolYear: p.school_year,
      majors: p.majors, email: p.email, phone: p.phone,
      autoBid: s.held.includes(p.id as string),
      notes: notesFor(p.id as string),
    })),
  });
}
