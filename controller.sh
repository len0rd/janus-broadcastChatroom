#!/bin/bash
#curl script

IP=10.10.110.103
PORT=8089
FILE_PORT=8080
ROOM=4556

GATEWAY="$(curl --header "Content-Type: application/json" --request POST --data '{"janus" : "create", "transaction" : "123abc"}' https://$IP:$PORT/janus -k --insecure)"
echo "${GATEWAY}"

SESSION_ID=$(echo $GATEWAY | awk '{print $9}')
echo "Session ID:" $SESSION_ID

PLUGIN="$(curl --header "Content-Type: application/json" --request POST --data '{"janus" : "attach", "plugin" : "janus.plugin.audiobridge", "transaction" : "123abc"}' https://$IP:$PORT/janus/$SESSION_ID -k --insecure)"
echo "${PLUGIN}"

PLUGIN_ID=$(echo $PLUGIN | awk '{print $11}')
echo "Plugin Handle ID:" $PLUGIN_ID

ENDPOINT="$(curl --header "Content-Type: application/json" --request POST --data '{"janus": "message", "transaction": "123abc", "body": { "room": '"$ROOM"', "request": "create", "record": false, "is_private": true}}' https://$IP:$PORT/janus/$SESSION_ID/$PLUGIN_ID -k --insecure)"
echo "${ENDPOINT}"

#ROOM_ID=$(echo $ENDPOINT | awk '{print $19}')
#ROOM=${ROOM_ID::-1}
#echo "Room ID:" $ROOM

# Create a mountpoint for the stream:
# First attach the streaming plugin
PLUGIN="$(curl --header "Content-Type: application/json" --request POST --data '{"janus" : "attach", "plugin" : "janus.plugin.streaming", "transaction" : "123abc"}' https://$IP:$PORT/janus/$SESSION_ID -k --insecure)"
echo "${PLUGIN}"
STREAM_PLUGIN_ID=$(echo $PLUGIN | awk '{print $11}')

# send out email with URL
URL="https://$IP:$FILE_PORT?r=$ROOM"
EMAIL="tylerm15@gmail.com jennawong16@gmail.com"
#export $URL
echo "Save your boi's life: " $URL | mail -s "Videoroom URL" $EMAIL 

# Now create the mountpoint:
MOUNTPOINT_CREATE="$(curl --header "Content-Type: application/json" --request POST --data '{"janus": "message", "transaction": "123abc", "body": {"request": "create", "is_private": true, "id": '"$ROOM"', "type": "rtp", "audio": true, "audiopt": 10, "audioport": 8005, "audiortpmap":"opus/48000/2", "video": true, "videoport": 8004, "videopt": 96, "videortpmap": "H264/90000", "videofmtp": "profile-level-id=42e028;packetization-mode=1"}}' https://$IP:$PORT/janus/$SESSION_ID/$STREAM_PLUGIN_ID -k --insecure)"
echo "${MOUNTPOINT_CREATE}"

# And finish off by having the pi start the stream:
printf "\n\nStarting stream up to Janus\n"
#raspivid -n -w 1280 -h 720 -fps 25 -g 25 -vf -t 86400000 -b 2500000 -ih -o -| ffmpeg -y -i - -c:v copy -map 0:0 -f rtp rtp://"${IP}":8004
# raspivid -n -w 640 -h 480 -fps 25 -g 25 -vf -t 86400000 -b 2500000 -ih -o -| gst-launch-1.0 -v fdsrc ! h264parse ! rtph264pay config-interval=1 pt=96 ! udpsink host="${IP}" port=8004 alsasrc device=plughw:1,0 ! audioconvert ! audioresample ! opusenc ! rtpopuspay ! udpsink host="${IP}" port=8005
gst-launch-1.0 rpicamsrc ! video/x-raw,width=640,height=480 ! x264enc speed-preset=ultrafast tune=zerolatency byte-stream=true bitrate=200 threads=1 ! h264parse config-interval=1 ! rtph264pay pt=96 ! udpsink host="${IP}" port=8004 alsasrc device=plughw:1,0 ! audioconvert ! audioresample ! opusenc ! rtpopuspay ! udpsink host="${IP}" port=8005