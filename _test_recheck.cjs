require('dotenv').config();

function detectBadges(categories) {
  const cats = (categories || []).map(c => (c.title || '').toLowerCase());
  const catStr = cats.join('|');
  return {
    featured: /featured\s+pictures/i.test(catStr),
    quality: /quality\s+images/i.test(catStr),
    valued: /valued\s+images/i.test(catStr),
  };
}

(async () => {
  const filenames = ['Benalúa de Guadix (Granada).jpg', 'View of Santa Maria del Fiore in Florence.jpg'];
  const titles = filenames.map(f => `File:${f}`).join('|');
  const params = new URLSearchParams({
    action: 'query', format: 'json', prop: 'categories',
    cllimit: '50', titles, redirects: '1',
  });
  const res = await fetch(`https://commons.wikimedia.org/w/api.php?${params}`, {
    headers: { 'User-Agent': 'PatrimonioEuropeo/1.0' },
  });
  const data = await res.json();
  for (const p of Object.values(data.query.pages)) {
    const badges = detectBadges(p.categories);
    console.log(`${p.title}:`);
    console.log(`  badges:`, badges);
  }
})();
