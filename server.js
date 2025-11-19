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
const ADMIN_ID = [
  "e3078d0d-aa6c-410c-8015-9a7d269fe230",
  "694beb8e-c652-41b0-9922-36b34f55282d",
];

const BANNED_WORDS_FILE = path.join(__dirname, "bannedwords.json");
const BANS_FILE = path.join(__dirname, "ban.json");
const MESSAGES_FILE = path.join(__dirname, "chat-history.json");

// Load files
let bannedWords = fs.existsSync(BANNED_WORDS_FILE)
  ? JSON.parse(fs.readFileSync(BANNED_WORDS_FILE, "utf-8"))
  : [];

let bans = fs.existsSync(BANS_FILE)
  ? JSON.parse(fs.readFileSync(BANS_FILE, "utf-8"))
  : [];

let messages = fs.existsSync(MESSAGES_FILE)
  ? JSON.parse(fs.readFileSync(MESSAGES_FILE, "utf-8"))
  : [];

const saveBans = () => fs.writeFileSync(BANS_FILE, JSON.stringify(bans, null, 2));
const saveMessages = () => fs.writeFileSync(MESSAGES_FILE, JSON.stringify(messages, null, 2));

let mutedUsers = {}; // { userId: unmuteTimestamp }

app.use(express.json());
app.use(cookieParser());
app.use(express.static("public"));

// Block banned users
app.use((req, res, next) => {
  const cookieId = req.cookies?.userid;
  if (bans.find(b => b.cookie === cookieId)) return res.status(403).send("You are banned.");
  next();
});

io.on("connection", (socket) => {
  let username = null;
  let userId = null;

  // Set username and userId
  socket.on("set username", (data) => {
    username = data.username || "Anonymous";
    userId = data.cookieId || randomUUID();

    socket.username = username;
    socket.userId = userId;

    if (!data.cookieId) socket.emit("setCookie", userId);

    console.log(`🟢 User connected: ${username} (${userId})`);

    // Send last 100 messages
    socket.emit("chat history", messages.slice(-100));
  });

  // Chat message
  socket.on("chat message", (msg) => {
    if (!username || !userId) return;

    // Auto-unmute cleanup
    const now = Date.now();
    for (const [uid, time] of Object.entries(mutedUsers)) {
      if (time <= now) delete mutedUsers[uid];
    }

    if (bans.find(b => b.cookie === userId)) {
      socket.emit("bannedNotice", { text: "You are banned." });
      return;
    }

    if (mutedUsers[userId]) {
      socket.emit("chat message", {
        username: "System",
        message: `You are muted for ${Math.ceil((mutedUsers[userId]-now)/1000)}s`,
        system: true
      });
      return;
    }

    if (msg.startsWith("/")) {
      handleCommand(msg, socket);
      return;
    }

    // AutoMod banned words
    const lowerMsg = msg.toLowerCase();
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

    const msgData = { username, userId, message: msg };
    messages.push(msgData);
    messages = messages.slice(-100);
    saveMessages();

    io.emit("chat message", msgData);

    // Mentions
    for (const s of io.sockets.sockets.values()) {
      if (msg.includes(`@${s.username}`) && s.userId !== userId) {
        s.emit("mention", { from: username, message: msg });
      }
    }
  });

  socket.on("disconnect", () => console.log(`🔴 ${username || "Unknown"} disconnected`));
});

// ---------------- Command handler ----------------
function handleCommand(msg, socket) {
  const args = msg.trim().split(" ");
  const command = args[0].toLowerCase();
  const isAdmin = ADMIN_ID.includes(socket.userId);

  const adminCommands = ["/ban","/unban","/server","/mute","/kick","/clear","/purge","/addbannedword","/removebannedword"];
  if (adminCommands.includes(command) && !isAdmin) {
    socket.emit("chat message", { username:"System", message:"❌ You are not an admin.", system:true });
    return;
  }

  switch(command) {
    case "/help":
      let helpMsg = "User Commands:\n/online\n/report [userid] [message]\n/stats\n/roll [XdY]\n/flip\n/hug [userid]";
      if(isAdmin) helpMsg += "\nAdmin Commands:\n/ban [userid] [reason]\n/unban [userid]\n/server [say|update|listusers|updatestatus]\n/mute [userid] [duration]\n/kick [userid]\n/clear [userid]\n/purge\n/addbannedword [word]\n/removebannedword [word]";
      socket.emit("chat message",{username:"Server",message:helpMsg,system:true});
      break;

    // Add other commands like /ban, /unban, /mute, /kick, etc. (same as before)

    default:
      socket.emit("chat message",{username:"System",message:`Unknown command: ${command}`,system:true});
  }
}

// Helpers
function parseDuration(str) {
  const match = str.match(/^(\d+)(s|m|h)$/);
  if(!match) return 300000;
  const [, val, unit] = match;
  const num = parseInt(val);
  switch(unit) {
    case "s": return num*1000;
    case "m": return num*60*1000;
    case "h": return num*60*60*1000;
    default: return 300000;
  }
}

app.get("/chat-history.json",(req,res)=>res.json(messages));
app.get("/admin",(req,res)=>res.sendFile(path.join(__dirname,"public/admin.html")));

const PORT = process.env.PORT || 3000;
server.listen(PORT,()=>console.log(`✅ Server running on port ${PORT}`));
