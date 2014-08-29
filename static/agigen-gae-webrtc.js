/* global define, module */
(function (factory) {
    "use strict";
    if ( typeof define === 'function' && define.amd ) {
        // AMD. Register as an anonymous module.
        define('agigen-gae-webrtc', [], factory);
    } else if (typeof exports === 'object') {
        // Node/CommonJS style for Browserify
        module.exports = factory;
    } else {
        // Browser globals
        window.agigen = window.agigen || {};
        window.agigen.webRtc = factory();
    }
}(function() {

"use strict";

var Peer, PeerConnection, SessionDescription, IceCandidate, debug, RTC, servers;

PeerConnection = window.RTCPeerConnection || window.mozRTCPeerConnection || window.webkitRTCPeerConnection;
SessionDescription = window.RTCSessionDescription || window.mozRTCSessionDescription || window.webkitRTCSessionDescription;
IceCandidate = window.RTCIceCandidate || window.mozRTCIceCandidate || window.webkitRTCIceCandidate;

debug = (function(doDebug) {
    return doDebug ? console.log.bind(console) : function() {};
})(true);

servers = {
    'iceServers': [
        {
            'url': 'stun:stun.l.google.com:19302'
        },
    ]
};

Peer = function() {
    var availableCallbacks = ['onSend'];

    function Peer (options) {
        debug('Initializing Peer', options);

        $.extend(this, {
            onMessage: function() {},
            onOpen: function() {},
            onClose: function() {},
            onError: function() {},
            remoteClient: null,
            localClient: null,
            socket: null,
            dataChannelName: 'peerData',
        }, options);

        this.connected = false;
        this.onSend = [];
        this.iceCandidates = [];
        this.remoteDescriptionSet = false;


        this.createConnection();
    }

    Peer.prototype.addEventListener = function(event_name, callback) {
        if (typeof callback !== 'function') {
            throw "Callback is not a function";
        }

        if (availableCallbacks.indexOf(event_name) !== -1) {
            this[event_name].push(callback);
        }
    };

    Peer.prototype.setLocalAndSendMessage = function (description) {
        this.connection.setLocalDescription(description);
        this.sendHandshakeEvent('description', {'description': JSON.stringify(description)});
    }

    Peer.prototype.createConnection = function() {
        var connection, sendChannel, receiveChannel, handleSendChannelStateChange, handleReceiveChannelStateChange, handleChannelError;

        debug('Creating Peer Connection');

        this.connection = connection = new PeerConnection(servers);

        handleSendChannelStateChange = function () {
            var readyState = sendChannel.readyState;
            debug('Send channel state is: ' + readyState);
            if (readyState === "open") {
                this.connected = true;
                this.onOpen(this.remoteClient);
            } else {
                this.connected = false;
                this.onClose();
            }
        };

        handleReceiveChannelStateChange = function () {
            var readyState = receiveChannel.readyState;
            debug('Receive channel state is: ' + readyState);
        };

        handleChannelError = function(error) {
            debug('--- DataChannel error', error);
            this.onError(error);
        };

        sendChannel = connection.createDataChannel(this.dataChannelName, {
            reliable: true,
            ordered: true,
        });

        sendChannel.onopen = handleSendChannelStateChange.bind(this);
        sendChannel.onclose = handleSendChannelStateChange.bind(this);
        sendChannel.onerror = handleChannelError;

        this.addEventListener('onSend', function(message) {
            sendChannel.send(JSON.stringify(message));
        });

        connection.ondatachannel = function(e) {
            receiveChannel = e.channel;

            receiveChannel.onmessage = function(msg) {
                debug('--- DataChannel message received', msg);

                this.onMessage(JSON.parse(msg.data));
            }.bind(this);

            receiveChannel.onopen = handleReceiveChannelStateChange.bind(this);
            receiveChannel.onclose = handleReceiveChannelStateChange.bind(this);
            receiveChannel.onerror = handleChannelError;
        }.bind(this);

        connection.onicecandidate = function(e) {
            if (e.candidate) {
                this.sendHandshakeEvent('ice_candidate', {'candidate': JSON.stringify(e.candidate)});
                connection.onicecandidate = function() { };
            }
        }.bind(this);

        connection.oniceconnectionstatechange = function(e) {
            if (this.connection.iceConnectionState == 'disconnected') {
                debug('--- Peer connection closed', e);
            }
        }.bind(this);
    };

    Peer.prototype.send = function(message) {
        this.onSend.forEach(function(callback) {
            callback(message);
        });
    };

    Peer.prototype.sendOffer = function() {
        if (this.connected) {
            debug('Peer already connected');
            return false;
        }

        debug('Create offer handshake to ', this.remoteClient);

        this.connection.createOffer(this.setLocalAndSendMessage.bind(this), function(error) {
            console.error('Failed to create session description: ', error);
        });

        //setTimeout(this.sendOffer.bind(this), 5000);
    };

    Peer.prototype.sendAnswer = function() {
        this.connection.createAnswer(this.setLocalAndSendMessage.bind(this), function(error) {
            console.error('Failed to create session description: ', error);
        });
    };

    Peer.prototype.sendHandshakeEvent = function(eventType, data) {
        debug('Sending handshake: ', eventType, data);

        this.socket.sendMessage({
            type: 'handshake',
            data: $.extend({
                event: eventType,
            }, data)
        });
        // $.ajax({
        //     url: '/api/io/client/' + this.remoteClient.id + '/handshake/' + eventType,
        //     type: 'POST',
        //     data: $.extend({
        //         'peer_id': this.localClient,
        //     }, data)
        // });
    };

    Peer.prototype.onHandshakeEvent = function(handshake) {
        debug('Got ' + handshake.event + ' handshake');
        if (handshake.event == 'description') {
            var description = new SessionDescription(JSON.parse(handshake.description));

            debug('RECEIVE: Received description from server', description);

            debug('Setting remote description');
            this.connection.setRemoteDescription(description);
            this.remoteDescriptionSet = true;

            this.addIceClients();

            if (description.type == 'offer') {
                this.sendAnswer();
            }
        }
        else if (handshake.event == 'ice_candidate') {
            var candidate = new IceCandidate(JSON.parse(handshake.candidate));
            debug('RECEIVE: Received ice candidate from server', candidate);
            this.iceCandidates.push(candidate);

            if (this.remoteDescriptionSet) {
                this.addIceClients();
            }
        }
    };

    Peer.prototype.addIceClients = function() {
        var candidate,
            success = function() {
                debug('AddIceCandidate success.');
            },
            fail = function(error) {
                debug('Failed to add Ice Candidate: ', error);
            };

        while (this.iceCandidates.length) {
            candidate = this.iceCandidates.shift()
            debug('Adding ice candidate: ', candidate);
            this.connection.addIceCandidate(candidate, success, fail);
        }
    };

    return Peer;
}();


RTC = function() {
    function RTC (options) {
        this.peers = [];

        var socket = this.socket = options.channelSocket;

        socket.onmessage = function(message) {
            var data = JSON.parse(message.data), foundPeer = false, peer;

            console.log(data);

            switch (data.message.type) {
                case 'request':
                    peer = new Peer({
                        onMessage: function(msg) {
                            console.log(msg);
                        },
                        remoteClient: data.from,
                        localClient: data.to,
                        socket: socket,
                    });

                    peer.sendOffer();

                    this.peers.push(peer);
                    break
                case 'handshake':

                    this.peers.forEach(function(_peer) {
                        if (_peer.remoteClient == data.from) {
                            foundPeer = true
                            _peer.onHandshakeEvent(data.message.data);
                        }
                    });

                    if (!foundPeer) {
                        peer = new Peer({
                            onMessage: function(msg) {
                                console.log(msg);
                            },
                            remoteClient: data.from,
                            localClient: data.to,
                            socket: socket,
                        });
                        this.peers.push(peer);

                        peer.onHandshakeEvent(data.message.data);
                    }
                    break
            }
        }.bind(this);

        socket.sendMessage({type: 'request'});
    }

    RTC.prototype.send = function(message) {
        this.peers.forEach(function(peer) {
            console.log('send to peer', peer);
            peer.send(message);
        });
    };

    return RTC;
}();


// exports
return {
    RTC: RTC
}

}));
