const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();
app.use(cors());

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*"
  }
});

const users = {};
const strokes = [];
const redoStack = [];

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  socket.on("user:join", (username) => {
    users[socket.id] = username;

    // send full canvas to newly joined user
    socket.emit("canvas:sync", strokes);

    // update online users list
    io.emit("users:update", Object.values(users));
  });

  socket.on("stroke:start", (stroke) => {
    stroke.user = users[socket.id];
    stroke.points = [];
    socket.currentStroke = stroke;
    socket.broadcast.emit("stroke:start", stroke);
  });

  socket.on("stroke:move", (point) => {
    if (!socket.currentStroke) return;
    socket.currentStroke.points.push(point);
    socket.broadcast.emit("stroke:move", {
      strokeId: socket.currentStroke.id,
      point
    });
  });

  socket.on("stroke:end", () => {
    if (!socket.currentStroke) return;

    strokes.push(socket.currentStroke);
    redoStack.length = 0;

    socket.broadcast.emit("stroke:end", {
      strokeId: socket.currentStroke.id
    });

    socket.currentStroke = null;
  });

  socket.on("undo", () => {
    if (strokes.length === 0) return;
    const removedStroke = strokes.pop();
    redoStack.push(removedStroke);
    io.emit("canvas:reset", strokes);
  });

  socket.on("redo", () => {
    if (redoStack.length === 0) return;
    const restoredStroke = redoStack.pop();
    strokes.push(restoredStroke);
    io.emit("canvas:reset", strokes);
  });

  socket.on("disconnect", () => {
    delete users[socket.id];
    io.emit("users:update", Object.values(users));
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
