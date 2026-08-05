import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

const ACTIONS = new Set(["reject", "auto_bid", "next_round"]);

export async function POST(request: Request) {
  const { candidateId, round, action, note } = await request.json();
  if (!ACTIONS.has(action)) {
    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  }
  // A note is only ever kept when the candidate advances. Enforced here, not in
  // the UI, so a stale client can never persist a note through a reject.
  const kept = action === "reject" ? null : (typeof note === "string" && note.trim() ? note.trim() : null);
  await sql`
    insert into decisions (candidate_id, round, action, note)
    values (${candidateId}, ${round}, ${action}, ${kept})`;
  return NextResponse.json({ ok: true });
}
