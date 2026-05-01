'use client';
import { useState, useRef, useEffect } from 'react';

const QUICK_ACTIONS = [
  { label: 'Honey Description',    prompt: 'Write a compelling product description for Himalayan Wild Honey in both Hindi and English. Tone warm and authentic. Include sourcing story, 5 benefits, how to use, and why buy from 5 Pahadi Roots.' },
  { label: 'Saffron Description',  prompt: 'Write a product description for Kashmiri Saffron from Pampore in English and Hindi. Highlight Grade-A quality, authenticity test tips, and premium positioning.' },
  { label: 'Draft Customer Reply', prompt: 'Draft a professional empathetic customer service reply for: "My ghee arrived melted and looks different from the photo. Is it still good to use?"' },
  { label: '5 Instagram Captions', prompt: 'Write 5 Instagram captions for Kashmiri Saffron. Mix Hindi and English. Include emojis, a story hook, key benefit, and 8 relevant hashtags per post for Indian health audience.' },
  { label: 'WhatsApp Broadcast',   prompt: 'Write a WhatsApp broadcast for Wild Honey — announce a weekend offer. Personal tone, under 200 words, clear CTA. Write in both Hindi and English versions.' },
  { label: 'Market Research',      prompt: 'Search the web: What are the top trending Himalayan superfoods and natural health products in India right now? What are competitors charging for similar products?' },
  { label: 'Gift Combo Ideas',     prompt: 'Suggest 5 Himalayan gift combos from our product range at different price points: under Rs.500, Rs.500-1000, Rs.1000-2000, Rs.2000-3000, above Rs.3000. Give each combo a catchy name.' },
  { label: 'Content Calendar',     prompt: 'Create a 2-week social media content calendar for 5 Pahadi Roots. Mix: product features, health tips, founder stories, sourcing journeys, seasonal themes, and engagement posts.' },
  { label: 'Blog Post Outline',    prompt: 'Create a detailed blog outline: "Why Ladakhi Shilajit is the Ultimate Himalayan Superfood for Modern Indians" — include headline options, 7 sections, health benefits, sourcing story, buying guide, FAQ, CTA.' },
  { label: 'Reply to Review',      prompt: 'Draft a personal, grateful reply to this 5-star review: "Best honey I have ever tasted! Totally pure and natural, my whole family is hooked. Will order again!"' },
];

const CW_TYPES = [
  { value: 'desc',     label: 'Product Description' },
  { value: 'social',   label: 'Social Media (5 posts)' },
  { value: 'email',    label: 'Email Campaign' },
  { value: 'seo',      label: 'SEO Meta Tags' },
  { value: 'reply',    label: 'Customer Reply Templates' },
  { value: 'blog',     label: 'Blog Post Outline' },
  { value: 'whatsapp', label: 'WhatsApp Broadcast' },
  { value: 'story',    label: 'Brand Story' },
];

const PRODUCTS = [
  'Himalayan Wild Honey','A2 Bilona Ghee','Kashmiri Saffron','Ladakhi Shilajit',
  'Kangra Green Tea','Assam Tea','Lakadong Turmeric','Large Cardamom',
  'Black Rice','Bamboo Shoot','Bhut Jolokia Chilli','Cold Pressed Mustard Oil',
  'Joha Rice','Pahadi Basmati Rice',
];

const TONES = ['Warm & Friendly','Professional','Exciting & Bold','Educational','Luxury Premium','Conversational','Storytelling'];

const INSIGHT_PROMPTS = [
  'What are the top selling Himalayan products in India right now?',
  'Which products should I stock up on before Diwali/festive season?',
  'Draft a response to our most common customer complaint about delivery',
  'What pricing strategy should I use for premium Saffron?',
  'Suggest reorder priorities if Honey and Shilajit are running low',
  'What new Himalayan products are trending that we should add?',
];

