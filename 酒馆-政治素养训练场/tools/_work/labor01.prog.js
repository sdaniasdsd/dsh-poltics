const targets = ["https://video.laborinfocn7.com/videos/287","https://video.laborinfocn7.com/videos/134","https://video.laborinfocn7.com/videos/133","https://video.laborinfocn7.com/videos/872","https://video.laborinfocn7.com/videos/916","https://video.laborinfocn7.com/videos/86","https://video.laborinfocn7.com/videos/128","https://video.laborinfocn7.com/videos/434","https://video.laborinfocn7.com/videos/480"];
const CONC = 3;

async function grab(url) {
  const tab = await context.newPage();
  try {
    await tab.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await tab.waitForTimeout(2500);
    return await tab.evaluate((cfg) => {
      const clean = (s) => (s || "").replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
      const out = { url: location.href, title: document.title, heading: "", answers: [] };
      const h = document.querySelector(".QuestionHeader-title") || document.querySelector("h1");
      out.heading = h ? clean(h.innerText) : "";
      const items = document.querySelectorAll(".List-item");
      for (const it of items) {
        const body = it.querySelector(".RichContent-inner") || it.querySelector(".RichText");
        if (!body) continue;
        const t = clean(body.innerText);
        if (t.length < 200) continue;
        const a = it.querySelector(".AuthorInfo-name");
        const v = it.querySelector(".VoteButton--up");
        out.answers.push({
          author: a ? clean(a.innerText) : "",
          vote: v ? clean(v.innerText) : "",
          chars: t.length,
          text: t.slice(0, cfg.MAXC)
        });
        if (out.answers.length >= cfg.MAXA) break;
      }
      if (!out.answers.length) {
        const main = document.querySelector("article, .Post-RichTextContainer, .RichText, .article-content, main") || document.body;
        const t = clean(main.innerText);
        out.answers.push({ author: "", vote: "", chars: t.length, text: t.slice(0, cfg.MAXC) });
      }
      return out;
    }, { MAXA: 3, MAXC: 4000 });
  } catch (e) {
    return { url: url, error: String(e).slice(0, 300) };
  } finally {
    await tab.close();
  }
}

const results = [];
for (let i = 0; i < targets.length; i += CONC) {
  const wave = targets.slice(i, i + CONC);
  const settled = await Promise.allSettled(wave.map(function (u) { return grab(u); }));
  for (let k = 0; k < settled.length; k++) {
    const s = settled[k];
    results.push(s.status === "fulfilled" ? s.value : { url: wave[k], error: String(s.reason).slice(0, 300) });
  }
}
return { requested: targets.length, count: results.length, results: results };