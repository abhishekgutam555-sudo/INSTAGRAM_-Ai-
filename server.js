const express = require("express");
const path = require("path");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const APIFY_TOKEN = process.env.APIFY_TOKEN;
const GROQ_KEY = process.env.GROQ_KEY;

// ── Actor IDs ─────────────────────────────────────────────────
var PROFILE_ACTOR  = "apify~instagram-profile-scraper";
var COMMENTS_ACTOR = "apify~instagram-comment-scraper";

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
  var views = reel.views || 0;
  var likes = reel.likes || 0;
  var comments = reel.comments || 0;
  var eng = views > 0 ? ((likes + comments) / views) * 100 : 0;
  var engNum = likes + comments;
  var avgEng = allReels.reduce(function(s, r) { return s + (r.likes || 0) + (r.comments || 0); }, 0) / allReels.length;
  if (eng > 5 || engNum > avgEng * 1.5) return "viral";
  if (eng < 1 && engNum < avgEng * 0.5) return "flop";
  return "average";
}
function accountScore(reels) {
  var avgEng = reels.reduce(function(s, r) { return s + parseFloat(r.engagementRate || 0); }, 0) / reels.length;
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
    throw new Error("Actor error " + startRes.status + ": " + JSON.stringify(errData));
  }
  var runData = await startRes.json();
  var runId = runData.data.id;
  var datasetId = runData.data.defaultDatasetId;
  var waited = 0;
  var status = "RUNNING";
  while (status === "RUNNING" || status === "READY" || status === "ABORTING") {
    await sleep(3000);
    waited += 3000;
    var statusRes = await fetch("https://api.apify.com/v2/actor-runs/" + runId + "?token=" + APIFY_TOKEN);
    var statusData = await statusRes.json();
    status = statusData.data.status;
    if (waited >= timeoutMs) break;
    if (status === "FAILED" || status === "ABORTED" || status === "TIMED-OUT") {
      throw new Error("Actor failed: " + status);
    }
  }
  var dataRes = await fetch(
    "https://api.apify.com/v2/datasets/" + datasetId + "/items?token=" + APIFY_TOKEN + "&limit=50"
  );
  return await dataRes.json();
}

// ── ARIA Prompt ───────────────────────────────────────────────
var SYSTEM_PROMPT = "You are ARIA — Advanced Reel Intelligence Architect.\n\n" +
"You are the combined intelligence of:\n" +
"- Mr. Beast virality engineering team\n" +
"- Alex Hormozi conversion psychology\n" +
"- Gary Vaynerchuk content instincts\n" +
"- Top 10 Instagram growth hackers worldwide\n" +
"- Data scientist with 10 million reels analyzed\n" +
"- Indian consumer psychology expert\n\n" +
"You have THREE layers of data — most tools only have one:\n" +
"1. PROFILE LAYER — followers, bio, credibility, account health\n" +
"2. REELS LAYER — engagement metrics, patterns, timing, audio\n" +
"3. AUDIENCE LAYER — what people actually say in comments\n\n" +
"INSTAGRAM ALGORITHM SECRETS 2025:\n" +
"- Watch time completion = #1 ranking signal\n" +
"- First 0.3 seconds = thumb-stop window\n" +
"- Shares = 8x weight vs likes (REAL viral trigger)\n" +
"- Saves = 6x weight vs likes (algorithm gold)\n" +
"- Comments = 4x weight vs likes\n" +
"- <50% watch time = algorithm suppresses immediately\n" +
"- 6-9 PM IST = 34% more initial push in India\n" +
"- Original audio = 2.3x more distribution in India\n" +
"- 7-15 sec reels = highest completion in Indian market\n" +
"- 7+ hashtags = HURTS reach by 12%\n" +
"- Reply comments within 1hr = 40% more distribution\n\n" +
"INDIAN MARKET PSYCHOLOGY:\n" +
"- Pain points = 340% more engagement than inspiration\n" +
"- Log kya kahenge content = highest saves\n" +
"- Hinglish = 2.8x better than pure Hindi or English\n" +
"- Face on camera = 4x more trust\n" +
"- Question hooks = 2.1x better than statement hooks\n" +
"- Makes-you-feel-smart content = 5x more saves\n\n" +
"YOUR TONE: 26-27 saal Mumbai banda. Sharp. Hinglish. Seedha. Like expert dost.\n" +
"NEVER: Great job, Keep it up, Statistics indicate, It is recommended\n" +
"ALWAYS: Specific reel numbers, exact data references, algorithm connection\n\n" +
"CRITICAL: Return ONLY raw valid JSON. No markdown. No backtick. Start with {";

