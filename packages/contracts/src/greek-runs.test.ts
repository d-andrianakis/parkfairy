import { describe, expect, it } from 'vitest';
import { greekRuns } from './greek-runs.js';

describe('greekRuns', () => {
  it('marks a Greek name inside English, keeping the words between Greek ones in it', () => {
    expect(greekRuns('Ερμού 15, Αθήνα 105 63, Greece', 'en')).toEqual([
      { text: 'Ερμού 15, Αθήνα', lang: 'el' },
      { text: ' 105 63, Greece' },
    ]);
    expect(greekRuns('Near Πλατεία Συντάγματος', 'en')).toEqual([
      { text: 'Near ' },
      { text: 'Πλατεία Συντάγματος', lang: 'el' },
    ]);
  });

  it('keeps accents, diaeresis and polytonic letters inside the run', () => {
    expect(greekRuns('Προϊόντα, Ἀκρόπολις', 'en')).toEqual([
      { text: 'Προϊόντα, Ἀκρόπολις', lang: 'el' },
    ]);
    // Decomposed accents (a combining mark after the letter) too.
    expect(greekRuns('Αθη\u0301να', 'en')).toEqual([{ text: 'Αθη\u0301να', lang: 'el' }]);
  });

  it('keeps digits glued to Greek letters, and the numeral sign, inside the run', () => {
    expect(greekRuns('28ης Οκτωβρίου 15, Athens', 'en')).toEqual([
      { text: '28ης Οκτωβρίου', lang: 'el' },
      { text: ' 15, Athens' },
    ]);
    expect(greekRuns('Motorway Α1, Athens', 'en')).toEqual([
      { text: 'Motorway ' },
      { text: 'Α1', lang: 'el' },
      { text: ', Athens' },
    ]);
    expect(greekRuns('Γ\u02B9 Σεπτεμβρίου 10', 'en')).toEqual([
      { text: 'Γ\u02B9 Σεπτεμβρίου', lang: 'el' },
      { text: ' 10' },
    ]);
    expect(greekRuns('105 63 Αθήνα', 'en')).toEqual([
      { text: '105 63 ' },
      { text: 'Αθήνα', lang: 'el' },
    ]);
  });

  it('marks each Greek run apart, with the English between them left alone', () => {
    expect(greekRuns('Ερμού 1, Athens, Αττική', 'en')).toEqual([
      { text: 'Ερμού', lang: 'el' },
      { text: ' 1, Athens, ' },
      { text: 'Αττική', lang: 'el' },
    ]);
  });

  it('leaves English alone, and a Greek page alone', () => {
    expect(greekRuns('Ermou 15, Athens', 'en')).toEqual([{ text: 'Ermou 15, Athens' }]);
    expect(greekRuns('Ερμού 15, Athens', 'el')).toEqual([{ text: 'Ερμού 15, Athens' }]);
    expect(greekRuns('', 'en')).toEqual([{ text: '' }]);
  });

  it('reads Latin letters that look Greek as Latin', () => {
    // Plates and codes come in Latin capitals; only real Greek letters count.
    expect(greekRuns('Gate A, Terminal B', 'en')).toEqual([{ text: 'Gate A, Terminal B' }]);
  });
});
