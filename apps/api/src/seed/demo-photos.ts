/**
 * Photos of the demo listings, from `seed-assets/photos` (see CREDITS.md there). They are stock
 * pictures of similar places, not of these fictional listings. The text describes each picture
 * in Greek, the language the demo listings are written in.
 */
export interface DemoPhoto {
  file: string;
  alt: string;
}

export const DEMO_PHOTOS: Record<string, DemoPhoto[]> = {
  'syntagma-square-garage': [
    {
      file: 'syntagma-square-garage-1.jpg',
      alt: 'Υπόγειο γκαράζ με σταθμευμένα αυτοκίνητα στις δύο πλευρές και κίτρινο βέλος στο δάπεδο.',
    },
    {
      file: 'syntagma-square-garage-2.jpg',
      alt: 'Λωρίδα υπόγειου γκαράζ με κίτρινα βέλη κατεύθυνσης και αυτοκίνητα στις θέσεις τους.',
    },
  ],
  'ermou-parking': [
    {
      file: 'ermou-parking-1.jpg',
      alt: 'Στεγασμένο πάρκινγκ με κόκκινες κολόνες και διάβαση πεζών στο δάπεδο.',
    },
    {
      file: 'ermou-parking-2.jpg',
      alt: 'Είσοδος γκαράζ με μπάρα και μηχάνημα εισιτηρίων, με ένα μαύρο αυτοκίνητο πίσω της.',
    },
  ],
  'monastiraki-open-lot': [
    {
      file: 'monastiraki-open-lot-1.jpg',
      alt: 'Υπαίθριο πάρκινγκ με πλακόστρωτο και σειρές αυτοκινήτων μπροστά από μεγάλο κτίριο.',
    },
    {
      file: 'monastiraki-open-lot-2.jpg',
      alt: 'Ανοιχτός χώρος στάθμευσης με δέντρα, μπροστά από πολυκατοικίες.',
    },
  ],
  'kolonaki-private-space': [
    {
      file: 'kolonaki-private-space-1.jpg',
      alt: 'Μία θέση στάθμευσης σημαδεμένη με διακεκομμένες λευκές γραμμές σε πλακόστρωτο.',
    },
  ],
  'skoufa-garage': [
    {
      file: 'skoufa-garage-1.jpg',
      alt: 'Υπόγειος χώρος με θολωτή τσιμεντένια οροφή, κολόνες και άδειες θέσεις στάθμευσης.',
    },
    {
      file: 'skoufa-garage-2.jpg',
      alt: 'Σήμανση φόρτισης ηλεκτρικών αυτοκινήτων βαμμένη στην άσφαλτο μιας θέσης.',
    },
  ],
  'koukaki-acropolis-parking': [
    {
      file: 'koukaki-acropolis-parking-1.jpg',
      alt: 'Μακρύ υπόγειο πάρκινγκ λαξευμένο σε βράχο, με αυτοκίνητα στις δύο πλευρές.',
    },
    {
      file: 'koukaki-acropolis-parking-2.jpg',
      alt: 'Νεοβαμμένες θέσεις για άτομα με αναπηρία, με το σύμβολο του αμαξιδίου στην άσφαλτο.',
    },
  ],
  'piraeus-port-gate-e8': [
    {
      file: 'piraeus-port-gate-e8-1.jpg',
      alt: 'Αυτοκίνητα σταθμευμένα στο λιμάνι, με μεγάλα επιβατηγά πλοία πίσω τους.',
    },
    {
      file: 'piraeus-port-gate-e8-2.jpg',
      alt: 'Άδεια προβλήτα λιμανιού κάτω από συννεφιασμένο ουρανό, με κτίρια στην απέναντι όχθη.',
    },
  ],
  'piraeus-long-stay': [
    {
      file: 'piraeus-long-stay-1.jpg',
      alt: 'Πολυώροφο κτίριο στάθμευσης από μπετόν με τέσσερα επίπεδα.',
    },
    {
      file: 'piraeus-long-stay-2.jpg',
      alt: 'Πολυώροφο πάρκινγκ σε γωνία δρόμου, με δέντρα μπροστά του.',
    },
  ],
  'glyfada-marina-parking': [
    {
      file: 'glyfada-marina-parking-1.jpg',
      alt: 'Προβλήτα μαρίνας με ιστιοφόρα και σκάφη, με βουνά και σύννεφα στο βάθος.',
    },
    {
      file: 'glyfada-marina-parking-2.jpg',
      alt: 'Μαρίνα με γαλάζια νερά και σκάφη αραγμένα κάτω από καθαρό ουρανό.',
    },
  ],
  'marousi-business-park': [
    {
      file: 'marousi-business-park-1.jpg',
      alt: 'Είσοδος πάρκινγκ με πορτοκαλί μπάρες μπροστά από επαγγελματικό κτίριο.',
    },
    {
      file: 'marousi-business-park-2.jpg',
      alt: 'Πολυώροφο πάρκινγκ με πράσινα τζάμια στην πρόσοψη.',
    },
  ],
  'athens-airport-park-and-fly': [
    {
      file: 'athens-airport-park-and-fly-1.jpg',
      alt: 'Στεγασμένο επίπεδο μεγάλου πάρκινγκ με αυτοκίνητα κάτω από μεταλλικά δοκάρια.',
    },
    {
      file: 'athens-airport-park-and-fly-2.jpg',
      alt: 'Μεταλλικός πολυώροφος χώρος στάθμευσης γεμάτος αυτοκίνητα, με γρασίδι μπροστά.',
    },
  ],
  'aristotelous-parking': [
    {
      file: 'aristotelous-parking-1.jpg',
      alt: 'Είσοδος γκαράζ με δύο μπάρες και κολόνες, φωτισμένη από λάμπες στην οροφή.',
    },
    {
      file: 'aristotelous-parking-2.jpg',
      alt: 'Εσωτερικό γκαράζ με ράμπα, σταθμευμένες μοτοσικλέτες και κίτρινα βέλη στο δάπεδο.',
    },
  ],
  'ladadika-parking': [
    {
      file: 'ladadika-parking-1.jpg',
      alt: 'Αυτοκίνητα σε υπαίθριο πάρκινγκ το βράδυ, μπροστά από φωτισμένα κτίρια από τούβλο.',
    },
    {
      file: 'ladadika-parking-2.jpg',
      alt: 'Υπαίθριο πάρκινγκ τη νύχτα, με σταθμευμένα αυτοκίνητα μπροστά από ψηλό κτίριο.',
    },
  ],
  'thessaloniki-airport-parking': [
    {
      file: 'thessaloniki-airport-parking-1.jpg',
      alt: 'Τερματικός σταθμός αεροδρομίου με ταξί στο κράσπεδο, κάτω από μεταλλικό στέγαστρο.',
    },
    {
      file: 'thessaloniki-airport-parking-2.jpg',
      alt: 'Τρεις θέσεις με πράσινη σήμανση φόρτισης ηλεκτρικών αυτοκινήτων δίπλα σε φορτιστές.',
    },
  ],
};
