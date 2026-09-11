// Ballpoint Breach - Multiplayer Worker
// Routes WebSocket connections to Durable Object rooms

export { GameRoom } from './room';

interface Env {
  ROOMS: DurableObjectNamespace;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Upgrade, Connection, Sec-WebSocket-Key, Sec-WebSocket-Version',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // Health check
    if (url.pathname === '/health') {
      return new Response('OK', { headers: corsHeaders });
    }

    // WebSocket connection to room
    if (url.pathname === '/room') {
      const code = url.searchParams.get('code');
      
      if (!code || code.length !== 6) {
        return new Response('Invalid room code', { status: 400, headers: corsHeaders });
      }

      // Get or create Durable Object for this room
      const roomId = env.ROOMS.idFromName(code);
      const room = env.ROOMS.get(roomId);

      // Forward request to DO
      return room.fetch(request);
    }

    // Create room - generate code
    if (url.pathname === '/create') {
      const code = generateRoomCode();
      return new Response(JSON.stringify({ code }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response('Not found', { status: 404, headers: corsHeaders });
  },
};

function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Exclude confusing chars
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}
