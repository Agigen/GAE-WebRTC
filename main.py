#!/usr/bin/env python

import webapp2
import json
import time
import logging
import uuid

from google.appengine.api import channel
from google.appengine.api import memcache
from google.appengine.api import users

#from google.appengine.ext import ndb


MC_LISTENING_CLIENTS="listening_clients_%s"

def add_listener(lid, room):
    mc_client = memcache.Client()
    while True:
        listeners = mc_client.gets(MC_LISTENING_CLIENTS % room)
        if listeners is None:
            memcache.set(MC_LISTENING_CLIENTS % room, {lid: time.time()})
            break

        keys_to_del = []
        for k, l in listeners.items():
            if l < time.time() - 3600:
                keys_to_del.append(k)
        for k in keys_to_del:
            del listeners[k]

        listeners[lid] = time.time()

        if mc_client.cas(MC_LISTENING_CLIENTS % room, listeners):
            break

    return channel.create_channel(lid + room)


def broadcast(from_lid, room, msg):
    listeners = memcache.get(MC_LISTENING_CLIENTS % room)
    if not listeners:
        return
    for lid, t in listeners.items():
        if t < time.time() - 3600:
            continue
        if lid == from_lid:
            continue

        logging.info("sending message to %s" % lid)
        send_message(from_lid, lid, room, msg)



def send_message(from_, to, room, message):
    channel.send_message(to + room, json.dumps({
        'message': message,
        'from': from_,
        'to': to,
    }))


class MessageHandler(webapp2.RequestHandler):
    def post(self, to=None):
        user_id = self.request.cookies.get('uid')

        if user_id:
            logging.info('Send message');
            if to:
                send_message(user_id, to, self.request.get('room', 'default'), json.loads(self.request.get('message', '{}')))
            else:
                broadcast(user_id, self.request.get('room', 'default'), json.loads(self.request.get('message', '{}')))


class TokenHandler(webapp2.RequestHandler):
    def get(self):
        self.response.headers['Content-Type'] = 'application/json'
        user_id = self.request.cookies.get('uid')

        if not user_id:
            user_id = str(uuid.uuid4())
            self.response.set_cookie('uid', user_id)

        self.response.out.write(json.dumps({
            'token': add_listener(user_id, self.request.get('room', 'default'))
        }))


app = webapp2.WSGIApplication([
    # not found api error
    (r'/api/get-token', TokenHandler),
    (r'/api/message', MessageHandler),
])
