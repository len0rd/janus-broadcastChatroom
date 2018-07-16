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
var janusHandle = null;
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
		//$('#start').one('click', function() {
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
				// Attach to video room test plugin
				janus.attach({
					plugin: "janus.plugin.videoroom",
					opaqueId: opaqueId,
					success: function(pluginHandle) {
						//$('#details').remove();
						janusHandle = pluginHandle;
						Janus.log("Plugin attached! (" + janusHandle.getPlugin() + ", id=" + janusHandle.getId() + ")");
						Janus.log("  -- This is a publisher/manager");
						$('#start').removeAttr('disabled').click(function() {
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
						Janus.error("  -- Error attaching plugin...", error);
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
						Janus.debug(" ::: Got a message (publisher) :::");
						Janus.debug(msg);
						var event = msg["videoroom"];
						Janus.debug("Event: " + event);
						if(event != undefined && event != null) {
							if (event === "joined") {
								// Publisher/manager created, negotiate WebRTC and attach to existing feeds, if any
								myid = msg["id"];
								mypvtid = msg["private_id"];
								Janus.log("Successfully joined room " + msg["room"] + " with ID " + myid);
								publishOwnFeed(true);
								// Any new feed to attach to? --> Remote feeds only (not local)
								if(msg["publishers"] !== undefined && msg["publishers"] !== null) {
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
								} else if(msg["error"] !== undefined && msg["error"] !== null) {
									if(msg["error_code"] === 426) {
										// This is a "no such room" error: give a more meaningful description
										bootbox.alert(
											"Room <code>" + room + "</code> does not exist");
									} else {
										bootbox.alert(msg["error"]);
									}
								}
							} else if (event === "created") {
								Janus.debug("room created! username will indicate we're host");
								room = msg["room"];
								$('#start').html("Close Room");
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
								// Audio has been rejected
								toastr.warning("Our audio stream has been rejected, viewers won't hear us");
							}
							var video = msg["video_codec"];
							if(mystream && mystream.getVideoTracks() && mystream.getVideoTracks().length > 0 && !video) {
								// Video has been rejected
								toastr.warning("Our video stream has been rejected, viewers won't see us");
								// Hide the webcam video
								$('#video0').hide();
								$(LOCAL_VIDEO_ID).append(
									'<div class="no-video-container">' +
										'<i class="fa fa-video-camera fa-5 no-video-icon" style="height: 100%;"></i>' +
										'<span class="no-video-text" style="font-size: 16px;">Video rejected, no webcam</span>' +
									'</div>');
							}
						}
					},
					onlocalstream: function(stream) {

						Janus.debug(" ::: Got local stream :::");
						mystream = stream;
						Janus.debug(stream);
						//hide the login screen (where you pick a username)
						$('#videojoin').hide();

						//show all the video containers
						$('#videos').removeClass('d-none').show();

						// TODO: this is trash
						//  I dont know why, but for non-host streams i can only get them
						//  to work when i attach them to a video element as below
						if ($('#video0').length === 0) {
							$(LOCAL_VIDEO_ID).append('<video class="rounded centered d-none" id="video0" width="100%" height="100%" autoplay muted="muted"/>');
						}

						if (isHost) {
							// if($('#video0').length === 0) {
								// $(LOCAL_VIDEO_ID).append('<video class="rounded centered" id="video0" width="100%" height="100%" autoplay muted="muted"/>');
								// Add a 'mute' button
								$(LOCAL_VIDEO_ID).append('<button class="btn btn-warning" id="mute" style="position: absolute; bottom: 0px; left: 0px; margin: 15px;">Mute</button>');
								$('#mute').click(toggleMute);
								// Add an 'unpublish' button
								$(LOCAL_VIDEO_ID).append('<button class="btn btn-warning" id="unpublish" style="position: absolute; bottom: 0px; right: 0px; margin: 15px;">Unpublish</button>');
								$('#unpublish').click(unpublishOwnFeed);
							// }
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

						Janus.debug("===1");
						Janus.attachMediaStream($('#video0').get(0), stream);
						// $(LOCAL_VIDEO_ID).get(0).muted = "muted";
						
						
						Janus.debug("===2");
						
						var videoTracks = stream.getVideoTracks();
						Janus.debug("===3");
						if(videoTracks === null || videoTracks === undefined || videoTracks.length === 0) {
							// No webcam
							$('#video0').hide();
							//if no video was granted, this shows a little icon indicating that
							//TODO:: in future only appear on host stream??
							// if ($(LOCAL_VIDEO_ID + ' .no-video-container').length === 0) {
							// 	$(LOCAL_VIDEO_ID).append(
							// 		'<div class="no-video-container">' +
							// 			'<i class="fa fa-video-camera fa-5 no-video-icon"></i>' +
							// 			'<span class="no-video-text">No webcam available</span>' +
							// 		'</div>');
							// }
						} else {
							// $(LOCAL_VIDEO_ID + ' .no-video-container').remove();
							$('#video0').removeClass('d-none').show();
						}
						Janus.debug("===4");
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
		var register = { "request": "join", "room": room, "ptype": "publisher", "display": username };
		myusername = username;
		janusHandle.send({"message": register});
	}
}

function publishOwnFeed(useAudio) {
	// Publish our stream
	if (isHost) {
		$(LOCAL_LABEL_ID).attr('disabled', true).unbind('click');
	}
	Janus.debug('===CREATE OFFER===');
	janusHandle.createOffer({
		// Add data:true here if you want to publish datachannels as well
		media: { audioRecv: false, videoRecv: false, audioSend: true, videoSend: isHost },	// Publishers are sendonly
		success: function(jsep) {
			Janus.debug("Got publisher SDP!");
			Janus.debug(jsep);
			var publish = { "request": "configure", "audio": true, "video": isHost };
			janusHandle.send({"message": publish, "jsep": jsep});
		},
		error: function(error) {
			Janus.error("WebRTC error:", error);
			if (useAudio) {
					publishOwnFeed(false);
			} else {
				bootbox.alert("WebRTC error... " + JSON.stringify(error));
				$(LOCAL_LABEL_ID).removeAttr('disabled').click(function() { publishOwnFeed(true); });
			}
		}
	});
}

function toggleMute() {
	var muted = janusHandle.isAudioMuted();
	Janus.log((muted ? "Unmuting" : "Muting") + " local stream...");
	if(muted)
		janusHandle.unmuteAudio();
	else
		janusHandle.muteAudio();
	muted = janusHandle.isAudioMuted();
	$('#mute').html(muted ? "Unmute" : "Mute");
}

function unpublishOwnFeed() {
	// Unpublish our stream
	$('#unpublish').attr('disabled', true).unbind('click');
	var unpublish = { "request": "unpublish" };
	janusHandle.send({"message": unpublish});
}

function newRemoteFeed(id, display, audio, video) {
	// A new feed has been published, create a new plugin handle and attach to it as a subscriber
	var remoteFeed = null;
	janus.attach({
		plugin: "janus.plugin.videoroom",
		opaqueId: opaqueId,
		success: function(pluginHandle) {
			remoteFeed = pluginHandle;
			Janus.log("Remote Feed plugin attached! (" + remoteFeed.getPlugin() + ", id=" + remoteFeed.getId() + ")");
			Janus.log("  -- This is a subscriber");
			// We wait for the plugin to send us an offer
			var listen = { "request": "join", "room": room, "ptype": "subscriber", "feed": id, "private_id": mypvtid };
			// In case you don't want to receive audio, video or data, even if the
			// publisher is sending them, set the 'offer_audio', 'offer_video' or
			// 'offer_data' properties to false (they're true by default), e.g.:
			// 		listen["offer_video"] = false;
			// For example, if the publisher is VP8 and this is Safari, let's avoid video
			if(video !== "h264" && Janus.webRTCAdapter.browserDetails.browser === "safari") {
				if(video)
					video = video.toUpperCase()
				toastr.warning("Publisher is using " + video + ", but Safari doesn't support it: disabling video");
				listen["offer_video"] = false;
			}
			//tell the feed we're listening
			remoteFeed.send({"message": listen});
		},
		error: function(error) {
			Janus.error("  -- Error attaching plugin...", error);
			bootbox.alert("Error attaching plugin... " + error);
		},
		onmessage: function(msg, jsep) {
			Janus.debug(" ::: Remote subscriber got a message :::");
			Janus.debug(msg);
			var event = msg["videoroom"];
			Janus.debug("Event: " + event);
			if(msg["error"] !== undefined && msg["error"] !== null) {
				bootbox.alert(msg["error"]);
			} else if (event != undefined && event != null) {
				if (event === "attached") {
					// Subscriber created and attached
					Janus.debug("===New remote feed attached");

					remoteFeed.rfindex = -1;
					remoteFeed.rfid = msg["id"];
					remoteFeed.rfdisplay = msg["display"];

					if (remoteFeed.rfdisplay === HOST_USERNAME) {
						Janus.debug("=====It's the host feed");
						//if this is the host stream it always goes to vid0
						remoteFeed.rfindex = 0;
						if(remoteFeed.spinner === undefined || remoteFeed.spinner === null) {
							var target = document.getElementById('video' + remoteFeed.rfindex);
							remoteFeed.spinner = new Spinner({top:100}).spin(target);
						} else {
							remoteFeed.spinner.spin();
						}
						Janus.log("Successfully attached to feed " + remoteFeed.rfid + " (" + remoteFeed.rfdisplay + ") in room " + msg["room"]);
						$('#videolabel' + remoteFeed.rfindex).removeClass('d-none').html(remoteFeed.rfdisplay).show();
						feeds[0] = remoteFeed;
					} else {
						//if its not the host stream, find the first available
						//put the feed info in the first available array slot
						for (var i = REMOTE_INIT_INDEX; i < MAX_PARTICIPANTS; i++) {
							if(feeds[i] === undefined || feeds[i] === null) {
								feeds[i] = remoteFeed;
								remoteFeed.rfindex = i;
								break;
							}
						}
					}
					Janus.debug("=====Remote feed is set as # " + remoteFeed.rfindex);
				}
			}
			if(jsep !== undefined && jsep !== null) {
				Janus.debug("Handling SDP as well...");
				Janus.debug(jsep);
				// Answer and attach
				remoteFeed.createAnswer({
					jsep: jsep,
					// Add data:true here if you want to subscribe to datachannels as well
					// (obviously only works if the publisher offered them in the first place)
					media: { audioSend: false, videoSend: false },	// We want recvonly audio/video
					success: function(jsep) {
						Janus.debug("Got SDP!");
						Janus.debug(jsep);
						var body = { "request": "start", "room": room };
						remoteFeed.send({"message": body, "jsep": jsep});
					},
					error: function(error) {
						Janus.error("WebRTC error:", error);
						bootbox.alert("WebRTC error... " + JSON.stringify(error));
					}
				});
			}
		},
		webrtcState: function(on) {
			Janus.log("Janus says this WebRTC PeerConnection (feed #" + remoteFeed.rfindex + ") is " + (on ? "up" : "down") + " now");
		},
		onlocalstream: function(stream) {
			// The subscriber stream is recvonly, we don't expect anything here
		},
		onremotestream: function(stream) {
			Janus.debug("Remote feed #" + remoteFeed.rfindex);
			var addButtons = false;
			
			//make a video object for the remote feed
			var containerNum = remoteFeed.rfindex > 0 ? 1 : 0;
			if ($('#remotevideo'+remoteFeed.rfindex).length === 0) {
				// No remote video yet
				$('#videocontainer' + containerNum).append('<video class="rounded centered" id="waitingvideo' + remoteFeed.rfindex + '" width=320 height=240 />');
				$('#videocontainer' + containerNum).append('<video class="rounded centered relative d-none" id="remotevideo' + remoteFeed.rfindex + '" width="100%" height="100%" autoplay/>');
				
				if (containerNum === 0) {
					$('#videocontainer' + containerNum).append(
						// '<span class="label label-primary hide" id="curres'+remoteFeed.rfindex+'" style="position: absolute; bottom: 0px; left: 0px; margin: 15px;"></span>' +
						'<span class="badge badge-pill badge-secondary d-none" id="curbitrate'+remoteFeed.rfindex+'" style="position: absolute; bottom: 0px; right: 0px; margin: 15px;"></span>');
				}
				// Show the video, hide the spinner and show the resolution when we get a playing event
				$("#remotevideo" + remoteFeed.rfindex).bind("playing", function () {
					if(remoteFeed.spinner !== undefined && remoteFeed.spinner !== null)
						remoteFeed.spinner.stop();
					remoteFeed.spinner = null;
					$('#waitingvideo'+remoteFeed.rfindex).remove();
				});
			}


			//setup video if this is the host feed
			if (remoteFeed.rfdisplay === HOST_USERNAME) {
				Janus.debug("==This is the remote host stream to attach");
				//it's the host stream, add to the main pane
				addButtons = true;
			} else {
				//if it's a normal audio-only participant, just add it to the list:
				if ($('#rp' + remoteFeed.rfid).length === 0) {
					//if this stream isn't already on the list, add it
					$('#clientlist').append('<li id="rp' + remoteFeed.rfid + '" class="list-group-item">' + remoteFeed.rfdisplay 
						+ ' <i class="abmuted fa fa-microphone-slash"></i></li>');
					$('#rp' + remoteFeed.rfid + ' > i').hide();
				}
			}

			Janus.attachMediaStream($('#remotevideo'+remoteFeed.rfindex).get(0), stream);
			var videoTracks = stream.getVideoTracks();
			if (videoTracks === null || videoTracks === undefined || videoTracks.length === 0) {
				// No remote video
				if (remoteFeed.rfdisplay === HOST_USERNAME) {
					//if this is the host stream and it has no video
					//display a nice little icon indicating this
					$('#remotevideo'+remoteFeed.rfindex).hide();
					if($('#videocontainer'+remoteFeed.rfindex + ' .no-video-container').length === 0) {
						$('#videocontainer'+remoteFeed.rfindex).append(
							'<div class="no-video-container">' +
								'<i class="fa fa-video-camera fa-5 no-video-icon"></i>' +
								'<span class="no-video-text">No remote video available</span>' +
							'</div>');
					}
				}
			} else {
				$('#videocontainer'+remoteFeed.rfindex+ ' .no-video-container').remove();
				$('#remotevideo'+remoteFeed.rfindex).removeClass('d-none').show();
			}

			if (!addButtons)
				return;
			//bitrate time junk:
			if (remoteFeed.rfdisplay === HOST_USERNAME && (Janus.webRTCAdapter.browserDetails.browser === "chrome" 
				|| Janus.webRTCAdapter.browserDetails.browser === "firefox" || Janus.webRTCAdapter.browserDetails.browser === "safari")) {
				$('#curbitrate'+remoteFeed.rfindex).removeClass('d-none').show();
				bitrateTimer[remoteFeed.rfindex] = setInterval(function() {
					// Display updated bitrate, if supported
					var bitrate = remoteFeed.getBitrate();
					$('#curbitrate'+remoteFeed.rfindex).text(bitrate);
				}, 1000);
			}
		},
		oncleanup: function() {
			Janus.log(" ::: Got a cleanup notification (remote feed " + id + ") :::");
			
			if (remoteFeed.rfindex === 0) {
				//if it's the host feed:
				if(remoteFeed.spinner !== undefined && remoteFeed.spinner !== null)
					remoteFeed.spinner.stop();
				remoteFeed.spinner = null;
				$('#novideo'+remoteFeed.rfindex).remove();
				$('#curbitrate'+remoteFeed.rfindex).remove();
			} else {
				$('#rp' + remoteFeed.rfid).remove();
			}
			$('#remotevideo' + remoteFeed.rfindex).remove();
			$('#waitingvideo' + remoteFeed.rfindex).remove();
			
			if(bitrateTimer[remoteFeed.rfindex] !== null && bitrateTimer[remoteFeed.rfindex] !== null) 
				clearInterval(bitrateTimer[remoteFeed.rfindex]);
			bitrateTimer[remoteFeed.rfindex] = null;
		}
	});
}

// Helper to parse query string
function getQueryStringValue(name) {
	name = name.replace(/[\[]/, "\\[").replace(/[\]]/, "\\]");
	var regex = new RegExp("[\\?&]" + name + "=([^&#]*)"),
		results = regex.exec(location.search);
	return results === null ? "" : decodeURIComponent(results[1].replace(/\+/g, " "));
}
