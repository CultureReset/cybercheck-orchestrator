const DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

export const capabilities = [
  {
    key: 'business_profile.update_contact',
    summary: 'Update the public contact details.',
    route: 'internal',
    handler: async ({ ctx, input, gateway }) => {
      const { request } = await import('../../src/kernel/executor.js');
      const out = {};
      for (const [key, value] of Object.entries(input)) {
        out[key] = await request({ ctx, capability: 'business.set_fact', input: { key: `contact.${key}`, value } });
      }
      return { updated: Object.keys(input) };
    },
    verify: async ({ gateway, input }) => {
      const { facts } = await gateway.canonical();
      const missing = Object.keys(input).filter(k => facts[`contact.${k}`] === undefined);
      return {
        state: missing.length === 0 ? 'verified' : 'partial',
        evidence: [{ kind: 'facts_present', missing }],
      };
    },
  },
];

export const renderers = {
  about: async ({ gateway }) => {
    const { business, facts, locations } = await gateway.canonical();
    return {
      name: business.display_name,
      story: facts['profile.story'] ?? null,
      category: facts['profile.category'] ?? null,
      locations: locations.map(l => ({
        label: l.label,
        address: [l.street1, l.city, l.region, l.postal_code].filter(Boolean).join(', '),
      })),
    };
  },

  // Regular hours, with any active temporary closure layered on top.
  // The temporary window never overwrites the weekly record.
  hours: async ({ gateway }) => {
    const { hours, temporary } = await gateway.canonical();
    return {
      weekly: hours.map(h => ({
        day: DAYS[h.weekday],
        closed: h.closed,
        opens: h.opens, closes: h.closes,
      })),
      exceptions: temporary.map(t => ({
        from: t.starts_at, to: t.ends_at, closed: t.closed, reason: t.reason,
      })),
    };
  },

  contact: async ({ gateway }) => {
    const { facts } = await gateway.canonical();
    return {
      phone: facts['contact.phone'] ?? null,
      email: facts['contact.email'] ?? null,
      website: facts['contact.website'] ?? null,
    };
  },
};
