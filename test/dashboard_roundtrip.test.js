// What the dashboard GETs must be savable as-is: a fresh server (every key unset) must not 400 on Save.
const test = require('node:test');
const assert = require('node:assert');
const V = require('../src/dashboard/validate');

for (const route of ['config', 'automod']) {
  test(`${route}: echoing an all-unset GET back as a PATCH is accepted`, () => {
    const body = {};
    for (const k of V.ROUTE_KEYS[route]) body[k] = null; // what the GET returns for a guild with nothing set
    const r = V.validateConfigPatch(body, route);
    assert.equal(r.ok, true, r.error);
    for (const [k, v] of Object.entries(r.values)) assert.equal(v, null, `${k} may only pass through as null`);
  });
}

test('automod: the keys the UI sends are all accepted, dead keys are not', () => {
  const ok = V.validateConfigPatch({ antispam: true, antilink: false, antilink_whitelist: ['youtube.com'], word_filter: ['bad'] }, 'automod');
  assert.equal(ok.ok, true, ok.error);
  for (const dead of ['antispam_threshold', 'antispam_action', 'antispam_duration', 'word_filter_list']) {
    assert.equal(V.validateConfigPatch({ [dead]: 5 }, 'automod').ok, false, dead);
  }
});
