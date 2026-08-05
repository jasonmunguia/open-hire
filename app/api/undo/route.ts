import { NextResponse } from "next/server";
import { sql, JOB_EXTERNAL_ID } from "@/lib/db";

/**
 * Undo the most recent decision.
 *
 * Decisions are append-only and the round state is replayed from them, so
 * deleting the newest row restores the previous state exactly — including
 * stepping back across a round boundary if that decision closed a round.
 */
export async function POST() {
  const [job] = await sql`select id from jobs where external_id = ${JOB_EXTERNAL_ID}`;
  if (!job) return NextResponse.json({ undone: false });

  const rows = await sql`
    delete from decisions
    where id = (
      select d.id from decisions d
      join candidates c on c.id = d.candidate_id
      where c.job_id = ${job.id}
      order by d.created_at desc
      limit 1
    )
    returning candidate_id`;

  return NextResponse.json({ undone: rows.length > 0 });
}
