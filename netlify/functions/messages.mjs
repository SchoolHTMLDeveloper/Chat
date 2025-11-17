import { getStore } from "@netlify/blobs";

const ADMIN_ID = [
  "e3078d0d-aa6c-410c-8015-9a7d269fe230",
  "694beb8e-c652-41b0-9922-36b34f55282d",
];

async function handleCommand(message, username, userId, store) {
  const args = message.trim().split(" ");
  const command = args[0].toLowerCase();
  
  const adminCommands = [
    "/ban", "/unban", "/mute", "/kick", "/clear", "/purge", 
    "/addbannedword", "/removebannedword"
  ];
  
  const isAdmin = ADMIN_ID.includes(userId);
  
  if (adminCommands.includes(command) && !isAdmin) {
    return {
      username: "System",
      message: "❌ You are not an admin.",
      system: true,
    };
  }
  
  const messages = await store.get("messages", { type: "json" }) || [];
  
  switch (command) {
    case "/ban": {
      const banId = args[1];
      const reason = args.slice(2).join(" ") || "No reason provided";
      if (!banId) {
        return {
          username: "System",
          message: "Usage: /ban userid reason",
          system: true,
        };
      }
      
      const bans = await store.get("bans", { type: "json" }) || [];
      if (!bans.find((b) => b.cookie === banId)) {
        let uname = "Unknown";
        for (let i = messages.length - 1; i >= 0; i--) {
          if (messages[i].userId === banId) {
            uname = messages[i].username;
            break;
          }
        }
        
        bans.push({
          username: uname,
          cookie: banId,
          reason,
          time: Date.now(),
        });
        await store.setJSON("bans", bans);
        
        const sysMsg = {
          username: "AutoMod",
          message: `${uname} has been manually banned for ${reason}`,
          system: true,
        };
        messages.push(sysMsg);
        await store.setJSON("messages", messages.slice(-100));
        
        return sysMsg;
      }
      return null;
    }
    
    case "/unban": {
      const unbanId = args[1];
      if (!unbanId) {
        return {
          username: "System",
          message: "Usage: /unban userid",
          system: true,
        };
      }
      
      const bans = await store.get("bans", { type: "json" }) || [];
      const index = bans.findIndex((b) => b.cookie === unbanId || b.userId === unbanId);
      
      if (index !== -1) {
        const u = bans[index];
        bans.splice(index, 1);
        await store.setJSON("bans", bans);
        
        const sysMsg = {
          username: "AutoMod",
          message: `${u.username || "Unknown"} has been unbanned.`,
          system: true,
        };
        messages.push(sysMsg);
        await store.setJSON("messages", messages.slice(-100));
        
        return sysMsg;
      }
      return {
        username: "System",
        message: "User not found in ban list.",
        system: true,
      };
    }
    
    case "/clear": {
      const tId = args[1];
      if (!tId) {
        return {
          username: "System",
          message: "Usage: /clear userid",
          system: true,
        };
      }
      
      const filtered = messages.filter((m) => m.userId !== tId);
      await store.setJSON("messages", filtered);
      
      return {
        username: "Server",
        message: `All messages from ${tId} cleared`,
        system: true,
      };
    }
    
    case "/purge":
      await store.setJSON("messages", []);
      return {
        username: "Server",
        message: "Chat history purged",
        system: true,
      };
    
    case "/addbannedword": {
      const word = args[1];
      if (!word) {
        return {
          username: "System",
          message: "Usage: /addbannedword [word]",
          system: true,
        };
      }
      const bannedWords = await store.get("bannedWords", { type: "json" }) || [];
      bannedWords.push(word);
      await store.setJSON("bannedWords", bannedWords);
      return {
        username: "Server",
        message: `Added "${word}" to banned words list`,
        system: true,
      };
    }
    
    case "/removebannedword": {
      const word = args[1];
      if (!word) {
        return {
          username: "System",
          message: "Usage: /removebannedword [word]",
          system: true,
        };
      }
      const bannedWords = await store.get("bannedWords", { type: "json" }) || [];
      const filtered = bannedWords.filter((w) => w !== word);
      await store.setJSON("bannedWords", filtered);
      return {
        username: "Server",
        message: `Removed "${word}" from banned words list`,
        system: true,
      };
    }
    
    case "/online":
      return {
        username: "Server",
        message: "Online user count not available in serverless mode. Use Socket.io version for real-time features.",
        system: true,
      };
    
    case "/stats": {
      const userMsgCount = messages.filter((m) => m.userId === userId).length;
      return {
        username: "Server",
        message: `Your stats:\nMessages sent: ${userMsgCount}`,
        system: true,
      };
    }
    
    case "/roll": {
      const dice = args[1]?.toLowerCase()?.split("d");
      if (!dice || dice.length !== 2) {
        return {
          username: "Server",
          message: "Usage: /roll XdY (e.g., /roll 2d6)",
          system: true,
        };
      }
      const [num, faces] = dice.map(Number);
      if (isNaN(num) || isNaN(faces) || num < 1 || faces < 1) {
        return {
          username: "Server",
          message: "Invalid dice format. Use /roll XdY (e.g., /roll 2d6)",
          system: true,
        };
      }
      const results = [];
      for (let i = 0; i < num; i++) {
        results.push(1 + Math.floor(Math.random() * faces));
      }
      return {
        username: "Server",
        message: `${username} rolled ${args[1]}: ${results.join(", ")} (Total: ${results.reduce((a, b) => a + b, 0)})`,
        system: true,
      };
    }
    
    case "/flip":
      return {
        username: "Server",
        message: `${username} flipped a coin: ${Math.random() < 0.5 ? "Heads" : "Tails"}`,
        system: true,
      };
    
    case "/help": {
      let helpMsg = `User Commands:
  /stats - View your message statistics
  /roll [XdY] - Roll dice (e.g., /roll 2d6)
  /flip - Flip a coin
  /help - Show this help message`;
      
      if (isAdmin) {
        helpMsg += `

Admin Commands:
  /ban [userid] [reason] - Ban a user
  /unban [userid] - Unban a user
  /clear [userid] - Clear all messages from a user
  /purge - Clear all chat history
  /addbannedword [word] - Add word to ban list
  /removebannedword [word] - Remove word from ban list`;
      }
      
      return {
        username: "Server",
        message: helpMsg,
        system: true,
      };
    }
    
    default:
      return {
        username: "System",
        message: `Unknown command: ${command}. Type /help for available commands.`,
        system: true,
      };
  }
}

