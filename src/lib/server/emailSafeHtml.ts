// lib/server/emailSafeHtml.ts — make e-mail HTML survive Outlook (outlook.com / Outlook desktop / Hotmail).
//
// Found Nov 2026 from a real Outlook screenshot of the sign-up verification mail: the dark-green header and the green "Verify my
// email" button were invisible. Outlook drops the WHOLE `background:` declaration when it holds a CSS gradient (and is unreliable
// with the `background:` shorthand), so white text ended up on the beige page (brand name unreadable) and the white button label sat on
// nothing (the button vanished). Gmail / Apple Mail were fine, which is why it was never noticed.
//
// Applied centrally to every outgoing e-mail so no template can reintroduce it:
//   background:linear-gradient(135deg,#1a3a1e,#2d6a4f)  ->  background-color:#1a3a1e   (first colour of the gradient)
//   background:#1a3a1e                                   ->  background-color:#1a3a1e
// Anything else (url(), named colours, multi-value shorthands) is left untouched.
export function emailSafeHtml(html: string): string {
  return html
    .replace(/background:\s*(?:repeating-)?linear-gradient\(\s*(?:[^,()#]+,\s*)?(#[0-9a-fA-F]{3,8})[^)]*\)/g, 'background-color:$1')
    .replace(/background:\s*(#[0-9a-fA-F]{3,8})(?=\s*(?:;|"|'|!important))/g, 'background-color:$1')
}
