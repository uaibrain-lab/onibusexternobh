/* Informational DER/MG departure lookup. No GTFS stop geometry or ETA. */
'use strict';
(() => {
  const get = id => document.getElementById(id);
  const line = get('derLine'), day = get('derDay');
  const status = get('derStatus'), summary = get('derSummary');
  const times = get('derTimes');
  let catalog;

  function setOptions(select, choices, placeholder) {
    select.replaceChildren(new Option(placeholder, ''));
    for (const [value, label] of choices)
      select.add(new Option(label, value));
    select.disabled = choices.length === 0;
  }
  function render() {
    times.replaceChildren();
    summary.textContent = '';
    const selected = catalog?.lines[line.value];
    if (!selected) {
      setOptions(day, [], 'Escolha uma linha');
      status.textContent = 'Selecione uma linha metropolitana.';
      return;
    }
    const chosen = day.value;
    const current = selected.frames.find(f => f.dayType + '\u0000' + f.board === chosen);
    if (!current) {
      status.textContent = 'Escolha manualmente um tipo de dia e quadro.';
      return;
    }
    status.textContent = `${current.departures.length} partidas listadas pelo DER/MG neste quadro.`;
    summary.textContent = `${selected.code} · ${selected.name} · ${current.board}`;
    const fragment = document.createDocumentFragment();
    for (const raw of current.departures) {
      const item = document.createElement('li');
      item.className = 'time';
      const time = document.createElement('strong');
      time.textContent = `${raw.slice(0, 2)}:${raw.slice(2, 4)}`;
      item.append(time);
      if (raw.length > 4) {
        const suffix = document.createElement('small');
        suffix.textContent = ` ${raw.slice(4)}`;
        suffix.title = 'Sufixo original do DER/MG — sem interpretação';
        item.append(suffix);
      }
      fragment.append(item);
    }
    times.append(fragment);
  }
  line.addEventListener('change', () => {
    const selected = catalog?.lines[line.value];
    setOptions(day, selected ? selected.frames.map(f =>
      [f.dayType + '\u0000' + f.board, `${f.dayType} · ${f.board}`]) : [],
    'Escolha o tipo de dia/quadro');
    render();
  });
  day.addEventListener('change', render);

  (async () => {
    try {
      const response = await fetch('./catalog/der-rmbh-411c-511c.json');
      if (!response.ok) throw Error('catalog unavailable');
      const data = await response.json();
      if (data.schema !== 1 || data.dataStatus !== 'published-departures-only' ||
          data.routePlanningEnabled !== false || data.georeferencedStops !== false ||
          !data.lines || typeof data.lines !== 'object')
        throw Error('unexpected catalog schema');
      catalog = data;
      setOptions(line, Object.values(data.lines).map(row =>
        [row.code, `${row.code} — ${row.name}`]), 'Escolha a linha');
      status.textContent = 'Selecione uma linha e o quadro de operação.';
    } catch (_) {
      line.disabled = true; day.disabled = true;
      status.textContent = 'Horários metropolitanos indisponíveis nesta versão. Confira o DER/MG.';
    }
  })();
})();
