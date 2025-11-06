import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import fs from "fs";
import path from "path";
import cookieParser from "cookie-parser";

const app = express();
const server = createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

const bansFile = path.join("./bans.json");
const bannedWordsFile = path.join("./bannedwords.json");
const messagesFile = path.join("./chat.json");

// Middleware
app.use(express.static("public"));
app.use(express.json());
app.use(cookieParser());

// Ensure files exist
if (!fs.existsSync(bansFile)) fs.writeFileSync(bansFile, "[]");
if (!fs.existsSync(bannedWordsFile)) fs.writeFileSync(bannedWordsFile, "[]");
if (!fs.existsSync(messagesFile)) fs.writeFileSync(messagesFile, "[]");

// Load files
let bans = JSON.parse(fs.readFileSync(bansFile));
let bannedWords = JSON.parse(fs.readFileSync(bannedWordsFile));
let messages = JSON.parse(fs.readFileSync(messagesFile));

// Cookie middleware
app.use((req, res, next) => {
  if (!req.cookies.userId) {
    res.cookie("userId", Math.random().toString(36).substring(2, 10), { maxAge: 31536000000 }); // 1 year
  }
  next();
});

// Admin routes
const ADMIN_PASSWORD = "yourpassword"; // Change this

app.get("/admin.html", (req, res) => res.sendFile(path.join("./public/admin.html")));

app.get("/bans.json", (req, res) => res.json(bans));

app.post("/unban/:index", (req, res) => {
  const password = req.body.password;
  if (password !== ADMIN_PASSWORD) return res.status(403).send("Wrong password");
  const index = parseInt(req.params.index);
  if (!isNaN(index)) {
    bans.splice(index, 1);
    fs.writeFileSync(bansFile, JSON.stringify(bans, null, 2));
    return res.send("Unbanned");
  }
  res.status(400).send("Invalid index");
});

// Socket.IO
io.on("connection", (socket) => {
  const cookieId = socket.handshake.headers.cookie
    ?.split("; ")
    .find(c => c.startsWith("userId="))
    ?.split("=")[1] || Math.random().toString(36).substring(2, 10);

  // Send chat history
  socket.emit("chatHistory", messages);

  socket.on("chatMessage", (msg) => {
    if (!msg.user || !msg.text) return;

    // Reload banned words and bans each message
    bannedWords = JSON.parse(fs.readFileSync(bannedWordsFile));
    bans = JSON.parse(fs.readFileSync(bansFile));

    // Check if user is banned
    if (bans.find(b => b.cookie === cookieId || b.username === msg.user)) return;

    // Check for bad words
    const found = bannedWords.find(w => msg.text.toLowerCase().includes(w.toLowerCase()));
    if (found) {
      // Ban user
      bans.push({ username: msg.user, cookie: cookieId, reason: `Used banned word: ${found}` });
      fs.writeFileSync(bansFile, JSON.stringify(bans, null, 2));
      return; // Do not broadcast message
    }

    const messageData = {
      user: msg.user,
      text: msg.text,
      time: new Date().toLocaleTimeString()
    };

    messages.push(messageData);
    messages = messages.slice(-100); // keep last 100
    fs.writeFileSync(messagesFile, JSON.stringify(messages, null, 2));

    io.emit("chatMessage", messageData);
  });
});

server.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
