// Fills shared header/footer and the owner details into about/privacy/terms.html,
// and optionally injects a Google Search Console verification tag (for branding verification).
import { readFileSync } from 'node:fs';
import type { Plugin } from 'vite';

interface LegalConfig {
  ownerName: string;
  contactEmail: string;
  repoUrl: string;
  lastUpdated: string;
}

const NAV: [string, string, string][] = [
  ['about', 'Home', 'Start'],
  ['privacy', 'Privacy', 'Datenschutz'],
  ['terms', 'Terms', 'Bedingungen']
];

function header(page: string) {
  const links = NAV.map(
    ([id, en, de]) =>
      `<a href="${id}.html"${id === page ? ' aria-current="page"' : ''}><span class="l" lang="en">${en}</span><span class="l" lang="de">${de}</span></a>`
  ).join('');
  return `<header class="top">
      <a class="brand" href="about.html"><img src="icon.svg" alt="" />Structed</a>
      <nav aria-label="Site">${links}<a href="./"><span class="l" lang="en">Open app</span><span class="l" lang="de">App öffnen</span></a></nav>
      <div class="lang" role="group" aria-label="Language / Sprache"><button type="button" data-l="en" aria-pressed="false">EN</button><button type="button" data-l="de" aria-pressed="false">DE</button></div>
    </header>`;
}

function footer(c: LegalConfig) {
  return `<footer>
      <span>© ${new Date().getFullYear()} ${c.ownerName}</span>
      <a href="privacy.html"><span class="l" lang="en">Privacy policy</span><span class="l" lang="de">Datenschutzerklärung</span></a>
      <a href="terms.html"><span class="l" lang="en">Terms of use</span><span class="l" lang="de">Nutzungsbedingungen</span></a>
      <a href="mailto:${c.contactEmail}">${c.contactEmail}</a>
      <a href="${c.repoUrl}">GitHub</a>
    </footer>`;
}

export function legalPages(): Plugin {
  const c: LegalConfig = JSON.parse(readFileSync(new URL('../legal.config.json', import.meta.url), 'utf8'));
  const verification = process.env.GOOGLE_SITE_VERIFICATION?.trim();
  return {
    name: 'structed-legal-pages',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        let out = html
          .replace(/\{\{HEADER:(\w+)\}\}/g, (_, p) => header(p))
          .replace('{{FOOTER}}', footer(c))
          .replaceAll('{{OWNER_NAME}}', c.ownerName)
          .replaceAll('{{CONTACT_EMAIL}}', c.contactEmail)
          .replaceAll('{{REPO_URL}}', c.repoUrl)
          .replaceAll('{{LAST_UPDATED}}', c.lastUpdated);
        if (verification) out = out.replace('<head>', `<head>\n    <meta name="google-site-verification" content="${verification}" />`);
        return out;
      }
    }
  };
}
