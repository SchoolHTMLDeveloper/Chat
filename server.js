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

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

// Paths
const BANNED_WORDS_FILE = path.join(__dirname, "bannedwords.json");
const BANS_FILE = path.join(__dirname, "ban.json");
const MESSAGES_FILE = path.join(__dirname, "chat-history.json");

// Load banned words
let bannedWords = [];
if (fs.existsSync(BANNED_WORDS_FILE)) {
  bannedWords = JSON.parse(fs.readFileSync(BANNED_WORDS_FILE, "utf-8"));
}

// Load bans
let bans = [];
if (fs.existsSync(BANS_FILE)) {
  bans = JSON.parse(fs.readFileSync(BANS_FILE, "utf-8"));
}
const saveBans = () => fs.writeFileSync(BANS_FILE, JSON.stringify(bans, null, 2));

// Load messages
let messages = [];
if (fs.existsSync(MESSAGES_FILE)) {
  messages = JSON.parse(fs.readFileSync(MESSAGES_FILE, "utf-8"));
}
const saveMessages = () => fs.writeFileSync(MESSAGES_FILE, JSON.stringify(messages, null, 2));

// Middleware
app.use(express.json());
app.use(cookieParser());
app.use(express.static("public"));

// Block banned users
app.use((req, res, next) => {
  const cookieId = req.cookies?.userid;
  const banned = bans.find(b => b.cookie === cookieId);
  if (banned) return res.status(403).send(`You are banned: ${banned.reason}`);
  next();
});

// Socket.io
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

    // Send only last 100 messages to avoid duplicates
    const lastMessages = messages.slice(-100);
    socket.emit("chat history", lastMessages);

    console.log(`🟢 New user connected: ${username} (${userId})`);
  });

  // Handle incoming chat messages
  socket.on("chat message", (msg) => {
    if (!username || !userId) return;

    // Ignore messages from banned users
    if (bans.find(b => b.cookie === userId)) {
      socket.emit("bannedNotice", { text: "You are banned." });
      return;
    }

    const lowerMsg = msg.toLowerCase();

    // AutoMod banned words
    const foundWord = bannedWords.find(w => lowerMsg.includes(w.toLowerCase()));
    if (foundWord) {
      if (!bans.find(b => b.cookie === userId)) {
        const reason = `Used banned word "${foundWord}"`;

        bans.push({ username, cookie: userId, reason, time: Date.now() });
        saveBans();

        const sysMsg = { username: "AutoMod", message: `${username} has been banned for ${reason}`, system: true };
        io.emit("chat message", sysMsg);

        messages.push(sysMsg);
        messages = messages.slice(-100);
        saveMessages();
      }
      socket.disconnect();
      return;
    }

    // Normal message
    const msgData = { username, userId, message: msg };
    messages.push(msgData);
    messages = messages.slice(-100);
    saveMessages();

    io.emit("chat message", msgData);
  });

  socket.on("disconnect", () => {
    console.log(`🔴 ${username || "Unknown"} disconnected`);
  });
});

//
// ---------- Admin Routes ----------
//

// Serve admin page
app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "public/admin.html"));
});

// Return JSON list of bans
app.get("/api/bans", (req, res) => {
  res.json(bans);
});

// Manual ban: only ID + reason required, username fetched automatically
app.post("/admin/ban", (req, res) => {
  const { id, reason, password } = req.body;
  if (password !== ADMIN_PASSWORD) return res.status(403).send("Invalid password");

  // Avoid duplicate ban
  if (bans.find(b => b.cookie === id)) return res.send("User already banned.");

  // Find username from chat history
  let userNameToUse = "Unknown";
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].userId === id) {
      userNameToUse = messages[i].username;
      break;
    }
  }

  bans.push({ username: userNameToUse, cookie: id, reason, time: Date.now() });
  saveBans();

  const sysMsg = { username: "AutoMod", message: `${userNameToUse} has been manually banned for ${reason}`, system: true };
  io.emit("chat message", sysMsg);

  messages.push(sysMsg);
  messages = messages.slice(-100);
  saveMessages();

  res.send(`${userNameToUse} (${id}) banned for ${reason}`);
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

// Serve chat history JSON (optional, for debugging)
app.get("/chat-history.json", (req, res) => {
  res.json(messages);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
