// src/app/api/chat/route.ts
// Ported 1:1 from the old site's api/chat.js (Vercel serverless function) to
// Next.js 16 App Router, for the Pahadi_AI widget (public/js/ai-assistant.js).
// Primary: Google Gemini | Fallback: Claude (Anthropic)
// Keys stored in Vercel Environment Variables — never exposed to browser.

import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const GEMINI_KEY = process.env.GEMINI_API_KEY
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY

const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`
const CLAUDE_URL = 'https://api.anthropic.com/v1/messages'

export async function POST(req: NextRequest) {
  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { contents, system_instruction, generationConfig } = body || {}
  const systemText = system_instruction?.parts?.[0]?.text || ''

  // ── 1. Try Gemini first ──────────────────────────────────
  if (GEMINI_KEY) {
    try {
      const geminiRes = await fetch(GEMINI_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction,
          contents,
          tools: [{ google_search: {} }],
          generationConfig: generationConfig || {
            temperature: 0.7,
            maxOutputTokens: 1024,
          },
        }),
      })

      const data = await geminiRes.json()

      if (geminiRes.ok && data.candidates?.[0]) {
        console.log('[api/chat] Gemini responded OK')
        return NextResponse.json(data, { status: 200 })
      }

      console.warn(
        '[api/chat] Gemini failed:',
        data.error?.message || geminiRes.status,
        '— trying Claude fallback'
      )
    } catch (err: any) {
      console.warn('[api/chat] Gemini fetch error:', err.message, '— trying Claude fallback')
    }
  }

  // ── 2. Fallback: Claude (Anthropic) ─────────────────────
  if (!ANTHROPIC_KEY) {
    return NextResponse.json(
      { error: 'Both Gemini and Claude are unavailable' },
      { status: 500 }
    )
  }

  try {
    // Convert Gemini-style contents to Anthropic messages format
    const messages = (contents || []).map((c: any) => ({
      role: c.role === 'model' ? 'assistant' : 'user',
      content: c.parts?.[0]?.text || '',
    }))

    const claudeRes = await fetch(CLAUDE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        system: systemText,
        messages,
      }),
    })

    const claudeData = await claudeRes.json()

    if (!claudeRes.ok) {
      console.error('[api/chat] Claude also failed:', claudeData.error?.message)
      return NextResponse.json(
        { error: claudeData.error?.message || 'Claude error' },
        { status: claudeRes.status }
      )
    }

    // Convert Claude response → Gemini-style format so the frontend widget
    // works without any changes.
    const text = claudeData.content?.[0]?.text || ''
    console.log('[api/chat] Claude fallback responded OK')

    return NextResponse.json(
      {
        candidates: [
          {
            content: { parts: [{ text }], role: 'model' },
            finishReason: 'STOP',
          },
        ],
      },
      { status: 200 }
    )
  } catch (err: any) {
    console.error('[api/chat] Claude fetch error:', err.message)
    return NextResponse.json(
      { error: 'All AI services unavailable. Please try again.' },
      { status: 500 }
    )
  }
}
