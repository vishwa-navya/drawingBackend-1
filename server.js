const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();
app.use(cors());

const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*" },
});

// ==============================
// In-memory state
// ==============================
const users = {};        // socket.id -> username
const strokes = [];      // all committed strokes
const redoStack = [];    // redo history

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  // ==============================
  // USER JOIN
  // ==============================
  socket.on("user:join", (username) => {
    users[socket.id] = username;

    // Send full canvas history
    socket.emit("canvas:sync", strokes);

    // Update online users
    io.emit("users:update", Object.values(users));
  });

  // ==============================
  // STROKE START
  // ==============================
  socket.on("stroke:start", (stroke) => {
    stroke.user = users[socket.id];

    // Always initialize points for brush / eraser
    if (!Array.isArray(stroke.points)) {
      stroke.points = [];
    }

    socket.currentStroke = stroke;

    // Broadcast start (for live drawing)
    socket.broadcast.emit("stroke:start", stroke);
  });

  // ==============================
  // STROKE MOVE (BRUSH / ERASER)
  // ==============================
  socket.on("stroke:move", (data) => {
    if (!socket.currentStroke) return;

    let point = null;

    // ✅ Support BOTH payload formats
    if (data?.point) {
      point = data.point;
    } else if (
      typeof data?.x === "number" &&
      typeof data?.y === "number"
    ) {
      point = { x: data.x, y: data.y };
    }

    if (!point) return;

    socket.currentStroke.points.push(point);

    // Broadcast minimal move payload
    socket.broadcast.emit("stroke:move", {
      strokeId: socket.currentStroke.id,
      x: point.x,
      y: point.y,
    });
  });

  // ==============================
  // STROKE END (BRUSH + SHAPES)
  // ==============================
  socket.on("stroke:end", (data) => {
    if (!socket.currentStroke) return;

    // Merge shape geometry if present
    if (data?.shapeType) {
      socket.currentStroke.shapeType = data.shapeType;
      socket.currentStroke.startX = data.startX;
      socket.currentStroke.startY = data.startY;
      socket.currentStroke.endX = data.endX;
      socket.currentStroke.endY = data.endY;
    }

    // Save stroke permanently
    strokes.push(socket.currentStroke);

    // Clear redo stack
    redoStack.length = 0;

    // 🔥 Broadcast FULL stroke object
    io.emit("stroke:end", socket.currentStroke);

    socket.currentStroke = null;
  });

  // ==============================
  // UNDO
  // ==============================
  socket.on("undo", () => {
    if (!strokes.length) return;

    redoStack.push(strokes.pop());
    io.emit("canvas:reset", strokes);
  });

  // ==============================
  // REDO
  // ==============================
  socket.on("redo", () => {
    if (!redoStack.length) return;

    strokes.push(redoStack.pop());
    io.emit("canvas:reset", strokes);
  });

  // ==============================
  // DISCONNECT
  // ==============================
  socket.on("disconnect", () => {
    delete users[socket.id];
    io.emit("users:update", Object.values(users));
    console.log("User disconnected:", socket.id);
  });
});

// ==============================
// SERVER START
// ==============================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});



