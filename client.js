// We make use of this 'server' variable to provide the address of the
// REST Janus API. By default, in this example we assume that Janus is
// co-located with the web server hosting the HTML pages but listening
// on a different port (8089)

//TODO: Eventually this code will be client/participant only -> will need
//to weed most of the host code (clients will still need to recognize)
//when a remote feed is 
const HOST_USERNAME = "cfe331345cb7443aaf92";
var server = "https://" + window.location.hostname + ":8089/janus";

var isHost = (getQueryStringValue("c") === "1" || getQueryStringValue("c") === "y");
var room   = Number(getQueryStringValue("r"));
const MAX_PARTICIPANTS = 6;
const REMOTE_INIT_INDEX = isHost ? 1 : 2;
const LOCAL_VIDEO_ID = isHost ? '#videocontainer0' : '#videocontainer1';
const LOCAL_LABEL_ID = isHost ? '#videolabel0' : '#videolabel1';

var janus = null;
var audioHandle = null;
var streamingHandle = null;
var opaqueId = "videoroomtest-" + Janus.randomString(12);

var myusername = null;
var myid = null;
var mystream = null;
// We use this other ID just to map our subscriptions to us
var mypvtid = null;

var feeds = [];
var bitrateTimer = [];

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
					plugin: "janus.plugin.videoroom",
					opaqueId: opaqueId,
					success: function(pluginHandle) {
						janusHandle = pluginHandle;
						Janus.log("Plugin attached! (" + janusHandle.getPlugin() + ", id=" + janusHandle.getId() + ")");
						$('#stop').click(function() {
							$(this).attr('disabled', true);
							if (isHost) {
								Janus.debug("===SENDING DESTROY REQUEST===");
								var destroy = {"request": "destroy", "room": room};
								janusHandle.send({"message": destroy});
							}
							janus.destroy();
						});

						if (isHost) {
							Janus.debug("---we're the host, sending a create request");
							//create the room first
							var register = {
								"request": "create", 
								"is_private": true, 
								"publishers": 6, 
								"bitrate": 128000, 
								"fir_freq": 10,
								"record": false};
							if (room !== 0) {
								register["room"] = room;
							}
							janusHandle.send({"message": register});
						} else {
							// Prepare the username registration
							$('#videojoin').removeClass('d-none').show();
							//$('#registernow').removeClass('hide').show();
							$('#register').click(registerUsername);
							$('#username').focus();
						}
					},
					error: function(error) {
						Janus.error("Error attaching videoroom plugin...", error);
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
					mediaState: function(medium, on) {
						Janus.log("Janus " + (on ? "started" : "stopped") + " receiving our " + medium);
					},
					webrtcState: function(on) {
						Janus.log("Janus says our WebRTC PeerConnection is " + (on ? "up" : "down") + " now");
						$(LOCAL_VIDEO_ID).parent().parent().unblock();
						// This controls allows us to override the global room bitrate cap
						$('#bitrate').parent().parent().removeClass('d-none').show();
						$('#bitrate a').click(function() {
							var id = $(this).attr("id");
							var bitrate = parseInt(id)*1000;
							if(bitrate === 0) {
								Janus.log("Not limiting bandwidth via REMB");
							} else {
								Janus.log("Capping bandwidth to " + bitrate + " via REMB");
							}
							$('#bitrateset').html($(this).html() + '<span class="caret"></span>').parent().removeClass('open');
							janusHandle.send({"message": { "request": "configure", "bitrate": bitrate }});
							return false;
						});
					},
					onmessage: function(msg, jsep) {
						Janus.debug(" ==> Videoroom publisher got a message:");
						Janus.debug(msg);
						var event = msg["videoroom"];
						if (event != undefined && event != null) {
							if (event === "joined") {
								// Publisher/manager created, negotiate WebRTC and attach to existing feeds, if any
								myid = msg["id"];
								mypvtid = msg["private_id"];
								Janus.log("Successfully joined room " + msg["room"] + " with ID " + myid);
								publishOwnFeed(true);

								if (streamingHandle !== null) {
									//if we have a streaming handle, connect to the default stream for the room;
									connectRoomStream();
								}
								// Any new feed to attach to? --> Remote feeds only (not local)
								if (msg["publishers"] !== undefined && msg["publishers"] !== null) {
									var list = msg["publishers"];
									Janus.debug("Got a list of available publishers/feeds:");
									Janus.debug(list);
									for(var f in list) {
										var id = list[f]["id"];
										var display = list[f]["display"];
										var audio = list[f]["audio_codec"];
										var video = list[f]["video_codec"] === null || list[f]["video_codec"] === undefined ? "" : list[f]["video_codec"] === null;
										Janus.debug("  >> [" + id + "] " + display + " (audio: " + audio + ", video: " + video + ")");
										newRemoteFeed(id, display, audio, video);
									}
								}
							} else if (event === "destroyed") {
								// The room has been destroyed
								Janus.warn("The room has been closed!");
								bootbox.alert("The room has been closed", function() {
									window.location.reload();
								});
							} else if (event === "event") {
								//see if this is an error event
								if(msg["error"] !== undefined && msg["error"] !== null) {
									if(msg["error_code"] === 426) {
										// This is a "no such room" error: give a more meaningful description
										bootbox.alert(
											"Room <code>" + room + "</code> does not exist");
									} else {
										bootbox.alert(msg["error"]);
									}
									return;
								}

								//remote feed subscription management.
								// if we're host we dont care about this stuff:
								if (!isHost) {
									if(msg["publishers"] !== undefined && msg["publishers"] !== null) {
										var list = msg["publishers"];
										Janus.debug("Got a list of available publishers/feeds:");
										Janus.debug(list);
										for(var f in list) {
											var id = list[f]["id"];
											var display = list[f]["display"];
											var audio = list[f]["audio_codec"];
											var video = list[f]["video_codec"];
											Janus.debug("  >> [" + id + "] " + display + " (audio: " + audio + ", video: " + video + ")");
											newRemoteFeed(id, display, audio, video);
										}
									} else if(msg["leaving"] !== undefined && msg["leaving"] !== null) {
										// One of the publishers has gone away?
										var leaving = msg["leaving"];
										Janus.log("Publisher left: " + leaving);
										var remoteFeed = null;
										for(var i=1; i<6; i++) {
											if(feeds[i] != null && feeds[i] != undefined && feeds[i].rfid == leaving) {
												remoteFeed = feeds[i];
												break;
											}
										}
										if(remoteFeed != null) {
											Janus.debug("Feed " + remoteFeed.rfid + " (" + remoteFeed.rfdisplay + ") has left the room, detaching");
											$('#videolabel'+remoteFeed.rfindex).empty().hide();
											$('#videocontainer'+remoteFeed.rfindex).empty();
											feeds[remoteFeed.rfindex] = null;
											remoteFeed.detach();
										}
									} else if(msg["unpublished"] !== undefined && msg["unpublished"] !== null) {
										// One of the publishers has unpublished?
										var unpublished = msg["unpublished"];
										Janus.log("Publisher left: " + unpublished);
										if(unpublished === 'ok') {
											// That's us
											janusHandle.hangup();
											return;
										}
										var remoteFeed = null;
										for(var i=1; i<6; i++) {
											if(feeds[i] != null && feeds[i] != undefined && feeds[i].rfid == unpublished) {
												remoteFeed = feeds[i];
												break;
											}
										}
										if(remoteFeed != null) {
											Janus.debug("Feed " + remoteFeed.rfid + " (" + remoteFeed.rfdisplay + ") has left the room, detaching");
											$('#videolabel'+remoteFeed.rfindex).empty().hide();
											$('#videocontainer'+remoteFeed.rfindex).empty();
											feeds[remoteFeed.rfindex] = null;
											remoteFeed.detach();
										}
									}
								} 
							} else if (event === "created") {
								Janus.debug("room created! username will indicate we're host");
								room = msg["room"];
								$('#stop').html("Close Room");
								$('#h1Title').html("Room #" + room);
								myusername = HOST_USERNAME;
								username = HOST_USERNAME;
								var register = { "request": "join", "room": room, "ptype": "publisher", "display": username };
								janusHandle.send({"message": register});
							}
						}
						if(jsep !== undefined && jsep !== null) {
							Janus.debug("Handling SDP as well...");
							Janus.debug(jsep);
							janusHandle.handleRemoteJsep({jsep: jsep});
							// Check if any of the media we wanted to publish has
							// been rejected (e.g., wrong or unsupported codec)
							var audio = msg["audio_codec"];
							if(mystream && mystream.getAudioTracks() && mystream.getAudioTracks().length > 0 && !audio) {
								// Audio consent has been rejected
								toastr.warning("Our audio stream has been rejected, viewers won't hear us");
							}
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
						$('#videos').removeClass('d-none').show();
						$('#stop').removeClass('d-none').show();

						// TODO: this is trash
						//  I dont know why, but for non-host streams i can only get them
						//  to work when i attach them to a video element as below
						if ($('#video0').length === 0) {
							$(LOCAL_VIDEO_ID).append('<video class="rounded centered d-none" id="video0" width="100%" height="100%" autoplay muted="muted"/>');
						}

						if (isHost) {
							$(LOCAL_VIDEO_ID).append('<button class="btn btn-warning" id="mute" style="position: absolute; bottom: 0px; left: 0px; margin: 15px;">Mute</button>');
							$('#mute').click(toggleMute);
							// Add an 'unpublish' button
							$(LOCAL_VIDEO_ID).append('<button class="btn btn-warning" id="unpublish" style="position: absolute; bottom: 0px; right: 0px; margin: 15px;">Unpublish</button>');
							$('#unpublish').click(unpublishOwnFeed);
							if (janusHandle.webrtcStuff.pc.iceConnectionState !== "completed" &&
								janusHandle.webrtcStuff.pc.iceConnectionState !== "connected") {
								$(LOCAL_VIDEO_ID).parent().parent().block({
									message: '<b>Publishing...</b>',
									css: {
										border: 'none',
										backgroundColor: 'transparent',
										color: 'white'
									}
								});
							}
							//still want the pretty username label up top tho
							$(LOCAL_LABEL_ID).removeClass('d-none').html(myusername).show();
						} else {
							//add yourself to the participants list:
							if ($('#rp' + myid).length === 0) {
								
								//if this stream isn't already on the list, add it
								$('#clientlist').append('<li id="rp' + myid + '" class="list-group-item list-group-item-info">' + myusername 
								+ ' <i class="abmuted fa fa-microphone-slash"></i></li>');
								$('#rp' + myid + ' > i').hide();
								//bind the mute button
								$('#mute').removeClass('d-none').show();
								$('#mute').click(toggleMute);
							}
						}

						Janus.attachMediaStream($('#video0').get(0), stream);
						// $(LOCAL_VIDEO_ID).get(0).muted = "muted";
						
						var videoTracks = stream.getVideoTracks();
						if(videoTracks === null || videoTracks === undefined || videoTracks.length === 0) {
							// No webcam
							$('#video0').hide();
						} else {
							// $(LOCAL_VIDEO_ID + ' .no-video-container').remove();
							$('#video0').removeClass('d-none').show();
						}
					},
					onremotestream: function(stream) {
						// The publisher stream is sendonly, we don't expect anything here
					},
					oncleanup: function() {
						Janus.log(" ::: Got a cleanup notification: we are unpublished now :::");
						mystream = null;
						$(LOCAL_VIDEO_ID).html('<button id="publish" class="btn btn-primary">Publish</button>');
						$(LOCAL_LABEL_ID).click(function() { publishOwnFeed(true); });
						$(LOCAL_VIDEO_ID).parent().parent().unblock();
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
		var register = {"request": "join", "room": myroom, "display": username};
		myusername = username;
		audioHandle.send({"message": register});
	}
}