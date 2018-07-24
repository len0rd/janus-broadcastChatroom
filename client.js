// We make use of this 'server' variable to provide the address of the
// REST Janus API. By default, in this example we assume that Janus is
// co-located with the web server hosting the HTML pages but listening
// on a different port (8089)

var server = "https://" + window.location.hostname + ":8089/janus";

//get the room number from the 'r' parameter in the url
const room   = Number(getQueryStringValue("r"));
//our different handlers
var janus = null;
var audioHandle = null;
var streamingHandle = null;
//this is useful purely for debugging. it allows us to assign an identical id to 
//both plugins we attach to. With some modification (same id for machine), it could
//also help track a certain user
var opaqueId = "anlive-" + Janus.randomString(12);

// basic user values
var myusername = null; //entered by user
var myid; //returned by janus on successful room join

var webrtcUp = false; //ensures we only setup the room page once
var audioenabled = false; //keep track of whether user is muted or has even approved microphone
var bitrateTimer; // subscriber for little bitrate pill in bottom-right of video 

// if the user disconnects, properly leave the room 
window.onbeforeunload = function() {
	if (audioHandle !== null) {
		// try and at least fire off a leave before the page reloads
		audioHandle.send({"message": {"request": "leave"}});
	}
}

$(document).ready(function() {
	// Initialize the library (all console debuggers enabled)
	Janus.init({debug: "all", callback: function(){
		$(this).attr('disabled', true).unbind('click');
		// Make sure the browser supports WebRTC
		if(!Janus.isWebrtcSupported()) {
			bootbox.alert("No WebRTC support... ");
			return;
		}
		// Create session with janus
		janus = new Janus({
			server: server,
			success: function() {
				// Attach to audiobridge plugin
				attachAudioBridge();
				// Attach to streaming plugin
				attachStreaming();
			},
			error: function(error) {
				//we cant go any further if we're unable to connect to the Janus server
				Janus.error(error);
				bootbox.alert(error, function() {
					window.location.reload(); //tell the user about our problems
				});
			},
			destroyed: function() {
				window.location.reload();
			}
		});
	}});
});

/**
 * Called when we successfully attach a Janus session to the server.
 * This will attach to the audio bridge plugin. This plugin handles 
 * mixing and publishing the audio of all the WebRTC participants in 
 * a room (as a single stream!). Audio bridge is also used to forward 
 * a UDP RTP stream of its audio to the linux device. However this 
 * forwarding is setup by the linux controller script in this example.
 * @see controller.sh
 */
