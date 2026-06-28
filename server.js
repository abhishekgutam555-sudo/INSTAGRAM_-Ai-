const express = require("express");
const path = require("path");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const APIFY_TOKEN = process.env.APIFY_TOKEN;
const GROQ_KEY = process.env.GROQ_KEY;

// ── Actor IDs ─────────────────────────────────────────────────
var REELS_ACTOR    = "8yz4aO3qlqckRu3nu";
var COMMENTS_ACTOR = "apify~instagram-comment-scraper";
var PROFILE_ACTOR  = "apify~instagram-profile-scraper";

// ── Helpers ───────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(function(r) { setTimeout(r, ms); });
}

function fmt(n) {
  if (!n && n !== 0) return "0";
  if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
  if (n >= 1000) return (n / 1000).toFixed(1) + "K";
  return "" + n;
}

function getDaysAgo(ts) {
  if (!ts) return "?";
  var d = Math.floor((Date.now() - new Date(ts).getTime()) / 86400000);
  return d === 0 ? "Aaj" : d === 1 ? "Kal" : d + "d ago";
}

function classifyReel(reel, allReels) {
  var views = reel.videoViewCount || reel.viewsCount || 0;
  var likes = reel.likesCount || reel.likeCount || 0;
  var comments = reel.commentsCount || reel.commentCount || 0;
  var eng = views > 0 ? ((likes + comments) / views) * 100 : 0;
  var avgViews = allReels.reduce(function(s, r) {
    return s + (r.videoViewCount || r.viewsCount || 0);
  }, 0) / allReels.length;
  if (views > avgViews * 1.5 || eng > 5) return "viral";
  if (views < avgViews * 0.5 && eng < 2) return "flop";
  return "average";
}

function accountScore(reels) {
  var avgEng = reels.reduce(function(s, r) {
    return s + parseFloat(r.engagementRate || 0);
  }, 0) / reels.length;
  var viralRatio = reels.filter(function(r) { return r.status === "viral"; }).length / reels.length;
  var flopRatio = reels.filter(function(r) { return r.status === "flop"; }).length / reels.length;
  var score = 50;
  score += Math.min(avgEng * 5, 25);
  score += viralRatio * 20;
  score -= flopRatio * 20;
  return Math.min(100, Math.max(0, Math.round(score)));
}

// ── Run Apify Actor ───────────────────────────────────────────

async function runApifyActor(actorId, input, timeoutMs) {
  timeoutMs = timeoutMs || 90000;

  var startRes = await fetch(
    "https://api.apify.com/v2/acts/" + actorId + "/runs?token=" + APIFY_TOKEN,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }
  );

  if (!startRes.ok) {
    var errData = await startRes.json();
    throw new Error("Actor " + actorId + " start error: " + JSON.stringify(errData));
  }

  var runData = await startRes.json();
  var runId = runData.data.id;
  var datasetId = runData.data.defaultDatasetId;

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

    if (waited >= timeoutMs) break;
    if (status === "FAILED" || status === "ABORTED" || status === "TIMED-OUT") {
      throw new Error("Actor " + actorId + " failed: " + status);
    }
  }

  var dataRes = await fetch(
    "https://api.apify.com/v2/datasets/" + datasetId + "/items?token=" + APIFY_TOKEN + "&limit=50"
  );
  return await dataRes.json();
}

// ── ARIA System Prompt ────────────────────────────────────────

