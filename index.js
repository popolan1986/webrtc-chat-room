'use strict';

var os = require('os');
var nodeStatic = require('node-static');
var http = require('http');
var socketIO = require('socket.io');

var fileServer = new(nodeStatic.Server)();
var app = http.createServer(function(req, res) {
  fileServer.serve(req, res);
}).listen(8884);

console.log('Welcome to the chat room on port 8884...');

var io = socketIO.listen(app);
io.sockets.on('connection', function(socket) {

  // convenience function to log server messages on the client
  function log() {
    var array = ['Message from server:'];
    array.push.apply(array, arguments);
    socket.emit('log', array);
  }

  socket.on('message', function(message) {
    log('Client said: ', message);
    // for a real app, would be room-only (not broadcast)
    socket.broadcast.emit('message', message);
  });

  socket.on('create or join', function(room) {
    log('Received request to create or join room ' + room);

    // join room
		var existingRoom = io.sockets.adapter.rooms[room];
		var clients = [];

		if(existingRoom){
			clients = Object.keys(existingRoom);
		}

		if(clients.length == 0){
      socket.join(room);
      log('Client ID ' + socket.id + ' created room ' + room);
			io.to(room).emit('created', room, socket.id);
		}
		else if(clients.length == 1){
      log('Client ID ' + socket.id + ' is joining room ' + room);
      io.to(room).emit('join', room);
			socket.join(room);
			socket.to(room).emit('joined', room, socket.id);
		}
		// only allow 2 users max per room
		else{
			socket.emit('full', room);
		}
  });

  socket.on('ipaddr', function() {
    var ifaces = os.networkInterfaces();
    for (var dev in ifaces) {
      ifaces[dev].forEach(function(details) {
        if (details.family === 'IPv4' && details.address !== '127.0.0.1') {
          socket.emit('ipaddr', details.address);
        }
      });
    }
  });

  socket.on('bye', function(){
    console.log('received bye');
  });

});
