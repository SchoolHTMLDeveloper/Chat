import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import fs from "fs";
import path from "path";
import cookieParser from "cookie-parser";

const app = express();
const server = createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const PORT = process.env.PORT || 3000;
const bansFile = path.join(__dirname, "bans.json");
const bannedWordsFile = path.join(__dirname, "bannedwords.json");
const messagesFile = path.join(__dirname, "chat.json");

// Admin password (use env var in production)
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "yourpassword";

// ensure files
if (!fs.existsSync(bansFile)) fs.writeFileSync(bansFile, "[]");
if (!fs.existsSync(bannedWordsFile)) fs.writeFileSync(bannedWordsFile, "[]");
if (!fs.existsSync(messagesFile)) fs.writeFileSync(messagesFile, "[]");

// load initial data
let bans = JSON.parse(fs.readFileSync(bansFile));
let bannedWords = JSON.parse(fs.readFileSync(bannedWordsFile));
let messages = JSON.parse(fs.readFileSync(messagesFile));

app.use(express.json());
app.use(cookieParser());
// serve public folder
app.use(express.static(path.join(__dirname, "public")));

// cookie middleware for HTTP requests (so if client loads page from this server, cookie is set)
app.use((req, res, next) => {
  if (!req.cookies.userId) {
    res.cookie("userId", Math.random().toString(36).substring(2, 10), { maxAge: 31536000000 });
  }
  next();
});

/* ---------- Admin routes ---------- */

// serve admin page (static file in public)
app.get("/admin.html", (req, res) => res.sendFile(path.join(__dirname, "public", "admin.html")));

// return bans for admin UI
app.get("/bans.json", (req, res) => {
  bans = JSON.parse(fs.readFileSync(bansFile));
  res.json(bans);
});

// unban (index)
app.post("/unban/:index", (req, res) => {
  const { password } = req.body;
  if (password !== ADMIN_PASSWORD) return res.status(403).send("Wrong password");
  const index = parseInt(req.params.index);
  if (isNaN(index) || index < 0 || index >= bans.length) return res.status(400).send("Invalid index");
  bans.splice(index, 1);
  fs.writeFileSync(bansFile, JSON.stringify(bans, null, 2));
  return res.send("Unbanned");
});

// ban by userid (admin)
app.post("/ban/userid", (req, res) => {
  const { password, userid, reason } = req.body;
  if (password !== ADMIN_PASSWORD) return res.status(403).send("Wrong password");
  if (!userid) return res.status(400).send("userid required");
  bans = JSON.parse(fs.readFileSync(bansFile));
  // avoid duplicate
  if (!bans.find(b => b.cookie === userid)) {
    bans.push({ username: "(by-admin)", cookie: userid, reason: reason || "Banned by admin" });
    fs.writeFileSync(bansFile, JSON.stringify(bans, null, 2));
    // send system message to all clients
    const systemMsg = { user: "AutoMod", text: `User with id ${userid} has been banned by admin${reason ? `: ${reason}` : ""}`, time: new Date().toLocaleTimeString(), system: true };
    messages.push(systemMsg);
    messages = messages.slice(-100);
    fs.writeFileSync(messagesFile, JSON.stringify(messages, null, 2));
    io.emit("chatMessage", systemMsg);
  }
  res.send("Banned");
});

/* ---------- Socket.IO Chat ---------- */

// helper to read cookie from handshake safely
function getCookieIdFromHandshake(socket) {
  try {
    const cookieHeader = socket.handshake.headers.cookie || "";
    const cookiePairs = cookieHeader.split(";").map(c => c.trim());
    const pair = cookiePairs.find(c => c.startsWith("userId="));
    if (pair) return pair.split("=")[1];
  } catch (e) {}
  // fallback to socket id truncated
  return "skt_" + socket.id.slice(0, 8);
}

io.on("connection", (socket) => {
  console.log("🟢 User connected:", socket.id);

  // determine user's cookie id
  const cookieId = getCookieIdFromHandshake(socket);

  // send chat history
  messages = JSON.parse(fs.readFileSync(messagesFile));
  socket.emit("chatHistory", messages);

  // handle incoming message
  socket.on("chatMessage", (msg) => {
    try {
      // refresh banned lists on each message
      bannedWords = JSON.parse(fs.readFileSync(bannedWordsFile));
      bans = JSON.parse(fs.readFileSync(bansFile));
    } catch (e) {
      console.error("Error reading ban files:", e);
    }

    // validate
    if (!msg || !msg.user || !msg.text) return;

    // check if user is banned
    const alreadyBanned = bans.find(b => b.cookie === cookieId || b.username === msg.user);
    if (alreadyBanned) {
      // optionally notify the one who tried to send
      socket.emit("bannedNotice", { text: "You are banned and cannot send messages.", reason: alreadyBanned.reason });
      return;
    }

    // check for banned words (case-insensitive)
    const foundWord = bannedWords.find(w => w && w.length && msg.text.toLowerCase().includes(w.toLowerCase()));
    if (foundWord) {
      // add to bans (persist)
      bans.push({ username: msg.user, cookie: cookieId, reason: `Used banned word: ${foundWord}` });
      fs.writeFileSync(bansFile, JSON.stringify(bans, null, 2));

      // broadcast system message about ban
      const systemMsg = {
        user: "AutoMod",
        text: `${msg.user} has been banned for using "${foundWord}"`,
        time: new Date().toLocaleTimeString(),
        system: true
      };
      messages.push(systemMsg);
      messages = messages.slice(-100);
      fs.writeFileSync(messagesFile, JSON.stringify(messages, null, 2));
      io.emit("chatMessage", systemMsg);

      // notify banned socket
      socket.emit("bannedNotice", { text: `You have been banned for using "${foundWord}"`, reason: foundWord });

      return; // do not broadcast the offending message
    }

    // build message payload that includes userid so admin can act on it
    const messageData = {
      user: msg.user,
      text: msg.text,
      time: new Date().toLocaleTimeString(),
      userid: cookieId // expose cookie-based user id
    };

    // save & broadcast
    messages.push(messageData);
    messages = messages.slice(-100);
    fs.writeFileSync(messagesFile, JSON.stringify(messages, null, 2));
    io.emit("chatMessage", messageData);
  });

  socket.on("disconnect", () => {
    console.log("🔴 User disconnected:", socket.id);
  });
});

server.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
