const $ = (s) => document.querySelector(s);

let ws;
let role = null;
let roomId = null;
let name = "";
let roomPassword = "";
let localStream = null;
let viewerPc = null;
const presenterPeers = new Map();

const landing = $("#landing");
const broadcast = $("#broadcast");
const video = $("#video");
const emptyState = $("#emptyState");
const emptyTitle = $("#emptyTitle");
const emptyText = $("#emptyText");
const shareBtn = $("#shareBtn");
const statusText = $("#statusText");
const liveBadge = $("#liveBadge");
const messages = $("#messages");
const errorBox = $("#error");

document.querySelectorAll(".tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
    tab.classList.add("active");
    $("#" + tab.dataset.tab + "Panel").classList.add("active");
  });
});

function showError(text) {
  errorBox.textContent = text;
  errorBox.classList.remove("hidden");
  setTimeout(() => errorBox.classList.add("hidden"), 3500);
}

function makeRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({length:6}, () => chars[Math.floor(Math.random()*chars.length)]).join("");
}

function socketUrl() {
  return `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`;
}

function connect(callback) {
  ws = new WebSocket(socketUrl());

  ws.onopen = callback;

  ws.onmessage = async (event) => {
    const msg = JSON.parse(event.data);

    if (msg.type === "error") {
      showError(msg.message);
      return;
    }

    if (msg.type === "joined") {
      enterBroadcast(msg);
      return;
    }

    if (msg.type === "room-state") {
      $("#viewerCount").textContent = `${msg.viewers} ${msg.viewers === 1 ? "espectador" : "espectadores"}`;
      if (msg.title) $("#broadcastTitle").textContent = msg.title;
      return;
    }

    if (msg.type === "viewer-joined" && role === "presenter") {
      if (localStream) await createOfferForViewer(msg.viewerId);
      return;
    }

    if (msg.type === "viewer-left" && role === "presenter") {
      const pc = presenterPeers.get(msg.viewerId);
      if (pc) pc.close();
      presenterPeers.delete(msg.viewerId);
      return;
    }

    if (msg.type === "signal") {
      if (role === "presenter") await handlePresenterSignal(msg.viewerId, msg.data);
      else await handleViewerSignal(msg.data);
      return;
    }

    if (msg.type === "chat") {
      addMessage(msg.name, msg.message, msg.role);
      return;
    }

    if (msg.type === "system-chat") {
      addSystemMessage(msg.message);
      return;
    }

    if (msg.type === "stream-status") {
      setLiveState(msg.live);
      if (!msg.live && role === "viewer") {
        video.srcObject = null;
        video.style.display = "none";
        emptyState.classList.remove("hidden");
        emptyTitle.textContent = "Transmissão pausada";
        emptyText.textContent = "O apresentador parou de compartilhar a tela.";
      }
      return;
    }

    if (msg.type === "presenter-left") {
      if (viewerPc) viewerPc.close();
      viewerPc = null;
      video.srcObject = null;
      video.style.display = "none";
      emptyState.classList.remove("hidden");
      emptyTitle.textContent = "Transmissão encerrada";
      emptyText.textContent = "O apresentador saiu da sala.";
      setLiveState(false);
    }
  };

  ws.onclose = () => {
    statusText.textContent = "Conexão encerrada.";
  };
}

$("#createRoom").addEventListener("click", () => {
  name = $("#hostName").value.trim() || "Apresentador";
  const title = $("#streamTitle").value.trim() || "Transmissão ao vivo";
  roomPassword = $("#hostPassword").value.trim();
  roomId = makeRoomCode();
  role = "presenter";

  connect(() => {
    ws.send(JSON.stringify({
      type: "join",
      role,
      roomId,
      name,
      password: roomPassword,
      title
    }));
  });
});

$("#joinRoom").addEventListener("click", () => {
  name = $("#viewerName").value.trim() || "Visitante";
  roomId = $("#roomCode").value.trim().toUpperCase();
  roomPassword = $("#viewerPassword").value.trim();
  role = "viewer";

  if (!roomId) return showError("Digite o código da sala.");

  connect(() => {
    ws.send(JSON.stringify({
      type: "join",
      role,
      roomId,
      name,
      password: roomPassword
    }));
  });
});

function enterBroadcast(msg) {
  landing.classList.add("hidden");
  broadcast.classList.remove("hidden");

  $("#roomLabel").textContent = roomId;
  $("#broadcastTitle").textContent = msg.title || "Transmissão ao vivo";
  $("#viewerCount").textContent = `${msg.viewers || 0} espectadores`;
  $("#roleLabel").textContent = role === "presenter" ? "Você está transmitindo" : "Você está assistindo";

  if (role === "viewer") {
    shareBtn.classList.add("hidden");
    emptyTitle.textContent = "Aguardando transmissão";
    emptyText.textContent = "Assim que o apresentador compartilhar a tela, ela aparecerá aqui.";
    statusText.textContent = "Conectado à sala.";
  } else {
    statusText.textContent = "Sala criada. Compartilhe sua tela quando quiser.";
  }
}

function setLiveState(live) {
  liveBadge.textContent = live ? "AO VIVO" : "OFFLINE";
  liveBadge.classList.toggle("online", live);
  liveBadge.classList.toggle("offline", !live);
}

