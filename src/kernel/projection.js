import { q, one } from '../db.js';
import { getPackage } from './registry.js';
import { makeGateway } from './gateway.js';
// The public profile is not a page a module writes to.
// It is assembled from whatever installed apps chose to project.
// Install an app, a section appears. Uninstall it, the section goes.
export async function publicProfile(slug) {
  const business = await one(`select * from business where slug = $1 and status = 'active'`, [slug]);
  if (!business) return null;
  const sections = await q(
    `select pm.*, i.package_key
       from projection_map pm
       join install i on i.id = pm.install_id
      where pm.business_id = $1 and pm.visible = true and i.status = 'active'
      order by pm.sort_order`,
    [business.id]
  );
  const ctx = { businessId: business.id, person: null, membership: null };
  const out = [];
  for (const s of sections) {
    const pkg = getPackage(s.package_key);
    const renderer = pkg?.module?.renderers?.[s.renderer];
    if (!renderer) continue;
    const gateway = makeGateway({ ctx, packageKey: s.package_key });
    try {
      const data = await renderer({ ctx, gateway });
      out.push({ key: s.section_key, title: s.title, icon: s.icon, package: s.package_key, data });
    } catch (e) {
      out.push({ key: s.section_key, title: s.title, error: e.message });
    }
  }
  return { business: { id: business.id, slug: business.slug, name: business.display_name }, sections: out };
}
