import express from "express";
import http from "http";
import { Server } from "socket.io";
import fs from "fs";
import cookieParser from "cookie-parser";
import { randomUUID } from "crypto";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD; // 🔒 Set in Railway

const BANNED_WORDS_FILE = path.join(__dirname, "bannedwords.json");
const BANS_FILE = path.join(__dirname, "ban.json");

// Load banned words
let bannedWords = [];
if (fs.existsSync(BANNED_WORDS_FILE)) {
  bannedWords = JSON.parse(fs.readFileSync(BANNED_WORDS_FILE, "utf-8"));
}

// Load existing bans
let bans = [];
if (fs.existsSync(BANS_FILE)) {
  bans = JSON.parse(fs.readFileSync(BANS_FILE, "utf-8"));
}

// Helper to save bans
const saveBans = () => fs.writeFileSync(BANS_FILE, JSON.stringify(bans, null, 2));

app.use(express.json());
app.use(cookieParser());
app.use(express.static("public"));

// Middleware to block banned users
app.use((req, res, next) => {
  const cookieId = req.cookies?.userid;
  const banned = bans.find(b => b.cookie === cookieId);
  if (banned) return res.status(403).send(`You are banned: ${banned.reason}`);
  next();
});

io.on("connection", (socket) => {
  let username;
  let userId;

  // Set username and persistent ID
  socket.on("set username", (data) => {
    username = data.username || "Anonymous";

    if (!data.cookieId) {
      userId = randomUUID();
      socket.emit("setCookie", userId);
    } else {
      userId = data.cookieId;
    }

    socket.username = username;
    socket.userId = userId;

    socket.emit("userInfo", { username, userId });
    console.log(`🟢 New user connected: ${username} (${userId})`);
  });

  // Handle incoming chat messages
  socket.on("chat message", (msg) => {
    if (!username || !userId) return;

    const lowerMsg = msg.toLowerCase();

    // Check if banned
    if (bans.find(b => b.cookie === userId || b.username === username)) {
      socket.emit("bannedNotice", { text: "You are banned." });
      return;
    }

    // Check banned words
    const foundWord = bannedWords.find(w => lowerMsg.includes(w.toLowerCase()));
    if (foundWord) {
      const reason = `Used banned word "${foundWord}"`;

      bans.push({ username, cookie: userId, reason, time: Date.now() });
      saveBans();

      io.emit("chat message", {
        username: "AutoMod",
        message: `${username} has been banned for ${reason}`,
        system: true
      });

      socket.disconnect();
      return;
    }

    // Broadcast normal message
    io.emit("chat message", {
      username,
      userId,
      message: msg
    });
  });

  socket.on("disconnect", () => {
    console.log(`🔴 ${username || "Unknown"} disconnected`);
  });
});

//
// ---------- Admin Routes ----------
//

// Serve admin page
app.get("/admin/bans", (req, res) => {
  res.sendFile(path.join(__dirname, "public/admin.html"));
});

// Return JSON list of bans
app.get("/api/bans", (req, res) => {
  res.json(bans);
});

// Manual ban
app.post("/admin/ban", (req, res) => {
  const { id, reason, password } = req.body;
  if (password !== ADMIN_PASSWORD) return res.status(403).send("Invalid password");

  bans.push({ userId: id, cookie: id, reason, time: Date.now() });
  saveBans();

  io.emit("chat message", {
    username: "AutoMod",
    message: `User with ID ${id} has been manually banned for ${reason}`,
    system: true
  });

  res.send(`User ${id} banned for ${reason}`);
});

// Unban
app.post("/admin/unban", (req, res) => {
  const { id, password } = req.body;
  if (password !== ADMIN_PASSWORD) return res.status(403).send("Invalid password");

  const before = bans.length;
  bans = bans.filter(b => b.cookie !== id && b.userId !== id);
  saveBans();

  if (bans.length === before) return res.send("User not found.");
  res.send(`User ${id} unbanned.`);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