shareBtn.addEventListener("click", async () => {
  try {
    localStream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: 30, max: 60 } },
      audio: true
    });

    video.srcObject = localStream;
    video.muted = true;
    video.style.display = "block";
    emptyState.classList.add("hidden");
    statusText.textContent = "Transmitindo sua tela.";
    setLiveState(true);

    ws.send(JSON.stringify({ type: "stream-status", live: true }));

    localStream.getVideoTracks()[0].addEventListener("ended", stopSharing);

    for (const [viewerId, pc] of presenterPeers) {
      pc.close();
      presenterPeers.delete(viewerId);
      await createOfferForViewer(viewerId);
    }
  } catch {
    statusText.textContent = "Compartilhamento cancelado.";
  }
});

async function stopSharing() {
  if (localStream) {
    localStream.getTracks().forEach(t => t.stop());
    localStream = null;
  }

  presenterPeers.forEach(pc => pc.close());
  presenterPeers.clear();

  video.srcObject = null;
  video.style.display = "none";
  emptyState.classList.remove("hidden");
  emptyTitle.textContent = "Pronto para transmitir";
  emptyText.textContent = "Escolha uma tela, janela ou aba do navegador.";
  statusText.textContent = "Transmissão pausada.";
  setLiveState(false);

  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "stream-status", live: false }));
  }
}

function makePeer() {
  return new RTCPeerConnection({
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" }
    ]
  });
}

async function createOfferForViewer(viewerId) {
  if (!localStream) return;

  const pc = makePeer();
  presenterPeers.set(viewerId, pc);

  localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

  pc.onicecandidate = (e) => {
    if (e.candidate) {
      ws.send(JSON.stringify({
        type: "signal",
        viewerId,
        data: { candidate: e.candidate }
      }));
    }
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  ws.send(JSON.stringify({
    type: "signal",
    viewerId,
    data: { description: pc.localDescription }
  }));
}

async function handlePresenterSignal(viewerId, data) {
  const pc = presenterPeers.get(viewerId);
  if (!pc) return;

  if (data.description) await pc.setRemoteDescription(data.description);
  if (data.candidate) {
    try { await pc.addIceCandidate(data.candidate); } catch {}
  }
}

async function handleViewerSignal(data) {
  if (!viewerPc) {
    viewerPc = makePeer();

    viewerPc.ontrack = (event) => {
      video.srcObject = event.streams[0];
      video.style.display = "block";
      emptyState.classList.add("hidden");
      statusText.textContent = "Assistindo ao vivo.";
      setLiveState(true);
    };

    viewerPc.onicecandidate = (e) => {
      if (e.candidate) {
        ws.send(JSON.stringify({
          type: "signal",
          data: { candidate: e.candidate }
        }));
      }
    };
  }

  if (data.description) {
    await viewerPc.setRemoteDescription(data.description);

    if (data.description.type === "offer") {
      const answer = await viewerPc.createAnswer();
      await viewerPc.setLocalDescription(answer);

      ws.send(JSON.stringify({
        type: "signal",
        data: { description: viewerPc.localDescription }
      }));
    }
  }

  if (data.candidate) {
    try { await viewerPc.addIceCandidate(data.candidate); } catch {}
  }
}

function addMessage(sender, message, messageRole) {
  const box = document.createElement("div");
  box.className = `msg ${messageRole === "viewer" ? "viewer" : "presenter"}`;

  const who = document.createElement("div");
  who.className = "name";
  who.textContent = sender;

  const text = document.createElement("p");
  text.textContent = message;

  box.appendChild(who);
  box.appendChild(text);
  messages.appendChild(box);
  messages.scrollTop = messages.scrollHeight;
}

function addSystemMessage(message) {
  const div = document.createElement("div");
  div.className = "system-msg";
  div.textContent = message;
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
}

$("#chatForm").addEventListener("submit", (e) => {
  e.preventDefault();

  const input = $("#chatInput");
  const message = input.value.trim();
  if (!message || ws?.readyState !== WebSocket.OPEN) return;

  ws.send(JSON.stringify({ type: "chat", message }));
  input.value = "";
});

$("#copyInvite").addEventListener("click", async () => {
  const params = new URLSearchParams({ room: roomId });
  const url = `${location.origin}/?${params.toString()}`;

  try {
    await navigator.clipboard.writeText(url);
    $("#copyInvite").textContent = "✓ Convite copiado";
    setTimeout(() => $("#copyInvite").textContent = "🔗 Copiar convite", 1600);
  } catch {
    prompt("Copie o link:", url);
  }
});

$("#fullscreenBtn").addEventListener("click", async () => {
  const target = document.querySelector(".video-card");
  if (!document.fullscreenElement) {
    await target.requestFullscreen?.();
  } else {
    await document.exitFullscreen?.();
  }
});

$("#leaveBtn").addEventListener("click", () => {
  if (localStream) localStream.getTracks().forEach(t => t.stop());
  presenterPeers.forEach(pc => pc.close());
  if (viewerPc) viewerPc.close();
  if (ws) ws.close();
  location.href = "/";
});

const params = new URLSearchParams(location.search);
const invitedRoom = params.get("room");
if (invitedRoom) {
  document.querySelector('[data-tab="watch"]').click();
  $("#roomCode").value = invitedRoom.toUpperCase();
}
