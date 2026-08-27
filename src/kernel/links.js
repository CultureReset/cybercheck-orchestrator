import { publicProfile } from './projection.js';
// The links page. Every section is a projection from an installed app, and
// every one opens in place. Nothing on this page sends the visitor to a
// third-party site, which is the only reason the business gets to see what
// the visitor was looking for.
export async function renderLinks(slug) {
  const profile = await publicProfile(slug);
  if (!profile) return null;
  const about = profile.sections.find(s => s.key === 'about')?.data ?? {};
  const contact = profile.sections.find(s => s.key === 'contact')?.data ?? {};
  const tiles = profile.sections.filter(s => !['about', 'contact'].includes(s.key));
  return page({ profile, about, contact, tiles });
}
function page({ profile, about, contact, tiles }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(profile.business.name)} — Links</title>
<style>
  :root { --ink:#0f1720; --muted:#5b6672; --line:#e3e8ee; --bg:#f6f8fa; --accent:#12507e; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--ink);
         font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; }
  .wrap { max-width:560px; margin:0 auto; padding:28px 18px 64px; }
  header { text-align:center; margin-bottom:26px; }
  h1 { font-size:26px; margin:0 0 4px; letter-spacing:-.01em; }
  .sub { color:var(--muted); font-size:15px; margin:0 0 10px; }
  .status { display:inline-block; font-size:13px; padding:4px 12px; border-radius:999px;
            background:#e7f4ec; color:#166534; }
  .status.shut { background:#fdeaea; color:#9b1c1c; }
  .tile { width:100%; text-align:left; background:#fff; border:1px solid var(--line);
          border-radius:14px; padding:16px 18px; margin-bottom:10px; cursor:pointer;
          display:flex; align-items:center; gap:14px; font-size:16px; color:inherit; }
  .tile:hover { border-color:#c8d2dd; }
  .tile .t { flex:1; font-weight:600; }
  .tile .c { color:var(--muted); font-size:13px; font-weight:400; display:block; }
  .chev { color:var(--muted); transition:transform .15s; }
  .tile[aria-expanded="true"] .chev { transform:rotate(90deg); }
  .panel { display:none; background:#fff; border:1px solid var(--line); border-top:0;
           border-radius:0 0 14px 14px; margin:-16px 0 10px; padding:4px 18px 18px; }
  .panel.open { display:block; }
  .row { display:flex; justify-content:space-between; padding:9px 0;
         border-bottom:1px solid #f0f3f6; font-size:15px; }
  .row:last-child { border-bottom:0; }
  .row .d { color:var(--muted); font-size:13px; }
  .day { display:inline-block; border:1px solid var(--line); border-radius:10px;
         padding:9px 12px; margin:0 8px 8px 0; cursor:pointer; background:#fff; font-size:14px; }
  .day.none { opacity:.4; cursor:not-allowed; }
  .day.sel { border-color:var(--accent); background:#eaf2f9; }
  .cta { display:block; text-align:center; background:var(--accent); color:#fff;
         padding:13px; border-radius:12px; text-decoration:none; font-weight:600; margin-top:14px; }
  .note { color:var(--muted); font-size:12px; margin-top:14px; text-align:center; }
  .src { font-size:11px; color:var(--muted); text-transform:uppercase; letter-spacing:.06em; }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>${esc(profile.business.name)}</h1>
    ${about.category ? `<p class="sub">${esc(about.category)}</p>` : ''}
    ${about.locations?.[0] ? `<p class="sub">${esc(about.locations[0].address)}</p>` : ''}
    ${openBadge(profile)}
  </header>
  ${tiles.map(tile).join('\n')}
  ${contact.phone ? `<a class="cta" href="tel:${esc(contact.phone)}">Call ${esc(contact.phone)}</a>` : ''}
  ${contact.website ? `<a class="cta" style="background:#fff;color:var(--accent);border:1px solid var(--line)"
       href="${esc(contact.website)}">Visit website</a>` : ''}
  <p class="note">Every section above is an installed app.<br>Nothing here leaves this page.</p>
</div>
<script>
const SLUG = ${JSON.stringify(profile.business.slug)};
document.querySelectorAll('.tile').forEach(function (btn) {
  btn.addEventListener('click', function () {
    var panel = document.getElementById('p-' + btn.dataset.key);
    var open = panel.classList.toggle('open');
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
});
// Choosing a date is a search. It is recorded before anything is booked,
// which is the part a third-party booking page keeps for itself.
document.querySelectorAll('.day').forEach(function (el) {
  el.addEventListener('click', async function () {
    if (el.classList.contains('none')) return;
    document.querySelectorAll('.day').forEach(function (d) { d.classList.remove('sel'); });
    el.classList.add('sel');
    var out = document.getElementById('slots');
    out.innerHTML = '<div class="row"><span class="d">checking…</span></div>';
    var res = await fetch('/public/' + SLUG + '/availability/search', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ date: el.dataset.date, partySize: 1, surface: 'links' }),
    });
    var data = await res.json();
    out.innerHTML = (data.slots || []).map(function (s) {
      return '<div class="row"><span><strong>' + s.resource + '</strong>' +
             (s.starts ? ' <span class="d">' + s.starts + '–' + s.ends + '</span>' : '') +
             '</span><span>' + (s.price ? '$' + s.price + ' · ' : '') + s.remaining + ' left</span></div>';
    }).join('') || '<div class="row"><span class="d">nothing open that day</span></div>';
  });
});
</script>
</body>
</html>`;
}
function tile(section) {
  return `<button class="tile" data-key="${esc(section.key)}" aria-expanded="false">
    <span class="t">${esc(section.title)}<span class="c">${esc(caption(section))}</span></span>
    <span class="chev">›</span>
  </button>
  <div class="panel" id="p-${esc(section.key)}">${body(section)}</div>`;
}
function caption(s) {
  const d = s.data ?? {};
  if (d.categories) return `${d.categories.reduce((n, c) => n + c.items.length, 0)} items`;
  if (d.days) return `${d.days.filter(x => x.open > 0).length} days open`;
  if (d.weekly) return d.weekly.filter(w => !w.closed).length + ' days a week';
  if (d.forms) return d.forms.map(f => f.title).join(', ');
  if (d.items) return `${d.items.length} entries`;
  return `provided by ${s.package}`;
}
function body(s) {
  const d = s.data ?? {};
  if (d.categories) {
    return d.categories.map(c =>
      `<div class="src">${esc(c.name)}</div>` +
      c.items.map(i => `<div class="row"><span>${esc(i.name)}<span class="d">${esc(i.description ?? '')}</span></span>
        <span>${i.price != null ? '$' + esc(String(i.price)) : ''}</span></div>`).join('')
    ).join('');
  }
  if (d.days) {
    return `<p class="d" style="color:var(--muted);font-size:13px">Pick a day. Real remaining count, no redirect.</p>` +
      d.days.map(day =>
        `<button class="day ${day.open ? '' : 'none'}" data-date="${esc(day.date)}">
           ${esc(day.date.slice(5))}<br><span class="d">${day.open ? day.open + ' open' : 'full'}</span>
         </button>`).join('') +
      `<div id="slots"></div>`;
  }
  if (d.weekly) {
    return d.weekly.map(w =>
      `<div class="row"><span>${esc(w.day)}</span>
       <span>${w.closed ? 'Closed' : esc(w.opens ?? '') + ' – ' + esc(w.closes ?? '')}</span></div>`
    ).join('') + (d.exceptions?.length
      ? `<div class="src" style="margin-top:12px">Exceptions</div>` + d.exceptions.map(e =>
          `<div class="row"><span>${esc(String(e.from).slice(0, 10))} – ${esc(String(e.to).slice(0, 10))}</span>
           <span>${e.closed ? 'Closed' : 'Adjusted'}${e.reason ? ' · ' + esc(e.reason) : ''}</span></div>`).join('')
      : '');
  }
  if (d.forms) {
    return d.forms.map(f =>
      `<div class="row"><span>${esc(f.title)}</span><span class="d">${(f.fields ?? []).join(', ')}</span></div>`
    ).join('');
  }
  if (d.items) {
    return d.items.map(i =>
      `<div class="row"><span>${esc(i.name ?? '')}</span><span class="d">${esc(summarise(i))}</span></div>`
    ).join('') || `<div class="row"><span class="d">nothing yet</span></div>`;
  }
  if (d.story || d.name) {
    return `<p>${esc(d.story ?? '')}</p>` +
      (d.locations ?? []).map(l => `<div class="row"><span>${esc(l.label)}</span><span class="d">${esc(l.address)}</span></div>`).join('');
  }
  return `<pre style="font-size:12px;overflow:auto">${esc(JSON.stringify(d, null, 2))}</pre>`;
}
function summarise(item) {
  return Object.entries(item)
    .filter(([k]) => !['id', 'business_id', 'created_at', 'name'].includes(k))
    .map(([, v]) => v).filter(Boolean).join(' · ');
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
// Open or closed comes from canonical hours, with any temporary closure
// layered on top. It is computed, not typed into the page.
function openBadge(profile) {
  const hours = profile.sections.find(s => s.key === 'hours')?.data;
  if (!hours) return '';
  const now = new Date();
  const today = hours.weekly?.[now.getDay()];
  const exception = (hours.exceptions ?? []).find(e =>
    new Date(e.from) <= now && now <= new Date(e.to));
  if (exception?.closed) {
    return `<span class="status shut">Closed${exception.reason ? ' — ' + esc(exception.reason) : ''}</span>`;
  }
  if (!today || today.closed) return `<span class="status shut">Closed today</span>`;
  return `<span class="status">Open today &middot; ${esc(today.opens ?? '')} – ${esc(today.closes ?? '')}</span>`;
}
// The same sections, as a fragment the business can drop into their own site.
export async function renderEmbed(slug, sectionKey) {
  const profile = await publicProfile(slug);
  if (!profile) return null;
  const section = profile.sections.find(s => s.key === sectionKey);
  if (!section) return null;
  return `<div class="ghost-embed" data-business="${esc(slug)}" data-section="${esc(sectionKey)}">
  <style>.ghost-embed .row{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #eee}
  .ghost-embed .day{display:inline-block;border:1px solid #ddd;border-radius:8px;padding:8px 10px;margin:0 6px 6px 0}</style>
  ${body(section)}
</div>`;
}
