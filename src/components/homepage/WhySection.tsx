const PILLARS = [
  {
    num: '01', icon: '🔬',
    title: 'Lab Tested Purity',
    body: 'Every batch tested for heavy metals, pesticides & adulterants. Certificate with every order.',
  },
  {
    num: '02', icon: '🤝',
    title: 'Direct from Farmers',
    body: 'Zero middlemen. 200+ farming families across 12 Himalayan states — fair wages, always.',
  },
  {
    num: '03', icon: '🌱',
    title: 'Eco Packaging',
    body: 'Glass jars, recycled cardboard, zero single-use plastic. Packaging as clean as our products.',
  },
  {
    num: '04', icon: '🌿',
    title: 'Give-Back Program',
    body: '5% of every order funds Himalayan forest restoration and village school programs.',
  },
]

export default function WhySection() {
  return (
    <section className="why-bg">
      <div className="ct">
        <div className="chip">✦ Our Promise</div>
        <h2 className="sh2">Why 5 Pahadi Roots?</h2>
        <p className="ssub">Four pillars that define everything we do — mountain to doorstep.</p>
      </div>

      <div className="pgr">
        {PILLARS.map((p) => (
          <div key={p.num} className="pillar">
            <div className="pnum">{p.num}</div>
            <div className="pillar-ico">{p.icon}</div>
            <div className="pt">{p.title}</div>
            <div className="pd">{p.body}</div>
          </div>
        ))}
      </div>
    </section>
  )
}
