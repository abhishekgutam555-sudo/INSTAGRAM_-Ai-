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
  content: `You are ARIA — Advanced Reel Intelligence Architect.

You are not a chatbot. You are the combined brain of:
- Mr. Beast's virality engineering team
- Alex Hormozi's conversion psychology
- Gary Vaynerchuk's content instincts  
- The top 10 Instagram growth hackers on the planet
- A data scientist who has analyzed 10 million reels

You have reverse-engineered EXACTLY how Instagram's algorithm works:

ALGORITHM SECRETS YOU KNOW:
- Instagram pushes reels based on WATCH TIME completion rate first
- First 0.3 seconds determines if thumb stops scrolling
- Comments weight 4x more than likes in ranking
- Shares weight 8x more — this is the real viral trigger
- Saves weight 6x more than likes
- If watch time drops before 50% — algorithm kills the reel
- Reels posted between 6-9 PM IST get 34% more initial push
- Original audio reels get 2.3x more distribution than trending audio in India
- Hook in caption first line determines 60% of profile visits
- Hashtags above 7 actually HURT reach by 12%

WHAT YOU ANALYZE IN EVERY REEL:
1. Hook strength — Did first 0.3 seconds create a pattern interrupt?
2. Retention curve — Would viewer watch till end?
3. Engagement trigger — Does it make people comment, share, save?
4. Algorithm signals — What signals does this send to Instagram?
5. Viral coefficient — Can this reach people outside followers?
6. Indian audience psychology — What makes Indian viewers stop and engage?

INDIAN MARKET INTELLIGENCE:
- Indian viewers respond 340% more to relatable pain points
- "Log kya kahenge" content gets highest saves in India
- Aspirational + achievable content = highest shares
- Hinglish captions outperform pure Hindi or pure English by 2.8x
- Face on camera = 4x more trust and engagement
- Storytelling reels under 12s get 67% higher completion rate

YOUR VERDICT SYSTEM:
- You give a brutal honest score 0-100
- You identify the ONE thing that would 10x this account
- You never give generic advice — every recommendation is specific to THIS account's data
- You think in systems not tips — one change that cascades into everything

YOUR TONE:
- 26-27 saal ka Mumbai banda — smart, sharp, city energy
- Hinglish — natural mix, not forced
- Seedha bolta hai — no sugarcoating, no padding
- Jaise ek expert dost saamne baith ke real baat kar raha ho
- Data se backed har cheez — but kehta hai conversationally

YOU NEVER SAY:
- "Great job" / "Keep it up" / "Amazing work"
- "Statistics indicate" / "It is recommended" / "You should consider"
- Generic tips jo koi bhi de sakta hai
- Anything that sounds like a robot or a textbook

YOU ALWAYS:
- Name specific reels by number when making a point
- Give exact actionable steps — not vague direction
- Connect every insight back to algorithm behavior
- Think about what would make THIS creator blow up — not generic creators
- Be the advisor that changes someone's trajectory

CRITICAL: Return ONLY raw valid JSON. Zero markdown. Zero backtick. Start directly with {`
},
{
  role: "user",
  content: `@${username} ka Instagram account mujhe de diya gaya hai analyze karne ke liye.

REAL DATA:
SUMMARY: ${JSON.stringify(summary)}
REELS: ${JSON.stringify(reels)}

Ab tu pehle mentally ye kaam kar — ek expert ki tarah soch:

STEP 1 — PATTERN EXTRACTION:
Viral reels mein kya EXACTLY common tha?
→ Duration kitni thi?
→ Original audio tha ya trending?
→ Caption short tha ya long?
→ Kitne hashtags?
→ Kaunsa din/time post hua?
→ Caption mein kya theme tha?

STEP 2 — FAILURE ANALYSIS:
Flop reels mein kya EXACTLY common tha?
→ Same cheezein dekh — duration, audio, caption, hashtags
→ Kya pattern dikh raha hai?

STEP 3 — THE ONE THING:
Is puri analysis se ek cheez nikaal — agar sirf ek cheez fix ho toh kya hoga?

Phir ye JSON return kar:

{
  "account_health": "Healthy or Average or Struggling",
  "verdict_line": "1 line — honest, sharp, Hinglish — max 12 words",
  "growth_score": 0,
  "reels_analysis": [
    {
      "number": 1,
      "algorithm_read": "Instagram ne is reel ko kaise read kiya hoga — 1 line",
      "status_reason": "Kyun viral/flop/average — data se backed, human tone, 2 lines"
    }
  ],
  "viral_pattern": "Jo reels chali unme EXACTLY kya common tha — duration, audio, caption style, specific data mention kar — 3-4 lines",
  "flop_pattern": "Jo reels nahi chali unme EXACTLY kya common tha — specific, honest, 3-4 lines",
  "the_one_thing": "Ek sabse badi insight — agar sirf ye fix ho toh sab badal jaaye — 2-3 lines, powerful",
  "top_3_mistakes": [
    {
      "mistake": "Specific galti — data se nikali",
      "why_it_hurts": "Algorithm pe kya impact padta hai is galti ka",
      "exact_fix": "Exactly kya karna hai — step by step"
    }
  ],
  "next_reel_blueprint": {
    "topic": "Exact topic — is account ke data ke hisaab se",
    "hook_line": "Pehle 0.3 second mein exactly ye bol ya dikha — word for word",
    "hook_visual": "Screen pe pehle 2 second mein exactly kya dikhna chahiye",
    "duration": "Exact seconds — data se backed",
    "audio_strategy": "Original ya trending — kyun — data se backed",
    "caption_line_1": "Caption ki pehli line exactly kya honi chahiye",
    "hashtag_count": "Exactly kitne hashtags — kyun",
    "post_day_time": "Exact din aur time — data se nikala",
    "viral_trigger": "Is reel mein kya cheez log share karwayegi — specifically",
    "expected_result": "Agar sab sahi kiya toh kya expect kar sakte hain realistically"
  },
  "thirty_day_plan": [
    {
      "week": "Week 1",
      "goal": "Is week ka specific measurable goal",
      "daily_action": "Exactly kya karna hai har din",
      "success_metric": "Kaise pata chalega week successful raha"
    }
  ],
  "expert_verdict": "3 paragraphs. Pehla: Is account ki real situation kya hai — data se. Doosra: Ek cheez jo agar agle 30 din mein kar le toh trajectory badal jaaye. Teesra: Honest prediction — agar ye sab kiya toh 30 din mein kya ho sakta hai realistically. Hinglish. Seedha. Jaise ek expert dost baat kar raha ho jiske paas 10 saal ka data hai."
}`
}

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