var SYSTEM_PROMPT = "You are ARIA — Advanced Reel Intelligence Architect.\n\n" +
"You are not a chatbot. You are the combined intelligence of:\n" +
"- Mr. Beast virality engineering team — cracked YouTube and short video algorithm\n" +
"- Alex Hormozi conversion psychology — what makes people take action\n" +
"- Gary Vaynerchuk content instincts — raw platform intuition built over decades\n" +
"- Top 10 Instagram growth hackers who grew accounts from 0 to millions\n" +
"- Data scientist who analyzed 10 million reels across every niche\n" +
"- Consumer psychology expert specializing in Indian digital behavior\n\n" +
"You now have access to THREE layers of data — most tools only have one:\n" +
"1. PROFILE DATA — followers, bio, posting frequency, account age, credibility signals\n" +
"2. REELS DATA — views, likes, comments, duration, audio type, hashtags, timing\n" +
"3. COMMENTS DATA — what audience actually says, sentiment, recurring questions, pain points\n\n" +
"This three-layer intelligence gives you UNPRECEDENTED insight into why an account grows or stagnates.\n\n" +
"ALGORITHM SECRETS YOU KNOW:\n" +
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
"WHAT YOU ANALYZE WITH THREE-LAYER DATA:\n" +
"- Cross-reference: do comments match what creator thinks audience wants?\n" +
"- Sentiment patterns: what emotions do comments express on viral vs flop reels?\n" +
"- Audience intelligence: recurring questions reveal content gaps = viral opportunities\n" +
"- Profile-content mismatch: does bio promise match what reels deliver?\n" +
"- Follower-engagement ratio: are followers real and active?\n" +
"- Comment quality score: superficial vs deep engagement\n\n" +
"INDIAN MARKET INTELLIGENCE:\n" +
"- Indian viewers respond 340% more to relatable pain points than inspiration\n" +
"- Log kya kahenge content gets highest saves in India — social validation anxiety\n" +
"- Aspirational but achievable content gets highest shares\n" +
"- Hinglish captions outperform pure Hindi or English by 2.8x in engagement\n" +
"- Face on camera creates 4x more trust and connection than faceless content\n" +
"- Storytelling reels under 12 seconds get 67% higher completion rate\n" +
"- Question-based hooks outperform statement hooks by 2.1x in India\n" +
"- Content that makes people feel smart after watching gets 5x more saves\n\n" +
"YOUR TONE:\n" +
"- 26-27 saal ka Mumbai banda — smart sharp confident city energy\n" +
"- Hinglish — natural mix not forced\n" +
"- Seedha bolta hai — no sugarcoating no padding no filler\n" +
"- Jaise ek expert dost saamne baith ke real talk kar raha ho\n" +
"- Data backed har cheez — but conversational not academic\n\n" +
"YOU NEVER SAY: Great job, Keep it up, Amazing work, Statistics indicate, It is recommended\n\n" +
"YOU ALWAYS: Reference specific reel numbers and actual comment examples when making a point\n\n" +
"CRITICAL: Return ONLY raw valid JSON. Zero markdown. Zero backtick. Start directly with {";

// ── API Route ─────────────────────────────────────────────────

