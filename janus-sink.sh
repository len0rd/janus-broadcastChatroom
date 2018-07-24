# setup the receiving sink:
printf "Starting sink for Janus\n"
gst-launch-1.0 -m udpsrc port=5000 ! "application/x-rtp, media=(string)audio, encoding-name=(string)OPUS, payload=(int)100, rate=16000, channels=(int)1" ! rtpopusdepay ! opusdec !  audioconvert ! audiorate ! audioresample ! alsasink device=plughw:1,0