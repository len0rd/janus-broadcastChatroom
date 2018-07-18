// We make use of this 'server' variable to provide the address of the
// REST Janus API. By default, in this example we assume that Janus is
// co-located with the web server hosting the HTML pages but listening
// on a different port (8089)

//TODO: Eventually this code will be client/participant only -> will need
//to weed most of the host code (clients will still need to recognize)
//when a remote feed is 
var server = "https://" + window.location.hostname + ":8089/janus";

var isHost = (getQueryStringValue("c") === "1" || getQueryStringValue("c") === "y");
var room   = Number(getQueryStringValue("r"));

//should be able to get rid of all this crap
//const MAX_PARTICIPANTS = 6;
//const REMOTE_INIT_INDEX = isHost ? 1 : 2;
//const LOCAL_VIDEO_ID = isHost ? '#videocontainer0' : '#videocontainer1';
//const LOCAL_LABEL_ID = isHost ? '#videolabel0' : '#videolabel1';
//var feeds = [];

var janus = null;
var audioHandle = null;
var streamingHandle = null;
var opaqueId = "demo-" + Janus.randomString(12);

var myusername = null;
var myid = null;
var mystream = null;
// We use this other ID just to map our subscriptions to us
//var mypvtid = null;
var webrtcUp = false;
var audioenabled = false;
var bitrateTimer;

window.onbeforeunload = function(event) {
	// janus.destroy(); // potential issue if janus not initialized
	if (janusHandle !== null && isHost) {
		//try and send a destroy request... good luck getting it through in time
		var destroy = {"request": "destroy", "room": room};
		janusHandle.send({"message": destroy});
	}
};

