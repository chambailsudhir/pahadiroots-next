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
}

export const REGION_META: Record<string, RegionMeta> = {
  hp: {
    emoji: '🏔️', tagline: 'Dev Bhoomi',
    panelBg: 'linear-gradient(135deg,#1a3a1e,#2d5233)',
    pills: ['🍎 Apple & ACV', '🍯 Pine Honey', '🍵 Kangra Tea', '🥛 Bilona Ghee', '🌰 Chilgoza Nuts'],
    snippet: 'Dev Bhoomi — Deodar forests hide cliff-hive honey & Kangra tea perfumes alpine air.',
    description: 'Himachal Pradesh — Dev Bhoomi, the Land of Gods. Ancient Shiva temples cling to cliff faces above apple orchards that bloom white every spring. The Kangra valley, cradle of a 5,000-year-old civilisation, produces an orthodox tea so delicate it was once reserved for royalty. From Kinnaur\'s snowbound heights come the rare Chilgoza pine nuts — hand-gathered from ancient forests above 2,500 metres.',
  },
  uk: {
    emoji: '🏔️', tagline: 'Dev Bhoomi',
    panelBg: 'linear-gradient(135deg,#1a3a1e,#2d5233)',
    pills: ['🍯 Wild Honey', '🌾 Pahadi Rajma', '🌸 Buransh Juice', '🥛 Badri Ghee', '🌿 Jakhiya'],
    snippet: 'Sacred rivers, ancient temples & meadows above 3,000m yielding wild honey and Badri ghee.',
    description: 'Kumaon and Garhwal — sacred Himalayan land of ancient temples, dense forests, and glacial rivers. Wild multifloral honey, deep-red Pahadi rajma, and precious Badri cow ghee from meadows above 3,000 metres.',
  },
  jk: {
    emoji: '🌷', tagline: 'Paradise on Earth',
    panelBg: 'linear-gradient(135deg,#1e3a8a,#2d4fa3)',
    pills: ['🌸 Kashmiri Kesar', '🌰 Kagzi Walnuts', '🍵 Kahwa Tea', '🌶️ Kashmiri Mirchi', '🥜 Almonds'],
    snippet: "Saffron fields turn violet each October. The world's finest spice, harvested before sunrise.",
    description: 'Kashmir — Jannat, as the Mughals called it — where saffron fields turn the Pampore plains a deep violet every October, harvested flower by flower before sunrise. Mongra saffron — Grade A, thread by thread — is the world\'s most precious spice.',
  },
  la: {
    emoji: '❄️', tagline: 'Land of High Passes',
    panelBg: 'linear-gradient(135deg,#4a2c10,#6b3a18)',
    pills: ['🫐 Seabuckthorn', '🪨 Shilajit', '🍑 Wild Apricots', '⚡ Black Buckwheat', '🧂 Rock Salt'],
    snippet: 'Roof of the world. Shilajit oozes from granite at 3,500m. Seabuckthorn lines the Indus.',
    description: 'Ladakh — the roof of the world, where the sky is impossibly blue. Seabuckthorn berries ripen on thorny bushes along the Indus river — loaded with Vitamin C, Omega-7, and antioxidants. Shilajit oozes from granite rocks during summer thaw.',
  },
  sk: {
    emoji: '🌺', tagline: "India's First Organic State",
    panelBg: 'linear-gradient(135deg,#1a3a1e,#2a5230)',
    pills: ['🫚 Large Cardamom', '🌿 Organic Turmeric', '🍵 Temi Tea', '🌱 Organic Ginger', '🥬 Gundruk'],
    snippet: "India's only fully organic state. Cardamom groves under forest shade, Temi tea above clouds.",
    description: "Sikkim — India's first and only fully organic state. Large cardamom, smoky and complex, grows under forest canopy in the steep Dzongu valley. Temi Tea Estate, perched at 1,600 metres, produces one of India's most prized orthodox teas.",
  },
  as: {
    emoji: '🌊', tagline: 'Land of the Red River',
    panelBg: 'linear-gradient(135deg,#1a2a3a,#2d4053)',
    pills: ['🍵 Assam CTC Tea', '🍯 Wild Forest Honey', '🌶️ Bhut Jolokia', '🫚 Mustard Oil', '🌿 Black Pepper'],
    snippet: "The world's largest river island. Assam tea — 70% of India's total production.",
    description: "Assam — the land of the Brahmaputra and the tea that woke the world. Assam produces 70% of India's total tea output — the bold, malty CTC that fuels a billion cups every morning.",
  },
  ml: {
    emoji: '🌧️', tagline: 'Abode of Clouds',
    panelBg: 'linear-gradient(135deg,#1e3a8a,#2d4fa3)',
    pills: ['🌿 Lakadong Turmeric', '🌑 Wild Black Pepper', '🍯 Wild Honey', '🍃 Bay Leaf', '🫚 Hill Ginger'],
    snippet: 'Wettest land on earth. Lakadong turmeric with 7.5% curcumin — highest on the planet.',
    description: 'Meghalaya — Abode of Clouds, the wettest land on earth. Lakadong turmeric carries up to 7.5% curcumin — the highest of any turmeric variety on earth.',
  },
  nl: {
    emoji: '🌶️', tagline: 'Land of Festivals & Fire',
    panelBg: 'linear-gradient(135deg,#3a0a0a,#5c1a1a)',
    pills: ['🌶️ Bhut Jolokia', '🍯 Wild Hill Honey', '🫙 Axone (Fermented)', '🌿 Wild Herbs', '🧂 Tribal Salt'],
    snippet: 'Ghost Pepper country. Hornbill Festival, 16 tribes, and fermented Axone — fierce & proud.',
    description: 'Nagaland — Land of the Hornbill, where 16 distinct tribes gather each December. Bhut Jolokia, the Ghost Pepper — once the world\'s hottest chilli — grows wild in Naga villages.',
  },
  mn: {
    emoji: '💃', tagline: 'Land of Dance & Heritage',
    panelBg: 'linear-gradient(135deg,#1a1e3a,#2d3353)',
    pills: ['🌾 Black Rice', '🎋 Bamboo Shoots', '🌿 Wild Herbs', '🍯 Wild Honey', '🧵 Handloom'],
    snippet: 'Purple Chakhao rice, Loktak Lake, and a matrilineal society where women rule the market.',
    description: "Manipur — the Jewelled Land. Chakhao, the black rice of Manipur — this purple-grain heirloom rice cooked for royal feasts — is now one of India's most antioxidant-rich foods.",
  },
  tr: {
    emoji: '🏛️', tagline: 'Land of Fourteen Tribes',
    panelBg: 'linear-gradient(135deg,#0d3320,#1a5c3a)',
    pills: ['🍍 Queen Pineapple', '🍯 Wild Forest Honey', '🎋 Bamboo Shoots', '🌿 Matai Peas', '🫙 Berma'],
    snippet: 'Queen pineapple so sweet it needs no sugar. Wild honey from ancient Chakma bark hives.',
    description: 'Tripura — where Culture Meets Nature. The queen pineapple here is so sweet it needs no sugar. Wild forest honey is gathered by Chakma & Tripuri tribes using centuries-old bark hives.',
  },
  ar: {
    emoji: '🌿', tagline: 'Land of the Dawn-Lit Mountains',
    panelBg: 'linear-gradient(135deg,#1a3a1e,#2d5233)',
    pills: ['🍊 Kiwi & Citrus', '🍯 Wild Honey', '🌿 Adi Herbs', '🫚 Mustard Oil', '🌾 Rice Wine'],
    snippet: 'Sunrise state. Wild honey from the oldest forest. Tribal herbs unchanged for millennia.',
    description: 'Arunachal Pradesh — the Land of the Dawn-Lit Mountains, where the sun rises first in India. Dense, untouched forests yield some of the most potent wild honey on earth.',
  },
  mz: {
    emoji: '🌸', tagline: 'The Blue Mountain State',
    panelBg: 'linear-gradient(135deg,#1a1e3a,#2d3a6b)',
    pills: ['🌶️ Bird Eye Chilli', '🍯 Wild Honey', '🫙 Dawl Ku', '🌿 Wild Herbs', '🎋 Bamboo'],
    snippet: 'Land of the Lushai Hills. Bird eye chilli so fierce it lights you up from the inside.',
    description: 'Mizoram — the Blue Mountain State, where gentle rolling hills hide some of the most fiery and unique ingredients in Northeast India.',
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
