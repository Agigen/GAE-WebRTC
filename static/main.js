(function($, goog, agigen) {
"use strict";

var channel, socket;

$.get('/api/get-token', {room: 1}, function(response) {
    if (response.redirect_url) {
        window.location = response.redirect_url;
        return;
    }

    channel = new goog.appengine.Channel(response.token);
    socket = channel.open();

    socket.onopen = function() {
        console.log("socket open");

        window.rtc = new agigen.webRtc.RTC({channelSocket: socket});
    };

    socket.sendMessage = function(message) {
        $.post('/api/message', {room: 1, message: JSON.stringify(message)});
    };
});

}(window.jQuery, window.goog, window.agigen));