export default function AIAssistantPage() {
  const [activeTab, setActiveTab]   = useState('chat');
  const [preferred, setPreferred]   = useState('gemini');
  const [keyStatus, setKeyStatus]   = useState({ gemini: null, claude: null });
  const [messages, setMessages]     = useState([]);
  const [input, setInput]           = useState('');
  const [loading, setLoading]       = useState(false);
  const [history, setHistory]       = useState([]);
  const msgsRef = useRef(null);

  const [cwType, setCwType]         = useState('desc');
  const [cwProduct, setCwProduct]   = useState(PRODUCTS[0]);
  const [cwTone, setCwTone]         = useState(TONES[0]);
  const [cwLang, setCwLang]         = useState('both');
  const [cwOutput, setCwOutput]     = useState('');
  const [cwLoading, setCwLoading]   = useState(false);
  const [copied, setCopied]         = useState(false);

  const [insightQ, setInsightQ]             = useState('');
  const [insightA, setInsightA]             = useState('');
  const [insightLoading, setInsightLoading] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem('pahadi_ai_preferred');
    if (saved === 'claude' || saved === 'gemini') setPreferred(saved);
  }, []);

  useEffect(() => {

    setMessages([{
      role: 'bot',
      text: 'Namaste Sudhir!\n\nI\'m **Pahadi Assist** — your business AI.\n\nI can help with:\n• Product descriptions and SEO content in Hindi and English\n• Customer service replies and email campaigns\n• Market research and competitor analysis\n• Gift combos, pricing strategy, content calendars\n• WhatsApp broadcasts and Instagram captions\n• Any business question — no restrictions!\n\nWhat shall we work on today?',
    }]);
  }, []);

  useEffect(() => {
    if (msgsRef.current) msgsRef.current.scrollTop = msgsRef.current.scrollHeight;
  }, [messages, loading]);

  function togglePreferred() {
    const next = preferred === 'gemini' ? 'claude' : 'gemini';
    setPreferred(next);
    localStorage.setItem('pahadi_ai_preferred', next);
  }

  async function callAI(msgs, allowFallback = true) {
    const pw = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('pr_pw') : '';
    const res = await fetch('/api/ai-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-pw': pw || '' },
      body: JSON.stringify({ messages: msgs, preferred, allowFallback }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'HTTP ' + res.status);
    if (data.keyStatus) setKeyStatus(data.keyStatus);
    return data;
  }

  async function sendMessage(text) {
    const msg = (text || input).trim();
    if (!msg || loading) return;
    setInput('');
    const newHistory = [...history, { role: 'user', content: msg }];
    setMessages(m => [...m, { role: 'user', text: msg }]);
    setHistory(newHistory);
    setLoading(true);
    try {
      const result = await callAI(newHistory.slice(-14));
      setMessages(m => [...m, {
        role: 'bot',
        text: result.text,
        sources: result.sources || [],
        provider: result.provider,
        usedFallback: result.usedFallback,
        primaryError: result.primaryError,
      }]);
      setHistory(h => [...h, { role: 'assistant', content: result.text }]);
    } catch(e) {
      setMessages(m => [...m, { role: 'bot', text: 'Error: ' + e.message, isError: true }]);
    }
    setLoading(false);
  }

  async function generateContent() {
    const langStr = cwLang === 'both' ? 'in BOTH English and Hindi (clearly separated with headings)'
      : cwLang === 'hi' ? 'in Hindi only' : 'in English only';
    const prompts = {
      desc:     'Write a compelling conversion-focused product description for "' + cwProduct + '" ' + langStr + '. Tone: ' + cwTone + '. Include: what it is, exact Himalayan/regional origin, 5 specific benefits, how to use in 3 steps, why buy from 5 Pahadi Roots. Be authentic and specific, no generic marketing language.',
      social:   'Write 5 social media posts for "' + cwProduct + '" ' + langStr + '. Tone: ' + cwTone + '. Each post: hook opening line, key benefit or story, emojis, 8 relevant hashtags for Indian health audience. Mix Instagram and Facebook formats.',
      email:    'Write a complete email campaign for "' + cwProduct + '" ' + langStr + '. Tone: ' + cwTone + '. Include: subject line (under 50 chars), preview text (under 90 chars), email body with story/benefits/social proof/CTA, PS line.',
      seo:      'Write SEO meta tags for the "' + cwProduct + '" product page on pahadiroots.com ' + langStr + ':\n1. Meta title (under 60 chars)\n2. Meta description (under 155 chars)\n3. 10 target keywords mixing long-tail and short',
      reply:    'Draft 3 customer service reply templates for "' + cwProduct + '" ' + langStr + '. Tone: ' + cwTone + '. Cover:\n1. Quality concern\n2. Delivery delay\n3. Positive review response',
      blog:     'Create a detailed blog outline for "' + cwProduct + '" ' + langStr + ':\n1. 3 headline options\n2. Introduction hook\n3. 7 main sections with subheadings\n4. Health benefits\n5. Sourcing story\n6. How to use / recipes\n7. Buying guide\n8. 5 FAQs\n9. CTA conclusion',
      whatsapp: 'Write 3 WhatsApp broadcast messages for "' + cwProduct + '" ' + langStr + '. Tone: ' + cwTone + '.\n1. Product feature highlight\n2. Limited/seasonal offer\n3. Health tip featuring the product\nEach under 250 words. End with pahadiroots.com',
      story:    'Write a brand story connecting 5 Pahadi Roots to "' + cwProduct + '" ' + langStr + '. Tone: ' + cwTone + '. Include: origin region, farming community, our sourcing journey, what makes our version special, mountain to home story. Make it emotional and authentic.',
    };
    setCwLoading(true); setCwOutput('');
    try {
      const result = await callAI([{ role: 'user', content: prompts[cwType] }], true);
      setCwOutput(result.text + (result.usedFallback ? '\n\n[Note: Used ' + result.provider + ' as fallback]' : ''));
    } catch(e) {
      setCwOutput('Error: ' + e.message);
    }
    setCwLoading(false);
  }

  async function runInsight() {
    if (!insightQ.trim()) return;
    setInsightLoading(true); setInsightA('');
    try {
      const result = await callAI([{ role: 'user', content: insightQ }], true);
      setInsightA(result.text);
    } catch(e) {
      setInsightA('Error: ' + e.message);
    }
    setInsightLoading(false);
  }

  function copyText(t) {
    navigator.clipboard.writeText(t || cwOutput).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 2000);
    });
  }

  function renderText(t) {
    return (t||'').replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>').replace(/\n/g,'<br/>');
  }

  const activeKeyAvailable = preferred === 'gemini' ? keyStatus.gemini : keyStatus.claude;
  const fallbackAvailable  = preferred === 'gemini' ? keyStatus.claude : keyStatus.gemini;
  const anyKeyAvailable    = keyStatus.gemini || keyStatus.claude;
  const statusLoading      = keyStatus.gemini === null;

  let statusLabel, statusColor;
  if (statusLoading)           { statusLabel = 'Checking…'; statusColor = 'var(--tx2,#8b949e)'; }
  else if (!anyKeyAvailable)   { statusLabel = 'No Keys Set'; statusColor = '#f85149'; }
  else if (activeKeyAvailable) { statusLabel = (preferred === 'gemini' ? 'Gemini' : 'Claude') + ' Ready'; statusColor = '#3fb950'; }
  else if (fallbackAvailable)  { statusLabel = 'Auto → ' + (preferred === 'gemini' ? 'Claude' : 'Gemini'); statusColor = '#d29922'; }
  else                         { statusLabel = 'Key Missing'; statusColor = '#f85149'; }

  const s = {
    card:   { background:'var(--bg2,#161b22)', border:'1px solid var(--bd,#30363d)', borderRadius:12 },
    input:  { background:'var(--bg,#0d1117)', border:'1px solid var(--bd,#30363d)', borderRadius:8, padding:'9px 12px', color:'var(--tx,#e6edf3)', fontSize:13, fontFamily:'inherit', outline:'none', width:'100%', boxSizing:'border-box' },
    btn:    { background:'var(--accent,#3fb950)', color:'#fff', border:'none', borderRadius:8, padding:'8px 18px', fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'inherit' },
    btnSm:  { background:'var(--bg2,#161b22)', color:'var(--tx2,#8b949e)', border:'1px solid var(--bd,#30363d)', borderRadius:6, padding:'5px 12px', fontSize:12, cursor:'pointer', fontFamily:'inherit' },
    tab:    (a) => ({ padding:'8px 16px', fontSize:13, fontWeight:a?600:400, cursor:'pointer', border:'none', background:'none', color:a?'var(--accent,#3fb950)':'var(--tx2,#8b949e)', borderBottom:a?'2px solid var(--accent,#3fb950)':'2px solid transparent', fontFamily:'inherit' }),
    label:  { fontSize:10, color:'var(--tx2,#8b949e)', textTransform:'uppercase', letterSpacing:'0.7px', fontWeight:600, marginBottom:6, display:'block' },
    select: { background:'var(--bg,#0d1117)', border:'1px solid var(--bd,#30363d)', borderRadius:8, padding:'8px 10px', color:'var(--tx,#e6edf3)', fontSize:13, fontFamily:'inherit', outline:'none', width:'100%', marginBottom:12, boxSizing:'border-box' },
    bubble: (role) => ({ maxWidth:'80%', padding:'10px 14px', borderRadius:14, fontSize:13, lineHeight:1.65, background:role==='user'?'var(--accent,#3fb950)':'var(--bg2,#161b22)', color:role==='user'?'#fff':'var(--tx,#e6edf3)', border:role==='user'?'none':'1px solid var(--bd,#30363d)', borderBottomRightRadius:role==='user'?4:14, borderBottomLeftRadius:role==='user'?14:4, alignSelf:role==='user'?'flex-end':'flex-start', whiteSpace:'pre-wrap' }),
  };

  const AIToggle = () => (
    <div style={{ display:'flex', alignItems:'center', gap:8 }}>
      <span style={{ fontSize:11, color: preferred==='gemini'?'#f0a500':'var(--tx2,#8b949e)', fontWeight: preferred==='gemini'?700:400 }}>🔵 Gemini</span>
      <div onClick={togglePreferred} style={{ width:42, height:22, borderRadius:11, cursor:'pointer', position:'relative', background: preferred==='claude'?'var(--accent,#3fb950)':'#f0a500', transition:'background 0.2s', border:'1px solid var(--bd,#30363d)' }}>
        <div style={{ position:'absolute', top:2, width:16, height:16, borderRadius:'50%', background:'#fff', transition:'left 0.2s', left: preferred==='claude'?22:2, boxShadow:'0 1px 3px rgba(0,0,0,0.4)' }} />
      </div>
      <span style={{ fontSize:11, color: preferred==='claude'?'var(--accent,#3fb950)':'var(--tx2,#8b949e)', fontWeight: preferred==='claude'?700:400 }}>🟠 Claude</span>
    </div>
  );

  return (
    <div style={{ display:'flex', gap:16, height:'calc(100vh - 120px)', overflow:'hidden' }}>

      <div style={{ width:210, flexShrink:0, display:'flex', flexDirection:'column', gap:10, overflowY:'auto' }}>
        <div style={{ ...s.card, padding:12 }}>
          <div style={s.label}>AI Status</div>
          <div style={{ display:'flex', alignItems:'center', gap:8, fontSize:12, marginBottom:10 }}>
            <div style={{ width:8, height:8, borderRadius:'50%', background:statusColor, flexShrink:0 }} />
            <span style={{ color:statusColor, fontWeight:600 }}>{statusLabel}</span>
          </div>
          <div style={s.label}>Preferred AI</div>
          <AIToggle />
          <div style={{ marginTop:10, display:'flex', flexDirection:'column', gap:4 }}>
            {[['gemini','Gemini Flash'],['claude','Claude Haiku']].map(([k,label]) => (
              <div key={k} style={{ display:'flex', alignItems:'center', gap:6, fontSize:11 }}>
                <div style={{ width:6, height:6, borderRadius:'50%', background: keyStatus[k]===null?'var(--tx2,#8b949e)':keyStatus[k]?'#3fb950':'#f85149', flexShrink:0 }} />
                <span style={{ color:'var(--tx2,#8b949e)' }}>{label}</span>
                {keyStatus[k] && <span style={{ color:'#3fb950', fontSize:10 }}>✓</span>}
              </div>
            ))}
          </div>
          {!anyKeyAvailable && !statusLoading && (
            <div style={{ fontSize:10.5, color:'#f85149', marginTop:8 }}>Set Gemini_API_Key or ANTHROPIC_API_KEY in Vercel env vars.</div>
          )}
          {fallbackAvailable && !activeKeyAvailable && !statusLoading && (
            <div style={{ fontSize:10.5, color:'var(--yellow)', marginTop:8 }}>
              {preferred === 'gemini' ? 'Gemini' : 'Claude'} key missing. Auto-switching to {preferred === 'gemini' ? 'Claude' : 'Gemini'}.
            </div>
          )}
        </div>

        <div style={{ ...s.card, padding:12, flex:1, overflowY:'auto' }}>
          <div style={s.label}>Quick Actions</div>
          <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
            {QUICK_ACTIONS.map((a,i) => (
              <button key={i} onClick={() => { setActiveTab('chat'); sendMessage(a.prompt); }}
                style={{ ...s.btnSm, textAlign:'left', padding:'6px 8px', fontSize:11.5, borderRadius:6 }}>
                {a.label}
              </button>
            ))}
          </div>
        </div>

        <button onClick={() => { setMessages([{ role:'bot', text:'Chat cleared. What would you like to work on?' }]); setHistory([]); }}
          style={{ ...s.btnSm, padding:'8px', textAlign:'center', borderRadius:8 }}>
          Clear Chat
        </button>
      </div>

      <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden', ...s.card }}>
        <div style={{ display:'flex', borderBottom:'1px solid var(--bd,#30363d)', padding:'0 16px', flexShrink:0, alignItems:'center', justifyContent:'space-between' }}>
          <div style={{ display:'flex' }}>
            {[['chat','Chat'],['content','Content Writer'],['insights','Insights']].map(([id,label]) => (
              <button key={id} style={s.tab(activeTab===id)} onClick={() => setActiveTab(id)}>{label}</button>
            ))}
          </div>
          <div style={{ paddingRight:4 }}><AIToggle /></div>
        </div>

        {activeTab==='chat' && (
          <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
            <div ref={msgsRef} style={{ flex:1, overflowY:'auto', padding:16, display:'flex', flexDirection:'column', gap:12 }}>
              {messages.map((m,i) => (
                <div key={i} style={{ display:'flex', flexDirection:'column', alignItems:m.role==='user'?'flex-end':'flex-start', gap:3 }}>
                  <div style={s.bubble(m.role)} dangerouslySetInnerHTML={{ __html:renderText(m.text) }} />
                  {m.role==='bot' && m.provider && (
                    <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                      <span style={{ fontSize:10, color:'var(--tx2,#8b949e)', paddingInline:4 }}>
                        {m.usedFallback ? '⚡ Auto: ' : ''}{m.provider === 'gemini' ? '🔵 Gemini' : '🟠 Claude'}
                      </span>
                      {m.usedFallback && <span style={{ fontSize:10, color:'var(--yellow)' }} title={m.primaryError || ''}>↩ fallback{m.primaryError ? ': ' + m.primaryError.substring(0,60) : ''}</span>}
                    </div>
                  )}
                  {m.sources?.length>0 && (
                    <div style={{ fontSize:10, color:'var(--tx2,#8b949e)', paddingInline:4 }}>
                      {m.sources.slice(0,2).map((src,si) => (
                        <a key={si} href={src.uri} target="_blank" rel="noopener" style={{ color:'var(--accent,#3fb950)', textDecoration:'none', marginRight:8 }}>
                          {(src.title||src.uri).substring(0,40)}
                        </a>
                      ))}
                    </div>
                  )}
                  {m.role==='bot' && m.text.length>50 && (
                    <button onClick={() => copyText(m.text)} style={{ ...s.btnSm, fontSize:10, padding:'2px 8px' }}>Copy</button>
                  )}
                </div>
              ))}
              {loading && (
                <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                  {[0,1,2].map(i=><span key={i} style={{ width:7, height:7, borderRadius:'50%', background:'var(--accent,#3fb950)', animation:'b 0.8s ' + (i*0.15) + 's ease-in-out infinite', display:'inline-block' }}/>)}
                  <span style={{ fontSize:11, color:'var(--tx2,#8b949e)' }}>{preferred === 'gemini' ? '🔵 Gemini' : '🟠 Claude'} thinking…</span>
                  <style>{`@keyframes b{0%,80%,100%{transform:scale(.6);opacity:.3}40%{transform:scale(1);opacity:1}}`}</style>
                </div>
              )}
            </div>
            <div style={{ padding:12, borderTop:'1px solid var(--bd,#30363d)', display:'flex', gap:8, flexShrink:0 }}>
              <textarea value={input} onChange={e=>setInput(e.target.value)}
                onKeyDown={e=>{ if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMessage();} }}
                placeholder="Ask anything — content, replies, research, strategy…" rows={2}
                style={{ ...s.input, resize:'none', flex:1 }} />
              <button onClick={()=>sendMessage()} disabled={loading||!input.trim()}
                style={{ ...s.btn, opacity:loading||!input.trim()?0.4:1, alignSelf:'flex-end' }}>Send</button>
            </div>
          </div>
        )}

        {activeTab==='content' && (
          <div style={{ flex:1, display:'grid', gridTemplateColumns:'220px 1fr', overflow:'hidden' }}>
            <div style={{ padding:14, borderRight:'1px solid var(--bd,#30363d)', overflowY:'auto', display:'flex', flexDirection:'column', gap:4 }}>
              <label style={s.label}>Content Type</label>
              <select style={s.select} value={cwType} onChange={e=>setCwType(e.target.value)}>
                {CW_TYPES.map(t=><option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
              <label style={s.label}>Product</label>
              <select style={s.select} value={cwProduct} onChange={e=>setCwProduct(e.target.value)}>
                {PRODUCTS.map(p=><option key={p}>{p}</option>)}
              </select>
              <label style={s.label}>Language</label>
              <div style={{ display:'flex', gap:4, marginBottom:12 }}>
                {[['en','English'],['hi','हिंदी'],['both','Both']].map(([v,l])=>(
                  <button key={v} onClick={()=>setCwLang(v)} style={{ flex:1, padding:'6px 2px', borderRadius:6, fontSize:11, cursor:'pointer', fontFamily:'inherit',
                    background:cwLang===v?'color-mix(in srgb, var(--accent,#3fb950) 20%, transparent)':'var(--bg,#0d1117)',
                    color:cwLang===v?'var(--accent,#3fb950)':'var(--tx2,#8b949e)',
                    border:'1px solid ' + (cwLang===v?'var(--accent,#3fb950)':'var(--bd,#30363d)') }}>{l}</button>
                ))}
              </div>
              <label style={s.label}>Tone</label>
              <select style={s.select} value={cwTone} onChange={e=>setCwTone(e.target.value)}>
                {TONES.map(t=><option key={t}>{t}</option>)}
              </select>
              <button onClick={generateContent} disabled={cwLoading} style={{ ...s.btn, width:'100%', padding:'10px 0', opacity:cwLoading?0.6:1 }}>
                {cwLoading?'Generating…':'Generate'}
              </button>
              {cwOutput && <button onClick={generateContent} disabled={cwLoading} style={{ ...s.btnSm, width:'100%', padding:'7px 0', textAlign:'center', marginTop:6 }}>Regenerate</button>}
            </div>
            <div style={{ padding:16, display:'flex', flexDirection:'column', overflow:'hidden' }}>
              <div style={{ display:'flex', justifyContent:'space-between', marginBottom:8 }}>
                <span style={{ fontSize:12, color:'var(--tx2,#8b949e)' }}>{cwProduct} — {CW_TYPES.find(t=>t.value===cwType)?.label}</span>
                <span style={{ fontSize:11, color:'var(--tx2,#8b949e)' }}>{preferred === 'gemini' ? '🔵 Gemini 2.0 Flash' : '🟠 Claude Haiku'}</span>
              </div>
              <div style={{ flex:1, overflowY:'auto', background:'var(--bg,#0d1117)', border:'1px solid var(--bd,#30363d)', borderRadius:10, padding:16, fontSize:13.5, lineHeight:1.75, color:'var(--tx,#e6edf3)', whiteSpace:'pre-wrap' }}>
                {cwLoading?<span style={{ color:'var(--tx2,#8b949e)' }}>Generating…</span>
                  :cwOutput||<span style={{ color:'var(--tx2,#8b949e)' }}>Select options and click Generate…</span>}
              </div>
              {cwOutput && <div style={{ display:'flex', gap:8, marginTop:10 }}>
                <button onClick={()=>copyText(cwOutput)} style={s.btnSm}>{copied?'Copied!':'Copy All'}</button>
                <button onClick={()=>setCwOutput('')} style={s.btnSm}>Clear</button>
              </div>}
            </div>
          </div>
        )}

        {activeTab==='insights' && (
          <div style={{ flex:1, overflowY:'auto', padding:20, display:'flex', flexDirection:'column', gap:14 }}>
            <div style={{ fontSize:13, color:'var(--tx2,#8b949e)' }}>Ask business questions. Paste data directly for analysis, or ask for market insights.</div>
            <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
              {INSIGHT_PROMPTS.map((q,i)=>(
                <button key={i} onClick={()=>setInsightQ(q)} style={{ ...s.btnSm, borderRadius:20, padding:'5px 12px', fontSize:12 }}>{q}</button>
              ))}
            </div>
            <div style={{ display:'flex', gap:8 }}>
              <textarea value={insightQ} onChange={e=>setInsightQ(e.target.value)}
                onKeyDown={e=>{ if(e.key==='Enter'&&!e.shiftKey) runInsight(); }}
                placeholder="Ask a business question or paste data…" rows={3}
                style={{ ...s.input, flex:1, resize:'none' }} />
              <button onClick={runInsight} disabled={insightLoading||!insightQ.trim()}
                style={{ ...s.btn, opacity:insightLoading||!insightQ.trim()?0.4:1, alignSelf:'flex-end' }}>
                {insightLoading?'…':'Ask'}
              </button>
            </div>
            <div style={{ background:'var(--bg,#0d1117)', border:'1px solid var(--bd,#30363d)', borderRadius:10, padding:16, fontSize:13.5, lineHeight:1.75, color:'var(--tx,#e6edf3)', whiteSpace:'pre-wrap', minHeight:180 }}>
              {insightLoading?'Querying ' + (preferred === 'gemini' ? 'Gemini' : 'Claude') + '…'
                :insightA?<div dangerouslySetInnerHTML={{__html:renderText(insightA)}}/>
                :<span style={{ color:'var(--tx2,#8b949e)' }}>Insights will appear here.</span>}
            </div>
            {insightA && <button onClick={()=>copyText(insightA)} style={{ ...s.btnSm, alignSelf:'flex-start' }}>{copied?'Copied!':'Copy'}</button>}
          </div>
        )}
      </div>
    </div>
  );
}