function attachAudioBridge() {
	janus.attach({
		plugin: "janus.plugin.audiobridge",
		opaqueId: opaqueId,
		success: function(pluginHandle) {
			//we've successfully attached to the audio plugin
			audioHandle = pluginHandle;
			Janus.log("Plugin attached! (" + audioHandle.getPlugin() + ", id=" + audioHandle.getId() + ")");
			// prepare for user registration by showing the required elements
			$('#videojoin').removeClass('d-none').show();
			$('#register').click(registerUsername); 
			$('#username').focus();
			$('#stop').click(function() {
				$(this).attr('disabled', true);
				janus.destroy();
			});
		},
		error: function(error) {
			// if we faile to attach the audio bridge, we're in trouble
			Janus.error("Error attaching audiobridge plugin...", error);
			bootbox.alert("Error attaching plugin... " + error);
		},
		consentDialog: function(on) {
			// Janus triggers this callback whenever there's a change
			// in the consent dialog (the box in browser that asks for the mic)
			Janus.debug("Consent dialog should be " + (on ? "on" : "off") + " now");
			if(on) {
				// Darken screen until the user deals with the dialog
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
			// triggered when the Janus server sends us async data
			Janus.debug(" ::: Got a message :::");
			Janus.debug(msg);
			var event = msg["audiobridge"];
			Janus.debug("Event: " + event);
			//just double check this msg is meant for us
			if (event != undefined && event != null) {
				if (event === "joined") {
					// A joined event is triggered every time a new participant joins
					// including ourselves
					// see if we've already started the room/webrtc page here
					if (!webrtcUp) {
						//hide the login elements (where you pick a username)
						$('#videojoin').hide();
						//show all containers for video and participants
						$('#mediacontainer').removeClass('d-none').show();
						$('#stop').removeClass('d-none').show();

						// Successfully joined, negotiate WebRTC now
						Janus.log("Successfully joined room " + msg["room"] + " with ID " + msg["id"]);
						myid = msg["id"];
						webrtcUp = true;
						// Publish our stream
						audioHandle.createOffer({
							media: { video: false, audioSend: true, audioRecv: true},	// This is an audio only room
							success: function(jsep) {
								Janus.debug("Got SDP! JSEP::");
								Janus.debug(jsep);
								var publish = { "request": "configure", "muted": false};
								audioHandle.send({"message": publish, "jsep": jsep});
							},
							error: function(error) {
								Janus.error("WebRTC error:", error);
								// TODO: need to handle when user disallows mic. They should still be able
								// to hear and see everything. Below is a start, but not functional. 'NotAllowedError'
								// is returned when the user rejects mic priveledge (i think).
								if (error["name"] !== null && error["name"] !== undefined && error["name"] === "NotAllowedError") {
									// in this case we only got an error because the user denied mic permissions. we should
									// still show them the room. Configure ourselves as muted
									var publish = { "request": "configure", "muted": true};
									audioHandle.send({"message": publish});
								} else {
									bootbox.alert("WebRTC error... " + JSON.stringify(error));
								}
							}
						});
					}

					// if we have a streaming handle, connect to the default stream for the room;
					if (streamingHandle !== null) {
						connectRoomStream();
					}

					// Any room participant?
					if (msg["participants"] !== undefined && msg["participants"] !== null) {
						//if there are, lets update the sidebar with the list of participants
						var list = msg["participants"];
						updateParticipantList(list);
					}
				} else if (event === "destroyed") {
					// The room has been destroyed/closed
					Janus.warn("The room has been destroyed!");
					bootbox.alert("The room has been closed", function() {
						window.location.reload();
					});
				} else if (event === "event") {
					if (msg["participants"] !== undefined && msg["participants"] !== null) {
						//if the message is a participants list, lets update ours!
						var list = msg["participants"];
						updateParticipantList(list);
					} else if (msg["error"] !== undefined && msg["error"] !== null) {
						//just push the error up to the user (for now)
						if (msg["error_code"] === 485) {
							// This is a "no such room" error: give a more meaningful description
							bootbox.alert("Room <code>" + room + "</code> does not exist");
						} else {
							bootbox.alert(msg["error"]);
						}
						return;
					}
					// Any new feed to attach to?
					if (msg["leaving"] !== undefined && msg["leaving"] !== null) {
						// One of the participants has gone away?
						var leaving = msg["leaving"];
						Janus.log("Participant left: " + leaving + " (we have " + $('#rp' + leaving).length + " elements with ID #rp" + leaving + ")");
						$('#rp' + leaving).remove();
					}
				}
			}

			// SDP is apart of WebRTC that describes the session
			// and helps configure the overall conneciton. We dont
			// need to worry about the gritty details here b/c Janus
			if (jsep !== undefined && jsep !== null) {
				Janus.debug("Handling SDP as well...");
				Janus.debug(jsep);
				audioHandle.handleRemoteJsep({jsep: jsep});
			}
		},
		onlocalstream: function(stream) {
			// we dont need to do much here
			// note that clients cannot hear themselves, only 
			// the other people on the call
			Janus.debug(" ::: Got local stream :::");
			Janus.debug(stream);

			// if we have a local stream, then add a mute button
			// (so if the user reject mic permission, the mute button _shouldnt_ show up)
			if ($('#mixedaudio').length === 0) {
				audioenabled = true;
				updateSelf();

				//callback for the mute button
				$('#mute').click(function() {
					audioenabled = !audioenabled;
					$('#mute').html(audioenabled ? "Mute" : "Unmute");
					audioHandle.send({message: {"request": "configure", "muted": !audioenabled}});
					updateSelf();
				}).removeClass('d-none').show();
			}
		},
		onremotestream: function(stream) {
			// this is triggered when we receive the remote audio bridge stream from Janus
			$('#mediacontainer').removeClass('d-none').show(); //maybe this triggers before a join? show this just-in-case
			// if we haven't already made the audio object for the audio bridge, do it now
			if ($('#mixedaudio').length === 0) {
				$('#audiocontainer0').append('<audio class="rounded centered" id="mixedaudio" width="100%" height="100%" autoplay/>');
			}
			//attach the remote audio stream to our audio element
			Janus.attachMediaStream($('#mixedaudio').get(0), stream);
		},
		oncleanup: function() {
			Janus.log(" ::: Got a cleanup notification :::");
			//clear out stuff
			webrtcUp = false;
			$('#clientlist').empty();
			$('#bitrate').parent().parent().addClass('d-none');
			$('#bitrate a').unbind('click');//not sure this is necessary
		}
	});
}
/**
 * Called after successfully attaching a Janus session to the server
 * and after attaching to audiobridge plugin. This plugin directs the 
 * audio and video stream from WebRTC participants to a video conference
 * room.
 */
function attachStreaming() {
	janus.attach({
		plugin: "janus.plugin.streaming",
		opaqueId: opaqueId,
		success: function(pluginHandle) {
			//successfully attached streaming plugin
			Janus.log("Steam plugin attached!");
			//streamingHandle and pluginHandle are same session ID
			streamingHandle = pluginHandle;
			
		},
		error: function(error) {
			//error in attaching stream will result in no video/audio
			Janus.error(" ==> ERROR attaching streaming plugin", error);
			bootbox.alert("Error streaming video: " + error);
		},
		onmessage: function(msg, jsep) {
			//Janus sending us data
			Janus.debug(" ==> Streaming Handle got a message");
			Janus.debug(msg);
			var result = msg["result"];
			//verifying data is meant for us
			if (result !== null && result !== undefined) {
				// you can get a bunch of info about status here.
				// see the streamingtest example for details
			} else if (msg["error"] !== null && msg["error"] !== undefined) {
				//bad things happened
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
						//successful answer, start streaming!
						Janus.debug("Got SDP!");
						Janus.debug(jsep);
						var body = { "request": "start" };
						streamingHandle.send({"message": body, "jsep": jsep});
					},
					error: function(error) {
						//oops no successful answer
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
				$('#videocontainer0').append('<video class="rounded d-none" id="remotevideo0" width="100%"  autoplay/>');
				// and the little badge for bitrate
				$('#videocontainer0').append(
					'<span class="badge badge-pill badge-secondary d-none bottom-right" id="curbitrate0" style="bottom: 0px;position: absolute; right: 0px; margin: 15px;"></span>');
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
					bitrateTimer = setInterval(function() {
					// Display updated bitrate, if supported
					var bitrate = streamingHandle.getBitrate();
					$('#curbitrate0').text(bitrate);
				}, 1000);
			}
			
		},
		oncleanup: function() {
			//remove stream
			Janus.log("cleanup notification for remote streaming video");
			$('#remotevideo0').remove();
			if (bitrateTimer !== null && bitrateTimer !== undefined) {
				clearInterval(bitrateTimer);
			}
		}
	});
}

/**
 * Displays WebRTC participants as they join the video conference room
 */
function updateParticipantList(list) {
	// add self first
	updateSelf();

	Janus.debug("Got a list of participants:");
	Janus.debug(list);
	for (var f in list) {
		var id = list[f]["id"];
		var display = list[f]["display"];
		var muted = list[f]["muted"];
		var setup = list[f]["setup"];
		//participant joins room
		addParticipant(id, display, muted, setup);
	}
}

/**
 * Add self to participant list first
 */
function updateSelf(setup) {
	if (myid !== null && myid !== undefined) {
		var tempSetup = setup !== null && setup !== undefined ? setup : true;
		addParticipant(myid, myusername, !audioenabled, tempSetup);
		$('#rp' + myid).addClass(' list-group-item-info');
	} else {
		Janus.warn('myid is undefined!!');
	}
}

/**
 * Adds WebRTC participants to video conference room
 */
function addParticipant(id, display, muted, setup) {
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
/**
 * Allows participants to enter own username before joining the video conference room
 */
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
			//TODO: need error handling here
			$('#username').removeAttr('disabled');
			$('#register').removeAttr('disabled').click(registerUsername);
			return;
		}
		//failure condition
		if(/[^a-zA-Z0-9]/.test(username)) {
			//TODO: need error handling here
			$('#username').removeAttr('disabled').val("");
			$('#register').removeAttr('disabled').click(registerUsername);
			return;
		}
		//request to join room with username
		var register = {"request": "join", "room": room, "display": username};
		myusername = username;
		audioHandle.send({"message": register});
	}
}