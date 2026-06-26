const express = require("express");
const path = require("path");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const APIFY_TOKEN  = process.env.APIFY_TOKEN;
const GROQ_KEY     = process.env.GROQ_KEY;

// ── Helpers ───────────────────────────────────────────────────

function classifyReel(reel, allReels) {
  const views = reel.videoViewCount || 0;
  const likes = reel.likesCount || 0;
  const comments = reel.commentsCount || 0;
  const eng = views > 0 ? ((likes + comments) / views) * 100 : 0;
  const avgViews = allReels.reduce((s,r) => s+(r.videoViewCount||0),0) / allReels.length;
  if (views > avgViews * 1.5 || eng > 5) return "viral";
  if (views < avgViews * 0.5 && eng < 2) return "flop";
  return "average";
}

function getDaysAgo(ts) {
  if (!ts) return "?";
  const d = Math.floor((Date.now() - new Date(ts).getTime()) / 86400000);
  return d === 0 ? "Aaj" : d === 1 ? "Kal" : `${d}d ago`;
}

function fmt(n) {
  if (!n && n!==0) return "0";
  if (n>=1000000) return (n/1000000).toFixed(1)+"M";
  if (n>=1000) return (n/1000).toFixed(1)+"K";
  return ""+n;
}

function accountScore(reels) {
  const avgEng = reels.reduce((s,r)=>s+parseFloat(r.engagementRate),0)/reels.length;
  const viralRatio = reels.filter(r=>r.status==="viral").length / reels.length;
  const flopRatio  = reels.filter(r=>r.status==="flop").length  / reels.length;
  let score = 50;
  score += Math.min(avgEng * 5, 25);
  score += viralRatio * 20;
  score -= flopRatio  * 20;
  return Math.min(100, Math.max(0, Math.round(score)));
}

// ── API ───────────────────────────────────────────────────────

app.post("/api/analyze", async (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: "Username required" });

  try {
    // 1. Apify
    const apRes = await fetch(
      `https://api.apify.com/v2/acts/apify~instagram-reel-scraper/run-sync-get-dataset-items?token=${APIFY_TOKEN}&timeout=120&memory=512`,
      { method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ directUrls:[`https://www.instagram.com/${username}/`], resultsLimit:10 }) }
    );
    if (!apRes.ok) throw new Error(`Apify ${apRes.status}`);
    const raw = await apRes.json();
    if (!raw || !raw.length) throw new Error("Koi reel nahi mili. Account public hai? Username sahi hai?");

    // 2. Process
    const reels = raw.map((r,i) => ({
      number: i+1,
      caption: (r.caption||"").slice(0,100),
      hashtags: (r.hashtags||[]).slice(0,5),
      views: r.videoViewCount||0, viewsFmt: fmt(r.videoViewCount||0),
      likes: r.likesCount||0,     likesFmt: fmt(r.likesCount||0),
      comments: r.commentsCount||0, commentsFmt: fmt(r.commentsCount||0),
      duration: Math.round(r.videoDuration||0),
      daysAgo: getDaysAgo(r.timestamp),
      originalAudio: r.musicInfo?.uses_original_audio||false,
      audioName: r.musicInfo?.song_name||"Unknown",
      status: classifyReel(r, raw),
      engagementRate: raw.some(x=>x.videoViewCount)
        ? (((r.likesCount||0)+(r.commentsCount||0))/(r.videoViewCount||1)*100).toFixed(2)
        : "0",
    }));

    const avgViews = Math.round(reels.reduce((s,r)=>s+r.views,0)/reels.length);
    const avgEng   = (reels.reduce((s,r)=>s+parseFloat(r.engagementRate),0)/reels.length).toFixed(2);
    const score    = accountScore(reels);
    const summary  = { username, avgViews, avgEngagement:avgEng+"%", viralCount:reels.filter(r=>r.status==="viral").length, flopCount:reels.filter(r=>r.status==="flop").length, avgDuration:Math.round(reels.reduce((s,r)=>s+r.duration,0)/reels.length), score };

    // 3. Groq AI
    const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method:"POST",
      headers:{ "Content-Type":"application/json", "Authorization":`Bearer ${GROQ_KEY}` },
      body: JSON.stringify({
        model: "llama-3.1-70b-versatile",
        max_tokens: 3000,
        temperature: 0.7,
        messages: [
          {
            role: "system",
            content: `Tu ek Instagram growth specialist hai. 26-27 saal ka Mumbai ka banda — 500+ Indian creators ke saath kaam kiya hai. Data-driven lekin bolta Hinglish mein, seedha, sharp. City boy energy. Dost ki tarah but expert level.

KABHI mat bol: "Great job", "Keep it up", "Statistics indicate", "It is recommended".
HAMESHA bol seedha — jaise saamne baith ke baat kar raha ho.

CRITICAL: Return ONLY raw valid JSON. No markdown. No backtick. Start with {`
          },
          {
            role: "user",
            content: `Real Instagram data @${username}:

SUMMARY: ${JSON.stringify(summary)}

REELS: ${JSON.stringify(reels)}

Return this exact JSON:
{
  "account_health": "Healthy or Average or Struggling",
  "verdict_line": "1 line honest summary — Hinglish, seedha, max 15 words",
  "reels_analysis": [{"number":1,"status_reason":"1-2 lines kyun — human tone"}],
  "viral_pattern": "2-3 lines — viral reels mein kya common, data-backed, honest",
  "flop_pattern": "2-3 lines — flop pattern, direct",
  "top_3_mistakes": [
    {"problem":"specific galti — punchy","fix":"exact actionable fix"}
  ],
  "next_reel_blueprint": {
    "topic":"exact topic","hook":"pehle 2 sec mein exactly kya","duration":"ideal length",
    "audio":"original ya trending — data se","caption_style":"caption tip",
    "post_time":"best time","why_this_works":"2 lines confident"
  },
  "thirty_day_plan": [
    {"week":"Week 1","focus":"focus","action":"exact tasks"},
    {"week":"Week 2","focus":"focus","action":"exact tasks"},
    {"week":"Week 3","focus":"focus","action":"exact tasks"},
    {"week":"Week 4","focus":"focus","action":"exact tasks"}
  ],
  "expert_verdict": "2 paragraphs. Human expert. Real data mention kar. Hinglish. No sugarcoating."
}`
          }
        ]
      })
    });

    const gd = await groqRes.json();
    if (gd.error) throw new Error(gd.error.message);
    const txt   = gd.choices[0].message.content;
    const clean = txt.replace(/```json\n?/g,"").replace(/```\n?/g,"").trim();
    const ai    = JSON.parse(clean);

    res.json({ reels, ai, username, score });

  } catch(err) {
    console.error(err);
    res.status(500).json({ error: err.message||"Server error" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`InstaGrow AI → port ${PORT}`));
