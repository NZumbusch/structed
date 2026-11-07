// Icons next to text (in buttons, switches, menus) should sit on the middle of the
// capital letters. Flex layout centres the icon on the line box instead, and where the
// letters sit inside that box depends on the font – the app uses each device's own
// system font (Roboto, Segoe UI, San Francisco…), so no fixed value fits all.
// This measures it in real (hidden) buttons and sets --icon-shift / --icon-shift-sm
// (in px) for app.css.
export function alignIcons() {
  // regular controls (14px text), small ones (13px: .btn.sm, switches, pills) and chips
  // (12px) apart: line heights round differently, so one value does not fit all
  const measure = () => {
    probe('btn', '--icon-shift');
    probe('btn sm', '--icon-shift-sm');
    probe('chip', '--icon-shift-xs');
  };
  const probe = (cls: string, prop: string) => {
    try {
      const btn = document.createElement('button');
      btn.className = cls;
      btn.style.cssText = 'position:absolute;left:-9999px;top:0;visibility:hidden';
      const ns = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(ns, 'svg');
      const px = cls === 'chip' ? '11' : '14';
      svg.setAttribute('width', px);
      svg.setAttribute('height', px);
      svg.style.translate = '0 0'; // measure without the correction
      const label = document.createElement('span');
      // a zero-size inline-block sits on the baseline: its top is the baseline
      const mark = document.createElement('span');
      mark.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline';
      label.append('H', mark);
      btn.append(svg, label);
      document.body.append(btn);
      const cs = getComputedStyle(btn);
      const size = parseFloat(cs.fontSize);
      const ctx = document.createElement('canvas').getContext('2d');
      if (ctx) {
        ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
        const cap = ctx.measureText('H').actualBoundingBoxAscent;
        const baseline = mark.getBoundingClientRect().top;
        const s = svg.getBoundingClientRect();
        const shift = baseline - cap / 2 - (s.top + s.height / 2); // + = icon must go down
        if (cap && Number.isFinite(shift) && Math.abs(shift) < size * 0.4)
          document.documentElement.style.setProperty(prop, `${shift.toFixed(2)}px`);
      }
      btn.remove();
    } catch {
      /* keep the CSS default */
    }
  };
  measure();
  document.fonts?.ready.then(measure);
}
