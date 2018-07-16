#!/bin/bash
#curl script

IP=10.10.110.103
PORT=8089

GATEWAY="$(curl --header "Content-Type: application/json" --request POST --data '{"janus" : "create", "transaction" : "123abc"}' https://$IP:$PORT/janus -k --insecure)"
echo "${GATEWAY}"

SESSION_ID=$(echo $GATEWAY | awk '{print $9}')
echo "Session ID:" $SESSION_ID

PLUGIN="$(curl --header "Content-Type: application/json" --request POST --data '{"janus" : "attach", "plugin" : "janus.plugin.videoroom", "transaction" : "123abc"}' https://$IP:$PORT/janus/$SESSION_ID -k --insecure)"
echo "${PLUGIN}"

PLUGIN_ID=$(echo $PLUGIN | awk '{print $11}')
echo "Plugin Handle ID:" $PLUGIN_ID

ENDPOINT="$(curl --header "Content-Type: application/json" --request POST --data '{"janus": "message", "transaction": "123abc", "body": { "room": '"${PLUGIN_ID}"', "request": "create", "publishers": 10, "record": false, "is_private": true, "fir_freq": 10, "bitrate": 128000}}' https://$IP:$PORT/janus/$SESSION_ID/$PLUGIN_ID -k --insecure)"
echo "${ENDPOINT}"

ROOM_ID=$(echo $ENDPOINT | awk '{print $19}')
ROOM=${ROOM_ID::-1}
echo "Room ID:" $ROOM