// ── Main API ──────────────────────────────────────────────────
app.post("/api/analyze", async function(req, res) {
  var username = req.body.username;
  if (!username) return res.status(400).json({ error: "Username required" });

  try {
    // STEP 1: Profile scraper (gets profile + latest posts including reels)
    console.log("Fetching profile for @" + username);
    var profileRaw = await runApifyActor(PROFILE_ACTOR, {
      usernames: [username],
      includeAboutSection: true,
    }, 90000);

    if (!profileRaw || !profileRaw.length) {
      throw new Error("Profile nahi mila. Username sahi hai? Account public hai?");
    }

    var profile = profileRaw[0];

    // Extract reels/posts from profile
    var allPosts = profile.latestPosts || profile.posts || profile.media || [];

    // Filter for videos/reels preferably
    var reelPosts = allPosts.filter(function(p) {
      return p.type === "Video" || p.type === "video" || p.isVideo || p.mediaType === "VIDEO";
    });

    // If no videos found, use all posts
    if (reelPosts.length === 0) reelPosts = allPosts;

    // Take latest 10
    reelPosts = reelPosts.slice(0, 10);

    if (reelPosts.length === 0) {
      throw new Error("Koi post/reel nahi mila. Account pe content hai?");
    }

    // Process reels
    var reels = reelPosts.map(function(r, i) {
      var views = r.videoViewCount || r.viewsCount || r.playCount || r.videoPlayCount || 0;
      var likes = r.likesCount || r.likeCount || r.likes || 0;
      var comments = r.commentsCount || r.commentCount || r.comments || 0;
      var engRate = views > 0
        ? ((likes + comments) / views * 100).toFixed(2)
        : likes + comments > 0 ? ((likes + comments) / Math.max(profile.followersCount || 1000, 1) * 100).toFixed(2) : "0";
      var reel = {
        number: i + 1,
        url: r.url || r.shortCode ? "https://www.instagram.com/p/" + (r.shortCode || "") + "/" : "",
        caption: (r.caption || r.text || r.alt || "").slice(0, 120),
        hashtags: (r.hashtags || r.tags || []).slice(0, 5),
        views: views,
        viewsFmt: fmt(views),
        likes: likes,
        likesFmt: fmt(likes),
        comments: comments,
        commentsFmt: fmt(comments),
        duration: Math.round(r.videoDuration || r.duration || 0),
        daysAgo: getDaysAgo(r.timestamp || r.takenAt || r.taken_at),
        originalAudio: r.musicInfo ? (r.musicInfo.uses_original_audio || false) : false,
        audioName: r.musicInfo ? (r.musicInfo.song_name || "Original") : "Unknown",
        type: r.type || r.mediaType || "Unknown",
        engagementRate: engRate,
      };
      return reel;
    });

    // Classify reels
    reels = reels.map(function(r) {
      r.status = classifyReel(r, reels);
      return r;
    });

    // Profile summary
    var profileSummary = {
      username: username,
      followers: fmt(profile.followersCount || profile.followers || 0),
      following: fmt(profile.followingCount || profile.following || 0),
      totalPosts: profile.postsCount || profile.mediaCount || allPosts.length,
      bio: (profile.biography || profile.bio || "").slice(0, 150),
      isVerified: profile.verified || profile.isVerified || false,
      category: profile.businessCategoryName || profile.category || "Not set",
      website: profile.website || profile.externalUrl || "None",
    };

    // STEP 2: Comments for top reels (parallel, non-blocking)
    var topReelUrls = reels
      .filter(function(r) { return r.url && r.url.length > 10; })
      .slice(0, 3)
      .map(function(r) { return r.url; });

    var commentsSummary = { total: 0, samples: [], recurring_themes: [] };

    if (topReelUrls.length > 0) {
      console.log("Fetching comments...");
      var commentsRaw = await runApifyActor(COMMENTS_ACTOR, {
        directUrls: topReelUrls,
        includeNestedComments: false,
        resultsLimit: 20,
      }, 60000).catch(function(e) {
        console.log("Comments failed (non-critical):", e.message);
        return [];
      });

      var themes = [];
      var allText = commentsRaw.map(function(c) { return (c.text || c.comment || ""); }).join(" ").toLowerCase();
      if (allText.includes("price") || allText.includes("cost") || allText.includes("kitna")) themes.push("Price inquiries");
      if (allText.includes("where") || allText.includes("kahan") || allText.includes("link")) themes.push("Location/Link requests");
      if (allText.includes("how") || allText.includes("kaise") || allText.includes("tutorial")) themes.push("Tutorial requests");
      if (allText.includes("love") || allText.includes("amazing") || allText.includes("best")) themes.push("Positive appreciation");
      if (allText.includes("more") || allText.includes("next") || allText.includes("aur")) themes.push("Requesting more content");

      commentsSummary = {
        total: commentsRaw.length,
        samples: commentsRaw.slice(0, 15).map(function(c) { return (c.text || c.comment || "").slice(0, 100); }),
        recurring_themes: themes,
      };
    }

    // Metrics
    var avgViews = Math.round(reels.reduce(function(s, r) { return s + r.views; }, 0) / reels.length);
    var avgEng = (reels.reduce(function(s, r) { return s + parseFloat(r.engagementRate); }, 0) / reels.length).toFixed(2);
    var score = accountScore(reels);
    var viralCount = reels.filter(function(r) { return r.status === "viral"; }).length;
    var flopCount = reels.filter(function(r) { return r.status === "flop"; }).length;

    // STEP 3: ARIA Prompt
    var userPrompt = "Teen layer ka real data hai @" + username + " ka. Ultra-deep expert analysis de.\n\n" +
      "LAYER 1 — PROFILE:\n" + JSON.stringify(profileSummary) + "\n\n" +
      "LAYER 2 — REELS (real numbers):\n" + JSON.stringify(reels) + "\n\n" +
      "LAYER 3 — AUDIENCE COMMENTS:\n" + JSON.stringify(commentsSummary) + "\n\n" +
      "METRICS SUMMARY:\n" + JSON.stringify({
        avgViews: avgViews, avgEngagement: avgEng + "%",
        viralCount: viralCount, flopCount: flopCount, score: score
      }) + "\n\n" +
      "Teen layer cross-reference karke analyze kar:\n" +
      "1. Reels patterns — viral vs flop mein exact differences\n" +
      "2. Comments intelligence — audience kya chahti hai vs creator kya de raha hai\n" +
      "3. Profile-content alignment — promise vs delivery\n" +
      "4. THE ONE THING — ek root cause\n\n" +
      "Return exact JSON:\n{\n" +
      "  \"account_health\": \"Healthy or Average or Struggling\",\n" +
      "  \"verdict_line\": \"1 line sharp Hinglish max 12 words\",\n" +
      "  \"growth_score\": 0,\n" +
      "  \"profile_analysis\": \"Profile ki strengths aur weaknesses 2-3 lines\",\n" +
      "  \"audience_insight\": \"Comments se kya pata chala 2-3 lines specific\",\n" +
      "  \"reels_analysis\": [{\"number\":1,\"algorithm_read\":\"1 line\",\"status_reason\":\"2 lines data backed\"}],\n" +
      "  \"viral_pattern\": \"Viral reels mein EXACTLY kya common 3-4 lines\",\n" +
      "  \"flop_pattern\": \"Flop reels mein EXACTLY kya common 3-4 lines\",\n" +
      "  \"audience_gap\": \"Jo audience maang rahi hai vs jo creator de raha hai\",\n" +
      "  \"the_one_thing\": \"Ek root cause 2-3 lines powerful\",\n" +
      "  \"top_3_mistakes\": [{\"mistake\":\"specific\",\"why_it_hurts\":\"algorithm impact\",\"exact_fix\":\"step by step\"}],\n" +
      "  \"next_reel_blueprint\": {\n" +
      "    \"topic\":\"exact topic audience intelligence se backed\",\n" +
      "    \"hook_line\":\"pehle 0.3 sec mein exactly ye bol word for word\",\n" +
      "    \"hook_visual\":\"screen pe pehle 2 sec mein kya dikhe\",\n" +
      "    \"duration\":\"exact seconds data se\",\n" +
      "    \"audio_strategy\":\"original ya trending kyun data se\",\n" +
      "    \"caption_line_1\":\"caption ki pehli line exactly\",\n" +
      "    \"hashtag_count\":\"kitne hashtags kyun\",\n" +
      "    \"post_day_time\":\"exact din aur time\",\n" +
      "    \"comment_hook\":\"caption mein kya daalo jo comments trigger kare\",\n" +
      "    \"viral_trigger\":\"kya cheez share karwayegi\",\n" +
      "    \"expected_result\":\"realistic expectation\"\n" +
      "  },\n" +
      "  \"thirty_day_plan\": [{\"week\":\"Week 1\",\"goal\":\"specific measurable goal\",\"daily_action\":\"exactly kya karna hai\",\"success_metric\":\"kaise pata chalega\"}],\n" +
      "  \"expert_verdict\": \"3 paragraphs. Pehla: Teen layer se real picture. Doosra: Biggest missed opportunity. Teesra: 30-day honest prediction. Hinglish. Seedha. No sugarcoating.\"\n}";

    // STEP 4: Groq
    var groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + GROQ_KEY },
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

    res.json({ reels: reels, ai: ai, username: username, score: score, profile: profileSummary, comments: commentsSummary });

  } catch (err) {
    console.error("Error:", err.message);
    res.status(500).json({ error: err.message || "Server error" });
  }
});

var PORT = process.env.PORT || 3000;
app.listen(PORT, function() { console.log("InstaGrow AI running on port " + PORT); });