$(document).ready(function() {
	// Initialize the library (all console debuggers enabled)
	Janus.init({debug: "all", callback: function(){
		// Use a button to start the demo
		//$('#stop').one('click', function() {
		$(this).attr('disabled', true).unbind('click');
		// Make sure the browser supports WebRTC
		if(!Janus.isWebrtcSupported()) {
			bootbox.alert("No WebRTC support... ");
			return;
		}
		// Create session
		janus = new Janus({
			server: server,
			success: function() {
				// Attach to video room plugin
				janus.attach({
					plugin: "janus.plugin.audiobridge",
					opaqueId: opaqueId,
					success: function(pluginHandle) {
						audioHandle = pluginHandle;
						Janus.log("Plugin attached! (" + audioHandle.getPlugin() + ", id=" + audioHandle.getId() + ")");
						// Prepare the username registration
						$('#videojoin').removeClass('d-none').show();
						$('#register').click(registerUsername);
						$('#username').focus();
						$('#stop').click(function() {
							$(this).attr('disabled', true);
							janus.destroy();
						});
					},
					error: function(error) {
						Janus.error("Error attaching audiobridge plugin...", error);
						bootbox.alert("Error attaching plugin... " + error);
					},
					consentDialog: function(on) {
						Janus.debug("Consent dialog should be " + (on ? "on" : "off") + " now");
						if(on) {
							// Darken screen and show hint
							$.blockUI({ 
								message: '<div></div>',
								css: {
									border: 'none',
									padding: '15px',
									backgroundColor: 'transparent',
									color: '#aaa',
									top: '10px',
									left: (navigator.mozGetUserMedia ? '-100px' : '300px')
								} });
						} else {
							// Restore screen
							$.unblockUI();
						}
					},
					onmessage: function(msg, jsep) {
						Janus.debug(" ::: Got a message :::");
						Janus.debug(msg);
						var event = msg["audiobridge"];
						Janus.debug("Event: " + event);
						if (event != undefined && event != null) {
							if (event === "joined") {
								// Successfully joined, negotiate WebRTC now
								myid = msg["id"];
								Janus.log("Successfully joined room " + msg["room"] + " with ID " + myid);
								if(!webrtcUp) {
									webrtcUp = true;
									// Publish our stream
									audioHandle.createOffer({
										media: { video: false},	// This is an audio only room
										success: function(jsep) {
											Janus.debug("Got SDP!");
											Janus.debug(jsep);
											var publish = { "request": "configure", "muted": false };
											audioHandle.send({"message": publish, "jsep": jsep});
										},
										error: function(error) {
											Janus.error("WebRTC error:", error);
											bootbox.alert("WebRTC error... " + JSON.stringify(error));
										}
									});
								}

								// if we have a streaming handle, connect to the default stream for the room;
								if (streamingHandle !== null) {
									connectRoomStream();
								}

								// Any room participant?
								if (msg["participants"] !== undefined && msg["participants"] !== null) {
									var list = msg["participants"];
									generateParticipantList(list);
								}
							} else if(event === "roomchanged") {
								// The user switched to a different room
								myid = msg["id"];
								Janus.log("Moved to room " + msg["room"] + ", new ID: " + myid);
								// Any room participant?
								if(msg["participants"] !== undefined && msg["participants"] !== null) {
									var list = msg["participants"];
									generateParticipantList(list);
								}
							} else if(event === "destroyed") {
								// The room has been destroyed
								Janus.warn("The room has been destroyed!");
								bootbox.alert("The room has been destroyed", function() {
									window.location.reload();
								});
							} else if(event === "event") {
								if (msg["participants"] !== undefined && msg["participants"] !== null) {
									var list = msg["participants"];
									generateParticipantList(list);

								} else if(msg["error"] !== undefined && msg["error"] !== null) {
									if(msg["error_code"] === 485) {
										// This is a "no such room" error: give a more meaningful description
										bootbox.alert("Room <code>" + room + "</code> does not exist");
									} else {
										bootbox.alert(msg["error"]);
									}
									return;
								}
								// Any new feed to attach to?
								if(msg["leaving"] !== undefined && msg["leaving"] !== null) {
									// One of the participants has gone away?
									var leaving = msg["leaving"];
									Janus.log("Participant left: " + leaving + " (we have " + $('#rp' + leaving).length + " elements with ID #rp" + leaving + ")");
									$('#rp' + leaving).remove();
								}
							}
						}

						if(jsep !== undefined && jsep !== null) {
							Janus.debug("Handling SDP as well...");
							Janus.debug(jsep);
							audioHandle.handleRemoteJsep({jsep: jsep});
						}
					},
					onlocalstream: function(stream) {
						//deals with properly attaching the local stream
						//note that clients cannot hear themselves, only 
						//the other people on the call
						Janus.debug(" ::: Got local stream :::");
						mystream = stream;
						Janus.debug(stream);
						//hide the login screen (where you pick a username)
						$('#videojoin').hide();
						//show all the video containers
						$('#mediacontainer').removeClass('d-none').show();
						$('#stop').removeClass('d-none').show();
					},
					onremotestream: function(stream) {
						$('#mediacontainer').removeClass('d-none').show();
						var addMute = false;
						if ($('#mixedaudio').length === 0) {
							addMute = true;
							$('#audiocontainer0').append('<audio class="rounded centered" id="mixedaudio" width="100%" height="100%" autoplay/>');
						}
						Janus.attachMediaStream($('#mixedaudio').get(0), stream);

						if (addMute) {
							audioenabled = true;
							$('#mute').click(function() {
								audioenabled = !audioenabled;
								$('#mute').html(audioenabled ? "Mute" : "Unmute");
								audioHandle.send({message: {"request": "configure", "muted": !audioenabled}});
							}).removeClass('d-none').show();
						}
					},
					oncleanup: function() {
						Janus.log(" ::: Got a cleanup notification :::");
						webrtcUp = false;
						$('#clientlist').empty();
						$('#bitrate').parent().parent().addClass('d-none');
						$('#bitrate a').unbind('click');
					}
				});

				// Attach to streaming plugin
				janus.attach({
					plugin: "janus.plugin.streaming",
					opaqueId: opaqueId,
					success: function(pluginHandle) {
						Janus.log("Steam plugin attached!");
						streamingHandle = pluginHandle;
					},
					error: function(error) {
						Janus.error(" ==> ERROR attaching streaming plugin", error);
						bootbox.alert("Error streaming video: " + error);
					},
					onmessage: function(msg, jsep) {
						Janus.debug(" ==> Streaming Handle got a message");
						Janus.debug(msg);
						var result = msg["result"];
						if (result !== null && result !== undefined) {
							// you can get a bunch of info about status here.
							// see the streamingtest example for details
						} else if (msg["error"] !== null && msg["error"] !== undefined) {
							bootbox.alert(msg["error"]);
							Janus.log(" ==> Streaming got error message: ", msg);
							return;
						}

						if(jsep !== undefined && jsep !== null) {
							Janus.debug("Handling SDP as well...");
							Janus.debug(jsep);
							// Offer from the plugin, let's answer
							streamingHandle.createAnswer({
								jsep: jsep,
								media: { audioSend: false, videoSend: false },	// We want recvonly audio/video
								success: function(jsep) {
									Janus.debug("Got SDP!");
									Janus.debug(jsep);
									var body = { "request": "start" };
									streamingHandle.send({"message": body, "jsep": jsep});
									$('#watch').html("Stop").removeAttr('disabled').click(stopStream);
								},
								error: function(error) {
									Janus.error("WebRTC error:", error);
									bootbox.alert("WebRTC error... " + JSON.stringify(error));
								}
							});
						}
					},
					onremotestream: function(stream) {
						// We got the non-webrtc remote stream!
						if ($('#remotevideo0').length === 0) {
							//if the video tag hasn't been made yet, create it
							$('#videocontainer0').append('<video class="rounded centered relative d-none" id="remotevideo0" width="100%" height="100%" autoplay/>');
							// and the little badge for bitrate
							$('#videocontainer0').append(
								'<span class="badge badge-pill badge-secondary d-none" id="curbitrate0" style="position: absolute; bottom: 0px; right: 0px; margin: 15px;"></span>');
						}

						Janus.attachMediaStream($('#remotevideo0').get(0), stream);
						var videoTracks = stream.getVideoTracks();
						if (videoTracks === null || videoTracks === undefined || videoTracks.length === 0) {
							// No remote video
							//if this is the host stream and it has no video
							//display a nice little icon indicating this
							$('#remotevideo0').hide();
							if($('#videocontainer0' + ' .no-video-container').length === 0) {
								$('#videocontainer0').append(
									'<div class="no-video-container">' +
										'<i class="fa fa-video-camera fa-5 no-video-icon"></i>' +
										'<span class="no-video-text">No remote video available</span>' +
									'</div>');
							}
						} else {
							//we got a video track:
							$('#videocontainer0 .no-video-container').remove();
							$('#remotevideo0').removeClass('d-none').show();
						}

						//bitrate time junk:
						if (videoTracks && videoTracks.length && (
							Janus.webRTCAdapter.browserDetails.browser === "chrome" 
							|| Janus.webRTCAdapter.browserDetails.browser === "firefox" 
							|| Janus.webRTCAdapter.browserDetails.browser === "safari")) {
							
								$('#curbitrate0').removeClass('d-none').show();
								bitrateTimer[0] = setInterval(function() {
								// Display updated bitrate, if supported
								var bitrate = streamingHandle.getBitrate();
								$('#curbitrate0').text(bitrate);
							}, 1000);
						}
						
					},
					oncleanup: function() {
						Janus.log("cleanup notification for remote streaming video");
						
						$('#remotevideo0').remove();
						if (bitrateTimer[0] !== null && bitrateTimer[0] !== undefined) {
							clearInterval(bitrateTimer[0]);
						}
					}
				});
			},
			error: function(error) {
				Janus.error(error);
				bootbox.alert(error, function() {
					window.location.reload();
				});
			},
			destroyed: function() {
				window.location.reload();
			}
		});
	}});
});

