/**
 * REGION_META — single source of truth for curated per-state marketing copy
 * (emoji, tagline, panel background, product pills, short snippet, longer
 * description).
 *
 * BUG FIX: this used to be duplicated verbatim in both
 * src/app/regions/page.tsx and src/components/homepage/ExploreByRegion.tsx.
 * The two copies had already drifted (Nagaland's Axone pill read
 * "🫙 Axone" in one file and "🫙 Axone (Fermented)" in the other) and
 * src/app/regions/[slug]/page.tsx never referenced this data at all, so the
 * single-region detail page showed a hardcoded dark-green hero and only the
 * raw (possibly null) DB `state.description` — none of the curated tagline/
 * pills/panel-color theming used everywhere else on the site.
 *
 * All three call sites now import from here, so edits only need to happen
 * once and every surface (listing grid, homepage widget, detail page) stays
 * in sync automatically.
 */
export interface RegionMeta {
  emoji: string
  tagline: string
  panelBg: string
  pills: string[]
  snippet: string
  description: string
  /** Optional italic gold line under the tagline on the homepage region panel. */
  subtitle?: string
  /** Optional homepage only hero photo that overrides the state's database image. */
  homeHeroImage?: string
  /** CSS object-position for the wide homepage hero crop, so faces and the subject stay in frame. */
  heroFocus?: string
  /** Optional darker panel background used only by the homepage region widget. */
  homePanelBg?: string
  /** Optional homepage panel copy; falls back to `snippet` when absent. */
  homeCopy?: string
}

