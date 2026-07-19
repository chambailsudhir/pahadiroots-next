import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Link from 'next/link'

export const revalidate = 86400 // 24hr

// BUG FIX (Next.js 15+/16 migration): `params` is now a Promise.
interface Props { params: Promise<{ type: string }> }

const WHATSAPP = 'https://wa.me/919899984895'
const SUPPORT_EMAIL = 'hello@pahadiroots.com'
const SUPPORT_PHONE = '+91 98999 84895'
const BRAND = 'HimVeda by Pahadi Roots'
const LEGAL_ENTITY = 'Chambail International'
const OPERATOR_LINE = `${LEGAL_ENTITY} (trading as ${BRAND})`
// NOTE: no personal/founder name used anywhere in these policies, per the
// founder's instruction. Registered address and jurisdiction city confirmed
// by the founder — matches the address already used in Footer.tsx.
const ADDRESS = 'Village Sakoh, PO Sakoh, Distt. Kangra, Himachal Pradesh 176082'
const JURISDICTION = 'Palampur, Himachal Pradesh'
const SHORT_LOCATION = 'Himachal Pradesh, India'

// ── Small styled helpers, reused across all four policies ───────────────
function Callout({ tone, children }: { tone: 'green' | 'amber' | 'red' | 'blue'; children: React.ReactNode }) {
  const styles: Record<string, string> = {
    green: 'bg-emerald-50 border-emerald-200 text-emerald-900',
    amber: 'bg-amber-50 border-amber-200 text-amber-900',
    red:   'bg-red-50 border-red-200 text-red-900',
    blue:  'bg-sky-50 border-sky-200 text-sky-900',
  }
  return <div className={`border rounded-xl px-4 py-3 text-sm ${styles[tone]}`}>{children}</div>
}

