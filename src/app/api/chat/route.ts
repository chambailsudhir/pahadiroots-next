// src/app/api/chat/route.ts
// Ported 1:1 from the old site's api/chat.js (Vercel serverless function) to
// Next.js 16 App Router, for the Pahadi_AI widget (public/js/ai-assistant.js).
// Primary: Google Gemini | Fallback: Claude (Anthropic)
// Keys stored in Vercel Environment Variables — never exposed to browser.

import { NextRequest, NextResponse } from 'next/server'
import { guardAiRequest, readCappedJson, sanitizeChatContents, getClientIp } from '@/lib/api/aiGuard'
import { checkRateLimitKv } from '@/lib/api/rateLimitKv'
import { buildChatSystemPrompt, resolveChatLang, CHAT_ROUTE_LIMITS } from './systemPrompt'
import { getRequestId, requestLogger, REQUEST_ID_HEADER } from '@/lib/logger'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const GEMINI_KEY = process.env.GEMINI_API_KEY
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent'
const UPSTREAM_TIMEOUT_MS = 20_000
const CLAUDE_URL = 'https://api.anthropic.com/v1/messages'

export async function POST(req: NextRequest) {
  const requestId = getRequestId(req.headers)
  const log = requestLogger(requestId, { route: 'chat' })
  const withId = (res: NextResponse) => { res.headers.set(REQUEST_ID_HEADER, requestId); return res }

  // Oct 2026 audit (P0): this route used to forward whatever the browser sent. It is now
  // gated (same-origin, rate limits, daily cost ceiling) and the request is rebuilt from
  // validated fields only — callers can no longer pick tools or generation settings.
  const blocked = await guardAiRequest(req, {
    name: 'chat', maxBodyBytes: CHAT_ROUTE_LIMITS.maxBodyBytes,
    perMinute: CHAT_ROUTE_LIMITS.perMinute, perHour: CHAT_ROUTE_LIMITS.perHour, perDayGlobal: CHAT_ROUTE_LIMITS.perDayGlobal,
  })
  if (blocked) return withId(blocked)

  // AUDIT S2-008: per-IP daily cap sits in front of the global ceiling so a single actor cannot
  // trip the shared 3000/day switch and deny the assistant to everyone else.
  if (!await checkRateLimitKv(`mw:rl:ai_chat_day:${getClientIp(req)}`, CHAT_ROUTE_LIMITS.perDayPerIp, 86400)) {
    return withId(NextResponse.json({ error: 'Daily limit reached — please try again tomorrow' }, { status: 429, headers: { 'Retry-After': '86400' } }))
  }

  const parsed = await readCappedJson(req, CHAT_ROUTE_LIMITS.maxBodyBytes)
  if (!parsed.ok) return withId(parsed.res)

  // AUDIT S2-008: the system prompt is server-owned. A client that tries to supply one (or tools /
  // generation settings) is refused outright rather than silently ignored, so misuse is visible.
  if (parsed.body?.system_instruction !== undefined || parsed.body?.tools !== undefined || parsed.body?.generationConfig !== undefined) {
    return withId(NextResponse.json({ error: 'Invalid request' }, { status: 400 }))
  }

  const contentsClean = sanitizeChatContents(parsed.body?.contents)
  if (!contentsClean) {
    return withId(NextResponse.json({ error: 'Invalid request' }, { status: 400 }))
  }
  const lastUser = contentsClean[contentsClean.length - 1].parts[0].text
  if (lastUser.length > CHAT_ROUTE_LIMITS.maxUserTurnChars) {
    return withId(NextResponse.json({ error: 'Message too long' }, { status: 413 }))
  }
  const contents = contentsClean
  const { code: langCode, name: langName } = resolveChatLang(parsed.body?.lang)
  const systemText = buildChatSystemPrompt(langCode, langName)
  const system_instruction = { parts: [{ text: systemText }] }

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
        log.info('chat_gemini_ok')
        return withId(NextResponse.json(data, { status: 200 }))
      }

      log.warn('chat_gemini_failed', { upstream: data.error?.message || geminiRes.status })
    } catch (err: unknown) {
      log.warn('chat_gemini_fetch_error', { error: err instanceof Error ? err.message : String(err) })
    }
  }

  // ── 2. Fallback: Claude (Anthropic) ─────────────────────
  if (!ANTHROPIC_KEY) {
    return withId(NextResponse.json(
      { error: 'The assistant is unavailable right now. Please try again later.' },
      { status: 503 }
    ))
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
      // AUDIT S2-022: upstream error text is logged, never relayed to the browser.
      log.error('chat_claude_failed', { status: claudeRes.status, upstream: claudeData.error?.message })
      return withId(NextResponse.json(
        { error: 'The assistant is unavailable right now. Please try again later.' },
        { status: 503 }
      ))
    }

    // Convert Claude response → Gemini-style format so the frontend widget
    // works without any changes.
    const text = claudeData.content?.[0]?.text || ''
    log.info('chat_claude_fallback_ok')

    return withId(NextResponse.json(
      {
        candidates: [
          {
            content: { parts: [{ text }], role: 'model' },
            finishReason: 'STOP',
          },
        ],
      },
      { status: 200 }
    ))
  } catch (err: unknown) {
    log.error('chat_claude_fetch_error', { error: err instanceof Error ? err.message : String(err) })
    return withId(NextResponse.json(
      { error: 'All AI services unavailable. Please try again.' },
      { status: 503 }
    ))
  }
}