export const REGION_META: Record<string, RegionMeta> = {
  hp: {
    heroFocus: 'center',
    homeHeroImage: '/explore-region-art/himachal-hero.jpg',
    emoji: '🏔️', tagline: 'Dev Bhoomi',
    subtitle: 'Land of Gods',
    homeCopy: 'Himachal Pradesh — Dev Bhoomi, the land of Gods. Ancient forests, sacred rivers, fertile valleys and hardworking mountain people make this region a source of some of the purest foods in the world.',
    homePanelBg: 'linear-gradient(135deg,#1a3125,#13251a)',
    panelBg: 'linear-gradient(135deg,#1a3a1e,#2d5233)',
    pills: ['🍎 Apple & ACV', '🍯 Pine Honey', '🍵 Kangra Tea', '🥛 Bilona Ghee', '🌰 Chilgoza Nuts'],
    snippet: 'Dev Bhoomi — Deodar forests hide cliff-hive honey & Kangra tea perfumes alpine air.',
    description: 'Himachal Pradesh — Dev Bhoomi, the Land of Gods. Ancient Shiva temples cling to cliff faces above apple orchards that bloom white every spring. High in the Kangra valley, the same families have hand-rolled orthodox tea for generations, leaf by leaf, the way their grandmothers taught them. From Kinnaur\'s snowbound heights, foragers climb past 2,500 metres each autumn to gather wild Chilgoza pine nuts — a harvest that happens once a year, by hand, or not at all.',
  },
  uk: {
    heroFocus: 'center',
    homeHeroImage: '/explore-region-art/uttarakhand-hero.jpg',
    emoji: '🏔️', tagline: 'Dev Bhoomi',
    panelBg: 'linear-gradient(135deg,#1a3a1e,#2d5233)',
    pills: ['🍯 Wild Honey', '🌾 Pahadi Rajma', '🌸 Buransh Juice', '🥛 Badri Ghee', '🌿 Jakhiya'],
    snippet: 'Sacred rivers, ancient temples & meadows above 3,000m yielding wild honey and Badri ghee.',
    description: 'Kumaon and Garhwal — sacred Himalayan land of ancient temples, dense oak forests, and glacial rivers cold enough to numb your hands. Beekeepers still follow their bees on foot through blooming Buransh forests for wild multifloral honey, while mountain households press ghee from Badri cows grazing meadows above 3,000 metres — the same slow, patient methods passed down through generations of hill families.',
  },
  jk: {
    heroFocus: 'center',
    homeHeroImage: '/explore-region-art/jammu-kashmir-hero.jpg',
    emoji: '🌷', tagline: 'Paradise on Earth',
    panelBg: 'linear-gradient(135deg,#1e3a8a,#2d4fa3)',
    pills: ['🌸 Kashmiri Kesar', '🌰 Kagzi Walnuts', '🍵 Kahwa Tea', '🌶️ Kashmiri Mirchi', '🥜 Almonds'],
    snippet: "Saffron fields turn violet each October. The world's finest spice, harvested before sunrise.",
    description: 'Kashmir — Jannat, as the Mughals called it — where saffron fields turn the Pampore plains a deep violet every October. Entire families rise before dawn to pluck each crimson thread by hand before the sun can fade it; it takes hundreds of flowers to fill a single gram. This is Mongra saffron — Grade A, thread by thread — gathered the same painstaking way it has been for centuries.',
  },
  la: {
    heroFocus: 'center',
    homeHeroImage: '/explore-region-art/ladakh-hero.jpg',
    emoji: '❄️', tagline: 'Land of High Passes',
    panelBg: 'linear-gradient(135deg,#4a2c10,#6b3a18)',
    pills: ['🫐 Seabuckthorn', '🪨 Shilajit', '🍑 Wild Apricots', '⚡ Black Buckwheat', '🧂 Rock Salt'],
    snippet: 'Roof of the world. Shilajit oozes from granite at 3,500m. Seabuckthorn lines the Indus.',
    description: 'Ladakh — the roof of the world, where the sky turns impossibly blue and villages sit above 3,500 metres. Along the Indus, families gather thorny Seabuckthorn berries by hand each autumn — a fruit hardy enough to survive winters that would kill almost anything else. Shilajit, a mineral resin, seeps from granite cliffs only during the brief summer thaw, collected by locals who have read these mountains their whole lives.',
  },
  sk: {
    emoji: '🌺', tagline: "India's First Organic State",
    panelBg: 'linear-gradient(135deg,#1a3a1e,#2a5230)',
    pills: ['🫚 Large Cardamom', '🌿 Organic Turmeric', '🍵 Temi Tea', '🌱 Organic Ginger', '🥬 Gundruk'],
    snippet: "India's only fully organic state. Cardamom groves under forest shade, Temi tea above clouds.",
    description: "Sikkim — India's first and only fully organic state, where farming without chemicals isn't a certification, it's simply how it's always been done. Large cardamom grows in the cool shade of the forest canopy in the Dzongu valley, tended by the same families for generations. High above the clouds at 1,600 metres, Temi Tea Estate's pickers hand-select two leaves and a bud at a time for one of India's most prized orthodox teas.",
  },
  as: {
    emoji: '🌊', tagline: 'Land of the Red River',
    panelBg: 'linear-gradient(135deg,#1a2a3a,#2d4053)',
    pills: ['🍵 Assam CTC Tea', '🍯 Wild Forest Honey', '🌶️ Bhut Jolokia', '🫚 Mustard Oil', '🌿 Black Pepper'],
    snippet: "The world's largest river island. Assam tea — 70% of India's total production.",
    description: "Assam — the land of the mighty Brahmaputra and the tea that wakes the world. Across sprawling gardens, generations of pickers have plucked the same bold, malty leaf every morning — Assam alone supplies 70% of India's total tea output. Along its border villages, growers still tend Bhut Jolokia, the ghost pepper, the old way: no shortcuts, no chemicals, just patience.",
  },
  ml: {
    emoji: '🌧️', tagline: 'Abode of Clouds',
    panelBg: 'linear-gradient(135deg,#1e3a8a,#2d4fa3)',
    pills: ['🌿 Lakadong Turmeric', '🌑 Wild Black Pepper', '🍯 Wild Honey', '🍃 Bay Leaf', '🫚 Hill Ginger'],
    snippet: 'Wettest land on earth. Lakadong turmeric with 7.5% curcumin — highest on the planet.',
    description: 'Meghalaya — Abode of Clouds, the wettest place on earth, where it can rain for days without stopping. In the Jaintia Hills, farmers have grown Lakadong turmeric on ancestral land for generations — it carries up to 7.5% curcumin, the highest of any turmeric on the planet, prized long before anyone could explain why. Foragers still climb into the forest for wild black pepper and wild honey, exactly as their elders did.',
  },
  nl: {
    emoji: '🌶️', tagline: 'Land of Festivals & Fire',
    panelBg: 'linear-gradient(135deg,#3a0a0a,#5c1a1a)',
    pills: ['🌶️ Bhut Jolokia', '🍯 Wild Hill Honey', '🫙 Axone (Fermented)', '🌿 Wild Herbs', '🧂 Tribal Salt'],
    snippet: 'Ghost Pepper country. Hornbill Festival, 16 tribes, and fermented Axone — fierce & proud.',
    description: 'Nagaland — Land of the Hornbill, where 16 distinct tribes gather every December to sing and dance as one. Bhut Jolokia — once the world\'s hottest chilli — still grows wild in Naga villages, tended without fertiliser or spray. Axone, fermented soybean cake, is made the way Naga grandmothers have always made it: patiently, in small batches, never rushed.',
  },
  mn: {
    emoji: '💃', tagline: 'Land of Dance & Heritage',
    panelBg: 'linear-gradient(135deg,#1a1e3a,#2d3353)',
    pills: ['🌾 Black Rice', '🎋 Bamboo Shoots', '🌿 Wild Herbs', '🍯 Wild Honey', '🧵 Handloom'],
    snippet: 'Purple Chakhao rice, Loktak Lake, and a matrilineal society where women rule the market.',
    description: "Manipur — the Jewelled Land, home to Loktak Lake's floating gardens and a matrilineal market, Ima Keithel, run entirely by women. Chakhao, the purple-black rice once reserved for royal feasts, is still grown by hand in small terraced fields — a heirloom variety now recognised as one of India's most antioxidant-rich foods.",
  },
  tr: {
    emoji: '🏛️', tagline: 'Land of Fourteen Tribes',
    panelBg: 'linear-gradient(135deg,#0d3320,#1a5c3a)',
    pills: ['🍍 Queen Pineapple', '🍯 Wild Forest Honey', '🎋 Bamboo Shoots', '🌿 Matai Peas', '🫙 Berma'],
    snippet: 'Queen pineapple so sweet it needs no sugar. Wild honey from ancient Chakma bark hives.',
    description: 'Tripura — where culture meets nature amid fourteen distinct tribes. Chakma and Tripuri families still gather wild forest honey using centuries-old bark hives passed down through generations, and grow a queen pineapple so naturally sweet it needs no sugar. Every harvest here carries the same unhurried care it always has.',
  },
  ar: {
    emoji: '🌿', tagline: 'Land of the Dawn-Lit Mountains',
    panelBg: 'linear-gradient(135deg,#1a3a1e,#2d5233)',
    pills: ['🍊 Kiwi & Citrus', '🍯 Wild Honey', '🌿 Adi Herbs', '🫚 Mustard Oil', '🌾 Rice Wine'],
    snippet: 'Sunrise state. Wild honey from the oldest forest. Tribal herbs unchanged for millennia.',
    description: 'Arunachal Pradesh — the Land of the Dawn-Lit Mountains, where the sun rises first anywhere in India. Deep in forests that have barely changed in a thousand years, Adi tribal families forage wild honey from cliffside hives, using herbs and remedies unchanged for generations. Nothing here is farmed at scale — it\'s gathered, carefully, the way it always has been.',
  },
  mz: {
    emoji: '🌸', tagline: 'The Blue Mountain State',
    panelBg: 'linear-gradient(135deg,#1a1e3a,#2d3a6b)',
    pills: ['🌶️ Bird Eye Chilli', '🍯 Wild Honey', '🫙 Dawl Ku', '🌿 Wild Herbs', '🎋 Bamboo'],
    snippet: 'Land of the Lushai Hills. Bird eye chilli so fierce it lights you up from the inside.',
    description: 'Mizoram — the Blue Mountain State, where gentle rolling hills hide some of the fiercest, most distinctive ingredients in Northeast India. Mizo households grow bird\'s eye chilli in kitchen gardens the way their parents did, and ferment Dawl Ku by hand in small batches — flavours built slowly, never mass-produced.',
  },
}

/**
 * getRegionMeta — case-insensitive lookup. Region ids/state_ids from the DB
 * have been inconsistently compared with and without case-normalization
 * across the codebase (see BUG FIX notes in storeData/regions pages); this
 * helper is the one safe way to read REGION_META so callers don't have to
 * remember to lowercase first.
 */
export function getRegionMeta(id: string | null | undefined): RegionMeta | undefined {
  if (!id) return undefined
  return REGION_META[String(id).toLowerCase()]
}
