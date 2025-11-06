import express from "express";
import http from "http";
import { Server } from "socket.io";
import fs from "fs";
import cookieParser from "cookie-parser";
import { randomUUID } from "crypto";

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const ADMIN_PASSWORD = "changeme"; // 🔒 Change this password

app.use(express.json());
app.use(cookieParser());
app.use(express.static("public"));

const BAN_FILE = "ban.json";
const BANNED_WORDS_FILE = "bannedwords.json";

let bans = [];
let bannedWords = [];

// Load existing data
if (fs.existsSync(BAN_FILE)) bans = JSON.parse(fs.readFileSync(BAN_FILE));
if (fs.existsSync(BANNED_WORDS_FILE)) bannedWords = JSON.parse(fs.readFileSync(BANNED_WORDS_FILE));

// Save bans to file
const saveBans = () => fs.writeFileSync(BAN_FILE, JSON.stringify(bans, null, 2));

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

  // Assign persistent ID via cookies
  socket.on("set username", (data) => {
    username = data.username || "Anonymous";

    // Assign or reuse cookie ID
    if (!data.cookieId) {
      userId = randomUUID();
      socket.emit("setCookie", userId);
    } else {
      userId = data.cookieId;
    }

    socket.userId = userId;
    socket.username = username;

    console.log(`🟢 ${username} connected (${userId})`);

    socket.emit("userInfo", { username, userId });
  });

  socket.on("chat message", (msg) => {
    if (!username) return;

    const lowerMsg = msg.toLowerCase();
    const foundBadWord = bannedWords.find(w => lowerMsg.includes(w));

    if (foundBadWord) {
      const reason = `Used banned word: "${foundBadWord}"`;

      // Add to ban list
      bans.push({ username, cookie: socket.userId, reason, time: Date.now() });
      saveBans();

      io.emit("chat message", {
        username: "AutoMod",
        message: `${username} has been banned for ${reason}`,
        system: true
      });

      socket.disconnect();
      return;
    }

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
// ---------- Admin Endpoints ----------
//

// View bans
app.get("/admin/bans", (req, res) => {
  res.sendFile(process.cwd() + "/public/admin.html");
});

// Return list of bans (JSON)
app.get("/api/bans", (req, res) => {
  res.json(bans);
});

// Manual ban
app.post("/admin/ban", (req, res) => {
  const { id, reason, password } = req.body;
  if (password !== ADMIN_PASSWORD) return res.status(403).send("Invalid password");

  bans.push({ userId: id, reason, time: Date.now(), cookie: id });
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
