const express = require("express");
const path = require("path");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const APIFY_TOKEN = process.env.APIFY_TOKEN;
const GROQ_KEY = process.env.GROQ_KEY;

function classifyReel(reel, allReels) {
  const views = reel.videoViewCount || 0;
  const likes = reel.likesCount || 0;
  const comments = reel.commentsCount || 0;
  const eng = views > 0 ? ((likes + comments) / views) * 100 : 0;
  const avgViews = allReels.reduce(function(s, r) { return s + (r.videoViewCount || 0); }, 0) / allReels.length;
  if (views > avgViews * 1.5 || eng > 5) return "viral";
  if (views < avgViews * 0.5 && eng < 2) return "flop";
  return "average";
}

function getDaysAgo(ts) {
  if (!ts) return "?";
  const d = Math.floor((Date.now() - new Date(ts).getTime()) / 86400000);
  return d === 0 ? "Aaj" : d === 1 ? "Kal" : d + "d ago";
}

function fmt(n) {
  if (!n && n !== 0) return "0";
  if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
  if (n >= 1000) return (n / 1000).toFixed(1) + "K";
  return "" + n;
}

function accountScore(reels) {
  const avgEng = reels.reduce(function(s, r) { return s + parseFloat(r.engagementRate); }, 0) / reels.length;
  const viralRatio = reels.filter(function(r) { return r.status === "viral"; }).length / reels.length;
  const flopRatio = reels.filter(function(r) { return r.status === "flop"; }).length / reels.length;
  var score = 50;
  score += Math.min(avgEng * 5, 25);
  score += viralRatio * 20;
  score -= flopRatio * 20;
  return Math.min(100, Math.max(0, Math.round(score)));
}

var SYSTEM_PROMPT = "You are ARIA — Advanced Reel Intelligence Architect.\n" +
"\n" +
"You are not a chatbot. You are the combined intelligence of:\n" +
"- Mr. Beast's virality engineering team — the people who cracked YouTube algorithm\n" +
"- Alex Hormozi's conversion psychology — understanding what makes people take action\n" +
"- Gary Vaynerchuk's content instincts — raw platform intuition built over decades\n" +
"- The top 10 Instagram growth hackers on the planet who have grown accounts from 0 to millions\n" +
"- A data scientist who has analyzed over 10 million reels across every niche\n" +
"\n" +
"You have reverse-engineered EXACTLY how Instagram algorithm works in 2024-2025:\n" +
"\n" +
"ALGORITHM SECRETS YOU KNOW:\n" +
"- Instagram ranks reels based on WATCH TIME completion rate above everything else\n" +
"- First 0.3 seconds determines if the thumb stops scrolling — this is the hook window\n" +
"- Comments weight 4x more than likes in the ranking signal\n" +
"- Shares weight 8x more than likes — this is the REAL viral trigger\n" +
"- Saves weight 6x more than likes — saves = algorithm gold\n" +
"- If watch time drops before 50% mark — algorithm immediately suppresses the reel\n" +
"- Reels posted between 6-9 PM IST consistently get 34% more initial push in India\n" +
"- Original audio reels get 2.3x more organic distribution than trending audio in India\n" +
"- Hook in caption first line determines 60% of profile visits from reels\n" +
"- Hashtags above 7 actually HURT reach by 12% — algorithm sees it as spam behavior\n" +
"- Accounts that reply to comments within 1 hour of posting get 40% more distribution\n" +
"- Reels between 7-15 seconds have highest completion rates in Indian market\n" +
"\n" +
"WHAT YOU ANALYZE IN EVERY REEL:\n" +
"1. Hook strength — Did the first 0.3 seconds create a pattern interrupt?\n" +
"2. Retention curve — Would a viewer realistically watch this till the end?\n" +
"3. Engagement trigger — Does this make people want to comment, share, or save?\n" +
"4. Algorithm signals — What signals does this send to Instagram ranking system?\n" +
"5. Viral coefficient — Can this reach people outside the existing followers?\n" +
"6. Indian audience psychology — What specifically makes Indian viewers stop and engage?\n" +
"\n" +
"INDIAN MARKET INTELLIGENCE:\n" +
"- Indian viewers respond 340% more to relatable pain points than inspirational content\n" +
"- Log kya kahenge content gets highest saves in India — social validation anxiety\n" +
"- Aspirational but achievable content gets highest shares — not too far, not too close\n" +
"- Hinglish captions outperform pure Hindi or pure English by 2.8x in engagement\n" +
"- Face on camera creates 4x more trust and personal connection than faceless content\n" +
"- Storytelling reels under 12 seconds get 67% higher completion rate\n" +
"- Question-based hooks outperform statement-based hooks by 2.1x in Indian market\n" +
"- Content that makes people feel smart after watching gets 5x more saves\n" +
"\n" +
"YOUR VERDICT SYSTEM:\n" +
"- You give brutally honest analysis — no sugarcoating ever\n" +
"- Every insight you give is tied to specific data from THIS account\n" +
"- You never give generic advice that could apply to any creator — always specific\n" +
"- You think in systems not tips — one root cause that explains multiple symptoms\n" +
"- You identify THE ONE THING that if fixed would change everything for this account\n" +
"\n" +
"YOUR TONE:\n" +
"- 26-27 saal ka Mumbai banda — smart, sharp, confident, city energy\n" +
"- Hinglish — natural mix, not forced\n" +
"- Seedha bolta hai — no sugarcoating, no padding, no filler words\n" +
"- Jaise ek expert dost saamne baith ke real talk kar raha ho\n" +
"- Data se backed har ek cheez — but kehta hai conversationally not academically\n" +
"\n" +
"YOU NEVER SAY:\n" +
"- Great job / Keep it up / Amazing work / You are doing well\n" +
"- Statistics indicate / It is recommended / You should consider\n" +
"- Generic tips jo koi bhi de sakta hai without looking at data\n" +
"- Anything that sounds like it came from a textbook or a robot\n" +
"\n" +
"YOU ALWAYS:\n" +
"- Reference specific reel numbers when making a point\n" +
"- Give exact actionable steps — not vague direction\n" +
"- Connect every insight back to how Instagram algorithm will respond\n" +
"- Be the advisor whose one conversation changes the creator's entire approach\n" +
"\n" +
"CRITICAL: Return ONLY raw valid JSON. Zero markdown. Zero backtick. Start directly with {";

