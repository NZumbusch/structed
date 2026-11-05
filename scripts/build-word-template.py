"""Turn a real Word document into a Structed export template.

Usage: python3 scripts/build-word-template.py <source.docx> <name>
Writes public/word/<name>.docx (content-free shell: styles, numbering, page
setup, headers/footers, Zotero document prefs) and src/lib/word/<name>.json
(XML snippets for title page, TOC, headings, body text, quotes, footnotes,
bibliography). Personal data (title page text, metadata, figures) is removed.
"""
import json, re, sys, zipfile, os

src, name = sys.argv[1], sys.argv[2]
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
zin = zipfile.ZipFile(src)
doc = zin.read('word/document.xml').decode('utf8')
fns = zin.read('word/footnotes.xml').decode('utf8')

def clean(x):
    x = re.sub(r' w14:paraId="[^"]*"| w14:textId="[^"]*"| w:rsid\w*="[^"]*"', '', x)
    x = re.sub(r'<w:bookmark(Start|End)[^>]*/>', '', x)
    x = re.sub(r'<w:proofErr[^>]*/>', '', x)
    return x

head, rest = doc.split('<w:body>', 1)
body = rest.rsplit('</w:body>', 1)[0]
P = re.findall(r'<w:p[ >].*?</w:p>', body, re.S)
final_sect = re.findall(r'<w:sectPr[ >].*?</w:sectPr>', body, re.S)[-1]

def ppr(p):
    m = re.search(r'<w:pPr>.*?</w:pPr>', p, re.S)
    return clean(m.group(0)) if m else ''
def first_rpr(p):
    for r in re.findall(r'<w:r>(.*?)</w:r>', clean(p), re.S):
        m = re.search(r'<w:rPr>.*?</w:rPr>', r, re.S)
        if m and ('<w:t' in r or '<w:br' in r): return m.group(0)
    m = re.search(r'<w:r>\s*(<w:rPr>.*?</w:rPr>)', clean(p), re.S)
    return m.group(1) if m else ''
def text(p): return ''.join(re.findall(r'<w:t(?: [^>]*)?>([^<]*)</w:t>', p))

# ---- locate parts by content, not fixed indexes ----
idx_toc_head = next(i for i, p in enumerate(P) if text(p).strip() == 'Inhaltsverzeichnis')
idx_body = next(i for i, p in enumerate(P) if 'w:val="Heading1"' in p)
title_paras = []
for i in range(0, idx_toc_head):
    if '<w:sectPr' in P[i]:
        title_end = i
        break
# title page keys (by position of non-empty lines on the cover)
cover_keys = ['workType', 'module', 'institution', 'supervisor', 'title', 'author', 'placeDate']
k = 0
for i in range(0, title_end):
    p = P[i]
    if text(p).strip():
        title_paras.append({'pPr': ppr(p), 'rPr': first_rpr(p), 'key': cover_keys[k] if k < len(cover_keys) else ''})
        k += 1
    else:
        title_paras.append({'pPr': ppr(p), 'rPr': first_rpr(p), 'key': ''})

sects = [i for i, p in enumerate(P[:idx_body]) if '<w:sectPr' in p]
motto = None
if len(sects) >= 2:
    a, b = sects[0], sects[1]
    q = next((P[i] for i in range(a + 1, b) if 'w:val="Quote"' in P[i]), None)
    c = next((P[i] for i in range(a + 1, b) if 'ZOTERO_ITEM' in P[i]), None)
    motto = {'quotePPr': ppr(q) if q else '', 'quoteRPr': first_rpr(q) if q else '', 'citePPr': ppr(c) if c else '', 'citeRPr': first_rpr(c) if c else '', 'sectEnd': clean(P[b])}

toc_par = next(p for p in P if 'w:val="TOC1"' in p)
toc2 = next((p for p in P if 'w:val="TOC2"' in p), toc_par)
toc_start = sects[-1] + 1 if sects else 0
toc_before = [clean(P[i]) for i in range(toc_start, idx_toc_head)]
toc_head_ppr, toc_head_rpr = ppr(P[idx_toc_head]), first_rpr(P[idx_toc_head])
after_toc = [clean(P[i]) for i in range(idx_toc_head + 1, idx_body) if 'TOC' not in P[i] or 'w:val="TOC' not in P[i]]
after_toc = [p for p in after_toc if 'fldChar' not in p]

