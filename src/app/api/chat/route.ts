// src/app/api/chat/route.ts
// Ported 1:1 from the old site's api/chat.js (Vercel serverless function) to
// Next.js 16 App Router, for the Pahadi_AI widget (public/js/ai-assistant.js).
// Primary: Google Gemini | Fallback: Claude (Anthropic)
// Keys stored in Vercel Environment Variables — never exposed to browser.

import { NextRequest, NextResponse } from 'next/server'
import { guardAiRequest, readCappedJson, sanitizeChatContents, sanitizeSystemText, CHAT_LIMITS } from '@/lib/api/aiGuard'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const GEMINI_KEY = process.env.GEMINI_API_KEY
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent'
const UPSTREAM_TIMEOUT_MS = 20_000
const CLAUDE_URL = 'https://api.anthropic.com/v1/messages'

export async function POST(req: NextRequest) {
  // Oct 2026 audit (P0): this route used to forward whatever the browser sent. It is now
  // gated (same-origin, rate limits, daily cost ceiling) and the request is rebuilt from
  // validated fields only — callers can no longer pick tools or generation settings.
  const blocked = await guardAiRequest(req, {
    name: 'chat', maxBodyBytes: CHAT_LIMITS.maxBodyBytes, perMinute: 8, perHour: 60, perDayGlobal: 3000,
  })
  if (blocked) return blocked

  const parsed = await readCappedJson(req, CHAT_LIMITS.maxBodyBytes)
  if (!parsed.ok) return parsed.res

  const contentsClean = sanitizeChatContents(parsed.body?.contents)
  const systemClean = sanitizeSystemText(parsed.body?.system_instruction)
  if (!contentsClean || systemClean === null) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
  const contents = contentsClean
  const systemText = systemClean
  const system_instruction = systemText ? { parts: [{ text: systemText }] } : undefined

  // ── 1. Try Gemini first ──────────────────────────────────
  if (GEMINI_KEY) {
    try {
      const geminiRes = await fetch(GEMINI_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_KEY },
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
        body: JSON.stringify({
          system_instruction,
          contents,
          tools: [{ google_search: {} }],
          generationConfig: { temperature: 0.7, maxOutputTokens: 1024 },
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
    const messages = contents.map((c) => ({
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
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
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
