'use strict';

var isChannelReady = false;
var isStarted = false;
// gets a value indicating if the current client is a caller; false the client is a callee.
var isCaller = false; // var isInitiator = false;
// local peer connection
var pc;
var localStream;
var remoteStream;
// signaling channel. Here I use socket.io. We can also use WebSocket.
var socket;
// todo: find a way to input room
var room = 'tlan';

var startButton = document.getElementById('startButton');
var callButton = document.getElementById('callButton');
var quitButton = document.getElementById('hangupButton');
var localVideo = document.getElementById('localVideo');
var remoteVideo = document.getElementById('remoteVideo');

startButton.onclick = function(e) {
    e.preventDefault();
    
    // initialize the connection
    initializeConnection();
};

callButton.onclick = function (e) {
    e.preventDefault();

    initializeConnection();
};

quitButton.onclick = function (e) {
    e.preventDefault();

    if (localStream) {
        // stop is not a function for localStream
        // localStream.stop();
    }

    if (pc) {
        pc.removeStream(localStream);
        pc.close();
        socket.close();
        localVideo.src = null;
        remoteVideo.src = null;
    }

    startButton.disabled = false;
    callButton.disabled = false;
    quitButton.disabled = true;
};

window.onbeforeunload = function () {
    sendMessage('bye');
}

function initializeConnection() {
    if (!room) {
        // todo: how to handle this error better?
        alert('Invalid room name');
        return;
    }

    startOrJoin();

    startButton.disabled = true;
    callButton.disabled = true;
    quitButton.disabled = false;
}

//////////////////////////////////////////////////////
// WEBRTC STUFF STARTS HERE

// RTCPeerConnection configuration.
// I'm testing inside the enterprise network so I set it as null
// We can also use google's STUN server or deploy our own TURN server
/* var pcConfig = {
    iceServers: [{
        "urls": "stun:stun.l.google.com:19302"
    }]
}; */
var pcConfig = null;

function sendMessage(message) {
    console.log('Client sending message: ', message);
    socket.emit('message', message);
}

function startOrJoin(caller) {
    createSignalingChannel();

    navigator.getUserMedia({
        autio: false,
        video: true
    }, gotStream, errorHandler);
}

function createSignalingChannel() {
    if (location.hostname == '127.0.0.1') {
        socket = io.connect('127.0.0.1:8884');
    } else {
        socket = io.connect('10.144.20.67:8884');
    }
    socket.emit('create or join', room);

    socket.on('created', function (room) {
        console.log('Created room ' + room);
        // isInitiator = true;
        isCaller = true;
    });

    socket.on('full', function (room) {
        console.log('Room ' + room + ' is full');
        alert('Room ' + room + ' is full');
    });

    // join and joined are more like callee channel ready event
    socket.on('join', function (room) {
        console.log('Another peer made a request to join room ' + room);
        console.log('This peer is the initiator of room ' + room + '!');
        isChannelReady = true;
    });

    socket.on('joined', function (room) {
        console.log('joined: ' + room);
        isChannelReady = true;
    });

    socket.on('callerReady', function () {
        console.log('Caller signaling channel is ready');
        isChannelReady = true;
    });

    socket.on('log', function (array) {
        console.log.apply(console, array);
    });

    // This client receives a message
    socket.on('message', function (message) {
        console.log('Client received message:', message);
        if (message === 'got user media') {
            maybeStart();
        } else if (message.type === 'offer') {
            if (!isCaller && !isStarted) {
                maybeStart();
            }
            pc.setRemoteDescription(new RTCSessionDescription(message));
            doAnswer();
        } else if (message.type === 'answer' && isStarted) {
            pc.setRemoteDescription(new RTCSessionDescription(message));
        } else if (message.type === 'candidate' && isStarted) {
            var candidate = new RTCIceCandidate({
                sdpMLineIndex: message.label,
                candidate: message.candidate
            });
            pc.addIceCandidate(candidate);
        } else if (message === 'bye' && isStarted) {
            handleRemoteHangup();
        } else if (!isCaller && message === 'callerReady') {
            isChannelReady = true;
        }
    });
}

function gotStream(stream) {
    console.log('Adding local stream.');
    localVideo.src = window.URL.createObjectURL(stream);
    localStream = stream;
    sendMessage('got user media');
    if (isCaller) {
      maybeStart();
    }
}

function errorHandler(error) {
    alert('getUserMedia() error: ' + error.message);
}

function maybeStart() {
    console.log('>>>>>>> maybeStart() ', isStarted, localStream, isChannelReady);
    if (!isStarted && typeof localStream !== 'undefined' && isChannelReady) {
        console.log('>>>>>> creating peer connection');
        createPeerConnection();
        pc.addStream(localStream);
        isStarted = true;
        console.log('The caller:' + socket.id + 'will createCall');
        if (isCaller) {
            sendMessage('callerReady');
            doCall();
        }
    }
}

function createPeerConnection() {
    try {
        pc = new RTCPeerConnection(null);
        pc.onicecandidate = handleIceCandidate;
        pc.onaddstream = handleRemoteStreamAdded;
        pc.onremovestream = handleRemoteStreamRemoved;
        console.log('Created RTCPeerConnnection');
    } catch (e) {
        console.log('Failed to create PeerConnection, exception: ' + e.message);
        alert('Cannot create RTCPeerConnection object.');
        return;
    }
}

function handleIceCandidate(event) {
    console.log('icecandidate event is coming: ', event);
    if (event.candidate) {
        sendMessage({
            type: 'candidate',
            label: event.candidate.sdpMLineIndex,
            id: event.candidate.sdpMid,
            candidate: event.candidate.candidate
        });
    } else {
        console.log('End of candidates.');
    }
}

function handleRemoteStreamAdded(event) {
    console.log('Remote stream added.');
    remoteVideo.src = window.URL.createObjectURL(event.stream);
    remoteStream = event.stream;
}

function handleRemoteStreamRemoved(event) {
    console.log('Remote stream removed. Event: ', event);
}

// caller is creating offer
function doCall() {
    console.log('Caller is sending offer to peer');
    pc.createOffer(setLocalAndSendMessage, handleCreateOfferError);
}

function handleCreateOfferError(event) {
    console.log('createOffer() error: ', event);
}

// callee is creating answer
function doAnswer() {
    console.log('Callee is sending answer to peer.');
    pc.createAnswer().then(
        setLocalAndSendMessage,
        onCreateSessionDescriptionError
    );
}

function setLocalAndSendMessage(sessionDescription) {
    // todo
    // Set Opus as the preferred codec in SDP if Opus is present.
    //  sessionDescription.sdp = preferOpus(sessionDescription.sdp);
    pc.setLocalDescription(sessionDescription);
    console.log('setLocalAndSendMessage sending message', sessionDescription);
    sendMessage(sessionDescription);
}

function onCreateSessionDescriptionError(error) {
    trace('Failed to create session description: ' + error.toString());
}

function hangup() {
    console.log('Hanging up.');
    stop();
    sendMessage('bye');
}

function handleRemoteHangup() {
    console.log('Session terminated.');
    stop();
    // isInitiator = false;
}

function stop() {
    isStarted = false;
    // isAudioMuted = false;
    // isVideoMuted = false;
    pc.close();
    pc = null;
}