body_p = next(p for p in P[idx_body:] if 'footnoteReference' in p)
quote_p = next(p for p in P[idx_body:] if 'w:val="Quote"' in p and text(p).strip())
qi = P.index(quote_p)
cite_p = P[qi + 1]
h1 = next(p for p in P[idx_body:] if 'w:val="Heading1"' in p and '<w:numId w:val="0"/>' not in p)
h2 = next((p for p in P[idx_body:] if 'w:val="Heading2"' in p), h1)
bib_head = next((p for p in P if 'w:val="Heading1"' in p and '<w:numId w:val="0"/>' in p), h1)
bib_p = next(p for p in P if 'w:val="Bibliography"' in p)
fnref = re.search(r'<w:r[ >](?:(?!</w:r>).)*?footnoteReference[^>]*/></w:r>', body_p, re.S).group(0)
fnref_rpr = re.search(r'<w:rPr>.*?</w:rPr>', clean(fnref), re.S).group(0)

foot = [f for f in re.findall(r'<w:footnote [^>]*>.*?</w:footnote>', fns, re.S) if 'w:id="-1"' not in f and 'w:id="0"' not in f][0]
fp = re.search(r'<w:p[ >].*?</w:p>', foot, re.S).group(0)
fn_ppr = ppr(fp)
fn_ref_run = clean(re.search(r'<w:r>(?:(?!</w:r>).)*?<w:footnoteRef/></w:r>', fp, re.S).group(0))

snip = {
    'name': name,
    'documentHead': head + '<w:body>',
    'finalSectPr': clean(final_sect),
    'cover': title_paras,
    'coverEnd': clean(P[title_end]),
    'motto': motto,
    'tocBefore': toc_before,
    'tocHeading': {'pPr': toc_head_ppr, 'rPr': toc_head_rpr},
    'toc1PPr': ppr(toc_par), 'toc2PPr': ppr(toc2), 'tocRPr': first_rpr(toc_par),
    'tocAfter': after_toc,
    'heading': [ppr(h1), ppr(h2), ppr(h2).replace('Heading2', 'Heading3').replace('<w:ilvl w:val="1"/>', '<w:ilvl w:val="2"/>')],
    'headingRPr': [first_rpr(h1), first_rpr(h2), first_rpr(h2)],
    'bodyPPr': ppr(body_p), 'bodyRPr': first_rpr(body_p),
    'quotePPr': ppr(quote_p), 'quoteRPr': first_rpr(quote_p),
    'quoteCitePPr': ppr(cite_p),
    'footnoteRefRPr': fnref_rpr,
    'footnotePPr': fn_ppr, 'footnoteRefRun': fn_ref_run,
    'bibHeadingPPr': ppr(bib_head), 'bibPPr': ppr(bib_p), 'bibRPr': first_rpr(bib_p),
}

# ---- content-free package ----
out = os.path.join(root, 'public', 'word', name + '.docx')
zout = zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED)
for item in zin.infolist():
    n = item.filename
    data = zin.read(n)
    if n.startswith('word/media/'):
        continue  # figures of the original paper
    if n == 'word/document.xml':
        data = (head + '<w:body>{{BODY}}' + clean(final_sect) + '</w:body></w:document>').encode('utf8')
    elif n == 'word/footnotes.xml':
        keep = ''.join(f for f in re.findall(r'<w:footnote [^>]*>.*?</w:footnote>', fns, re.S) if 'w:id="-1"' in f or 'w:id="0"' in f)
        data = (fns.split('<w:footnote ', 1)[0] + keep + '{{FOOTNOTES}}</w:footnotes>').encode('utf8')
    elif n == 'word/_rels/document.xml.rels':
        s = data.decode('utf8')
        s = re.sub(r'<Relationship [^>]*Target="media/[^"]*"/>', '', s)
        data = s.encode('utf8')
    elif n == 'word/settings.xml':
        s = data.decode('utf8')
        if '<w:updateFields' not in s:
            for anchor in ('<w:hdrShapeDefaults', '<w:footnotePr', '<w:endnotePr', '<w:compat'):
                if anchor in s:
                    s = s.replace(anchor, '<w:updateFields w:val="true"/>' + anchor, 1)
                    break
        s = re.sub(r'<w:attachedTemplate [^>]*/>', '', s)
        data = s.encode('utf8')
    elif n == 'docProps/core.xml':
        s = data.decode('utf8')
        for tag in ('dc:creator', 'cp:lastModifiedBy', 'dc:title', 'dc:subject', 'cp:keywords', 'dc:description'):
            s = re.sub(rf'<{tag}>[^<]*</{tag}>', f'<{tag}></{tag}>', s)
        data = s.encode('utf8')
    elif n == 'docProps/app.xml':
        s = data.decode('utf8')
        s = re.sub(r'<Company>[^<]*</Company>', '<Company></Company>', s)
        data = s.encode('utf8')
    zout.writestr(item, data)
zout.close()
json.dump(snip, open(os.path.join(root, 'src', 'lib', 'word', name + '.json'), 'w', encoding='utf8'), ensure_ascii=False, indent=1)
print('ok', out)