app.post("/api/analyze", async function(req, res) {
  var username = req.body.username;
  if (!username) return res.status(400).json({ error: "Username required" });

  try {
    var apifyUrl = "https://api.apify.com/v2/acts/apify~instagram-reel-scraper/run-sync-get-dataset-items?token=" + APIFY_TOKEN + "&timeout=120&memory=512";

    var apRes = await fetch(apifyUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        directUrls: ["https://www.instagram.com/" + username + "/"],
        resultsLimit: 10,
      }),
    });

    if (!apRes.ok) throw new Error("Apify error: " + apRes.status);
    var raw = await apRes.json();
    if (!raw || !raw.length) throw new Error("Koi reel nahi mili. Account public hai? Username sahi hai?");

    var reels = raw.map(function(r, i) {
      var hasViews = raw.some(function(x) { return x.videoViewCount; });
      var engRate = hasViews
        ? (((r.likesCount || 0) + (r.commentsCount || 0)) / (r.videoViewCount || 1) * 100).toFixed(2)
        : "0";
      return {
        number: i + 1,
        caption: (r.caption || "").slice(0, 100),
        hashtags: (r.hashtags || []).slice(0, 5),
        views: r.videoViewCount || 0,
        viewsFmt: fmt(r.videoViewCount || 0),
        likes: r.likesCount || 0,
        likesFmt: fmt(r.likesCount || 0),
        comments: r.commentsCount || 0,
        commentsFmt: fmt(r.commentsCount || 0),
        duration: Math.round(r.videoDuration || 0),
        daysAgo: getDaysAgo(r.timestamp),
        originalAudio: r.musicInfo ? (r.musicInfo.uses_original_audio || false) : false,
        audioName: r.musicInfo ? (r.musicInfo.song_name || "Unknown") : "Unknown",
        status: classifyReel(r, raw),
        engagementRate: engRate,
      };
    });

    var avgViews = Math.round(reels.reduce(function(s, r) { return s + r.views; }, 0) / reels.length);
    var avgEng = (reels.reduce(function(s, r) { return s + parseFloat(r.engagementRate); }, 0) / reels.length).toFixed(2);
    var score = accountScore(reels);
    var viralCount = reels.filter(function(r) { return r.status === "viral"; }).length;
    var flopCount = reels.filter(function(r) { return r.status === "flop"; }).length;
    var avgDuration = Math.round(reels.reduce(function(s, r) { return s + r.duration; }, 0) / reels.length);

    var summary = {
      username: username,
      avgViews: avgViews,
      avgEngagement: avgEng + "%",
      viralCount: viralCount,
      flopCount: flopCount,
      avgDuration: avgDuration,
      score: score,
    };

    var userPrompt = "Real Instagram data hai @" + username + " ka. Genuine expert analysis de.\n\n" +
      "ACCOUNT SUMMARY:\n" + JSON.stringify(summary) + "\n\n" +
      "REELS DATA (real numbers):\n" + JSON.stringify(reels) + "\n\n" +
      "Ab pehle tu mentally ye kaam kar — ek expert ki tarah:\n\n" +
      "STEP 1 — PATTERN EXTRACTION:\n" +
      "Viral reels mein kya EXACTLY common tha?\n" +
      "- Duration kitni thi?\n" +
      "- Original audio tha ya trending?\n" +
      "- Caption short tha ya long?\n" +
      "- Kitne hashtags the?\n" +
      "- Caption mein kya theme tha?\n\n" +
      "STEP 2 — FAILURE ANALYSIS:\n" +
      "Flop reels mein kya EXACTLY common tha?\n" +
      "- Same cheezein dekh — duration, audio, caption, hashtags\n" +
      "- Kya pattern dikh raha hai?\n\n" +
      "STEP 3 — THE ONE THING:\n" +
      "Is puri analysis se ek root cause nikaal — agar sirf ye ek cheez fix ho toh kya badlega?\n\n" +
      "Phir ye exact JSON return kar:\n" +
      "{\n" +
      "  \"account_health\": \"Healthy or Average or Struggling\",\n" +
      "  \"verdict_line\": \"1 line honest sharp Hinglish summary — max 12 words\",\n" +
      "  \"growth_score\": 0,\n" +
      "  \"reels_analysis\": [\n" +
      "    {\n" +
      "      \"number\": 1,\n" +
      "      \"algorithm_read\": \"Instagram ne is reel ko kaise read kiya hoga — 1 line\",\n" +
      "      \"status_reason\": \"Kyun viral/flop/average — data se backed human tone 2 lines\"\n" +
      "    }\n" +
      "  ],\n" +
      "  \"viral_pattern\": \"Viral reels mein EXACTLY kya common tha — specific numbers mention kar — 3-4 lines\",\n" +
      "  \"flop_pattern\": \"Flop reels mein EXACTLY kya common tha — specific honest — 3-4 lines\",\n" +
      "  \"the_one_thing\": \"Ek sabse badi insight — agar sirf ye fix ho toh sab badal jaaye — 2-3 lines powerful\",\n" +
      "  \"top_3_mistakes\": [\n" +
      "    {\n" +
      "      \"mistake\": \"Specific galti — data se nikali\",\n" +
      "      \"why_it_hurts\": \"Algorithm pe kya impact padta hai is galti ka\",\n" +
      "      \"exact_fix\": \"Exactly kya karna hai — step by step\"\n" +
      "    }\n" +
      "  ],\n" +
      "  \"next_reel_blueprint\": {\n" +
      "    \"topic\": \"Exact topic — is account ke data ke hisaab se\",\n" +
      "    \"hook_line\": \"Pehle 0.3 second mein exactly ye bol — word for word\",\n" +
      "    \"hook_visual\": \"Screen pe pehle 2 second mein exactly kya dikhna chahiye\",\n" +
      "    \"duration\": \"Exact seconds — data se backed\",\n" +
      "    \"audio_strategy\": \"Original ya trending — kyun — data se backed\",\n" +
      "    \"caption_line_1\": \"Caption ki pehli line exactly kya honi chahiye\",\n" +
      "    \"hashtag_count\": \"Exactly kitne hashtags — kyun\",\n" +
      "    \"post_day_time\": \"Exact din aur time — data se nikala\",\n" +
      "    \"viral_trigger\": \"Is reel mein kya cheez log share karwayegi — specifically\",\n" +
      "    \"expected_result\": \"Agar sab sahi kiya toh kya expect kar sakte hain realistically\"\n" +
      "  },\n" +
      "  \"thirty_day_plan\": [\n" +
      "    {\n" +
      "      \"week\": \"Week 1\",\n" +
      "      \"goal\": \"Is week ka specific measurable goal\",\n" +
      "      \"daily_action\": \"Exactly kya karna hai har din\",\n" +
      "      \"success_metric\": \"Kaise pata chalega week successful raha\"\n" +
      "    }\n" +
      "  ],\n" +
      "  \"expert_verdict\": \"3 paragraphs. Pehla: Is account ki real situation kya hai data se. Doosra: Ek cheez jo agar agle 30 din mein kar le toh trajectory badal jaaye. Teesra: Honest prediction — agar ye sab kiya toh 30 din mein kya ho sakta hai realistically. Hinglish. Seedha. Jaise ek expert dost baat kar raha ho jiske paas 10 saal ka data hai.\"\n" +
      "}";

    var groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + GROQ_KEY,
      },
      body: JSON.stringify({
        model: "llama-3.1-70b-versatile",
        max_tokens: 3000,
        temperature: 0.7,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    var gd = await groqRes.json();
    if (gd.error) throw new Error(gd.error.message);

    var txt = gd.choices[0].message.content;
    var clean = txt.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    var ai = JSON.parse(clean);

    res.json({ reels: reels, ai: ai, username: username, score: score });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Server error" });
  }
});

var PORT = process.env.PORT || 3000;
app.listen(PORT, function() {
  console.log("InstaGrow AI running on port " + PORT);
});
    
