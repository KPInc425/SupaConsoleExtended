import { NextRequest, NextResponse } from 'next/server'
import { validateSession } from '@/lib/auth'
import { prisma } from '@/lib/db'
import crypto from 'crypto'

interface RouteContext {
  params: Promise<{ id: string }>
}

function base64url(input: string) {
  return Buffer.from(input).toString('base64').replace(/=+$/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}

export async function GET(request: NextRequest, { params }: RouteContext) {
  const { id } = await params

  try {
    const sessionToken = request.cookies.get('session')?.value
    if (!sessionToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const session = await validateSession(sessionToken)
    if (!session) return NextResponse.json({ error: 'Invalid session' }, { status: 401 })

    // fetch project's env JWT_SECRET and STUDIO_PORT
    const rows = await prisma.projectEnvVar.findMany({ where: { projectId: id, key: { in: ['JWT_SECRET', 'STUDIO_PORT'] } } })
    const env: Record<string,string> = {}
    rows.forEach(r => { env[r.key] = r.value })

    const jwtSecret = env['JWT_SECRET'] || ''
  const studioPort = env['STUDIO_PORT'] || '3000'
  const kongPort = env['KONG_HTTP_PORT']

    if (!jwtSecret || jwtSecret.length !== 40) {
      return NextResponse.json({ error: 'Project JWT_SECRET missing or invalid length' }, { status: 500 })
    }

    const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
    const now = Math.floor(Date.now() / 1000)
    const payload = base64url(JSON.stringify({ role: 'service_role', iss: 'supabase', iat: now, exp: now + 300 }))
    const signature = crypto.createHmac('sha256', jwtSecret).update(`${header}.${payload}`).digest('base64').replace(/=+$/g, '').replace(/\+/g, '-').replace(/\//g, '_')
    const token = `${header}.${payload}.${signature}`

    // Return an HTML page that sets a cookie and redirects to studio
  // Prefer Kong gateway if available (it proxies to internal services)
  const studioUrl = kongPort ? `http://localhost:${kongPort}` : `http://localhost:${studioPort}`
    const expires = new Date(Date.now() + 300 * 1000).toUTCString()

    const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>
    <script>
  // set cookie for localhost so it is sent to Studio when accessed via Kong or direct port
  // Include SameSite=Lax to allow cross-port navigation in dev; Secure omitted for localhost
  document.cookie = "sb:token=${token}; Path=/; Expires=${expires}; SameSite=Lax";
      // small delay, then redirect
      setTimeout(() => { window.location.href = "${studioUrl}" }, 250);
    </script>
    <p>Redirecting to Supabase Studio...</p>
    </body></html>`

    return new Response(html, {
      status: 200,
      headers: { 'Content-Type': 'text/html' }
    })
  } catch (err) {
    console.error('Studio login error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
