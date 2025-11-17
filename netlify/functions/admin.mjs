import { getStore } from "@netlify/blobs";

const ADMIN_ID = [
  "e3078d0d-aa6c-410c-8015-9a7d269fe230",
  "694beb8e-c652-41b0-9922-36b34f55282d",
];

export default async (req, context) => {
  const store = getStore("chat");
  const userId = req.headers.get("x-user-id");
  
  if (!ADMIN_ID.includes(userId)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 403,
      headers: { "Content-Type": "application/json" }
    });
  }
  
  const body = await req.json();
  const { action, targetId, reason, duration, word } = body;
  
  switch (action) {
    case "ban": {
      const bans = await store.get("bans", { type: "json" }) || [];
      const messages = await store.get("messages", { type: "json" }) || [];
      
      if (!bans.find((b) => b.cookie === targetId)) {
        let username = "Unknown";
        for (let i = messages.length - 1; i >= 0; i--) {
          if (messages[i].userId === targetId) {
            username = messages[i].username;
            break;
          }
        }
        
        bans.push({
          username,
          cookie: targetId,
          reason: reason || "No reason provided",
          time: Date.now(),
        });
        await store.setJSON("bans", bans);
        
        return new Response(JSON.stringify({ success: true, message: `${username} banned` }), {
          headers: { "Content-Type": "application/json" }
        });
      }
      break;
    }
    
    case "unban": {
      const bans = await store.get("bans", { type: "json" }) || [];
      const index = bans.findIndex((b) => b.cookie === targetId);
      
      if (index !== -1) {
        const user = bans[index];
        bans.splice(index, 1);
        await store.setJSON("bans", bans);
        
        return new Response(JSON.stringify({ success: true, message: `${user.username} unbanned` }), {
          headers: { "Content-Type": "application/json" }
        });
      }
      break;
    }
    
    case "clear": {
      const messages = await store.get("messages", { type: "json" }) || [];
      const filtered = messages.filter((m) => m.userId !== targetId);
      await store.setJSON("messages", filtered);
      
      return new Response(JSON.stringify({ success: true, message: "Messages cleared" }), {
        headers: { "Content-Type": "application/json" }
      });
    }
    
    case "purge": {
      await store.setJSON("messages", []);
      
      return new Response(JSON.stringify({ success: true, message: "Chat history purged" }), {
        headers: { "Content-Type": "application/json" }
      });
    }
    
    case "addBannedWord": {
      const bannedWords = await store.get("bannedWords", { type: "json" }) || [];
      if (!bannedWords.includes(word)) {
        bannedWords.push(word);
        await store.setJSON("bannedWords", bannedWords);
      }
      
      return new Response(JSON.stringify({ success: true, message: "Banned word added" }), {
        headers: { "Content-Type": "application/json" }
      });
    }
    
    case "removeBannedWord": {
      const bannedWords = await store.get("bannedWords", { type: "json" }) || [];
      const filtered = bannedWords.filter((w) => w !== word);
      await store.setJSON("bannedWords", filtered);
      
      return new Response(JSON.stringify({ success: true, message: "Banned word removed" }), {
        headers: { "Content-Type": "application/json" }
      });
    }
    
    default:
      return new Response(JSON.stringify({ error: "Unknown action" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
  }
  
  return new Response(JSON.stringify({ success: true }), {
    headers: { "Content-Type": "application/json" }
  });
};

export const config = {
  path: "/api/admin"
};
