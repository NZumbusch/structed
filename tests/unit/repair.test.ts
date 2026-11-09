import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { applyFixes, findFixes, learnFromEdit, parseDict, type Dict } from '../../src/lib/repair';
import { settings } from '../../src/lib/settings.svelte';

let d: Dict;
beforeAll(() => {
  d = parseDict(readFileSync(resolve(__dirname, '../../public/dict/de.txt'), 'utf8'));
  settings.repairLearned = {};
});
const sure = (text: string) => {
  const fx = findFixes(text, d);
  return applyFixes(text, fx, fx.map((f) => (f.level === 'sure' ? f.options[0] : null)));
};

// the passage from the screenshot, as Zotero delivered it
const SAS =
  'Kennzeichnend f?r die Periode zwischen 1670 und 1750 war in den unter deutschem Einflu? stehenden evangelischen Kirchen der Kampf zwischen der Orthodoxie und der neuen Bewegung, des Pietismus. In den Augen vieler hatte die Kirche bis dahin nur die traditionellen Doktrinen und die ausgeh?hl ten Zeremonien bewahrt und bot pers?nlicher Religiosit?t keinen Raum mehr, so da? das Verlangen nach Privatandacht und Privatbetrachtung wuchs. Die unterschiedlichen theologischen Auffassungen erschienen in der religi?sen Dichtung am markantesten und zogen die Umwertung der Rolle der Musik nach sich. Fr?her hatte die Musik zur Auslegung der Schrift gedient; die Komponisten hatten daher biblische Texte und Chor?le bearbei tet, die abwechslungsreiche Gef?hle ausdr?ckten und sogar weltliche For men verwendeten.';

describe('repairing text from PDFs', () => {
  it('repairs the umlauts and broken words of a real passage', () => {
    const out = sure(SAS);
    for (const w of ['für', 'Einfluß', 'ausgehöhlten', 'persönlicher', 'Religiosität', 'daß', 'religiösen', 'Früher', 'Choräle', 'bearbeitet', 'Gefühle', 'ausdrückten']) expect(out).toContain(w);
    expect(out).not.toMatch(/\p{L}\?/u);
  });
  it('marks "For men" for checking instead of joining it on its own', () => {
    const f = findFixes(SAS, d).find((x) => x.from === 'For men');
    expect(f?.level).toBe('check');
    expect(f?.options[0]).toBe('Formen');
  });
  it('leaves real question marks alone and unknown words unsolved', () => {
    expect(findFixes('Warum? Weil es so ist. Und f?r wen?', d).map((f) => f.from)).toEqual(['f?r']);
    const f = findFixes('Der Zxq?wv kam f?r uns.', d).find((x) => x.from === 'Zxq?wv');
    expect(f?.level).toBe('unsolved');
  });
  it('suggests splitting words that ran together, never on its own', () => {
    const f = findFixes('Die Zeit zwischender Reformation und heute war lang und schwer für alle Leute.', d).find((x) => x.kind === 'split');
    expect(f?.options[0]).toBe('zwischen der');
    expect(f?.level).toBe('check');
  });
  it('does not join or split in English text', () => {
    expect(findFixes('This book is written for men and women who study the history of music in Europe.', d)).toEqual([]);
  });
  it('learns from corrections by hand', () => {
    expect(learnFromEdit('die Bethäu?er und Gr??e', 'die Bethäuser und Größe')).toEqual({ 'Bethäu?er': 'Bethäuser', 'Gr??e': 'Größe' });
    settings.repairLearned = { 'Zxq?wv': 'Zxqöwv' };
    expect(sure('Der Zxq?wv kam.')).toBe('Der Zxqöwv kam.');
    settings.repairLearned = {};
  });
});
