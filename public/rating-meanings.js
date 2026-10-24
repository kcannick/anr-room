// What each rating means, shown on the Rate it step of /daily and the live page (approved
// mockup public/_mock-rating-meanings.html). The operator's definitions, 2026-10-14, verbatim —
// the same list as RATING_MEANINGS in track-report.js (a test keeps the two identical).
//
// ANRMeanings.mount(box) fills `box` with the meaning line and the "What the numbers mean"
// list, and returns set(n): call it with the picked number, or null to clear.
(function(){
  const MEANINGS = [
    'Scrap it!',
    'Take the best ideas... Scrap the rest.',
    'There’s something there but it needs significant work',
    'Potential release',
    'Solid release',
    'Strong release',
    'Potential Single',
    'Single',
    'Strong Single',
    'It’s a Hit!',
  ];

  const css = `
.rm-line{margin-top:12px;min-height:46px;box-sizing:border-box;border:1px solid var(--line);border-radius:11px;
  padding:11px 13px;display:flex;align-items:center;gap:11px;font-size:14px;line-height:1.4;color:var(--ink)}
.rm-line .rm-n{font-family:"Space Mono",monospace;font-weight:700;font-size:18px;color:var(--signal);flex:none;width:18px;text-align:center}
.rm-line.rm-empty{color:var(--ink-faint);border-style:dashed}
.rm-link{background:none;border:0;padding:0;margin-top:10px;color:var(--ink-dim);font:inherit;font-size:12.5px;
  text-decoration:underline;text-underline-offset:3px;cursor:pointer}
.rm-key{margin-top:10px;border:1px solid var(--line);border-radius:11px;overflow:hidden}
.rm-key div{display:flex;gap:12px;padding:9px 13px;font-size:13.5px;line-height:1.35;border-top:1px solid var(--line);color:var(--ink)}
.rm-key div:first-child{border-top:0}
.rm-key b{font-family:"Space Mono",monospace;color:var(--ink-dim);width:14px;flex:none;text-align:center}
.rm-key div.on{background:rgba(75,183,73,.10)} .rm-key div.on b{color:var(--signal)}`;

  function mount(box){
    if(!document.getElementById('rm-css')){
      const st = document.createElement('style'); st.id = 'rm-css'; st.textContent = css;
      document.head.appendChild(st);
    }
    let pick = null, open = false;
    function render(){
      box.innerHTML = (pick === null
          ? '<div class="rm-line rm-empty">Pick a number to see what it means.</div>'
          : `<div class="rm-line"><span class="rm-n">${pick}</span><span>${MEANINGS[pick]}</span></div>`)
        + `<button type="button" class="rm-link">${open ? 'Close' : 'What the numbers mean'}</button>`
        + (open ? `<div class="rm-key">${MEANINGS.map((m, i) =>
            `<div class="${i === pick ? 'on' : ''}"><b>${i}</b><span>${m}</span></div>`).join('')}</div>` : '');
      box.querySelector('.rm-link').onclick = () => { open = !open; render(); };
    }
    render();
    return function set(n){ pick = (n === null || n === undefined) ? null : +n; render(); };
  }

  window.ANRMeanings = { MEANINGS, mount };
})();