export default async (req, context) => {
  const store = getStore("chat");
  
  if (req.method === "GET") {
    const messages = await store.get("messages", { type: "json" }) || [];
    return new Response(JSON.stringify(messages), {
      headers: { "Content-Type": "application/json" }
    });
  }
  
  if (req.method === "POST") {
    const body = await req.json();
    const messages = await store.get("messages", { type: "json" }) || [];
    
    const userId = req.headers.get("x-user-id") || body.userId;
    const username = body.username || "Anonymous";
    const message = body.message;
    
    if (!message) {
      return new Response(JSON.stringify({ error: "Message is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }
    
    if (message.startsWith("/")) {
      const commandResult = await handleCommand(message, username, userId, store);
      if (commandResult) {
        const updatedMessages = await store.get("messages", { type: "json" }) || [];
        return new Response(JSON.stringify(commandResult), {
          headers: { "Content-Type": "application/json" }
        });
      }
      return new Response(JSON.stringify({ info: "Command executed" }), {
        headers: { "Content-Type": "application/json" }
      });
    }
    
    const bannedWords = await store.get("bannedWords", { type: "json" }) || [];
    const lowerMsg = message.toLowerCase();
    const foundWord = bannedWords.find((w) => lowerMsg.includes(w.toLowerCase()));
    
    if (foundWord) {
      const bans = await store.get("bans", { type: "json" }) || [];
      if (!bans.find((b) => b.cookie === userId)) {
        const reason = `Used banned word "${foundWord}"`;
        bans.push({
          username,
          cookie: userId,
          reason,
          time: Date.now(),
        });
        await store.setJSON("bans", bans);
        
        const sysMsg = {
          username: "AutoMod",
          message: `${username} has been banned for ${reason}`,
          system: true,
        };
        messages.push(sysMsg);
      }
      
      return new Response(JSON.stringify({ error: "Banned word detected", banned: true }), {
        status: 403,
        headers: { "Content-Type": "application/json" }
      });
    }
    
    const bans = await store.get("bans", { type: "json" }) || [];
    if (bans.find((b) => b.cookie === userId)) {
      return new Response(JSON.stringify({ error: "You are banned", banned: true }), {
        status: 403,
        headers: { "Content-Type": "application/json" }
      });
    }
    
    const msgData = { username, userId, message, timestamp: Date.now() };
    messages.push(msgData);
    
    const recentMessages = messages.slice(-100);
    await store.setJSON("messages", recentMessages);
    
    return new Response(JSON.stringify(msgData), {
      headers: { "Content-Type": "application/json" }
    });
  }
  
  return new Response("Method not allowed", { status: 405 });
};

export const config = {
  path: "/api/messages"
};
