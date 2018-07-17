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

ENDPOINT="$(curl --header "Content-Type: application/json" --request POST --data '{"janus": "message", "transaction": "123abc", "body": { "room": 4545, "request": "create", "publishers": 10, "record": false, "is_private": true, "fir_freq": 10, "bitrate": 128000}}' https://$IP:$PORT/janus/$SESSION_ID/$PLUGIN_ID -k --insecure)"
echo "${ENDPOINT}"

ROOM_ID=$(echo $ENDPOINT | awk '{print $19}')
ROOM=${ROOM_ID::-1}
echo "Room ID:" $ROOM

# Create a mountpoint for the stream:
# First attach the streaming plugin
PLUGIN="$(curl --header "Content-Type: application/json" --request POST --data '{"janus" : "attach", "plugin" : "janus.plugin.streaming", "transaction" : "123abc"}' https://$IP:$PORT/janus/$SESSION_ID -k --insecure)"
echo "${PLUGIN}"
STREAM_PLUGIN_ID=$(echo $PLUGIN | awk '{print $11}')

# Now create the mountpoint:
MOUNTPOINT_CREATE="$(curl --header "Content-Type: application/json" --request POST --data '{"janus": "message", "transaction": "123abc", "body": {"request": "create", "is_private": false, "id": 4545, "type": "rtp", "audio": false, "video": true, "videoport": 8004, "videopt": 126, "videortpmap": "H264/90000", "videofmtp": "profile-level-id=42e01f"}}' https://$IP:$PORT/janus/$SESSION_ID/$STREAM_PLUGIN_ID -k --insecure)"
echo "${MOUNTPOINT_CREATE}"

# And finish off by having the pi start the stream:
raspivid --verbose --nopreview --width 640 --height 480 --framerate 15 --bitrate 1000000 --profile baseline --timeout 0 -o - | gst-launch-1.0 -v fdsrc !  h264parse ! rtph264pay config-interval=1 pt=96 ! udpsink host=$IP port=8004
