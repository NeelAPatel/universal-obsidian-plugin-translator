'use strict';

function pluginNeedsCount(plugin) {
  return Object.values(plugin && plugin.files || {}).filter(f => ['new-file','known-untranslated','updated-approved','original-restored'].includes(f.state)).length;
}
function pluginBlockedCount(plugin) {
  return Object.values(plugin && plugin.files || {}).filter(f => ['new-file','known-untranslated'].includes(f.state) && !f.approved).length;
}
function pluginStatus(plugin) {
  if (!plugin || !plugin.lastScan) return {label:'Never scanned',tone:'neutral',rank:5};
  const files = Object.values(plugin.files || {});
  if (files.some(f => f.lastFailure)) return {label:'Translation failed',tone:'danger',rank:0};
  if (pluginBlockedCount(plugin) > 0) return {label:'Approval required',tone:'danger',rank:1};
  if (files.some(f => f.state === 'updated-approved' || f.state === 'original-restored')) return {label:'Update ready',tone:'warning',rank:2};
  if (files.some(f => f.state === 'known-untranslated' || f.state === 'new-file')) return {label:'Translation ready',tone:'warning',rank:3};
  if (plugin.everTranslated && files.some(f => f.state === 'translated-current')) return {label:'Translated / current',tone:'success',rank:4};
  if (files.length && files.every(f => f.state === 'no-translation')) return {label:'English / no action',tone:'success',rank:6};
  return {label:'No action',tone:'neutral',rank:7};
}
function formatTime(value) {
  if (!value) return 'Never';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString();
}

module.exports = { pluginNeedsCount, pluginBlockedCount, pluginStatus, formatTime };