function generateParticipantList(list) {
	$('#clientlist').empty();
	Janus.debug("Got a list of participants:");
	Janus.debug(list);
	for (var f in list) {
		var id = list[f]["id"];
		var display = list[f]["display"];
		var setup = list[f]["setup"];
		var muted = list[f]["muted"];

		Janus.debug("  >> [" + id + "] " + display + " (setup=" + setup + ", muted=" + muted + ")");
		if ($('#rp' + id).length === 0) {
			// Add to the participants list
			$('#clientlist').append('<li id="rp' + id + '" class="list-group-item">' + display +
				' <i class="absetup fa fa-chain-broken"></i>' +
				' <i class="abmuted fa fa-microphone-slash"></i></li>');
			$('#rp' + id + ' > i').addClass('d-none').hide();
		}
		if (muted === true || muted === "true")
			$('#rp' + id + ' > i.abmuted').removeClass('d-none').show();
		else
			$('#rp' + id + ' > i.abmuted').addClass('d-none').hide();
		if (setup === true || setup === "true")
			$('#rp' + id + ' > i.absetup').addClass('d-none').hide();
		else
			$('#rp' + id + ' > i.absetup').removeClass('d-none').show();
	}
}

/**
 * Helper method
 * Connects to the default stream for the room
 * The stream is a non-WebRTC stream published by something
 */
function connectRoomStream() {
	// Request to watch the default stream for the room.
	var request = {"request": "watch", "id": room};
	streamingHandle.send({"message": request});
}

// Helper to parse query string
function getQueryStringValue(name) {
	name = name.replace(/[\[]/, "\\[").replace(/[\]]/, "\\]");
	var regex = new RegExp("[\\?&]" + name + "=([^&#]*)"),
		results = regex.exec(location.search);
	return results === null ? "" : decodeURIComponent(results[1].replace(/\+/g, " "));
}

function checkEnter(field, event) {
	var theCode = event.keyCode ? event.keyCode : event.which ? event.which : event.charCode;
	if (theCode == 13) {
		registerUsername();
		return false;
	} else {
		return true;
	}
}

function registerUsername() {
	if ($('#username').length === 0) {
		// Create fields to register
		$('#register').click(registerUsername);
		$('#username').focus();
	} else {
		// Try a registration
		$('#username').attr('disabled', true);
		$('#register').attr('disabled', true).unbind('click');
		var username = $('#username').val();
		//failure condition
		if(username === "") {
			$('#you')
				.removeClass().addClass('label label-warning')
				.html("Insert your display name (e.g., HomeOwner, Police, EMS)");
			$('#username').removeAttr('disabled');
			$('#register').removeAttr('disabled').click(registerUsername);
			return;
		}
		//failure condition
		if(/[^a-zA-Z0-9]/.test(username)) {
			$('#you')
				.removeClass().addClass('label label-warning')
				.html('Input is not alphanumeric');
			$('#username').removeAttr('disabled').val("");
			$('#register').removeAttr('disabled').click(registerUsername);
			return;
		}
		var register = {"request": "join", "room": room, "display": username};
		myusername = username;
		audioHandle.send({"message": register});
	}
}