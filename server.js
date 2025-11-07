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
const ADMIN_PASSWORD = "admin123"; // change this!

app.use(express.json());
app.use(cookieParser());
app.use(express.static("public"));

let messages = [];
let bans = [];
let bannedWords = [];

function loadFiles() {
  if (fs.existsSync("chat-history.json")) messages = JSON.parse(fs.readFileSync("chat-history.json"));
  if (fs.existsSync("bans.json")) bans = JSON.parse(fs.readFileSync("bans.json"));
  if (fs.existsSync("bannedwords.json")) bannedWords = JSON.parse(fs.readFileSync("bannedwords.json"));
}
function saveMessages() {
  fs.writeFileSync("chat-history.json", JSON.stringify(messages, null, 2));
}
function saveBans() {
  fs.writeFileSync("bans.json", JSON.stringify(bans, null, 2));
}
loadFiles();

// ✅ Serve admin
app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

// ✅ API for bans
app.get("/api/bans", (req, res) => {
  res.json(bans);
});

// ✅ Admin unban route
app.post("/admin/unban", (req, res) => {
  const { id, password } = req.body;
  if (password !== ADMIN_PASSWORD) return res.status(403).send("Invalid password");
  bans = bans.filter(b => b.cookie !== id);
  saveBans();

  const unbanMsg = {
    username: "AutoMod",
    message: "A user has been unbanned by an admin.",
    system: true
  };
  messages.push(unbanMsg);
  messages = messages.slice(-100);
  saveMessages();
  io.emit("chat message", unbanMsg);

  res.send("User unbanned");
});

// ✅ Send chat history file
app.get("/chat-history.json", (req, res) => {
  res.sendFile(path.join(__dirname, "chat-history.json"));
});

// ✅ Socket handling
io.on("connection", (socket) => {
  const cookie = socket.handshake.headers.cookie || "";
  const id = cookie.split("uid=")[1] || socket.id;

  if (bans.some(b => b.cookie === id)) {
    socket.emit("banned", "You are banned.");
    socket.disconnect(true);
    return;
  }

  socket.on("chat message", (msg) => {
    if (bans.some(b => b.cookie === id)) return;

    // Check for banned words
    if (bannedWords.some(w => msg.message.toLowerCase().includes(w.toLowerCase()))) {
      bans.push({ username: msg.username, reason: "Banned word", cookie: id });
      saveBans();
      socket.emit("banned", "You were banned for saying a banned word.");
      socket.disconnect(true);

      const banMsg = {
        username: "AutoMod",
        message: `${msg.username} was banned for saying a banned word.`,
        system: true
      };
      messages.push(banMsg);
      messages = messages.slice(-100);
      saveMessages();
      io.emit("chat message", banMsg);
      return;
    }

    messages.push(msg);
    messages = messages.slice(-100);
    saveMessages();
    io.emit("chat message", msg);
  });
});

server.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
