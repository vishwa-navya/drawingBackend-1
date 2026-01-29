const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();
app.use(cors());

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
  },
});

// ==============================
// In-memory state (current setup)
// ==============================
const users = {};          // socketId -> username
const strokes = [];        // all committed strokes (brush + shapes)
const redoStack = [];      // redo history

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  // ==============================
  // USER JOIN
  // ==============================
  socket.on("user:join", (username) => {
    users[socket.id] = username;

    // Send full canvas history to newly joined user
    socket.emit("canvas:sync", strokes);

    // Update online users list
    io.emit("users:update", Object.values(users));
  });

  // ==============================
  // STROKE START
  // ==============================
  socket.on("stroke:start", (stroke) => {
    /*
      IMPORTANT:
      - Do NOT overwrite shape data
      - Only initialize points array if it doesn't exist
    */
    stroke.user = users[socket.id];

    if (!stroke.points) {
      stroke.points = [];
    }

    socket.currentStroke = stroke;

    // Broadcast to other users for real-time drawing
    socket.broadcast.emit("stroke:start", stroke);
  });

  // ==============================
  // STROKE MOVE (FREEHAND ONLY)
  // ==============================
  socket.on("stroke:move", (payload) => {
    if (!socket.currentStroke) return;

    // Only freehand strokes have points
    if (payload.point) {
      socket.currentStroke.points.push(payload.point);

      socket.broadcast.emit("stroke:move", {
        strokeId: socket.currentStroke.id,
        point: payload.point,
      });
    }
  });

  // ==============================
  // STROKE END (FREEHAND + SHAPES)
  // ==============================
  socket.on("stroke:end", (data) => {
    if (!socket.currentStroke) return;

    /*
      SHAPE FIX:
      If this is a shape stroke, merge shape geometry
      into the current stroke before saving.
    */
    if (data && data.shapeType) {
      socket.currentStroke.shapeType = data.shapeType;
      socket.currentStroke.startX = data.startX;
      socket.currentStroke.startY = data.startY;
      socket.currentStroke.endX = data.endX;
      socket.currentStroke.endY = data.endY;
    }

    // Save stroke permanently
    strokes.push(socket.currentStroke);

    // Clear redo stack on new action
    redoStack.length = 0;

    // Broadcast FULL stroke (not just ID)
    io.emit("stroke:end", socket.currentStroke);

    socket.currentStroke = null;
  });

  // ==============================
  // UNDO
  // ==============================
  socket.on("undo", () => {
    if (strokes.length === 0) return;

    const removedStroke = strokes.pop();
    redoStack.push(removedStroke);

    // Send updated canvas to everyone
    io.emit("canvas:reset", strokes);
  });

  // ==============================
  // REDO
  // ==============================
  socket.on("redo", () => {
    if (redoStack.length === 0) return;

    const restoredStroke = redoStack.pop();
    strokes.push(restoredStroke);

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

