const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const path = require("path");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, "public")));

const rooms = new Map();

function send(ws, payload) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function broadcast(room, payload) {
  if (room.presenter) send(room.presenter, payload);
  room.viewers.forEach(v => send(v.ws, payload));
}

function sanitizeText(text, max = 240) {
  return String(text || "").replace(/[<>]/g, "").trim().slice(0, max);
}

function roomState(room) {
  return {
    viewers: room.viewers.size,
    title: room.title,
    locked: !!room.password
  };
}

function broadcastState(room) {
  broadcast(room, { type: "room-state", ...roomState(room) });
}

function makeId() {
  return Math.random().toString(36).slice(2, 10);
}

wss.on("connection", (ws) => {
  ws.meta = { roomId: null, role: null, viewerId: null, name: "Visitante" };

  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    if (msg.type === "join") {
      const roomId = sanitizeText(msg.roomId, 10).toUpperCase();
      const role = msg.role === "presenter" ? "presenter" : "viewer";
      const name = sanitizeText(msg.name, 24) || "Visitante";
      const password = sanitizeText(msg.password, 40);

      if (!roomId) return send(ws, { type: "error", message: "Código de sala inválido." });

      if (role === "presenter") {
        if (!rooms.has(roomId)) {
          rooms.set(roomId, {
            presenter: null,
            viewers: new Map(),
            password,
            title: sanitizeText(msg.title, 42) || "Transmissão ao vivo"
          });
        }

        const room = rooms.get(roomId);
        if (room.presenter && room.presenter !== ws) {
          return send(ws, { type: "error", message: "Já existe um transmissor nesta sala." });
        }

        room.presenter = ws;
        room.password = password;
        room.title = sanitizeText(msg.title, 42) || room.title;

        ws.meta = { roomId, role, viewerId: null, name };
        send(ws, { type: "joined", roomId, role, ...roomState(room) });

        room.viewers.forEach((viewer, viewerId) => {
          send(ws, { type: "viewer-joined", viewerId });
        });

        broadcast(room, { type: "system-chat", message: `${name} iniciou a transmissão.` });
        broadcastState(room);
        return;
      }

      const room = rooms.get(roomId);
      if (!room) {
        return send(ws, { type: "error", message: "Essa sala não existe ou ainda não foi iniciada." });
      }
      if (room.password && room.password !== password) {
        return send(ws, { type: "error", message: "Senha incorreta." });
      }

      const viewerId = makeId();
      ws.meta = { roomId, role, viewerId, name };
      room.viewers.set(viewerId, { ws, name });

      send(ws, { type: "joined", roomId, role, viewerId, ...roomState(room) });
      if (room.presenter) send(room.presenter, { type: "viewer-joined", viewerId });

      broadcast(room, { type: "system-chat", message: `${name} entrou na sala.` });
      broadcastState(room);
      return;
    }

    const { roomId, role, viewerId, name } = ws.meta;
    if (!roomId || !rooms.has(roomId)) return;
    const room = rooms.get(roomId);

    if (msg.type === "signal") {
      if (role === "presenter") {
        const target = room.viewers.get(msg.viewerId);
        if (target) send(target.ws, { type: "signal", from: "presenter", data: msg.data });
      } else {
        send(room.presenter, {
          type: "signal",
          from: viewerId,
          viewerId,
          data: msg.data
        });
      }
      return;
    }

    if (msg.type === "chat") {
      const message = sanitizeText(msg.message, 300);
      if (!message) return;
      broadcast(room, {
        type: "chat",
        name,
        message,
        role,
        at: Date.now()
      });
      return;
    }

    if (msg.type === "stream-status" && role === "presenter") {
      broadcast(room, {
        type: "stream-status",
        live: !!msg.live
      });
    }
  });

  ws.on("close", () => {
    const { roomId, role, viewerId, name } = ws.meta;
    if (!roomId || !rooms.has(roomId)) return;
    const room = rooms.get(roomId);

    if (role === "presenter" && room.presenter === ws) {
      room.presenter = null;
      room.viewers.forEach(v => send(v.ws, { type: "presenter-left" }));
      broadcast(room, { type: "system-chat", message: "A transmissão foi encerrada." });
    }

    if (role === "viewer" && viewerId) {
      room.viewers.delete(viewerId);
      send(room.presenter, { type: "viewer-left", viewerId });
      broadcast(room, { type: "system-chat", message: `${name} saiu da sala.` });
    }

    if (!room.presenter && room.viewers.size === 0) {
      rooms.delete(roomId);
    } else {
      broadcastState(room);
    }
  });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Lunara Live rodando na porta ${PORT}`);
});
