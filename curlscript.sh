#!/bin/bash
#curl script

IP=10.10.110.103
PORT=8089

GATEWAY="$(curl --header "Content-Type: application/json" --request POST --data '{"janus" : "create", "transaction" : "123abc"}' https://$IP:$PORT/janus -k --insecure)"
echo "${GATEWAY}"

SESSION_ID=$(echo $GATEWAY | awk '{print $9}')
echo "Session ID:" $SESSION_ID

PLUGIN="$(curl --header "Content-Type: application/json" --request POST --data '{"janus" : "attach", "plugin" : "janus.plugin.audiobridge", "transaction" : "123abc"}' https://$IP:$PORT/janus/$SESSION_ID -k --insecure)"
echo "${PLUGIN}"

PLUGIN_ID=$(echo $PLUGIN | awk '{print $11}')
echo "Plugin Handle ID:" $PLUGIN_ID

ENDPOINT="$(curl --header "Content-Type: application/json" --request POST --data '{"janus": "message", "transaction": "123abc", "body": { "room": 4545, "request": "create", "record": false, "is_private": true}}' https://$IP:$PORT/janus/$SESSION_ID/$PLUGIN_ID -k --insecure)"
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
MOUNTPOINT_CREATE="$(curl --header "Content-Type: application/json" --request POST --data '{"janus": "message", "transaction": "123abc", "body": {"request": "create", "is_private": true, "id": 4545, "type": "rtp", "audio": true, "audiopt": 10, "audioport": 8005, "audiortpmap":"opus/48000/2", "video": true, "videoport": 8004, "videopt": 96, "videortpmap": "H264/90000", "videofmtp": "profile-level-id=42e028;packetization-mode=1"}}' https://$IP:$PORT/janus/$SESSION_ID/$STREAM_PLUGIN_ID -k --insecure)"
echo "${MOUNTPOINT_CREATE}"

# And finish off by having the pi start the stream:
# raspivid -n -w 1280 -h 720 -fps 25 -g 25 -vf -t 86400000 -b 2500000 -ih -o -| ffmpeg -y -i - -c:v copy -map 0:0 -f rtp rtp://"${IP}":8004
raspivid -n -w 640 -h 480 -fps 25 -g 25 -vf -t 86400000 -b 2500000 -ih -o -| gst-launch-1.0 -q -v fdsrc ! h264parse ! rtph264pay config-interval=1 pt=96 ! udpsink host="${IP}" port=8004 alsasrc device=plughw:1,0 ! audioconvert ! audioresample ! opusenc ! rtpopuspay ! udpsink host="${IP}" port=8005 &

printf "\n\nStarted stream up to Janus\n"

# setup the receiving sink:
gst-launch-1.0 -q -m udpsrc port=5000 ! "application/x-rtp, media=(string)audio, encoding-name=(string)OPUS, payload=(int)100, rate=16000, channels=(int)1" ! rtpopusdepay ! opusdec !  audioconvert ! audiorate ! audioresample ! alsasink device=plughw:1,0 &

printf "\n\nStarted sink for Janus\n"