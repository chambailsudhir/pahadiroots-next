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
// Anthropic's Messages API has no audio-input support, so there is no
// Claude fallback here. If GEMINI_API_KEY is not configured, transcription
// is simply unavailable and the client shows a "please type instead"
// message — it never breaks the rest of the chat widget.

import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const GEMINI_KEY = process.env.GEMINI_API_KEY
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`

// Hard cap on the base64 payload we'll accept. A 60-second clip at any of
// the mime types the client uses comes in well under this; this just stops
// a stray/huge request from reaching Gemini.
const MAX_BASE64_LEN = 11_000_000

// Mirrors the language codes already used in ai-assistant.js's LANG_NAMES,
// used only to hint Gemini toward the expected language — it still
// transcribes whatever language is actually spoken.
const LANG_HINTS: Record<string, string> = {
  en: 'English', hi: 'Hindi', pa: 'Punjabi', bn: 'Bengali', ta: 'Tamil', te: 'Telugu',
  mr: 'Marathi', gu: 'Gujarati', kn: 'Kannada', ml: 'Malayalam', or: 'Odia', as: 'Assamese',
  ne: 'Nepali', doi: 'Dogri', kngr: 'Kangri Pahari (Himachali)', garh: 'Garhwali',
  kum: 'Kumaoni', lad: 'Ladakhi', ur: 'Urdu', sa: 'Sanskrit', mai: 'Maithili', kok: 'Konkani',
  mni: 'Manipuri', si: 'Sinhala', nag: 'Nagamese', bodo: 'Bodo', mizo: 'Mizo', khasi: 'Khasi',
  sikkimese: 'Sikkimese', zh: 'Chinese', ja: 'Japanese', ko: 'Korean', ar: 'Arabic',
  fr: 'French', de: 'German', es: 'Spanish', ru: 'Russian', pt: 'Portuguese',
}

export async function POST(req: NextRequest) {
  if (!GEMINI_KEY) {
    return NextResponse.json(
      { error: 'Voice transcription is not configured on this server.' },
      { status: 501 }
    )
  }

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { audio, mimeType, lang } = body || {}

  if (!audio || typeof audio !== 'string') {
    return NextResponse.json({ error: 'Missing audio data' }, { status: 400 })
  }
  if (audio.length > MAX_BASE64_LEN) {
    return NextResponse.json({ error: 'Recording too long' }, { status: 413 })
  }
  if (!mimeType || typeof mimeType !== 'string') {
    return NextResponse.json({ error: 'Missing mimeType' }, { status: 400 })
  }

  const langName = typeof lang === 'string' ? LANG_HINTS[lang] : null

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

    if (!geminiRes.ok) {
      console.error('[api/transcribe] Gemini error:', data?.error?.message || geminiRes.status)
      return NextResponse.json(
        { error: data?.error?.message || 'Transcription failed' },
        { status: geminiRes.status }
      )
    }

    const text = (data.candidates?.[0]?.content?.parts || [])
      .map((p: any) => p.text || '')
      .join('')
      .trim()

    return NextResponse.json({ text }, { status: 200 })
  } catch (err: any) {
    console.error('[api/transcribe] fetch error:', err.message)
    return NextResponse.json({ error: 'Transcription service unavailable' }, { status: 500 })
  }
}
