import type { ChatTurn } from '@/lib/api/aiGuard'

// Nov 2026 verification: /api/chat forwarded whatever history the browser sent, up to 12 turns × 8,000 chars (~96k chars of
// input tokens per request, paid by us, on every message). The history is client-controlled, so a "model" turn could also be
// any text the caller wanted the model to believe it had said earlier (a fabricated prior answer, a long jailbreak).
//  - each earlier turn is capped: model turns to what the server would have produced, user turns to the per-message limit;
//  - the whole history is capped at HISTORY_MAX_CHARS, keeping the NEWEST turns (the current question always survives);
//  - the kept history starts with a user turn, as both upstream APIs expect.
export const HISTORY_MAX_CHARS = 12_000
export const MODEL_TURN_MAX_CHARS = 2_000
export const USER_TURN_MAX_CHARS = 2_000

export function shapeChatHistory(contents: ChatTurn[]): ChatTurn[] {
  const capped = contents.map(c => {
    const max = c.role === 'model' ? MODEL_TURN_MAX_CHARS : USER_TURN_MAX_CHARS
    const text = c.parts[0].text
    return text.length > max ? { role: c.role, parts: [{ text: text.slice(0, max) }] } as ChatTurn : c
  })
  const kept: ChatTurn[] = []
  let total = 0
  for (let i = capped.length - 1; i >= 0; i--) {
    const len = capped[i].parts[0].text.length
    if (kept.length > 0 && total + len > HISTORY_MAX_CHARS) break
    kept.unshift(capped[i])
    total += len
  }
  while (kept.length > 1 && kept[0].role !== 'user') kept.shift()
  return kept
}
