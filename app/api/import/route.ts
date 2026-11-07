import { respond, importDataset } from '@/lib/server-store';

export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  return respond(request, () => importDataset(request));
}
