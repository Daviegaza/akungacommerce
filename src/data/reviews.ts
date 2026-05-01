import type { Review } from '@/types'

export const reviews: Review[] = [
  // Aura Pro Headphones
  {
    id: 'r1',
    productId: 'aura-pro',
    userId: 'u1',
    userName: 'Marcus Chen',
    userAvatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100&q=80',
    rating: 5,
    title: 'Best headphones I have ever owned — and I have tried them all',
    comment:
      'I have owned the Sony XM5, Bose QC45, and AirPods Max. The Aura Pro beats all of them. The noise cancellation is eerily silent — I use these daily on a noisy bus commute and in an open-plan office. The soundstage is wide and detailed with tight, controlled bass. Build quality feels truly premium with the magnesium frame, and the memory foam ear cups do not get hot even after 4+ hours. Battery life consistently exceeds 35 hours. Worth every single penny.',
    createdAt: '2026-03-20',
    isVerified: true,
  },
  {
    id: 'r2',
    productId: 'aura-pro',
    userId: 'u2',
    userName: 'Sarah Kim',
    userAvatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=100&q=80',
    rating: 4,
    title: 'Incredible sound, but slightly tight for long sessions',
    comment:
      'Sound quality is outstanding — detailed mids, sparkling highs, and bass that punches without muddying the mix. ANC is top-tier, easily on par with the class leaders. My only complaint is the clamping force; after 3-4 hours they start to feel tight (I have a larger head). The carrying case is also bulkier than I would like for travel. Still, for the price during the launch sale, these are a steal.',
    createdAt: '2026-03-18',
    isVerified: true,
  },
  {
    id: 'r3',
    productId: 'aura-pro',
    userId: 'u3',
    userName: 'David Okonkwo',
    userAvatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=100&q=80',
    rating: 5,
    title: 'The multipoint feature changed my workflow',
    comment:
      'Being able to connect to my phone and laptop simultaneously and switch seamlessly is a game-changer. I take calls on my laptop, then walk away listening to music on my phone without touching any settings. The mic quality on calls is also excellent — my colleagues say I sound better than on my desktop mic. The Midnight Blue color is gorgeous in person.',
    createdAt: '2026-04-02',
    isVerified: true,
  },

  // SilenceBuds Pro 2
  {
    id: 'r4',
    productId: 'silencebuds-pro2',
    userId: 'u4',
    userName: 'Emily Watson',
    userAvatar: 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=100&q=80',
    rating: 5,
    title: 'Finally, earbuds that do not fall out at the gym',
    comment:
      'I have tried so many TWS earbuds and they all fell out during burpees or jump rope. These stay locked in. The sound is incredible — the triple driver setup really does make a difference, especially in the treble clarity. ANC is strong enough to silence the gym music. IPX5 means I do not worry about sweat. The spatial audio is a nice bonus for watching movies on my phone.',
    createdAt: '2026-04-12',
    isVerified: true,
  },
  {
    id: 'r5',
    productId: 'silencebuds-pro2',
    userId: 'u5',
    userName: 'James Park',
    userAvatar: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=100&q=80',
    rating: 4,
    title: 'Great sound, average call quality in wind',
    comment:
      'Music playback and ANC are both excellent — easily competitive with $300+ earbuds. The fit is comfortable for hours. My one issue: call quality in windy conditions. The mics pick up wind noise noticeably. Indoors or in calm conditions, calls are clear. For the price, the audio quality alone makes them worth it.',
    createdAt: '2026-04-05',
    isVerified: true,
  },

  // Pulse Smartwatch S3
  {
    id: 'r6',
    productId: 'pulse-s3',
    userId: 'u6',
    userName: 'Alex Rodriguez',
    userAvatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100&q=80',
    rating: 5,
    title: 'The perfect smartwatch — no compromises',
    comment:
      'Beautiful AMOLED display that is perfectly readable in direct sunlight. The health sensors match my medical devices within 1-2% accuracy — the ECG gave me real peace of mind. Dual-band GPS locks on in seconds and tracks routes better than my Garmin. Battery genuinely lasts 12+ days with always-on display enabled (I charge every other Sunday). The titanium model with sapphire glass is stunning.',
    createdAt: '2026-04-02',
    isVerified: true,
  },
  {
    id: 'r7',
    productId: 'pulse-s3',
    userId: 'u7',
    userName: 'Priya Sharma',
    userAvatar: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=100&q=80',
    rating: 4,
    title: 'Great watch, sleep tracking is the standout feature',
    comment:
      'I bought this primarily for sleep tracking and it delivers. The sleep stage detection is remarkably accurate — it correctly identifies when I wake up during the night and the readiness score correlates well with how I actually feel. The watch itself is premium and comfortable for 24/7 wear. I wish the app had more data export options. The 14-day battery claim is accurate if you disable the always-on display.',
    createdAt: '2026-03-28',
    isVerified: true,
  },

  // Waveform Speaker Mini
  {
    id: 'r8',
    productId: 'waveform-speaker-mini',
    userId: 'u8',
    userName: 'Tom Bradley',
    userAvatar: 'https://images.unsplash.com/photo-1560250097-0b93528c311a?w=100&q=80',
    rating: 5,
    title: 'This little thing is LOUD — and survives everything',
    comment:
      'Took this on a camping trip. Dropped it in a river (fully submerged for about 20 seconds while I panicked). Pulled it out, still playing music. It got covered in mud, rained on, and sat in direct sun for hours. The 360° sound fills a campsite surprisingly well. Battery lasted the whole 3-day trip on one charge. The Coral color makes it easy to spot when you set it down somewhere. Best portable speaker I have owned.',
    createdAt: '2026-04-15',
    isVerified: false,
  },

  // VinylCraft Turntable
  {
    id: 'r9',
    productId: 'vinylcraft-turntable',
    userId: 'u9',
    userName: 'Claire Dubois',
    userAvatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&q=80',
    rating: 5,
    title: 'My vinyl collection sounds new again',
    comment:
      'Upgraded from a decade-old entry-level turntable and the difference is staggering. The Ortofon 2M Red cartridge extracts detail I never knew was in my records. The build quality is exceptional — the MDF plinth is solid, the tonearm is precise, and the acrylic platter looks beautiful. Setup took 20 minutes. The Bluetooth output is a nice convenience for casual listening, though purists will want to use the RCA outputs. Worth the investment for any serious vinyl listener.',
    createdAt: '2026-03-05',
    isVerified: true,
  },

  // AlignPro Yoga Mat
  {
    id: 'r10',
    productId: 'yoga-mat-premium',
    userId: 'u10',
    userName: 'Yuki Tanaka',
    userAvatar: 'https://images.unsplash.com/photo-1580489944761-15a19d654956?w=100&q=80',
    rating: 5,
    title: 'The alignment lines are genius',
    comment:
      'I teach yoga and bought this mat for my personal practice. The alignment markings are subtle but incredibly useful — they help me demonstrate poses with consistency. The grip is the real standout: the suede surface genuinely gets grippier as you sweat, which is the opposite of most mats. No slipping in downward dog, even during hot yoga. The 5mm thickness is perfect — cushioned enough for knees but stable for balances. And it ships without plastic!',
    createdAt: '2026-04-18',
    isVerified: true,
  },

  // HydroFlask
  {
    id: 'r11',
    productId: 'hydroflask-bottle',
    userId: 'u11',
    userName: 'Jake Morrison',
    userAvatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=100&q=80',
    rating: 5,
    title: 'Still ice cold after a full day in the car',
    comment:
      'I filled it with ice water before a hike in 95°F weather. After 8 hours on the trail and leaving it in my hot car for another 4, the water was still cold with ice chunks floating. The powder coat has survived 6 months of daily use without a single scratch. The wide mouth makes it easy to add ice and clean. Bought the 32oz Ocean Blue — getting the 40oz Forest Green next.',
    createdAt: '2026-04-10',
    isVerified: false,
  },

  // Nomad Backpack
  {
    id: 'r12',
    productId: 'nomad-backpack',
    userId: 'u12',
    userName: 'Rachel Green',
    userAvatar: 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=100&q=80',
    rating: 5,
    title: 'The perfect EDC / travel backpack',
    comment:
      'Used this as my only bag on a 2-week trip across Europe. The 22L fits more than you would think — I packed 4 days of clothes, laptop, toiletries, and still had room. The Fidlock buckles are addictive to use. The anti-theft pocket gave me peace of mind in crowded metros. After 6 months of daily use, the recycled nylon shows zero wear. The luggage pass-through is perfectly placed. My only wish: a water bottle pocket that fits larger bottles.',
    createdAt: '2026-03-22',
    isVerified: true,
  },

  // Stride Ultra
  {
    id: 'r13',
    productId: 'stride-ultra',
    userId: 'u13',
    userName: 'Lisa Thompson',
    userAvatar: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=100&q=80',
    rating: 5,
    title: 'PR every single race since buying these',
    comment:
      'I have run three half marathons and one full marathon in these. Set a personal best every single time. The carbon plate gives an incredible energy return — it honestly feels like the shoes are pushing you forward. At 210g they are so light you forget you are wearing them. The Flyknit upper breathes perfectly — no blisters even after 42km. Yes they are expensive, but if you care about your race times, these are worth every cent.',
    createdAt: '2026-04-15',
    isVerified: true,
  },
  {
    id: 'r14',
    productId: 'stride-ultra',
    userId: 'u14',
    userName: 'Mike Peters',
    userAvatar: 'https://images.unsplash.com/photo-1560250097-0b93528c311a?w=100&q=80',
    rating: 4,
    title: 'Amazing race shoe, but not a daily trainer',
    comment:
      'These are phenomenal for race day and tempo runs. The energy return from the carbon plate is real and measurable in my splits. However, for easy recovery runs I prefer something with more cushion. The outsole rubber wore down faster than I expected — after about 200km the forefoot is noticeably worn. For races and key workouts: 5 stars. For durability as a daily trainer: 3.5 stars.',
    createdAt: '2026-04-08',
    isVerified: true,
  },

  // LensPro Camera
  {
    id: 'r15',
    productId: 'lenspro-camera',
    userId: 'u15',
    userName: 'Chris Nakamura',
    userAvatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100&q=80',
    rating: 5,
    title: 'A professional workhorse',
    comment:
      'Switched from a Sony A7R V and this is a meaningful upgrade. The 33MP sensor hits the sweet spot between resolution and file size. 8K/60p with internal RAW is a video editor\'s dream. The AI autofocus is borderline prescient — it tracks bird eyes, vehicle headlights, even helmet visors. The EVF is the best I have ever used. Dual CFexpress slots are a must for wedding photographers. The weather sealing survived a full day of rainforest shooting.',
    createdAt: '2026-02-15',
    isVerified: true,
  },

  // CloudWeight Blanket
  {
    id: 'r16',
    productId: 'weighted-blanket',
    userId: 'u16',
    userName: 'Amara Osei',
    userAvatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&q=80',
    rating: 5,
    title: 'First night: 8 hours of uninterrupted sleep',
    comment:
      'I have struggled with insomnia for years. The first night with this blanket I slept 8 hours straight — my Oura ring confirmed it. The nano-glass beads are completely silent (my old plastic-bead blanket sounded like a rainstick every time I moved). The organic cotton cover is soft and genuinely cooling. I got the 9kg Queen size (I weigh 68kg) and it is perfect. The Sage Green color looks beautiful on my bed. If you are on the fence, just buy it.',
    createdAt: '2026-04-20',
    isVerified: true,
  },

  // DeskPad Merino
  {
    id: 'r17',
    productId: 'deskpad-xl',
    userId: 'u17',
    userName: 'Daniel Lee',
    userAvatar: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=100&q=80',
    rating: 5,
    title: 'My desk finally feels complete',
    comment:
      'I did not realize how much I needed a good desk mat until I got this. The merino wool surface is incredibly smooth — my mouse glides perfectly with no stuttering. The temperature regulation is real: in winter it feels warm, in summer it stays cool. The cork base grips my wooden desk with zero movement. It also dramatically reduced the echo in my home office. Smells faintly of wool for the first day, then neutral. Worth every dollar for the aesthetic upgrade alone.',
    createdAt: '2026-03-14',
    isVerified: true,
  },

  // TypeForge Elite
  {
    id: 'r18',
    productId: 'mech-keyboard-elite',
    userId: 'u18',
    userName: 'Sophia Martinez',
    userAvatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=100&q=80',
    rating: 5,
    title: 'The endgame keyboard — I have stopped buying keyboards',
    comment:
      'I have owned 12 mechanical keyboards over the years. This is the last one I will buy. The gasket mount creates a bouncy, comfortable typing feel. The CNC aluminum case at 2.1kg does not move a millimeter. Hot-swap means I can experiment with any switch. The KAT-profile PBT keycaps are the best stock keycaps I have used. The brass weight on the bottom is a work of art. 8000Hz polling is noticeable in rhythm games. The E-White finish is flawless.',
    createdAt: '2026-03-01',
    isVerified: true,
  },

  // Artisan Mug Set
  {
    id: 'r19',
    productId: 'ceramic-mug-set',
    userId: 'u19',
    userName: 'Nina Johansson',
    userAvatar: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=100&q=80',
    rating: 5,
    title: 'Beautiful, functional, and each one is unique',
    comment:
      'Bought these as a housewarming gift for myself. The matte glaze is gorgeous and the slight variations between mugs make the set feel genuinely artisanal. Double-walled means my coffee stays hot but the outside is never too hot to hold. They stack neatly which saves cabinet space. Dishwasher-safe was a requirement for me and these have survived dozens of cycles with no fading. The Ocean Set colors are even prettier in person than in photos.',
    createdAt: '2026-01-30',
    isVerified: true,
  },

  // FitBand Pro
  {
    id: 'r20',
    productId: 'fitband-pro',
    userId: 'u20',
    userName: 'Ryan Cooper',
    userAvatar: 'https://images.unsplash.com/photo-1560250097-0b93528c311a?w=100&q=80',
    rating: 4,
    title: 'Great value fitness tracker',
    comment:
      'For under $100, this punches way above its weight. The AMOLED display is bright and colorful. Sleep tracking seems accurate and the stress monitoring feature has actually helped me be more mindful. Battery life is a solid 10-12 days with all features enabled. The aluminum body makes it look more premium than competitors. Heart rate can lag slightly during HIIT — for steady-state cardio it is accurate. Overall, an excellent tracker for the price.',
    createdAt: '2026-04-25',
    isVerified: true,
  },
]
