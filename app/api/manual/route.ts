import { respond, saveManualEvaluation } from '@/lib/server-store';

export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  return respond(request, () => saveManualEvaluation(request));
}
