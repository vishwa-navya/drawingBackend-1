# drawingBackend-1

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
const strokes = [];      // committed strokes
const redoStack = [];    // redo history

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  // ==============================
  // USER JOIN
  // ==============================
  socket.on("user:join", (username) => {
    users[socket.id] = username;
    socket.emit("canvas:sync", strokes);
    io.emit("users:update", Object.values(users));
  });

  // ==============================
  // STROKE START
  // ==============================
  socket.on("stroke:start", (stroke) => {
    stroke.user = users[socket.id];

    if (!Array.isArray(stroke.points)) {
      stroke.points = [];
    }

    socket.currentStroke = stroke;

    socket.broadcast.emit("stroke:start", stroke);
  });

  // ==============================
  // STROKE MOVE (BRUSH / ERASER)
  // ==============================
  socket.on("stroke:move", (data) => {
    if (!socket.currentStroke) return;

    const point = {
      x: data.x,
      y: data.y,
    };

    socket.currentStroke.points.push(point);

    // 🔥 Always broadcast full metadata
    socket.broadcast.emit("stroke:move", {
      strokeId: socket.currentStroke.id,
      x: point.x,
      y: point.y,
      color: socket.currentStroke.color,
      strokeWidth: socket.currentStroke.strokeWidth,
      tool: socket.currentStroke.tool,
      user: socket.currentStroke.user,
    });
  });

  // ==============================
  // STROKE END (BRUSH + SHAPES)
  // ==============================
  socket.on("stroke:end", (data) => {
    if (!socket.currentStroke) return;

    if (data?.shapeType) {
      socket.currentStroke.shapeType = data.shapeType;
      socket.currentStroke.startX = data.startX;
      socket.currentStroke.startY = data.startY;
      socket.currentStroke.endX = data.endX;
      socket.currentStroke.endY = data.endY;
    }

    strokes.push(socket.currentStroke);
    redoStack.length = 0;

    io.emit("stroke:end", socket.currentStroke);
    socket.currentStroke = null;
  });

  // ==============================
  // GHOST CURSOR MOVE
  // ==============================
  socket.on("cursor:move", ({ x, y }) => {
    socket.broadcast.emit("cursor:update", {
      socketId: socket.id,
      username: users[socket.id],
      x,
      y,
    });
  });

  // ==============================
  // CURSOR LEAVE (MOBILE TOUCH END)
  // ==============================
  socket.on("cursor:leave", () => {
    socket.broadcast.emit("cursor:remove", socket.id);
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
