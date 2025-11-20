// chat.js — messaging + users list + WebRTC signaling
const socket = io();

// UI refs
const overlay = document.getElementById("overlay");
const registerBtn = document.getElementById("registerBtn");
const nameInput = document.getElementById("nameInput");
const myIdText = document.getElementById("myIdText");

const appDiv = document.getElementById("app");
const meLabel = document.getElementById("meLabel");
const usersList = document.getElementById("usersList");
const searchBox = document.getElementById("searchBox");

const roomLabel = document.getElementById("roomLabel");
const messagesBox = document.getElementById("messages");
const messageInput = document.getElementById("messageInput");
const sendBtn = document.getElementById("sendBtn");
const videoBtn = document.getElementById("videoBtn");

const videoArea = document.getElementById("videoArea");
const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
const endCallBtn = document.getElementById("endCallBtn");

// app state
let myNumber = localStorage.getItem("myNumber") || null;
let myName = localStorage.getItem("myName") || null;
let currentRoom = null;
let currentFriend = null; // {number, name, facetime}

// WebRTC
let pc = null;
let localStream = null;
const rtcConfig = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };

// --- registration ---
registerBtn.onclick = async () => {
    const name = (nameInput.value || "").trim();
    if (!name) return alert("Enter a name");

    const res = await fetch("/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name })
    });
    const data = await res.json();
    if (!data || !data.number) return alert("Server error while creating ID");

    myNumber = data.number;
    myName = data.name;
    localStorage.setItem("myNumber", myNumber);
    localStorage.setItem("myName", myName);

    myIdText.innerText = `Your ID: ${myNumber}`;
    enterApp();
};

// If user already registered (refresh), auto-enter
(function tryAutoEnter() {
    if (myNumber && myName) {
        // hide overlay and enter
        nameInput.value = myName;
        myIdText.innerText = `Your ID: ${myNumber}`;
        enterApp();
    }
})();

async function enterApp() {
    overlay.style.display = "none";
    appDiv.style.display = "flex";
    meLabel.innerText = myNumber + " (" + myName + ")";

    // register socket for signaling
    socket.emit("registerSocket", myNumber);

    await loadUsers();
}

// --- load users ---
async function loadUsers() {
    const res = await fetch("/users");
    const data = await res.json();
    const users = data.users || [];

    usersList.innerHTML = "";
    users.forEach(u => {
        const item = document.createElement("div");
        item.className = "userItem";
        item.dataset.number = u.number;
        item.innerHTML = `<strong>${escapeHtml(u.name)}</strong><br><small>${u.number}</small>`;
        item.onclick = () => openDM(u);
        usersList.appendChild(item);
    });
}

// search
searchBox.oninput = () => {
    const q = searchBox.value.toLowerCase().trim();
    Array.from(usersList.children).forEach(child => {
        const txt = child.innerText.toLowerCase();
        child.style.display = txt.includes(q) ? "" : "none";
    });
};

// --- open DM ---
async function openDM(userObj) {
    currentFriend = userObj;
    currentRoom = [myNumber, userObj.number].sort().join("_");
    roomLabel.innerText = `${userObj.name} (${userObj.number})`;
    messagesBox.innerHTML = "";

    socket.emit("joinRoom", currentRoom);

    const res = await fetch("/history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ room: currentRoom })
    });
    const data = await res.json();
    (data.messages || []).forEach(m => {
        addMessage(m.senderName || m.senderNumber, m.text);
    });
}

// --- send message ---
sendBtn.onclick = () => {
    if (!currentRoom) return alert("Open a conversation first by clicking a person.");
    const text = messageInput.value.trim();
    if (!text) return;
    const payload = { senderNumber: myNumber, senderName: myName, room: currentRoom, text };
    socket.emit("message", payload);
    addMessage(myName, text);
    messageInput.value = "";
};

// receive messages
socket.on("message", data => {
    if (data.room === currentRoom && data.senderNumber !== myNumber) {
        addMessage(data.senderName || data.senderNumber, data.text);
    }
});

function addMessage(sender, text) {
    const div = document.createElement("div");
    div.className = "message";
    div.innerText = `${sender}: ${text}`;
    messagesBox.appendChild(div);
    messagesBox.scrollTop = messagesBox.scrollHeight;
}

// --- Video calling (WebRTC in-app) ---
videoBtn.onclick = () => {
    if (!currentFriend) return alert("Open a DM with someone first.");
    startCall(currentFriend.number);
};

async function startCall(targetNumber) {
    if (!targetNumber) return;
    try {
        pc = new RTCPeerConnection(rtcConfig);

        // local stream
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localVideo.srcObject = localStream;
        localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

        pc.ontrack = (e) => {
            remoteVideo.srcObject = e.streams[0];
        };

        pc.onicecandidate = (e) => {
            if (e.candidate) {
                socket.emit("iceCandidate", { to: targetNumber, candidate: e.candidate });
            }
        };

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        // send offer to target's socket room (server will re-emit to that user's sockets)
        socket.emit("callUser", { to: targetNumber, from: myNumber, offer });

        videoArea.style.display = "flex";
    } catch (err) {
        console.error("startCall error:", err);
        alert("Couldn't start camera/microphone or create call.");
    }
}

// incoming offer
socket.on("incomingCall", async (data) => {
    // data = { to, from, offer }
    if (!myNumber) return;
    if (data.to !== myNumber) return; // not for me

    const accept = confirm(`Incoming video call from ${data.from}. Accept?`);
    if (!accept) return;

    try {
        pc = new RTCPeerConnection(rtcConfig);

        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localVideo.srcObject = localStream;
        localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

        pc.ontrack = (e) => {
            remoteVideo.srcObject = e.streams[0];
        };

        pc.onicecandidate = (e) => {
            if (e.candidate) {
                socket.emit("iceCandidate", { to: data.from, candidate: e.candidate });
            }
        };

        await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        socket.emit("answerCall", { to: data.from, from: myNumber, answer });

        videoArea.style.display = "flex";
    } catch (err) {
        console.error("incomingCall error:", err);
        alert("Couldn't accept call or access camera/mic.");
    }
});

// incoming answer
socket.on("callAnswered", async (data) => {
    // data = { to, from, answer }
    if (!pc) return;
    if (data.to !== myNumber) return;
    try {
        await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
        videoArea.style.display = "flex";
    } catch (err) {
        console.error("callAnswered error:", err);
    }
});

// ICE candidates from remote
socket.on("iceCandidate", async (data) => {
    if (!pc) return;
    try {
        await pc.addIceCandidate(data.candidate);
    } catch (err) {
        console.warn("addIceCandidate error:", err);
    }
});

// end call
endCallBtn.onclick = () => {
    if (pc) { pc.close(); pc = null; }
    if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
    videoArea.style.display = "none";
};

// utils
function escapeHtml(s) {
    return (s || "").replace(/[&<>"']/g, function (m) {
        return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[m];
    });
}
