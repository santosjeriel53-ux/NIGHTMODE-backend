import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import jwt from "jsonwebtoken";

const app = express();
const PORT = process.env.PORT || 3000;

const {
 GEMINI_API_KEY,
 YOUTUBE_API_KEY,
 NIGHTMODE_ACCESS_CODE,
 JWT_SECRET,
 ALLOWED_ORIGINS
} = process.env;

const allowedOrigins = (ALLOWED_ORIGINS || "")
 .split(",")
 .map(origin => origin.trim())
 .filter(Boolean);

if (!GEMINI_API_KEY || !YOUTUBE_API_KEY ||
 !NIGHTMODE_ACCESS_CODE || !JWT_SECRET) {
 console.error("Missing required environment variables.");
 process.exit(1);
}

app.use(helmet());
app.use(express.json({ limit: "20kb" }));

app.use(cors({
 origin(origin, callback) {
 if (!origin) return callback(null, true);
 if (allowedOrigins.includes(origin)) {
 return callback(null, true);
 }
 return callback(new Error("Origin not allowed"));
 }
}));

app.use(rateLimit({
 windowMs: 60 * 1000,
 limit: 30,
 standardHeaders: "draft-8",
 legacyHeaders: false
}));

app.get("/", (_req, res) => {
 res.send("NIGHTMODE backend is running.");
});

app.get("/health", (_req, res) => {
 res.json({ status: "ok" });
});

app.post("/api/login", (req, res) => {
 const { code } = req.body || {};

 if (typeof code !== "string" ||
 code !== NIGHTMODE_ACCESS_CODE) {
 return res.status(401).json({
 error: "Incorrect access code."
 });
 }

 const token = jwt.sign(
 { app: "NIGHTMODE" },
 JWT_SECRET,
 { expiresIn: "12h" }
 );

 res.json({ token, expiresIn: "12h" });
});

function requireLogin(req, res, next) {
 const authorization = req.headers.authorization || "";
 const token = authorization.startsWith("Bearer ")
 ? authorization.slice(7)
 : "";

 try {
 req.user = jwt.verify(token, JWT_SECRET);
 next();
 } catch {
 res.status(401).json({
 error: "Please unlock NIGHTMODE again."
 });
 }
}

app.post("/api/ask", requireLogin, async (req, res) => {
 const { prompt } = req.body || {};

 if (typeof prompt !== "string" || !prompt.trim()) {
 return res.status(400).json({
 error: "Enter a question first."
 });
 }

 if (prompt.length > 8000) {
 return res.status(400).json({
 error: "Your question is too long."
 });
 }

 try {
 const response = await fetch(
 "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
 {
 method: "POST",
 headers: {
 "Content-Type": "application/json",
 "x-goog-api-key": GEMINI_API_KEY
 },
 body: JSON.stringify({
 contents: [{
 parts: [{ text: prompt.trim() }]
 }]
 })
 }
 );

 const data = await response.json();

 if (!response.ok) {
 console.error("Gemini API error:", data);
 return res.status(502).json({
 error: "Gemini could not answer right now."
 });
 }

 const answer = data.candidates?.[0]?.content?.parts
 ?.map(part => part.text || "")
 .join("")
 .trim();

 res.json({
 answer: answer || "No answer was returned."
 });
 } catch (error) {
 console.error("Gemini request failed:", error.message);
 res.status(502).json({
 error: "Could not connect to Gemini."
 });
 }
});

app.get("/api/search", requireLogin, async (req, res) => {
 const query = req.query.q;

 if (typeof query !== "string" || !query.trim()) {
 return res.status(400).json({
 error: "Enter something to search for."
 });
 }

 try {
 const url = new URL(
 "https://www.googleapis.com/youtube/v3/search"
 );

 url.search = new URLSearchParams({
 part: "snippet",
 type: "video",
 maxResults: "8",
 safeSearch: "moderate",
 q: query.trim(),
 key: YOUTUBE_API_KEY
 }).toString();

 const response = await fetch(url);
 const data = await response.json();

 if (!response.ok) {
 console.error("YouTube API error:", data);
 return res.status(502).json({
 error: "YouTube search failed."
 });
 }

 const videos = (data.items || []).map(item => ({
 videoId: item.id?.videoId,
 title: item.snippet?.title || "",
 channel: item.snippet?.channelTitle || "",
 thumbnail: item.snippet?.thumbnails?.medium?.url || ""
 })).filter(video => video.videoId);

 res.json({ videos });
 } catch (error) {
 console.error("YouTube request failed:", error.message);
 res.status(502).json({
 error: "Could not connect to YouTube."
 });
 }
});

app.listen(PORT, "0.0.0.0", () => {
 console.log(`NIGHTMODE backend listening on port ${PORT}`);
});
