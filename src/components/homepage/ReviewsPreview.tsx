const REVIEWS = [
  {
    initial: 'P', name: 'Priya Sharma', location: 'Mumbai · Verified Buyer',
    text: "The Kumaoni wild honey is unlike anything I've had. Raw, dark, floral — I can literally taste the altitude. My whole family is hooked.",
  },
  {
    initial: 'R', name: 'Rahul Mehta', location: 'Delhi · Verified Buyer',
    text: "5 Pahadi Roots has changed my pantry. The bilona ghee is a revelation — I feel good about what I'm feeding my kids.",
  },
  {
    initial: 'A', name: 'Anita Joshi', location: 'Bengaluru · Verified Buyer',
    text: "The Kashmir saffron threads are pure gold. Ordered from big brands before but nothing compares. Fast delivery, beautiful packaging.",
  },
]

export default function ReviewsPreview() {
  return (
    <section className="rev-bg">
      <div className="ct">
        <div className="chip">💬 Community Love</div>
        <h2 className="sh2">What Our Customers Say</h2>
        <p className="ssub">Real people, real mountains, real taste.</p>
      </div>

      <div className="rgrid">
        {REVIEWS.map((r, i) => (
          <div key={i} className="rcard">
            <div className="rq">&quot;</div>
            <div className="rstars">★★★★★</div>
            <p className="rtxt">&quot;{r.text}&quot;</p>
            <div className="rauth">
              <div className="rav">{r.initial}</div>
              <div>
                <div className="ran">{r.name}</div>
                <div className="rloc">{r.location}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
