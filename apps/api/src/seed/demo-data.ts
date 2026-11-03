import type { AreaId, CancellationPolicy } from '@parkfairy/contracts';
import type { PriceRules } from '../parking/pricing.js';

/**
 * Demo marketplace for local development and the smoke suite. Listings are fictional (no
 * real businesses); names and addresses are written in Greek, as owners would.
 */

/** Local-only demo account. Documented in GETTING_STARTED.md; never seeded off localhost. */
export const DEMO_ACCOUNT = {
  email: 'demo@example.com',
  password: 'parkfairy-demo-2026',
  name: 'Demo Οδηγός',
  locale: 'el',
} as const;

export interface DemoPeriod {
  weekday: number;
  opensMinute: number;
  closesMinute: number;
}

export interface DemoSpace {
  label: string;
  isCovered?: boolean;
  hasEvCharging?: boolean;
  isAccessible?: boolean;
  /** This space's own rate, for listings whose spaces differ. */
  hourlyRateMinor?: number;
}

export interface DemoListing {
  slug: string;
  name: string;
  address: string;
  description: string;
  areaId: AreaId;
  latitude: number;
  longitude: number;
  hourlyRateMinor: number;
  dailyMaxMinor: number | null;
  openingHours: DemoPeriod[];
  spaces: DemoSpace[];
  cancellationPolicy: CancellationPolicy;
  /** Only the kinds of price rule this listing shows off. */
  priceRules?: Partial<PriceRules>;
}

const h = (hours: number, minutes = 0) => hours * 60 + minutes;
const WEEK = [1, 2, 3, 4, 5, 6, 7];

function on(days: number[], opens: number, closes: number): DemoPeriod[] {
  return days.map((weekday) => ({ weekday, opensMinute: opens, closesMinute: closes }));
}
const allDay = on(WEEK, 0, h(24));
/** Open from `opens` until `closes` after midnight, every day. */
const overnight = (opens: number, closes: number) => [
  ...on(WEEK, 0, closes),
  ...on(WEEK, opens, h(24)),
];

function spaces(
  prefix: string,
  count: number,
  features: (n: number) => Omit<DemoSpace, 'label'> = () => ({}),
): DemoSpace[] {
  return Array.from({ length: count }, (_, i) => ({
    label: `${prefix}${i + 1}`,
    ...features(i + 1),
  }));
}

