import { getStore } from "@netlify/blobs";

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
