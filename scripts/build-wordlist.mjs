// Builds public/dict/de.txt, the German word list used to repair text from PDFs
// ("f?r" → "für", "bearbei tet" → "bearbeitet"). Source: FrequencyWords by Hermit Dave,
// content CC BY-SA 4.0 (https://github.com/hermitdave/FrequencyWords), built from
// OpenSubtitles 2018. Usage: node scripts/build-wordlist.mjs path/to/de_full.txt
//
// Format (one line per word, alphabetical, front-coded to keep the download small):
//   <digit: letters shared with the previous word, 0-9><rest of the word><frequency class A-Z>
// The frequency class is floor(log2(count)), so "A" is rare and higher letters are common.
import { readFileSync, writeFileSync } from 'node:fs';

const MIN = 5;
const src = readFileSync(process.argv[2], 'utf8');
const words = new Map();
for (const line of src.split('\n')) {
  const [w, n] = line.split(' ');
  const c = Number(n);
  if (!w || !(c >= MIN) || !/^[a-zäöüß]{2,}$/.test(w)) continue;
  words.set(w, Math.max(words.get(w) ?? 0, c));
}
const sorted = [...words.keys()].sort();
let prev = '';
const out = [];
for (const w of sorted) {
  let k = 0;
  while (k < 9 && k < w.length && k < prev.length && w[k] === prev[k]) k++;
  const cls = String.fromCharCode(65 + Math.min(25, Math.floor(Math.log2(words.get(w)))));
  out.push(k + w.slice(k) + cls);
  prev = w;
}
writeFileSync(new URL('../public/dict/de.txt', import.meta.url), out.join('\n') + '\n');
console.log(`${sorted.length} words`);
