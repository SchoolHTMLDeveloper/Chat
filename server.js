import express from "express";
import fs from "fs";
import http from "http";
import { Server } from "socket.io";
import cookieParser from "cookie-parser";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123"; // change this!

app.use(express.json());
app.use(cookieParser());
app.use(express.static("public"));

let messages = [];
let bans = [];
let bannedWords = [];

// --------------------
// Safe JSON loader
// --------------------
function safeRead(file, fallback = []) {
  try {
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, "utf-8"));
    }
  } catch (e) {
    console.error(`Error reading ${file}:`, e);
  }
  return fallback;
}

// --------------------
// Load bans & banned words
// --------------------
bans = safeRead("bans.json");
bannedWords = safeRead("bannedwords.json");

// --------------------
// Admin routes
// --------------------
app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

app.get("/api/bans", (req, res) => res.json(bans));

app.post("/admin/unban", (req, res) => {
  const { id, password } = req.body;
  if (password !== ADMIN_PASSWORD) return res.status(403).send("Invalid password");

  const unbanned = bans.find(b => b.cookie === id);
  bans = bans.filter(b => b.cookie !== id);
  fs.writeFileSync("bans.json", JSON.stringify(bans, null, 2));

  const unbanMsg = {
    username: "AutoMod",
    message: `${unbanned?.username || "A user"} has been unbanned by an admin.`,
    system: true,
    type: "unban"
  };

  messages.push(unbanMsg);
  messages = messages.slice(-100);
  io.emit("chat message", unbanMsg);

  res.send("User unbanned");
});

// --------------------
// Socket.io
// --------------------
io.on("connection", (socket) => {
  const cookie = socket.handshake.headers.cookie || "";
  const idMatch = cookie.match(/uid=([^;]+)/);
  const id = idMatch ? idMatch[1] : socket.id;

  const bannedUser = bans.find(b => b.cookie === id);
  if (bannedUser) {
    socket.emit("banned", "You are banned.");
    socket.disconnect(true);
    return;
  }

  // Send last 100 messages in memory only
  socket.emit("init history", messages.slice(-100));

  socket.on("chat message", (msg) => {
    if (!msg || typeof msg !== "object") return;
    if (!msg.message || typeof msg.message !== "string") return;
    if (!msg.username || typeof msg.username !== "string") return;

    // Skip banned users
    if (bans.some(b => b.cookie === id)) return;

    const content = msg.message.trim().toLowerCase();

    // AutoMod: banned words
    if (bannedWords.some(w => content.includes(w.toLowerCase()))) {
      bans.push({ username: msg.username, reason: "Used banned word", cookie: id });
      fs.writeFileSync("bans.json", JSON.stringify(bans, null, 2));

      socket.emit("banned", "You were banned for using a banned word.");
      socket.disconnect(true);

      const banMsg = {
        username: "AutoMod",
        message: `${msg.username} was banned for using a banned word.`,
        system: true,
        type: "ban"
      };

      messages.push(banMsg);
      messages = messages.slice(-100);
      io.emit("chat message", banMsg);
      return;
    }

    // Normal chat
    messages.push(msg);
    messages = messages.slice(-100);
    io.emit("chat message", msg);
  });
});

server.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
