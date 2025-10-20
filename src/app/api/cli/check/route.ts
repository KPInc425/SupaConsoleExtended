import { NextResponse } from 'next/server'
import { isSupabaseCliAvailable } from '@/lib/cli'

export async function GET() {
  const result = await isSupabaseCliAvailable()
  return NextResponse.json(result)
}