app.post("/api/analyze", async function(req, res) {
  var username = req.body.username;
  if (!username) return res.status(400).json({ error: "Username required" });

  try {

    // STEP 1: Run Profile + Reels scrapers in parallel
    console.log("Starting profile and reels scrapers for @" + username);

    var profilePromise = runApifyActor(PROFILE_ACTOR, {
      usernames: [username],
      includeAboutSection: true
    }, 60000).catch(function(e) {
      console.log("Profile scraper failed:", e.message);
      return [];
    });

    var reelsPromise = runApifyActor(REELS_ACTOR, {
      directUrls: ["https://www.instagram.com/" + username + "/"],
      resultsLimit: 10
    }, 90000).catch(function(e) {
      console.log("Reels scraper failed:", e.message);
      return [];
    });

    var results = await Promise.all([profilePromise, reelsPromise]);
    var profileRaw = results[0];
    var reelsRaw = results[1];

    if (!reelsRaw || reelsRaw.length === 0) {
      throw new Error("Reels nahi mile. Account public hai? Username sahi hai?");
    }

    // STEP 2: Process reels data
    var reels = reelsRaw.slice(0, 10).map(function(r, i) {
      var views = r.videoViewCount || r.viewsCount || r.playCount || 0;
      var likes = r.likesCount || r.likeCount || 0;
      var comments = r.commentsCount || r.commentCount || 0;
      var engRate = views > 0 ? ((likes + comments) / views * 100).toFixed(2) : "0";
      return {
        number: i + 1,
        url: r.url || r.shortCode ? "https://www.instagram.com/reel/" + r.shortCode + "/" : "",
        caption: (r.caption || r.text || "").slice(0, 120),
        hashtags: (r.hashtags || []).slice(0, 5),
        views: views,
        viewsFmt: fmt(views),
        likes: likes,
        likesFmt: fmt(likes),
        comments: comments,
        commentsFmt: fmt(comments),
        duration: Math.round(r.videoDuration || r.duration || 0),
        daysAgo: getDaysAgo(r.timestamp || r.takenAt),
        originalAudio: r.musicInfo ? (r.musicInfo.uses_original_audio || false) : false,
        audioName: r.musicInfo ? (r.musicInfo.song_name || "Unknown") : "Unknown",
        status: classifyReel(r, reelsRaw),
        engagementRate: engRate,
      };
    });

    // STEP 3: Get comments for top 3 reels
    var topReelUrls = reels
      .filter(function(r) { return r.url; })
      .slice(0, 3)
      .map(function(r) { return r.url; });

    var commentsData = [];
    if (topReelUrls.length > 0) {
      console.log("Fetching comments for top reels...");
      commentsData = await runApifyActor(COMMENTS_ACTOR, {
        directUrls: topReelUrls,
        includeNestedComments: false,
        resultsLimit: 20
      }, 60000).catch(function(e) {
        console.log("Comments scraper failed:", e.message);
        return [];
      });
    }

    // STEP 4: Process profile data
    var profileData = profileRaw && profileRaw[0] ? profileRaw[0] : {};
    var profileSummary = {
      followers: fmt(profileData.followersCount || profileData.followers || 0),
      following: fmt(profileData.followingCount || profileData.following || 0),
      totalPosts: profileData.postsCount || profileData.mediaCount || 0,
      bio: (profileData.biography || profileData.bio || "").slice(0, 150),
      isVerified: profileData.verified || profileData.isVerified || false,
      category: profileData.businessCategoryName || profileData.category || "Unknown",
    };

    // STEP 5: Process comments
    var commentsSummary = {
      total: commentsData.length,
      samples: commentsData.slice(0, 15).map(function(c) {
        return (c.text || c.comment || "").slice(0, 100);
      }),
      recurring_themes: extractThemes(commentsData),
    };

    function extractThemes(comments) {
      var text = comments.map(function(c) { return c.text || c.comment || ""; }).join(" ").toLowerCase();
      var themes = [];
      if (text.includes("price") || text.includes("cost") || text.includes("kitna")) themes.push("Price inquiries");
      if (text.includes("where") || text.includes("kahan") || text.includes("link")) themes.push("Location/Link requests");
      if (text.includes("how") || text.includes("kaise") || text.includes("tutorial")) themes.push("How-to questions");
      if (text.includes("amazing") || text.includes("love") || text.includes("best")) themes.push("Positive appreciation");
      if (text.includes("more") || text.includes("aur") || text.includes("next")) themes.push("Requesting more content");
      return themes;
    }

    // STEP 6: Build complete data summary
    var avgViews = Math.round(reels.reduce(function(s, r) { return s + r.views; }, 0) / reels.length);
    var avgEng = (reels.reduce(function(s, r) { return s + parseFloat(r.engagementRate); }, 0) / reels.length).toFixed(2);
    var score = accountScore(reels);
    var viralCount = reels.filter(function(r) { return r.status === "viral"; }).length;
    var flopCount = reels.filter(function(r) { return r.status === "flop"; }).length;

    var fullSummary = {
      username: username,
      profile: profileSummary,
      reels_metrics: {
        avgViews: avgViews,
        avgEngagement: avgEng + "%",
        viralCount: viralCount,
        flopCount: flopCount,
        avgDuration: Math.round(reels.reduce(function(s, r) { return s + r.duration; }, 0) / reels.length),
        score: score,
      },
      audience_intelligence: commentsSummary,
    };

    // STEP 7: Build ARIA prompt
    var userPrompt = "Teen layer ka real data hai @" + username + " ka. Ultra-deep expert analysis de.\n\n" +
      "LAYER 1 — PROFILE DATA:\n" + JSON.stringify(profileSummary) + "\n\n" +
      "LAYER 2 — REELS DATA (real numbers):\n" + JSON.stringify(reels) + "\n\n" +
      "LAYER 3 — AUDIENCE INTELLIGENCE (comments):\n" + JSON.stringify(commentsSummary) + "\n\n" +
      "COMPLETE SUMMARY:\n" + JSON.stringify(fullSummary) + "\n\n" +
      "Ab teen layer cross-reference karke analyze kar:\n\n" +
      "1. Reels mein kya pattern hai — viral vs flop mein exact differences\n" +
      "2. Comments kya bol rahe hain — audience kya chahti hai vs creator kya de raha hai\n" +
      "3. Profile promise vs content delivery — mismatch hai?\n" +
      "4. THE ONE THING — ek root cause jo sab fix kare\n\n" +
      "Ye exact JSON return kar:\n" +
      "{\n" +
      "  \"account_health\": \"Healthy or Average or Struggling\",\n" +
      "  \"verdict_line\": \"1 line honest sharp Hinglish max 12 words\",\n" +
      "  \"growth_score\": 0,\n" +
      "  \"profile_analysis\": \"Profile strengths aur weaknesses — 2-3 lines\",\n" +
      "  \"audience_insight\": \"Comments se kya pata chala audience ke baare mein — 2-3 lines specific\",\n" +
      "  \"reels_analysis\": [\n" +
      "    {\n" +
      "      \"number\": 1,\n" +
      "      \"algorithm_read\": \"Instagram ne is reel ko kaise read kiya — 1 line\",\n" +
      "      \"status_reason\": \"Kyun viral/flop/average — data backed 2 lines\"\n" +
      "    }\n" +
      "  ],\n" +
      "  \"viral_pattern\": \"Viral reels mein EXACTLY kya common tha — 3-4 lines specific\",\n" +
      "  \"flop_pattern\": \"Flop reels mein EXACTLY kya common tha — 3-4 lines\",\n" +
      "  \"audience_gap\": \"Jo audience maang rahi hai vs jo creator de raha hai — gap analysis\",\n" +
      "  \"the_one_thing\": \"Ek sabse badi insight — 2-3 lines powerful\",\n" +
      "  \"top_3_mistakes\": [\n" +
      "    {\n" +
      "      \"mistake\": \"Specific galti\",\n" +
      "      \"why_it_hurts\": \"Algorithm pe impact\",\n" +
      "      \"exact_fix\": \"Step by step fix\"\n" +
      "    }\n" +
      "  ],\n" +
      "  \"next_reel_blueprint\": {\n" +
      "    \"topic\": \"Exact topic — audience intelligence se backed\",\n" +
      "    \"hook_line\": \"Pehle 0.3 second mein exactly ye bol\",\n" +
      "    \"hook_visual\": \"Screen pe pehle 2 second mein kya dikhe\",\n" +
      "    \"duration\": \"Exact seconds — data se\",\n" +
      "    \"audio_strategy\": \"Original ya trending — kyun\",\n" +
      "    \"caption_line_1\": \"Caption ki pehli line exactly\",\n" +
      "    \"hashtag_count\": \"Kitne hashtags — kyun\",\n" +
      "    \"post_day_time\": \"Exact din aur time\",\n" +
      "    \"comment_hook\": \"Caption mein kya daalo jo comments trigger kare\",\n" +
      "    \"viral_trigger\": \"Kya cheez share karwayegi\",\n" +
      "    \"expected_result\": \"Realistic expectation\"\n" +
      "  },\n" +
      "  \"thirty_day_plan\": [\n" +
      "    {\n" +
      "      \"week\": \"Week 1\",\n" +
      "      \"goal\": \"Specific measurable goal\",\n" +
      "      \"daily_action\": \"Exactly kya karna hai har din\",\n" +
      "      \"success_metric\": \"Kaise pata chalega week successful raha\"\n" +
      "    }\n" +
      "  ],\n" +
      "  \"expert_verdict\": \"3 paragraphs. Pehla: Teen layer analysis se real picture. Doosra: Sabse bada opportunity jo ye creator miss kar raha hai. Teesra: 30-day honest prediction. Hinglish. Seedha. No sugarcoating.\"\n" +
      "}";

    // STEP 8: Groq AI
    var groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + GROQ_KEY,
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        max_tokens: 4000,
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
    var jsonStart = clean.indexOf("{");
    var jsonEnd = clean.lastIndexOf("}");
    if (jsonStart !== -1 && jsonEnd !== -1) clean = clean.slice(jsonStart, jsonEnd + 1);

    var ai = JSON.parse(clean);

    res.json({
      reels: reels,
      ai: ai,
      username: username,
      score: score,
      profile: profileSummary,
      comments: commentsSummary,
    });

  } catch (err) {
    console.error("Error:", err.message);
    res.status(500).json({ error: err.message || "Server error" });
  }
});

var PORT = process.env.PORT || 3000;
app.listen(PORT, function() {
  console.log("InstaGrow AI running on port " + PORT);
});

