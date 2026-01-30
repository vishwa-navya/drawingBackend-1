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
// In-memory state (SOURCE OF TRUTH)
// ==============================
const users = {};        // socket.id -> username
const strokes = [];      // committed strokes (brush + shapes)
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
    stroke.userId = socket.id;

    if (!Array.isArray(stroke.points)) {
      stroke.points = [];
    }

    socket.currentStroke = stroke;

    // Live drawing start
    socket.broadcast.emit("stroke:start", stroke);
  });

  // ==============================
  // STROKE MOVE (BRUSH / ERASER)
  // ==============================
  socket.on("stroke:move", (data) => {
    if (!socket.currentStroke) return;
    if (typeof data.x !== "number" || typeof data.y !== "number") return;

    const point = { x: data.x, y: data.y };
    socket.currentStroke.points.push(point);

    // Broadcast full metadata (fixes color + ghost lines)
    socket.broadcast.emit("stroke:move", {
      id: socket.currentStroke.id,
      strokeId: socket.currentStroke.id,
      x: point.x,
      y: point.y,
      color: socket.currentStroke.color,
      strokeWidth: socket.currentStroke.strokeWidth,
      tool: socket.currentStroke.tool,
      userId: socket.currentStroke.userId,
      user: socket.currentStroke.user,
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

    strokes.push(socket.currentStroke);
    redoStack.length = 0;

    // Broadcast committed stroke
    io.emit("stroke:end", socket.currentStroke);

    socket.currentStroke = null;
  });

  // ==============================
  // 🔥 CLEAR CANVAS (PERMANENT DELETE)
  // ==============================
  socket.on("clear:canvas", () => {
    console.log("Canvas cleared by:", users[socket.id]);

    strokes.length = 0;      // ✅ PERMANENT DELETE
    redoStack.length = 0;

    // Broadcast empty canvas to ALL users
    io.emit("canvas:reset", []);
  });

  // ==============================
  // UNDO / REDO
  // ==============================
  socket.on("undo", () => {
    if (!strokes.length) return;
    redoStack.push(strokes.pop());
    io.emit("canvas:reset", strokes);
  });

  socket.on("redo", () => {
    if (!redoStack.length) return;
    strokes.push(redoStack.pop());
    io.emit("canvas:reset", strokes);
  });

  // ==============================
  // GHOST CURSOR
  // ==============================
  socket.on("cursor:move", ({ x, y }) => {
    if (typeof x !== "number" || typeof y !== "number") return;

    socket.broadcast.emit("cursor:update", {
      socketId: socket.id,
      username: users[socket.id],
      x,
      y,
    });
  });

  socket.on("cursor:leave", () => {
    socket.broadcast.emit("cursor:remove", socket.id);
  });

  // ==============================
  // DISCONNECT
  // ==============================
  socket.on("disconnect", () => {
    delete users[socket.id];
    io.emit("users:update", Object.values(users));
    socket.broadcast.emit("cursor:remove", socket.id);
    console.log("User disconnected:", socket.id);
  });
});

// ==============================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});






