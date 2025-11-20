import { NextResponse } from 'next/server'

export async function GET() {
  try {
    // Basic health check - could be extended to check DB connection
    return NextResponse.json({ 
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '0.1.0'
    }, { status: 200 })
  } catch (error) {
    return NextResponse.json({ 
      status: 'unhealthy',
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 503 })
  }
}
