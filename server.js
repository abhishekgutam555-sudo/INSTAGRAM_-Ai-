const express = require("express");
const path = require("path");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const APIFY_TOKEN = process.env.APIFY_TOKEN;
const GROQ_KEY = process.env.GROQ_KEY;

// ── Helpers ───────────────────────────────────────────────────

function classifyReel(reel, allReels) {
  var views = reel.videoViewCount || 0;
  var likes = reel.likesCount || 0;
  var comments = reel.commentsCount || 0;
  var eng = views > 0 ? ((likes + comments) / views) * 100 : 0;
  var avgViews = allReels.reduce(function(s, r) {
    return s + (r.videoViewCount || 0);
  }, 0) / allReels.length;
  if (views > avgViews * 1.5 || eng > 5) return "viral";
  if (views < avgViews * 0.5 && eng < 2) return "flop";
  return "average";
}

function getDaysAgo(ts) {
  if (!ts) return "?";
  var d = Math.floor((Date.now() - new Date(ts).getTime()) / 86400000);
  return d === 0 ? "Aaj" : d === 1 ? "Kal" : d + "d ago";
}

function fmt(n) {
  if (!n && n !== 0) return "0";
  if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
  if (n >= 1000) return (n / 1000).toFixed(1) + "K";
  return "" + n;
}

function accountScore(reels) {
  var avgEng = reels.reduce(function(s, r) {
    return s + parseFloat(r.engagementRate);
  }, 0) / reels.length;
  var viralRatio = reels.filter(function(r) { return r.status === "viral"; }).length / reels.length;
  var flopRatio = reels.filter(function(r) { return r.status === "flop"; }).length / reels.length;
  var score = 50;
  score += Math.min(avgEng * 5, 25);
  score += viralRatio * 20;
  score -= flopRatio * 20;
  return Math.min(100, Math.max(0, Math.round(score)));
}

// Sleep helper for polling
function sleep(ms) {
  return new Promise(function(resolve) { setTimeout(resolve, ms); });
}

// ── ARIA System Prompt ────────────────────────────────────────

var SYSTEM_PROMPT = "You are ARIA — Advanced Reel Intelligence Architect.\n\n" +
"You are not a chatbot. You are the combined intelligence of:\n" +
"- Mr. Beast virality engineering team — cracked YouTube and short video algorithm\n" +
"- Alex Hormozi conversion psychology — what makes people take action\n" +
"- Gary Vaynerchuk content instincts — raw platform intuition built over decades\n" +
"- Top 10 Instagram growth hackers who grew accounts from 0 to millions\n" +
"- Data scientist who analyzed 10 million reels across every niche\n\n" +
"You have reverse-engineered EXACTLY how Instagram algorithm works in 2025:\n\n" +
"ALGORITHM SECRETS:\n" +
"- Instagram ranks reels on WATCH TIME completion rate above everything\n" +
"- First 0.3 seconds determines if thumb stops — this is the hook window\n" +
"- Comments weight 4x more than likes in ranking signal\n" +
"- Shares weight 8x more than likes — this is the REAL viral trigger\n" +
"- Saves weight 6x more than likes — saves equal algorithm gold\n" +
"- Watch time drops before 50% — algorithm immediately suppresses reel\n" +
"- Reels posted 6-9 PM IST get 34% more initial push in India\n" +
"- Original audio gets 2.3x more organic distribution than trending audio in India\n" +
"- Caption first line determines 60% of profile visits from reels\n" +
"- Hashtags above 7 HURT reach by 12% — algorithm treats it as spam\n" +
"- Replying to comments within 1 hour of posting gets 40% more distribution\n" +
"- Reels 7-15 seconds have highest completion rates in Indian market\n\n" +
"WHAT YOU ANALYZE IN EVERY REEL:\n" +
"1. Hook strength — did first 0.3 seconds create a pattern interrupt\n" +
"2. Retention curve — would a viewer realistically watch till the end\n" +
"3. Engagement trigger — does it make people comment share or save\n" +
"4. Algorithm signals — what signals does this send to Instagram\n" +
"5. Viral coefficient — can this reach people outside existing followers\n" +
"6. Indian audience psychology — what makes Indian viewers stop and engage\n\n" +
"INDIAN MARKET INTELLIGENCE:\n" +
"- Indian viewers respond 340% more to relatable pain points than inspiration\n" +
"- Log kya kahenge content gets highest saves in India — social validation anxiety\n" +
"- Aspirational but achievable content gets highest shares\n" +
"- Hinglish captions outperform pure Hindi or English by 2.8x in engagement\n" +
"- Face on camera creates 4x more trust and connection than faceless content\n" +
"- Storytelling reels under 12 seconds get 67% higher completion rate\n" +
"- Question-based hooks outperform statement hooks by 2.1x in India\n" +
"- Content that makes people feel smart after watching gets 5x more saves\n\n" +
"YOUR VERDICT SYSTEM:\n" +
"- You give brutally honest analysis — no sugarcoating ever\n" +
"- Every insight tied to specific data from THIS account\n" +
"- Never give generic advice — always specific to this creator\n" +
"- Think in systems not tips — one root cause explains multiple symptoms\n" +
"- Identify THE ONE THING that if fixed would change everything\n\n" +
"YOUR TONE:\n" +
"- 26-27 saal ka Mumbai banda — smart sharp confident city energy\n" +
"- Hinglish — natural mix not forced\n" +
"- Seedha bolta hai — no sugarcoating no padding no filler\n" +
"- Jaise ek expert dost saamne baith ke real talk kar raha ho\n" +
"- Data backed har cheez — but conversational not academic\n\n" +
"YOU NEVER SAY: Great job, Keep it up, Amazing work, Statistics indicate, It is recommended, Generic tips without looking at data\n\n" +
"YOU ALWAYS: Reference specific reel numbers, give exact steps not vague direction, connect every insight to algorithm behavior\n\n" +
"CRITICAL: Return ONLY raw valid JSON. Zero markdown. Zero backtick. Start directly with {";

