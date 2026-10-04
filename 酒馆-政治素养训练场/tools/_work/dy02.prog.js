const targets = ["https://www.douyin.com/note/7501350363354828070","https://www.douyin.com/note/7616390384072290658","https://www.douyin.com/shipin/7346135307756177420","https://www.douyin.com/shipin/7367634253728712704","https://www.douyin.com/shipin/7297800557618808883","https://www.douyin.com/shipin/7617646096197617690"];
const CONC = 3;

function clean(s) { return (s || "").replace(/\r/g, "").replace(/[ \t]+/g, " ").trim(); }

async function grab(u) {
  const tab = await context.newPage();
  try {
    await tab.goto(u, { waitUntil: "domcontentloaded", timeout: 45000 });
    await tab.waitForTimeout(6000);
    for (let i = 0; i < 3; i++) { await tab.mouse.wheel(0, 800); await tab.waitForTimeout(1200); }
    return await tab.evaluate(() => {
      const q = (s) => document.querySelector(s);
      const qa = (s) => Array.from(document.querySelectorAll(s));
      const t = (e) => ((e && e.innerText) || "").replace(/\s+/g, " ").trim();
      const comments = qa('[data-e2e="comment-item"]').map(t).filter((x) => x.length > 4).slice(0, 15);
      const related = []; const seen = new Set();
      for (const a of qa('a[href*="/video/"], a[href*="/shipin/"], a[href*="/note/"]')) {
        const href = (a.href || "").split("?")[0];
        if (!href || seen.has(href)) continue;
        const txt = t(a);
        if (txt.length < 8) continue;
        seen.add(href); related.push({ url: href, text: txt.slice(0, 140) });
        if (related.length >= 15) break;
      }
      const body = t(document.body);
      return {
        finalUrl: location.href,
        title: document.title,
        desc: t(q('[data-e2e="video-desc"]')) || t(q('[data-e2e="detail-video-desc"]')),
        bodyExcerpt: body.slice(0, 1200),
        comments: comments,
        related: related
      };
    });
  } catch (e) {
    return { url: u, error: String(e).slice(0, 250) };
  } finally { await tab.close(); }
}

const results = [];
for (let i = 0; i < targets.length; i += CONC) {
  const wave = targets.slice(i, i + CONC);
  const settled = await Promise.allSettled(wave.map((x) => grab(x)));
  for (let k = 0; k < settled.length; k++) {
    const s = settled[k];
    results.push(s.status === "fulfilled" ? s.value : { url: wave[k], error: String(s.reason).slice(0, 250) });
  }
}
return { requested: targets.length, count: results.length, results: results };