function PolicyTable({ head, rows }: { head: string[]; rows: string[][] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-stone-200">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-stone-50">
            {head.map(h => <th key={h} className="text-left font-semibold text-stone-700 px-4 py-2 border-b border-stone-200">{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-stone-100 last:border-0">
              {r.map((c, j) => <td key={j} className="px-4 py-2 text-stone-600" dangerouslySetInnerHTML={{ __html: c }} />)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Steps({ items }: { items: string[] }) {
  return (
    <ol className="space-y-2">
      {items.map((s, i) => (
        <li key={i} className="flex gap-3 text-sm text-stone-600">
          <span className="shrink-0 w-6 h-6 rounded-full bg-forest-700 text-white text-xs font-bold flex items-center justify-center">{i + 1}</span>
          <span className="pt-0.5" dangerouslySetInnerHTML={{ __html: s }} />
        </li>
      ))}
    </ol>
  )
}

function MedicalDisclaimer() {
  return (
    <Callout tone="amber">
      ⚕️ The products listed on pahadiroots.com are not intended to diagnose, treat, cure, or prevent any disease.
      Information on this website is not a substitute for professional medical advice, diagnosis, or treatment.
      Always consult your physician before using any supplement or health product.
    </Callout>
  )
}

function ContactCard({ title, note }: { title: string; note: string }) {
  return (
    <div className="rounded-2xl border border-stone-200 bg-stone-50 p-5 text-center space-y-2">
      <h3 className="font-bold text-stone-900">{title}</h3>
      <p className="text-sm text-stone-500">{note}</p>
      <div className="flex justify-center gap-3 flex-wrap pt-1">
        <a href={WHATSAPP} className="text-sm font-semibold text-forest-700 hover:underline">💬 WhatsApp Us</a>
        <a href={`mailto:${SUPPORT_EMAIL}`} className="text-sm font-semibold text-forest-700 hover:underline">📧 Email Support</a>
      </div>
    </div>
  )
}

const POLICIES: Record<string, { title: string; content: React.ReactNode }> = {

  // ── RETURNS ──────────────────────────────────────────────────────────
  // BUG FIX (content accuracy — flagged by founder): the previous version
  // of this page stated a blanket 7-day return window for everything,
  // including edible/perishable goods. That's wrong for an FMCG/food
  // business and doesn't match what the site's own legal terms.html
  // (still live at pahadiroots.com) actually promises. Food items are
  // return-exempt under the Consumer Protection (E-Commerce) Rules, 2020
  // perishable-goods carve-out — real returns are only for non-edible
  // items, and the actual operative window everywhere (edible or not) is
  // 48 hours with photo/video proof, not 7 days. Rewritten to match.
  returns: {
    title: 'Return & Refund Policy',
    content: (
      <div className="text-sm leading-relaxed space-y-6">
        <p className="text-stone-600">
          This policy applies to all purchases made on <strong>pahadiroots.com</strong>, operated by <strong>{OPERATOR_LINE}</strong>.
          Framed in compliance with the <strong>Consumer Protection Act, 2019</strong> and <strong>Consumer Protection (E-Commerce) Rules, 2020</strong>.
        </p>

        <Callout tone="green">⏰ Report damaged, defective, or wrong items within <strong>48 hours</strong> of delivery with photo/video proof. We always make it right.</Callout>

        <section>
          <h2 className="text-base font-bold text-stone-900 mb-2">1. Returns for Food / Edible Products</h2>
          <p className="text-stone-600 mb-2">In accordance with hygiene, safety, and perishable-goods exemptions under consumer protection law, returns and exchanges are <strong>generally not permitted</strong> for edible items — honey, ghee, saffron, shilajit, teas, spices, and all other food products.</p>
          <p className="text-stone-600 mb-2">As a goodwill measure, we <strong>may consider</strong> a return/refund for edible items on a case-by-case basis, subject to all of the following:</p>
          <ul className="list-disc list-inside text-stone-600 space-y-1">
            <li>Request raised <strong>within 48 hours</strong> of delivery</li>
            <li>Clear <strong>photo or video evidence</strong> provided</li>
            <li>Issue is damage, spoilage, or a quality concern attributable to transit or a manufacturing defect — not a change of mind</li>
          </ul>
          <p className="text-stone-500 text-xs mt-2">This decision is made in good faith, without prejudice to your statutory rights under the Consumer Protection Act, 2019 or any other applicable law.</p>
        </section>

        <section>
          <h2 className="text-base font-bold text-stone-900 mb-2">2. Returns for Non-Edible Products</h2>
          <p className="text-stone-600 mb-2">Returns are accepted for non-edible items (packaging, accessories, gift sets) where:</p>
          <ul className="list-disc list-inside text-stone-600 space-y-1">
            <li>Product is <strong>defective, damaged, or not as described</strong></li>
            <li>Return request raised <strong>within 48 hours</strong> of delivery</li>
            <li>Product is <strong>unused and unopened</strong>, in original condition with all packaging, labels, and accessories intact</li>
          </ul>
        </section>

        <section>
          <h2 className="text-base font-bold text-stone-900 mb-2">3. Products NOT Eligible for Return</h2>
          <Callout tone="red">❌ The following are generally not accepted for return or refund, except as required by applicable law.</Callout>
          <ul className="list-disc list-inside text-stone-600 space-y-1 mt-2">
            <li>Products that have been <strong>opened, used, altered, or tampered</strong> with</li>
            <li>Items reported <strong>after 48 hours</strong> of delivery</li>
            <li>Products without original packaging or labels</li>
            <li>Items damaged due to <strong>consumer misuse or negligence</strong></li>
            <li>Edible items once opened — unless a quality defect is raised within 48 hours</li>
            <li>Change of mind after the order has been shipped</li>
          </ul>
        </section>

        <section>
          <h2 className="text-base font-bold text-stone-900 mb-2">4. How to Raise a Return / Refund Request</h2>
          <Steps items={[
            `<strong>Contact within 48 hours</strong> of delivery — WhatsApp <a class="text-forest-700 underline" href="${WHATSAPP}">${SUPPORT_PHONE}</a> or email <a class="text-forest-700 underline" href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>`,
            `Share your <strong>Order ID</strong> with clear photos or a short video showing the issue`,
            `Our team <strong>reviews within 24–48 hours</strong> — we may ask follow-up questions`,
            `If approved, we arrange <strong>reverse pickup</strong> where serviceable. Otherwise, ship it back — we reimburse return shipping up to <strong>₹125 or actual cost, whichever is lower</strong> (valid courier receipt required)`,
            `Returned product is <strong>inspected on receipt</strong>. Refund is processed within <strong>7–10 business days</strong> after approval.`,
          ]} />
        </section>

        <section>
          <h2 className="text-base font-bold text-stone-900 mb-2">5. Refund Methods &amp; Timeline</h2>
          <PolicyTable
            head={['Payment Method', 'Refund To', 'Timeline']}
            rows={[
              ['Online (UPI, Cards, Net Banking via Razorpay)', 'Original payment method', '7–10 business days after approval'],
              ['COD / WhatsApp Order', 'UPI / Bank Transfer', '7–10 business days after approval'],
            ]}
          />
          <p className="text-stone-500 text-xs mt-2">Shipping and handling charges are non-refundable unless the return is due to our error.</p>
        </section>

        <section>
          <h2 className="text-base font-bold text-stone-900 mb-2">6. Order Cancellation</h2>
          <ul className="list-disc list-inside text-stone-600 space-y-1">
            <li>Orders may be cancelled <strong>before dispatch</strong> only — contact us immediately on WhatsApp. Requests between confirmation and dispatch are accepted at our discretion</li>
            <li>Once dispatched, cancellation requests <strong>cannot be accepted</strong></li>
            <li>Food/edible orders <strong>cannot be cancelled once dispatched</strong></li>
            <li>If <em>we</em> cancel your order (stock issue / pricing error), a <strong>full refund</strong> is issued within 7–10 business days</li>
          </ul>
        </section>

        <Callout tone="amber">⚠️ If packaging appears tampered or damaged at delivery, <strong>refuse to accept it</strong> and contact us immediately on WhatsApp with your order number. We will arrange a replacement or refund at no extra cost.</Callout>

        <section>
          <h2 className="text-base font-bold text-stone-900 mb-2">7. Consumer Grievance Redressal</h2>
          <p className="text-stone-600">In compliance with the <strong>Consumer Protection (E-Commerce) Rules, 2020</strong>, you may contact us for any grievance. We acknowledge complaints within <strong>48 hours</strong> and resolve them within a reasonable timeframe.</p>
          <p className="text-stone-600 mt-1"><strong>Grievance Contact:</strong> <a href={`mailto:${SUPPORT_EMAIL}`} className="text-forest-700 hover:underline">{SUPPORT_EMAIL}</a> · WhatsApp: <a href={WHATSAPP} className="text-forest-700 hover:underline">{SUPPORT_PHONE}</a></p>
        </section>

        <MedicalDisclaimer />
        <ContactCard title="Need Help with a Return?" note="Reach us within 48 hours of delivery — we respond fast" />
      </div>
    ),
  },

  // ── SHIPPING ─────────────────────────────────────────────────────────
  shipping: {
    title: 'Shipping Policy',
    content: (
      <div className="text-sm leading-relaxed space-y-6">
        <Callout tone="green">🎉 <strong>Free shipping</strong> on all orders above ₹799 · Flat ₹99 on orders below ₹799 · Pan-India delivery</Callout>

        <section>
          <h2 className="text-base font-bold text-stone-900 mb-2">Delivery Timeline</h2>
          <PolicyTable
            head={['Stage', 'Time']}
            rows={[
              ['Order processing &amp; confirmation', '1–2 business days'],
              ['Dispatch to courier', 'Within 2 business days'],
              ['Delivery — Metro cities', '3–5 business days after dispatch'],
              ['Delivery — Non-metro / remote areas', '7–12 business days after dispatch'],
            ]}
          />
          <p className="text-stone-500 text-xs mt-2">We ship Monday–Saturday. Sundays and public holidays are excluded from business days.</p>
        </section>

        <section>
          <h2 className="text-base font-bold text-stone-900 mb-2">Shipping Coverage</h2>
          <p className="text-stone-600">We deliver <strong>Pan India</strong> — all 28 states and 8 Union Territories. Our Himalayan products travel from the mountains directly to your doorstep.</p>
        </section>

        <section>
          <h2 className="text-base font-bold text-stone-900 mb-2">Tracking Your Order</h2>
          <Steps items={[
            'Once shipped, receive your <strong>tracking number via WhatsApp</strong>',
            `Track in real-time at <a class="text-forest-700 underline" href="/account">My Account → Orders</a>`,
            'Courier partners: <strong>Delhivery, BlueDart, DTDC, Xpressbees, Ekart, India Post</strong>',
          ]} />
          <p className="text-stone-500 text-xs mt-2">Allow up to 48 hours for tracking to activate after dispatch notification.</p>
        </section>

        <section>
          <h2 className="text-base font-bold text-stone-900 mb-2">Delayed or Lost Shipments</h2>
          <p className="text-stone-600">If delayed beyond the expected window, contact us with your order number. If a shipment is confirmed lost in transit, we will either <strong>resend the order</strong> (if in stock) or issue a <strong>full refund</strong>.</p>
        </section>

        <section>
          <h2 className="text-base font-bold text-stone-900 mb-2">Failed / Undelivered Orders</h2>
          <ul className="list-disc list-inside text-stone-600 space-y-1">
            <li>Courier attempts delivery up to <strong>3 times</strong> if you are unavailable</li>
            <li>After failed attempts, the package returns to us — return shipping cost is borne by you</li>
            <li>Contact us to reship — additional shipping charges apply</li>
            <li>If you remain unreachable after 3 attempts, we will make best efforts via alternate means; successful delivery cannot be guaranteed in such cases</li>
          </ul>
        </section>

        <section>
          <h2 className="text-base font-bold text-stone-900 mb-2">Refused Delivery (Prepaid Orders)</h2>
          <p className="text-stone-600">If you refuse a prepaid order, we arrange one re-attempt. If not possible, the order is cancelled and refunded <strong>after deducting RTO (return-to-origin) charges</strong> within 24–48 hours of the package reaching our facility.</p>
        </section>

        <Callout tone="amber">⚠️ If packaging appears tampered or damaged, <strong>refuse the delivery</strong> and WhatsApp us immediately with your order number. We will arrange a replacement or refund.</Callout>

        <section>
          <h2 className="text-base font-bold text-stone-900 mb-2">Delivery Marked but Not Received</h2>
          <p className="text-stone-600">Raise the complaint <strong>within 48 hours</strong> of the status update. Complaints raised after 48 hours may be difficult to resolve due to courier partner limitations.</p>
        </section>

        <Callout tone="blue">ℹ️ {OPERATOR_LINE} is not responsible for delays caused by courier partners, natural disasters, strikes, government restrictions, or other events beyond our reasonable control.</Callout>

        <ContactCard title="Shipping Query?" note="We respond within 24 hours on all working days" />
      </div>
    ),
  },

  // ── PRIVACY ──────────────────────────────────────────────────────────
  privacy: {
    title: 'Privacy Policy',
    content: (
      <div className="text-sm leading-relaxed space-y-6">
        <p className="text-stone-500 text-xs">Last updated: March 2026 · {OPERATOR_LINE}, {SHORT_LOCATION}</p>
        <p className="text-stone-600">We are committed to safeguarding the privacy of our website visitors and customers. This policy explains what personal data we collect, how we use it, and your rights. By using pahadiroots.com and agreeing to this policy, you consent to our data practices as described below.</p>

        <section>
          <h2 className="text-base font-bold text-stone-900 mb-2">1. Information We Collect</h2>
          <ul className="list-disc list-inside text-stone-600 space-y-1">
            <li><strong>Device &amp; visit data:</strong> IP address, browser type, operating system, pages visited, referral source, session duration</li>
            <li><strong>Account data:</strong> Name, email address, phone number, delivery address</li>
            <li><strong>Transaction data:</strong> Products ordered, payment method, order history</li>
            <li><strong>Newsletter:</strong> Email address if you subscribe</li>
            <li><strong>Communications:</strong> Messages sent via email or WhatsApp</li>
          </ul>
        </section>

        <section>
          <h2 className="text-base font-bold text-stone-900 mb-2">2. Cookies</h2>
          <p className="text-stone-600 mb-2">We use <strong>session cookies</strong> (cleared when the browser closes) and <strong>persistent cookies</strong> (stored until expiry) to keep you logged in, remember your cart across visits, and recognise you on return visits.</p>
          <p className="text-stone-600">You may reject cookies via browser settings, though this may affect site functionality. Our payment provider Razorpay may also set cookies — see <a href="https://razorpay.com/privacy/" target="_blank" rel="noopener" className="text-forest-700 hover:underline">Razorpay's Privacy Policy</a>.</p>
        </section>

        <section>
          <h2 className="text-base font-bold text-stone-900 mb-2">3. How We Use Your Information</h2>
          <ul className="list-disc list-inside text-stone-600 space-y-1">
            <li>To process and deliver your orders</li>
            <li>To send order confirmations and shipping updates via WhatsApp / email</li>
            <li>To respond to enquiries and complaints</li>
            <li>To improve products, website, and customer experience</li>
            <li>To send newsletters or offers — <strong>only if you have subscribed or consented</strong></li>
            <li>To provide anonymised, non-identifying statistics for analytics</li>
            <li>To comply with legal obligations</li>
          </ul>
        </section>

        <section>
          <h2 className="text-base font-bold text-stone-900 mb-2">4. Data Sharing &amp; Disclosure</h2>
          <ul className="list-disc list-inside text-stone-600 space-y-1">
            <li><strong>Courier partners:</strong> Name, address, phone — shared for delivery only</li>
            <li><strong>Razorpay:</strong> Payment data — we <strong>never store card details</strong></li>
            <li><strong>Legal compliance:</strong> Data may be disclosed if required by law or court order</li>
            <li><strong>Business transfer:</strong> If {LEGAL_ENTITY} is sold or merged, you will be notified and given the option to request deletion of your data before any such transfer</li>
            <li>We do <strong>not</strong> sell, rent, or trade personal data to any third party for marketing</li>
          </ul>
        </section>

        <section>
          <h2 className="text-base font-bold text-stone-900 mb-2">5. Data Security</h2>
          <p className="text-stone-600 mb-2">Your data is stored on <strong>Supabase</strong> (SOC 2 Type II compliant), behind firewall-protected, password-secured servers. All payment transactions are encrypted via Razorpay's <strong>PCI-DSS compliant</strong> gateway using SSL technology.</p>
          <Callout tone="amber">⚠️ Internet data transmission is inherently not 100% secure. While we take all reasonable precautions, we cannot guarantee absolute security. Keep your password confidential — we will never ask for it.</Callout>
        </section>

        <section>
          <h2 className="text-base font-bold text-stone-900 mb-2">6. International Data Transfers</h2>
          <p className="text-stone-600">Data may be stored and processed in countries where our infrastructure partners (Supabase, Vercel) operate, which may include the United States and European Union. By using our website, you consent to such transfers. You may withdraw this consent at any time by contacting <a href={`mailto:${SUPPORT_EMAIL}`} className="text-forest-700 hover:underline">{SUPPORT_EMAIL}</a>, after which we will delete your personal data within 30 days, subject to legal retention requirements.</p>
        </section>

        <section>
          <h2 className="text-base font-bold text-stone-900 mb-2">7. Your Rights</h2>
          <ul className="list-disc list-inside text-stone-600 space-y-1">
            <li>Request a copy of the personal data we hold about you</li>
            <li>Request correction of inaccurate data</li>
            <li>Request deletion of your account and associated data</li>
            <li>Opt out of marketing communications at any time</li>
          </ul>
          <p className="text-stone-600 mt-2">To exercise any right: <a href={`mailto:${SUPPORT_EMAIL}`} className="text-forest-700 hover:underline">{SUPPORT_EMAIL}</a></p>
        </section>

        <section>
          <h2 className="text-base font-bold text-stone-900 mb-2">8. Third-Party Websites</h2>
          <p className="text-stone-600">Our website may link to third-party sites. We are not responsible for their privacy practices — review their policies before sharing personal information.</p>
        </section>

        <section>
          <h2 className="text-base font-bold text-stone-900 mb-2">9. Policy Updates</h2>
          <p className="text-stone-600">We may update this Privacy Policy from time to time. Updated versions will be posted on this page. We may notify you of significant changes via email.</p>
        </section>

        <section>
          <h2 className="text-base font-bold text-stone-900 mb-2">10. Contact for Privacy Concerns</h2>
          <p className="text-stone-600"><strong>{OPERATOR_LINE}</strong> · {ADDRESS}<br />
            📧 <a href={`mailto:${SUPPORT_EMAIL}`} className="text-forest-700 hover:underline">{SUPPORT_EMAIL}</a><br />
            💬 WhatsApp: <a href={WHATSAPP} className="text-forest-700 hover:underline">{SUPPORT_PHONE}</a>
          </p>
        </section>

        <ContactCard title="Privacy Questions?" note="We respond within 24 hours on all working days" />
      </div>
    ),
  },

  // ── TERMS ────────────────────────────────────────────────────────────
  terms: {
    title: 'Terms of Service',
    content: (
      <div className="text-sm leading-relaxed space-y-6">
        <p className="text-stone-500 text-xs">Last updated: March 2026 · Effective immediately upon use of pahadiroots.com</p>

        <section>
          <h2 className="text-base font-bold text-stone-900 mb-2">1. Overview &amp; Acceptance</h2>
          <p className="text-stone-600 mb-2">This website is operated by <strong>{OPERATOR_LINE}</strong> ("we", "us", "our"). By visiting pahadiroots.com or placing an order, you agree to be bound by these Terms of Service and all referenced policies, including our Return, Shipping, and Privacy policies.</p>
          <p className="text-stone-600 mb-2">If you do not agree to all terms, please do not use this website or our services. These terms apply to all users — browsers, customers, and visitors.</p>
          <Callout tone="amber">⚠️ You must be 18 years or older, or have parental/guardian consent, to create an account and place orders on this website. By placing an order, you confirm you meet this requirement or have such consent.</Callout>
        </section>

        <section>
          <h2 className="text-base font-bold text-stone-900 mb-2">2. Products &amp; Descriptions</h2>
          <ul className="list-disc list-inside text-stone-600 space-y-1">
            <li>All products are sourced from verified Himalayan farmers, producers, and cooperatives</li>
            <li>Product images are representative — natural products may vary in colour, texture, and appearance</li>
            <li>Prices are in <strong>Indian Rupees (₹)</strong> and inclusive of applicable taxes</li>
            <li>We reserve the right to modify descriptions, pricing, or discontinue any product at any time</li>
            <li>We cannot guarantee that product quality will meet every individual's subjective expectations</li>
          </ul>
        </section>

        <section>
          <h2 className="text-base font-bold text-stone-900 mb-2">3. Orders, Payments &amp; Pricing</h2>
          <ul className="list-disc list-inside text-stone-600 space-y-1">
            <li>Orders are confirmed upon successful payment or WhatsApp acknowledgement (COD)</li>
            <li>We accept <strong>UPI, credit/debit cards, net banking</strong> (via Razorpay) and <strong>Cash on Delivery</strong></li>
            <li>Prices may change without notice — changes do not apply to already-confirmed orders</li>
            <li>We reserve the right to cancel orders due to pricing errors, stock unavailability, or suspected fraud — a full refund will be issued</li>
            <li>We may limit quantities per person or household at our discretion</li>
            <li>You agree to provide accurate, complete billing and delivery information</li>
          </ul>
        </section>

        <section>
          <h2 className="text-base font-bold text-stone-900 mb-2">4. Accounts &amp; User Responsibilities</h2>
          <ul className="list-disc list-inside text-stone-600 space-y-1">
            <li>You are solely responsible for maintaining the confidentiality of your login credentials</li>
            <li>We are not liable for losses arising from unauthorized account access</li>
            <li>Provide accurate personal information when registering or ordering</li>
            <li>You may not use this platform for illegal, fraudulent, or unauthorized purposes</li>
            <li>You may not transmit viruses, malware, or destructive code</li>
            <li>Breach of these terms may result in immediate account suspension</li>
          </ul>
        </section>

        <section>
          <h2 className="text-base font-bold text-stone-900 mb-2">5. Third-Party Services</h2>
          <ul className="list-disc list-inside text-stone-600 space-y-1">
            <li><strong>Razorpay</strong> handles all payment processing — we never store card details. See <a href="https://razorpay.com/privacy/" target="_blank" rel="noopener" className="text-forest-700 hover:underline">Razorpay's Privacy Policy</a></li>
            <li>Our website is hosted on <strong>Vercel</strong> with data stored on <strong>Supabase</strong> (SOC 2 compliant)</li>
            <li>Third-party links on our site are not our responsibility — review their policies before transacting</li>
          </ul>
        </section>

        <section>
          <h2 className="text-base font-bold text-stone-900 mb-2">6. Intellectual Property</h2>
          <p className="text-stone-600">All content on pahadiroots.com — text, images, logo, brand name, product descriptions, and design — is the intellectual property of <strong>{LEGAL_ENTITY}</strong>. Unauthorised reproduction, duplication, or commercial use without written permission is strictly prohibited.</p>
        </section>

        <section>
          <h2 className="text-base font-bold text-stone-900 mb-2">7. Prohibited Uses</h2>
          <p className="text-stone-600 mb-2">You are prohibited from using this website for:</p>
          <ul className="list-disc list-inside text-stone-600 space-y-1">
            <li>Any unlawful, fraudulent, or harmful purpose</li>
            <li>Violating any applicable Indian or international law</li>
            <li>Infringing intellectual property rights</li>
            <li>Harassing, abusing, or discriminating against others</li>
            <li>Submitting false or misleading information</li>
            <li>Uploading viruses, malware, or malicious code</li>
            <li>Scraping, crawling, or collecting user data without permission</li>
            <li>Reselling our products without authorisation</li>
          </ul>
        </section>

        <section>
          <h2 className="text-base font-bold text-stone-900 mb-2">8. Product Quality Warranty &amp; Disclaimer</h2>
          <p className="text-stone-600 mb-2"><strong>Website / Digital Service:</strong> Provided <strong>"as is"</strong> and <strong>"as available"</strong> without warranty of uninterrupted or error-free access.</p>
          <p className="text-stone-600 mb-2"><strong>Physical Products — Limited Quality Warranty.</strong> We warrant that products dispatched from our facility are:</p>
          <ul className="list-disc list-inside text-stone-600 space-y-1 mb-3">
            <li>Genuine, unadulterated, and fit for consumption as described</li>
            <li>Within their printed expiry/best-before date at time of dispatch, with <strong>at least 30% of shelf life remaining</strong></li>
            <li>Free from manufacturing defects visible at the time of packaging</li>
            <li>Stored under appropriate conditions prior to dispatch</li>
          </ul>
          <p className="text-stone-600 mb-2"><strong>This warranty does NOT cover:</strong></p>
          <ul className="list-disc list-inside text-stone-600 space-y-1 mb-3">
            <li>Natural variation in colour, texture, aroma, or taste — inherent to raw, single-origin Himalayan products (honey crystallisation, ghee graininess, saffron colour variation are normal, not defects)</li>
            <li>Changes in flavour or appearance after the printed best-before date</li>
            <li>Products damaged, mishandled, or improperly stored after delivery</li>
            <li>Subjective dissatisfaction with taste, potency, or intensity</li>
            <li>Products where tampering, opening, or alteration is evident</li>
          </ul>
          <Callout tone="amber">⚠️ Natural products may show batch-to-batch variation in colour, viscosity, crystallisation, and aroma. This is a sign of authenticity, not a defect — raw honey crystallises naturally, A2 ghee may be grainy in winter, saffron shade varies by harvest. These do not constitute grounds for return.</Callout>
          <p className="text-stone-600 mt-3">To the maximum extent permitted by Indian law including the Consumer Protection Act 2019, {LEGAL_ENTITY} shall not be liable for indirect, incidental, or consequential damages arising from use of our website or digital services. Liability for physical products is governed by applicable consumer law.</p>
        </section>

        <section>
          <h2 className="text-base font-bold text-stone-900 mb-2">9. Indemnification</h2>
          <p className="text-stone-600">You agree to indemnify and hold harmless {LEGAL_ENTITY} and its officers, employees, and agents from any claims, damages, or expenses (including reasonable legal fees) arising from your breach of these Terms, violation of any law, or infringement of any third-party rights.</p>
        </section>

        <section>
          <h2 className="text-base font-bold text-stone-900 mb-2">10. Accuracy of Information &amp; Errors</h2>
          <p className="text-stone-600">We strive to keep product descriptions, pricing, and availability accurate. Errors may occasionally occur. We reserve the right to correct typographical errors, pricing mistakes, or inaccuracies, and to cancel any order if information was incorrect — with a full refund.</p>
        </section>

        <section>
          <h2 className="text-base font-bold text-stone-900 mb-2">11. User Submissions &amp; Feedback</h2>
          <p className="text-stone-600">If you send us reviews, suggestions, contest entries, or other creative material, you grant {LEGAL_ENTITY} the right to use, publish, translate, or distribute such content without compensation or obligation of confidentiality. You agree submissions will not violate third-party rights or contain unlawful content.</p>
        </section>

        <section>
          <h2 className="text-base font-bold text-stone-900 mb-2">12. Optional Third-Party Tools</h2>
          <p className="text-stone-600">We may provide access to third-party tools (analytics, payment gateways, logistics APIs) on an "as is" and "as available" basis without warranty. Use of such tools is at your own risk — review their terms before use.</p>
        </section>

        <section>
          <h2 className="text-base font-bold text-stone-900 mb-2">13. Severability</h2>
          <p className="text-stone-600">If any provision of these Terms is found unlawful or unenforceable, it shall be severed from the rest — the remaining Terms remain fully valid and enforceable.</p>
        </section>

        <section>
          <h2 className="text-base font-bold text-stone-900 mb-2">14. Termination</h2>
          <p className="text-stone-600">We reserve the right to terminate your access to this website at any time, without notice, if you breach these Terms. Obligations incurred before termination remain in effect.</p>
        </section>

        <section>
          <h2 className="text-base font-bold text-stone-900 mb-2">15. Entire Agreement</h2>
          <p className="text-stone-600">These Terms, together with our Returns, Shipping, and Privacy policies, constitute the entire agreement between you and {LEGAL_ENTITY} regarding your use of this website and supersede all prior communications or agreements.</p>
        </section>

        <section>
          <h2 className="text-base font-bold text-stone-900 mb-2">16. Policy Updates</h2>
          <p className="text-stone-600">We reserve the right to update these Terms at any time. Updated versions will be published on this page with the revision date. Continued use of our website after changes constitutes acceptance of the revised Terms.</p>
        </section>

        <section>
          <h2 className="text-base font-bold text-stone-900 mb-2">17. Governing Law &amp; Jurisdiction</h2>
          <p className="text-stone-600">These Terms are governed by the <strong>laws of India</strong>. All disputes are subject to the exclusive jurisdiction of the competent courts in <strong>{JURISDICTION}</strong>.</p>
        </section>

        <section>
          <h2 className="text-base font-bold text-stone-900 mb-2">18. Contact</h2>
          <p className="text-stone-600">Questions about these Terms? Contact: <a href={`mailto:${SUPPORT_EMAIL}`} className="text-forest-700 hover:underline">{SUPPORT_EMAIL}</a> · WhatsApp: <a href={WHATSAPP} className="text-forest-700 hover:underline">{SUPPORT_PHONE}</a></p>
        </section>

        <MedicalDisclaimer />
      </div>
    ),
  },
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { type } = await params
  const policy = POLICIES[type]
  if (!policy) return { title: 'Policy Not Found' }
  return { title: `${policy.title} — ${BRAND}` }
}

export default async function PolicyPage({ params }: Props) {
  const { type } = await params
  const policy = POLICIES[type]
  if (!policy) notFound()

  const allPolicies = [
    { href: '/policies/shipping', label: 'Shipping Policy' },
    { href: '/policies/returns',  label: 'Return & Refund' },
    { href: '/policies/privacy',  label: 'Privacy Policy' },
    { href: '/policies/terms',    label: 'Terms of Service' },
  ]

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      <div className="flex flex-col sm:flex-row gap-8">

        {/* Sidebar nav */}
        <aside className="sm:w-48 shrink-0">
          <div className="text-[10px] font-bold uppercase tracking-widest text-stone-400 mb-2">Policies</div>
          <nav className="space-y-1">
            {allPolicies.map(p => (
              <Link
                key={p.href}
                href={p.href}
                className={`block text-sm px-3 py-2 rounded-xl transition-colors ${
                  p.href.endsWith(type)
                    ? 'bg-forest-700 text-white font-semibold'
                    : 'text-stone-600 hover:bg-stone-100'
                }`}
              >
                {p.label}
              </Link>
            ))}
          </nav>
        </aside>

        {/* Content */}
        <main className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold text-stone-900 mb-6">{policy.title}</h1>
          <div className="bg-white border border-stone-200 rounded-2xl p-6 sm:p-8">
            {policy.content}
          </div>
          <p className="text-xs text-stone-400 mt-4 text-center">
            Questions? <Link href="/contact" className="text-forest-700 hover:underline">Contact us</Link>
          </p>
        </main>
      </div>
    </div>
  )
}

export function generateStaticParams() {
  return Object.keys(POLICIES).map(type => ({ type }))
}