// ── API Route ─────────────────────────────────────────────────

app.post("/api/analyze", async function(req, res) {
  var username = req.body.username;
  if (!username) return res.status(400).json({ error: "Username required" });

  try {
    // STEP 1: Start Apify run
    var startRes = await fetch(
      "https://api.apify.com/v2/acts/instagram-scraper~fast-instagram-post-scraper/runs?token=" + APIFY_TOKEN,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          directUrls: username,
          resultsLimit: 10,
        }),
      }
    );

    if (!startRes.ok) {
      var errData = await startRes.json();
      throw new Error("Apify start error: " + startRes.status + " — " + JSON.stringify(errData));
    }

    var runData = await startRes.json();
    var runId = runData.data.id;
    var datasetId = runData.data.defaultDatasetId;

    // STEP 2: Poll until finished (max 90 seconds)
    var maxWait = 90000;
    var waited = 0;
    var pollInterval = 3000;
    var status = "RUNNING";

    while (status === "RUNNING" || status === "READY" || status === "ABORTING") {
      await sleep(pollInterval);
      waited += pollInterval;

      var statusRes = await fetch(
        "https://api.apify.com/v2/actor-runs/" + runId + "?token=" + APIFY_TOKEN
      );
      var statusData = await statusRes.json();
      status = statusData.data.status;

      if (waited >= maxWait) {
        throw new Error("Apify timeout — 90 sec se zyada lag gaya. Dobara try karo.");
      }

      if (status === "FAILED" || status === "ABORTED" || status === "TIMED-OUT") {
        throw new Error("Apify run failed: " + status);
      }
    }

    // STEP 3: Fetch dataset results
    var dataRes = await fetch(
      "https://api.apify.com/v2/datasets/" + datasetId + "/items?token=" + APIFY_TOKEN + "&limit=10"
    );
    var raw = await dataRes.json();

    if (!raw || !raw.length) {
      throw new Error("Koi reel nahi mili. Account public hai? Username sahi hai?");
    }

    // STEP 4: Process reels
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

    // STEP 5: Build user prompt
    var userPrompt = "Real Instagram data hai @" + username + " ka. Genuine expert analysis de.\n\n" +
      "ACCOUNT SUMMARY:\n" + JSON.stringify(summary) + "\n\n" +
      "REELS DATA (real numbers):\n" + JSON.stringify(reels) + "\n\n" +
      "Pehle mentally ye analyze kar:\n\n" +
      "STEP 1 — PATTERN EXTRACTION:\n" +
      "Viral reels mein kya EXACTLY common tha — duration, audio, caption length, hashtags, timing?\n\n" +
      "STEP 2 — FAILURE ANALYSIS:\n" +
      "Flop reels mein kya EXACTLY common tha — same cheezein dekh?\n\n" +
      "STEP 3 — THE ONE THING:\n" +
      "Is puri analysis se ek root cause nikaal — agar sirf ye fix ho toh kya badlega?\n\n" +
      "Return this exact JSON:\n" +
      "{\n" +
      "  \"account_health\": \"Healthy or Average or Struggling\",\n" +
      "  \"verdict_line\": \"1 line honest sharp Hinglish — max 12 words\",\n" +
      "  \"growth_score\": 0,\n" +
      "  \"reels_analysis\": [\n" +
      "    {\n" +
      "      \"number\": 1,\n" +
      "      \"algorithm_read\": \"Instagram ne is reel ko kaise read kiya — 1 line\",\n" +
      "      \"status_reason\": \"Kyun viral/flop/average — data backed human tone 2 lines\"\n" +
      "    }\n" +
      "  ],\n" +
      "  \"viral_pattern\": \"Viral reels mein EXACTLY kya common tha — specific data mention — 3-4 lines\",\n" +
      "  \"flop_pattern\": \"Flop reels mein EXACTLY kya common tha — specific honest — 3-4 lines\",\n" +
      "  \"the_one_thing\": \"Ek sabse badi insight — agar sirf ye fix ho toh sab badal jaaye — 2-3 lines powerful\",\n" +
      "  \"top_3_mistakes\": [\n" +
      "    {\n" +
      "      \"mistake\": \"Specific galti — data se nikali\",\n" +
      "      \"why_it_hurts\": \"Algorithm pe kya impact padta hai\",\n" +
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
      "    \"post_day_time\": \"Exact din aur time\",\n" +
      "    \"viral_trigger\": \"Is reel mein kya cheez log share karwayegi\",\n" +
      "    \"expected_result\": \"Agar sab sahi kiya toh kya expect kar sakte hain\"\n" +
      "  },\n" +
      "  \"thirty_day_plan\": [\n" +
      "    {\n" +
      "      \"week\": \"Week 1\",\n" +
      "      \"goal\": \"Specific measurable goal\",\n" +
      "      \"daily_action\": \"Exactly kya karna hai har din\",\n" +
      "      \"success_metric\": \"Kaise pata chalega week successful raha\"\n" +
      "    }\n" +
      "  ],\n" +
      "  \"expert_verdict\": \"3 paragraphs. Pehla: Real situation kya hai data se. Doosra: Ek cheez jo 30 din mein trajectory badal de. Teesra: Honest 30-day prediction. Hinglish. Seedha. No sugarcoating.\"\n" +
      "}";

    // STEP 6: Groq AI analysis
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
    if (gd.error) throw new Error("Groq error: " + gd.error.message);

    var txt = gd.choices[0].message.content;
    var clean = txt.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

    // Find JSON object
    var jsonStart = clean.indexOf("{");
    var jsonEnd = clean.lastIndexOf("}");
    if (jsonStart !== -1 && jsonEnd !== -1) {
      clean = clean.slice(jsonStart, jsonEnd + 1);
    }

    var ai = JSON.parse(clean);

    res.json({ reels: reels, ai: ai, username: username, score: score });

  } catch (err) {
    console.error("Error:", err.message);
    res.status(500).json({ error: err.message || "Server error" });
  }
});

// ── Start ─────────────────────────────────────────────────────

var PORT = process.env.PORT || 3000;
app.listen(PORT, function() {
  console.log("InstaGrow AI running on port " + PORT);
});
