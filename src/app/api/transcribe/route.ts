// src/app/api/transcribe/route.ts
// Server-side speech-to-text for the Pahadi_AI widget's voice-input button
// (public/js/ai-assistant.js).
//
// The previous voice-input implementation used the browser's built-in
// SpeechRecognition API, which does not exist at all in iOS Safari (or any
// browser on iOS — they're all WebKit under the hood) and is unreliable in
// many Android in-app browsers/WebViews. That's why voice input didn't work
// on mobile.
//
// This route replaces that with server-side transcription: the client
// records a short audio clip with MediaRecorder (supported on effectively
// every platform, including iOS Safari 14.5+) and posts it here as base64.
// We transcribe it with Gemini's audio understanding, reusing the same
// GEMINI_API_KEY already used by /api/chat — no new credentials needed.
//
// Anthropic's Claude models have no audio-input support in the Messages
// API, so Claude can never do the transcription itself. What it CAN do is
// stand in as a *text* fallback: if Gemini is unavailable (quota exhausted,
// down, misconfigured, etc.), we ask Claude — reusing the same
// ANTHROPIC_KEY already used as the /api/chat fallback — to write a short,
// warm, correctly-worded message in the user's selected language telling
// them voice isn't available right now and to type their question instead.
// That also sidesteps hand-maintaining "please type" translations for the
// ~35 languages the widget supports.

import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const GEMINI_KEY = process.env.GEMINI_API_KEY
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY

const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`
const CLAUDE_URL = 'https://api.anthropic.com/v1/messages'

// Hard cap on the base64 payload we'll accept. A 60-second clip at any of
// the mime types the client uses comes in well under this; this just stops
// a stray/huge request from reaching Gemini.
const MAX_BASE64_LEN = 11_000_000

// Mirrors the language codes already used in ai-assistant.js's LANG_NAMES.
// Used both to hint Gemini toward the expected language (it still
// transcribes whatever is actually spoken) and to tell Claude which
// language to write the fallback message in.
const LANG_HINTS: Record<string, string> = {
  en: 'English', hi: 'Hindi', pa: 'Punjabi', bn: 'Bengali', ta: 'Tamil', te: 'Telugu',
  mr: 'Marathi', gu: 'Gujarati', kn: 'Kannada', ml: 'Malayalam', or: 'Odia', as: 'Assamese',
  ne: 'Nepali', doi: 'Dogri', kngr: 'Kangri Pahari (Himachali)', garh: 'Garhwali',
  kum: 'Kumaoni', lad: 'Ladakhi', ur: 'Urdu', sa: 'Sanskrit', mai: 'Maithili', kok: 'Konkani',
  mni: 'Manipuri', si: 'Sinhala', nag: 'Nagamese', bodo: 'Bodo', mizo: 'Mizo', khasi: 'Khasi',
  sikkimese: 'Sikkimese', zh: 'Chinese', ja: 'Japanese', ko: 'Korean', ar: 'Arabic',
  fr: 'French', de: 'German', es: 'Spanish', ru: 'Russian', pt: 'Portuguese',
}

// Used if BOTH Gemini and Claude are unavailable — the last resort.
const HARDCODED_FALLBACK = "🎤 Voice input isn't available right now. Please type your question instead!"

async function claudeFallbackMessage(langName: string | null): Promise<string | null> {
  if (!ANTHROPIC_KEY) return null

  const instruction = langName
    ? `Write ONE short, warm sentence in ${langName} telling a shopper that voice input isn't working right now and asking them to type their question instead. Start it with a 🎤 emoji. Output ONLY that sentence — no preamble, no quotes, no translation, no alternatives.`
    : `Write ONE short, warm sentence in English telling a shopper that voice input isn't working right now and asking them to type their question instead. Start it with a 🎤 emoji. Output ONLY that sentence — no preamble, no quotes, no alternatives.`

  try {
    const res = await fetch(CLAUDE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 100,
        messages: [{ role: 'user', content: instruction }],
      }),
    })
    if (!res.ok) return null
    const data = await res.json()
    const text = (data.content?.[0]?.text || '').trim()
    return text || null
  } catch (err: any) {
    console.error('[api/transcribe] Claude fallback error:', err.message)
    return null
  }
}

export async function POST(req: NextRequest) {
  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { audio, mimeType, lang } = body || {}
  const langName = typeof lang === 'string' ? LANG_HINTS[lang] || null : null

  if (!audio || typeof audio !== 'string') {
    return NextResponse.json({ error: 'Missing audio data' }, { status: 400 })
  }
  if (audio.length > MAX_BASE64_LEN) {
    return NextResponse.json({ error: 'Recording too long' }, { status: 413 })
  }
  if (!mimeType || typeof mimeType !== 'string') {
    return NextResponse.json({ error: 'Missing mimeType' }, { status: 400 })
  }

  // ── If Gemini isn't even configured, go straight to the Claude fallback ──
  if (!GEMINI_KEY) {
    const msg = await claudeFallbackMessage(langName)
    return NextResponse.json({ text: '', message: msg || HARDCODED_FALLBACK }, { status: 200 })
  }

  const prompt = langName
    ? `Transcribe the speech in this audio clip verbatim, in ${langName} if that is the language spoken (otherwise transcribe in whatever language is actually spoken). Output ONLY the transcript text — no preamble, no quotes, no commentary. If the audio has no discernible speech, output nothing.`
    : `Transcribe the speech in this audio clip verbatim. Output ONLY the transcript text — no preamble, no quotes, no commentary. If the audio has no discernible speech, output nothing.`

  try {
    const geminiRes = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              { inline_data: { mime_type: mimeType, data: audio } },
              { text: prompt },
            ],
          },
        ],
        generationConfig: { temperature: 0.0, maxOutputTokens: 512 },
      }),
    })

    const data = await geminiRes.json()

    // ── Gemini unavailable (quota, rate limit, outage, bad key, etc.) ──
    // Fall back to Claude for a friendly localized message. This is a text
    // fallback only — Claude cannot transcribe the audio itself.
    if (!geminiRes.ok) {
      console.warn(
        '[api/transcribe] Gemini failed:',
        data?.error?.message || geminiRes.status,
        '— using Claude fallback message'
      )
      const msg = await claudeFallbackMessage(langName)
      return NextResponse.json({ text: '', message: msg || HARDCODED_FALLBACK }, { status: 200 })
    }

    const text = (data.candidates?.[0]?.content?.parts || [])
      .map((p: any) => p.text || '')
      .join('')
      .trim()

    return NextResponse.json({ text }, { status: 200 })
  } catch (err: any) {
    console.error('[api/transcribe] Gemini fetch error:', err.message, '— using Claude fallback message')
    const msg = await claudeFallbackMessage(langName)
    return NextResponse.json({ text: '', message: msg || HARDCODED_FALLBACK }, { status: 200 })
  }
}
