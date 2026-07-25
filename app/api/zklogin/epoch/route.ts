import { NextResponse } from "next/server";
import { createSuiClient } from "@/lib/sui/client";

export const runtime = "nodejs";

/** GET /api/zklogin/epoch → { epoch }. The browser needs the current epoch to
 *  pick `maxEpoch` when it creates the ephemeral session.
 *
 *  Sui mainnet epochs are ~24h, so the default 2-epoch session is ~48h. */
export async function GET() {
  const client = createSuiClient();
  const { epoch } = await client.getLatestSuiSystemState();
  return NextResponse.json({ epoch: Number(epoch) });
}
