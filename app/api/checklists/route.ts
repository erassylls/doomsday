import { respond, createChecklist } from '@/lib/server-store';

export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  return respond(request, () => createChecklist(request));
}
