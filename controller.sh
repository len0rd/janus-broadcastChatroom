#!/bin/bash
#curl script

IP=10.10.110.103
PORT=8089
FILE_PORT=8080
ROOM=4556

echo "Connect to Janus..."
GATEWAY="$(curl --header "Content-Type: application/json" --request POST --data '{"janus" : "create", "transaction" : "123abc"}' https://$IP:$PORT/janus -k --insecure)"
echo "${GATEWAY}"
SESSION_ID=$(echo $GATEWAY | awk '{print $9}')
echo "Session ID:" $SESSION_ID

echo "Attach to AudioBridge"
PLUGIN="$(curl --header "Content-Type: application/json" --request POST --data '{"janus" : "attach", "plugin" : "janus.plugin.audiobridge", "transaction" : "123abc"}' https://$IP:$PORT/janus/$SESSION_ID -k --insecure)"
echo "${PLUGIN}"
AUDIO_PLUGIN_ID=$(echo $PLUGIN | awk '{print $11}')
echo "Plugin Handle ID:" $AUDIO_PLUGIN_ID

echo "Create New AudioBridge room"
ENDPOINT="$(curl --header "Content-Type: application/json" --request POST --data '{"janus": "message", "transaction": "123abc", "body": { "room": '"${ROOM}"', "request": "create", "record": false, "is_private": true}}' https://$IP:$PORT/janus/$SESSION_ID/$AUDIO_PLUGIN_ID -k --insecure)"
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
echo "Send room id email"
URL="https://$IP:$FILE_PORT?r=$ROOM"
EMAIL="tylerm15@gmail.com jennawong16@gmail.com"
# send an email with a link to the room
# echo "Save your boi's life: " $URL | mail -s "Videoroom URL" $EMAIL 
echo "email sent!"

# Now create the mountpoint for A/V from Controller -> Janus
echo "Setup Janus mountpoint for our stream"
MOUNTPOINT_CREATE="$(curl --header "Content-Type: application/json" --request POST --data '{"janus": "message", "transaction": "123abc", "body": {"request": "create", "is_private": true, "id": '"${ROOM}"', "type": "rtp", "audio": true, "audiopt": 10, "audioport": 8005, "audiortpmap":"opus/48000/2", "video": true, "videoport": 8004, "videopt": 96, "videortpmap": "H264/90000", "videofmtp": "profile-level-id=42e028;packetization-mode=1"}}' https://$IP:$PORT/janus/$SESSION_ID/$STREAM_PLUGIN_ID -k --insecure)"
# srtp encrypt?
# MOUNTPOINT_CREATE="$(curl --header "Content-Type: application/json" --request POST --data '{"janus": "message", "transaction": "123abc", "body": {"request": "create", "is_private": true, "id": '"${ROOM}"', "type": "rtp", "audio": true, "audiopt": 10, "audioport": 8005, "audiortpmap": "opus/48000/2", "video": true, "videoport": 8004, "videopt": 96, "videortpmap": "H264/90000", "videofmtp": "profile-level-id=42e028;packetization-mode=1", "srtpsuite": 32, "srtpcrypto": "WbTBosdVUZqEb6Htqhn+m3z7wUh4RJVR8nE15GbN"}}' https://$IP:$PORT/janus/$SESSION_ID/$STREAM_PLUGIN_ID -k --insecure)"
echo "${MOUNTPOINT_CREATE}"

# Setup the RTP forward of the AudioBridge from Janus -> Controller
# first get this machine's ip
echo "Setup our listener to receive audio from Janus"
printf "Start gst listener\n\n"
exec ./janus-sink.sh &

LOCAL_IP="$(hostname -I)"
RTP_FORWARD_RESULT="$(curl --header "Content-Type: application/json" --request POST --data '{"janus": "message", "transaction": "1234asdf", "body": {"request": "rtp_forward", "room": '"${ROOM}"', "host": "10.10.110.74", "port": 5000, "ptype": 100}}' https://$IP:$PORT/janus/$SESSION_ID/$AUDIO_PLUGIN_ID -k --insecure)"
echo "${RTP_FORWARD_RESULT}"

# And finish off by having the pi start the stream:
printf "\n\nStarting stream up to Janus\n"
# raspivid -n -w 1280 -h 720 -fps 25 -g 25 -vf -t 86400000 -b 2500000 -ih -o -| ffmpeg -y -i - -c:v copy -map 0:0 -f rtp rtp://"${IP}":8004
# raspivid -n -w 640 -h 480 -fps 25 -g 25 -vf -t 86400000 -b 2500000 -ih -o -| gst-launch-1.0 -v fdsrc ! h264parse ! rtph264pay config-interval=1 pt=96 ! udpsink host="${IP}" port=8004 alsasrc device=plughw:1,0 ! audioconvert ! audioresample ! opusenc ! rtpopuspay ! udpsink host="${IP}" port=8005
 gst-launch-1.0 rpicamsrc ! video/x-raw,width=640,height=480 ! x264enc speed-preset=ultrafast tune=zerolatency byte-stream=true bitrate=200 threads=1 ! h264parse config-interval=1 ! rtph264pay pt=96 ! udpsink host="${IP}" port=8004 alsasrc device=plughw:1,0 ! audioconvert ! audioresample ! opusenc ! rtpopuspay ! udpsink host="${IP}" port=8005
# srtp encrypt?
# gst-launch-1.0 rpicamsrc ! video/x-raw,width=640,height=480 ! x264enc speed-preset=ultrafast tune=zerolatency byte-stream=true bitrate=400 threads=1 ! h264parse config-interval=1 ! rtph264pay ! 'application/x-srtp, payload=(int)96, ssrc=(uint)1356955624' ! srtpenc key="WbTBosdVUZqEb6Htqhn+m3z7wUh4RJVR8nE15GbN" ! udpsink host="${IP}" port=8004