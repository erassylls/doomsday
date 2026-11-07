import { respond, loadState } from '@/lib/server-store';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  return respond(request, () => loadState());
}