export const DEMO_LISTINGS: DemoListing[] = [
  {
    slug: 'syntagma-square-garage',
    cancellationPolicy: 'oneDay',
    name: 'Γκαράζ Πλατείας Συντάγματος',
    address: 'Όθωνος 10, Αθήνα 105 57',
    description: 'Υπόγειο γκαράζ δύο λεπτά από την πλατεία, ανοιχτό όλο το 24ωρο.',
    areaId: 'syntagma',
    latitude: 37.9752,
    longitude: 23.7357,
    hourlyRateMinor: 350,
    dailyMaxMinor: 2500,
    openingHours: allDay,
    spaces: spaces('A', 12, (n) => ({
      isCovered: true,
      hasEvCharging: n <= 3,
      isAccessible: n === 12,
    })),
  },
  {
    slug: 'ermou-parking',
    cancellationPolicy: 'oneHour',
    name: 'Πάρκινγκ Ερμού',
    address: 'Ερμού 45, Αθήνα 105 63',
    description: 'Στεγασμένος χώρος στην αρχή της Ερμού, ιδανικός για ψώνια.',
    areaId: 'syntagma',
    latitude: 37.9762,
    longitude: 23.73,
    hourlyRateMinor: 300,
    dailyMaxMinor: 2200,
    openingHours: on(WEEK, h(7), h(24)),
    spaces: spaces('P', 8, () => ({ isCovered: true })),
  },
  {
    slug: 'monastiraki-open-lot',
    cancellationPolicy: 'oneHour',
    name: 'Υπαίθριος χώρος Μοναστηρακίου',
    address: 'Αστίγγος 6, Αθήνα 105 55',
    description: 'Υπαίθριο πάρκινγκ δίπλα στον σταθμό του μετρό.',
    areaId: 'monastiraki',
    latitude: 37.977,
    longitude: 23.724,
    hourlyRateMinor: 250,
    dailyMaxMinor: 1600,
    openingHours: [...on([1, 2, 3, 4, 5, 6], h(8), h(22)), ...on([7], h(10), h(20))],
    spaces: spaces('M', 10, (n) => ({ isAccessible: n === 1 })),
  },
  {
    slug: 'kolonaki-private-space',
    cancellationPolicy: 'oneDayThenHalf',
    name: 'Ιδιωτική θέση Κολωνακίου',
    address: 'Πατριάρχου Ιωακείμ 20, Αθήνα 106 75',
    description: 'Μία θέση σε ιδιωτική πυλωτή, διαθέσιμη τις καθημερινές.',
    areaId: 'kolonaki',
    latitude: 37.9781,
    longitude: 23.7448,
    hourlyRateMinor: 400,
    dailyMaxMinor: 2800,
    openingHours: on([1, 2, 3, 4, 5], h(8), h(20)),
    spaces: [{ label: '1', isCovered: true }],
  },
  {
    slug: 'skoufa-garage',
    cancellationPolicy: 'oneDay',
    name: 'Γκαράζ Σκουφά',
    address: 'Σκουφά 30, Αθήνα 106 73',
    description: 'Μικρό γκαράζ με φορτιστές ηλεκτρικών αυτοκινήτων. Κλειστό τις Κυριακές.',
    areaId: 'kolonaki',
    latitude: 37.98,
    longitude: 23.741,
    hourlyRateMinor: 380,
    dailyMaxMinor: 2600,
    openingHours: on([1, 2, 3, 4, 5, 6], h(7, 30), h(23)),
    spaces: spaces('S', 6, (n) => ({ isCovered: true, hasEvCharging: n >= 5 })),
  },
  {
    slug: 'koukaki-acropolis-parking',
    cancellationPolicy: 'oneDay',
    name: 'Πάρκινγκ Ακρόπολης – Κουκάκι',
    address: 'Βεΐκου 12, Αθήνα 117 42',
    description: 'Δέκα λεπτά με τα πόδια από το Μουσείο της Ακρόπολης.',
    areaId: 'koukaki',
    latitude: 37.965,
    longitude: 23.7262,
    hourlyRateMinor: 300,
    dailyMaxMinor: 2000,
    openingHours: allDay,
    spaces: spaces('K', 15, (n) => ({
      isCovered: true,
      isAccessible: n <= 2,
      hasEvCharging: n >= 14,
    })),
  },
  {
    slug: 'piraeus-port-gate-e8',
    cancellationPolicy: 'oneHour',
    name: 'Πάρκινγκ Λιμανιού Πειραιά (Πύλη Ε8)',
    address: 'Ακτή Κονδύλη 2, Πειραιάς 185 45',
    description: 'Δίπλα στις αναχωρήσεις για τα νησιά του Αργοσαρωνικού.',
    areaId: 'piraeusPort',
    latitude: 37.944,
    longitude: 23.642,
    hourlyRateMinor: 200,
    dailyMaxMinor: 1500,
    openingHours: allDay,
    spaces: spaces('L', 20, (n) => ({ isAccessible: n <= 2 })),
  },
  {
    slug: 'piraeus-long-stay',
    cancellationPolicy: 'oneDayThenHalf',
    name: 'Μακροχρόνια στάθμευση Πειραιά',
    address: 'Γρηγορίου Λαμπράκη 100, Πειραιάς 185 34',
    description: 'Στεγασμένη στάθμευση για ταξίδια πολλών ημερών, με χαμηλό ημερήσιο όριο.',
    areaId: 'piraeusPort',
    latitude: 37.9466,
    longitude: 23.6501,
    hourlyRateMinor: 150,
    dailyMaxMinor: 1000,
    openingHours: allDay,
    spaces: spaces('LS', 8, () => ({ isCovered: true })),
  },
  {
    slug: 'glyfada-marina-parking',
    cancellationPolicy: 'oneHour',
    priceRules: { weekendRateMinor: 350 },
    name: 'Πάρκινγκ Μαρίνας Γλυφάδας',
    address: 'Ποσειδώνος 50, Γλυφάδα 166 74',
    description: 'Ανοιχτό ως τις 2 τα ξημερώματα, κοντά σε εστιατόρια και μπαρ.',
    areaId: 'glyfada',
    latitude: 37.862,
    longitude: 23.7505,
    hourlyRateMinor: 250,
    dailyMaxMinor: 1500,
    openingHours: overnight(h(6), h(2)),
    spaces: spaces('G', 10, (n) => ({ hasEvCharging: n <= 4 })),
  },
  {
    slug: 'marousi-business-park',
    cancellationPolicy: 'oneDay',
    name: 'Πάρκινγκ Επιχειρηματικού Κέντρου Αμαρουσίου',
    address: 'Κηφισίας 120, Μαρούσι 151 25',
    description: 'Για εργάσιμες μέρες· το Σάββατο έως τις 4 το απόγευμα.',
    areaId: 'marousi',
    latitude: 38.048,
    longitude: 23.805,
    hourlyRateMinor: 200,
    dailyMaxMinor: 1200,
    openingHours: [...on([1, 2, 3, 4, 5], h(6, 30), h(22)), ...on([6], h(8), h(16))],
    spaces: spaces('B', 12, (n) => ({ isCovered: true, hasEvCharging: n <= 6 })),
  },
  {
    slug: 'athens-airport-park-and-fly',
    cancellationPolicy: 'oneDayThenHalf',
    priceRules: {
      discounts: [
        { minDays: 7, percent: 10 },
        { minDays: 14, percent: 20 },
      ],
    },
    name: 'Park & Fly Αεροδρομίου Αθηνών',
    address: 'Λεωφόρος Σπάτων 5, Σπάτα 190 04',
    description: 'Δωρεάν μεταφορά προς τις αναχωρήσεις κάθε 15 λεπτά.',
    areaId: 'athensAirport',
    latitude: 37.93,
    longitude: 23.935,
    hourlyRateMinor: 250,
    dailyMaxMinor: 1800,
    openingHours: allDay,
    spaces: spaces('F', 30, (n) => ({
      isCovered: n <= 10,
      isAccessible: n <= 3,
      hasEvCharging: n >= 28,
      // Under cover costs more; the rest stay on the listing's rate.
      ...(n <= 10 ? { hourlyRateMinor: 300 } : {}),
    })),
  },
  {
    slug: 'aristotelous-parking',
    cancellationPolicy: 'oneHour',
    name: 'Πάρκινγκ Αριστοτέλους',
    address: 'Αριστοτέλους 5, Θεσσαλονίκη 546 24',
    description: 'Στο κέντρο της πόλης, λίγα βήματα από την παραλία.',
    areaId: 'thessalonikiCentre',
    latitude: 40.633,
    longitude: 22.9415,
    hourlyRateMinor: 280,
    dailyMaxMinor: 1800,
    openingHours: allDay,
    spaces: spaces('T', 10, () => ({ isCovered: true })),
  },
  {
    slug: 'ladadika-parking',
    cancellationPolicy: 'oneHour',
    priceRules: { night: { rateMinor: 180, fromMinute: h(23), toMinute: h(3) } },
    name: 'Πάρκινγκ Λαδάδικων',
    address: 'Κατούνη 8, Θεσσαλονίκη 546 25',
    description: 'Ανοιχτό ως τις 3 τα ξημερώματα για τη νυχτερινή ζωή της περιοχής.',
    areaId: 'ladadika',
    latitude: 40.6352,
    longitude: 22.937,
    hourlyRateMinor: 250,
    dailyMaxMinor: 1500,
    openingHours: overnight(h(8), h(3)),
    spaces: spaces('D', 6),
  },
  {
    slug: 'thessaloniki-airport-parking',
    cancellationPolicy: 'oneDayThenHalf',
    name: 'Στάθμευση Αεροδρομίου Μακεδονία',
    address: 'Αεροδρόμιο Μακεδονία, Θεσσαλονίκη 551 03',
    description: 'Στεγασμένες και υπαίθριες θέσεις, πέντε λεπτά από τον τερματικό σταθμό.',
    areaId: 'thessalonikiAirport',
    latitude: 40.522,
    longitude: 22.972,
    hourlyRateMinor: 200,
    dailyMaxMinor: 1400,
    openingHours: allDay,
    spaces: spaces('E', 16, (n) => ({ isCovered: n <= 8, hasEvCharging: n >= 15 })),
  },
];
