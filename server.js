// server.js
const express = require("express");
const app = express();
const http = require("http").createServer(app);
const io = require("socket.io")(http);
const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());

// --- Database ---
const db = new sqlite3.Database("./chat.db");
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    number TEXT UNIQUE,
    name TEXT,
    facetime TEXT
  )`);

    db.run(`CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    senderNumber TEXT,
    senderName TEXT,
    room TEXT,
    text TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
});

// helper to generate 9-digit number
function generateNumber() {
    return Math.floor(100000000 + Math.random() * 900000000).toString();
}

// Register a new user (name in body)
app.post("/register", (req, res) => {
    const name = (req.body.name || "Unknown").toString().substring(0, 100);
    const number = generateNumber();

    db.run(
        "INSERT INTO users (number, name, facetime) VALUES (?, ?, ?)",
        [number, name, null],
        function (err) {
            if (err) {
                console.error("register error:", err);
                return res.status(500).json({ error: true });
            }
            res.json({ number, name });
        }
    );
});

// list all users (number + name + facetime)
app.get("/users", (req, res) => {
    db.all("SELECT number, name, facetime FROM users ORDER BY id ASC", [], (err, rows) => {
        if (err) return res.status(500).json({ error: true });
        res.json({ users: rows });
    });
});

// update facetime (optional)
app.post("/setFacetime", (req, res) => {
    const { number, facetime } = req.body;
    if (!number) return res.status(400).json({ error: "missing number" });
    db.run("UPDATE users SET facetime = ? WHERE number = ?", [facetime || null, number], function (err) {
        if (err) return res.status(500).json({ error: true });
        res.json({ ok: true });
    });
});

// get history for a room
app.post("/history", (req, res) => {
    const { room } = req.body;
    if (!room) return res.status(400).json({ error: "missing room" });

    db.all("SELECT senderNumber, senderName, text, timestamp FROM messages WHERE room = ? ORDER BY id ASC", [room], (err, rows) => {
        if (err) return res.status(500).json({ error: true });
        res.json({ messages: rows });
    });
});

// Socket.io realtime
io.on("connection", socket => {
    // let client register themselves for signaling (join a room named by their number)
    socket.on("registerSocket", (number) => {
        if (!number) return;
        socket.join(number.toString());
    });

    // join chat room (DM or group)
    socket.on("joinRoom", (room) => {
        if (!room) return;
        socket.join(room);
    });

    // message send
    socket.on("message", (data) => {
        const { senderNumber, senderName, room, text } = data;
        if (!room || !senderNumber) return;

        db.run("INSERT INTO messages (senderNumber, senderName, room, text) VALUES (?, ?, ?, ?)", [senderNumber, senderName, room, text], function (err) {
            if (err) console.error("message insert error", err);
        });

        io.to(room).emit("message", { senderNumber, senderName, room, text, timestamp: new Date().toISOString() });
    });

    // WebRTC signaling: offer
    socket.on("callUser", (data) => {
        // data: { to: targetNumber, from: myNumber, offer }
        if (!data || !data.to) return;
        io.to(data.to.toString()).emit("incomingCall", data);
    });

    // answer
    socket.on("answerCall", (data) => {
        if (!data || !data.to) return;
        io.to(data.to.toString()).emit("callAnswered", data);
    });

    // ICE candidate
    socket.on("iceCandidate", (data) => {
        // data: { to, candidate }
        if (!data || !data.to) return;
        io.to(data.to.toString()).emit("iceCandidate", data);
    });
});

http.listen(PORT, () => console.log("Server running on port", PORT));
