import React, { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAuth } from "../App";
import {
  Mic, MicOff, Video, VideoOff, Monitor, PhoneOff, Send, Users, MessageSquare, Hand,
  Smile, ShieldCheck, UserX, VolumeX, Check, X, AlertCircle, Copy
} from "lucide-react";
import { audioNotificationManager } from "../utils/audioNotifications";

// Types
interface Peer {
  id: string;
  display_name: string;
  avatar: string;
  is_host: boolean;
  is_cohost: boolean;
  hand_raised: boolean;
  stream?: MediaStream;
}

interface ChatMessage {
  sender_id: string;
  sender_name: string;
  text: string;
  timestamp: number;
}

interface WaitingUser {
  user_id: string;
  name: string;
  avatar: string;
}

interface FloatingReaction {
  id: number;
  emoji: string;
  left: number;
  peer_id: string;
}

const Meeting: React.FC = () => {
  const { meetingId } = useParams<{ meetingId: string }>();
  const navigate = useNavigate();
  const { user, token } = useAuth();

  // Call options before entering
  const [showPreview, setShowPreview] = useState(true);
  const [guestName, setGuestName] = useState("");
  const [isMicOn, setIsMicOn] = useState(true);
  const [isCameraOn, setIsCameraOn] = useState(true);

  // States inside call
  const [isJoined, setIsJoined] = useState(false);
  const [isWaitingForApproval, setIsWaitingForApproval] = useState(false);
  const [lobbyMessage, setLobbyMessage] = useState("");
  const [meetingOwner, setMeetingOwner] = useState("");
  
  const [activePanel, setActivePanel] = useState<"chat" | "people" | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [hasUnreadChat, setHasUnreadChat] = useState(false);

  const [handRaised, setHandRaised] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);

  // Live peers list
  const [peers, setPeers] = useState<Peer[]>([]);
  // Wait room list (Host only)
  const [waitingUsers, setWaitingUsers] = useState<WaitingUser[]>([]);
  // Floating emojis list
  const [reactions, setReactions] = useState<FloatingReaction[]>([]);
  // Reaction picker state
  const [isReactionOpen, setIsReactionOpen] = useState(false);

  // Error messaging
  const [errorMsg, setErrorMsg] = useState("");

  // Refs
  const localStreamRef = useRef<MediaStream | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  
  const socketRef = useRef<WebSocket | null>(null);
  const peerConnectionsRef = useRef<HashMap<RTCPeerConnection>>({});
  const peersRef = useRef<Peer[]>([]);

  const myId = user?.id || `guest_${React.useId().replace(/:/g, "")}`;
  const myName = user?.full_name || guestName || "Guest";

  // Check meeting access and initialize local media for preview
  useEffect(() => {
    const checkAccess = async () => {
      try {
        const res = await fetch(`http://localhost:5000/api/meeting/check_meeting_access?meeting_id=${meetingId}`);
        if (!res.ok) {
          throw new Error("Meeting does not exist.");
        }
        await res.json();

        // Fetch meeting details
        const detailsRes = await fetch(`http://localhost:5000/api/meeting/details?meeting_id=${meetingId}`);
        if (detailsRes.ok) {
          const details = await detailsRes.json();
          setMeetingOwner(details.owner_id);
        }
      } catch (err: any) {
        setErrorMsg(err.message || "Failed to load meeting details.");
        setShowPreview(false);
      }
    };

    checkAccess();
    startPreviewMedia();

    return () => {
      stopLocalMedia();
    };
  }, [meetingId]);

  // Handle local video playback on state change
  useEffect(() => {
    if (showPreview && previewVideoRef.current && localStreamRef.current) {
      previewVideoRef.current.srcObject = localStreamRef.current;
    }
  }, [showPreview, isCameraOn]);

  useEffect(() => {
    if (isJoined && localVideoRef.current && localStreamRef.current) {
      localVideoRef.current.srcObject = localStreamRef.current;
    }
  }, [isJoined, isCameraOn]);

  // Keep ref up to date to access inside WS callbacks
  useEffect(() => {
    peersRef.current = peers;
  }, [peers]);

  // WebRTC ICE STUN configuration
  const rtcConfig: RTCConfiguration = {
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  };

  const startPreviewMedia = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });
      localStreamRef.current = stream;
      
      // Update tracks
      stream.getVideoTracks().forEach(t => t.enabled = isCameraOn);
      stream.getAudioTracks().forEach(t => t.enabled = isMicOn);

      if (previewVideoRef.current) {
        previewVideoRef.current.srcObject = stream;
      }
    } catch (err) {
      console.warn("Could not access camera/mic for preview:", err);
    }
  };

  const stopLocalMedia = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(t => t.stop());
      localStreamRef.current = null;
    }
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach(t => t.stop());
      screenStreamRef.current = null;
    }
  };

  const toggleMic = () => {
    const next = !isMicOn;
    setIsMicOn(next);
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach(t => t.enabled = next);
    }
  };

  const toggleCamera = () => {
    const next = !isCameraOn;
    setIsCameraOn(next);
    if (localStreamRef.current) {
      localStreamRef.current.getVideoTracks().forEach(t => t.enabled = next);
    }
  };

  // Join meeting handler
  const handleJoin = async () => {
    if (!user && !guestName.trim()) {
      alert("Please enter your display name.");
      return;
    }

    setShowPreview(false);
    setIsWaitingForApproval(true);
    setLobbyMessage("Requesting to join...");

    // Connect to WebSocket room signaling server
    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const wsUrl = `${protocol}://localhost:5000/api/ws/meeting/${meetingId}?token=${token || ""}&guest_name=${encodeURIComponent(myName)}`;

    const ws = new WebSocket(wsUrl);
    socketRef.current = ws;

    ws.onopen = () => {
      console.log("WebSocket connected!");
    };

    ws.onmessage = async (e) => {
      const msg = JSON.parse(e.data);
      console.log("WebSocket message received:", msg);

      switch (msg.type) {
        case "lobby_state":
          if (msg.is_waiting) {
            setIsWaitingForApproval(true);
            if (msg.message === "rejected") {
              setLobbyMessage("rejected");
              ws.close();
            } else {
              setLobbyMessage(msg.message);
            }
          } else {
            // Approved! Join the room
            setIsWaitingForApproval(false);
            setIsJoined(true);
            audioNotificationManager.playJoinNotification();
          }
          break;

        case "lobby_update":
          // Receive wait list (host only)
          setWaitingUsers(msg.waiting_users);
          if (msg.waiting_users.length > 0) {
            audioNotificationManager.playJoinRequestNotification();
          }
          break;

        case "room_joined":
          setIsWaitingForApproval(false);
          setIsJoined(true);
          // Standard: create WebRTC offer for all existing peers
          const existingPeers: Peer[] = msg.peers;
          setPeers(existingPeers);

          for (const ep of existingPeers) {
            await initiatePeerConnection(ep.id, true);
          }
          break;

        case "peer_joined":
          // Add peer to list
          const np: Peer = msg.peer;
          setPeers((prev) => {
            if (prev.some(p => p.id === np.id)) return prev;
            return [...prev, np];
          });
          audioNotificationManager.playJoinNotification();
          break;

        case "peer_left":
          const leftId = msg.peer_id;
          setPeers((prev) => prev.filter((p) => p.id !== leftId));
          if (peerConnectionsRef.current[leftId]) {
            peerConnectionsRef.current[leftId].close();
            delete peerConnectionsRef.current[leftId];
          }
          audioNotificationManager.playLeaveNotification();
          break;

        case "signaling_data":
          const sender = msg.sender_id;
          const data = msg.data;
          await handleSignalingData(sender, data);
          break;

        case "chat_broadcast":
          setChatMessages((prev) => [
            ...prev,
            {
              sender_id: msg.sender_id,
              sender_name: msg.sender_name,
              text: msg.text,
              timestamp: msg.timestamp,
            },
          ]);
          if (activePanel !== "chat") {
            setHasUnreadChat(true);
          }
          audioNotificationManager.playChatNotification();
          break;

        case "reaction_broadcast":
          triggerReactionAnimation(msg.sender_id, msg.emoji);
          break;

        case "hand_raise_broadcast":
          setPeers((prev) =>
            prev.map((p) =>
              p.id === msg.sender_id ? { ...p, hand_raised: msg.raised } : p
            )
          );
          if (msg.sender_id === myId) {
            setHandRaised(msg.raised);
          } else if (msg.raised) {
            audioNotificationManager.playRaiseHandNotification();
          }
          break;

        case "host_status_updated":
          setPeers((prev) =>
            prev.map((p) =>
              p.id === msg.peer_id ? { ...p, is_cohost: msg.is_cohost } : p
            )
          );
          break;

        case "force_mute":
          if (isMicOn) {
            toggleMic();
            alert("The host has muted your microphone.");
          }
          break;

        case "force_kick":
          alert("You have been kicked from this meeting.");
          handleDisconnect();
          break;
      }
    };

    ws.onclose = () => {
      console.log("WebSocket disconnected.");
    };

    ws.onerror = (err) => {
      console.error("WebSocket error:", err);
    };
  };

  // WebRTC Helper - Initiate peer connection
  const initiatePeerConnection = async (targetId: string, isOffer: boolean) => {
    if (peerConnectionsRef.current[targetId]) return;

    const pc = new RTCPeerConnection(rtcConfig);
    peerConnectionsRef.current[targetId] = pc;

    // Attach local stream tracks to connection
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => {
        pc.addTrack(track, localStreamRef.current!);
      });
    }

    pc.onicecandidate = (e) => {
      if (e.candidate && socketRef.current) {
        socketRef.current.send(
          JSON.stringify({
            type: "signal",
            target_id: targetId,
            data: { candidate: e.candidate },
          })
        );
      }
    };

    pc.ontrack = (e) => {
      console.log("Received remote stream track from peer:", targetId);
      setPeers((prev) =>
        prev.map((p) =>
          p.id === targetId ? { ...p, stream: e.streams[0] } : p
        )
      );
    };

    if (isOffer) {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      if (socketRef.current) {
        socketRef.current.send(
          JSON.stringify({
            type: "signal",
            target_id: targetId,
            data: { sdp: offer },
          })
        );
      }
    }
  };

  // WebRTC Helper - Handle incoming offers, answers, candidates
  const handleSignalingData = async (senderId: string, data: any) => {
    let pc = peerConnectionsRef.current[senderId];

    if (!pc) {
      await initiatePeerConnection(senderId, false);
      pc = peerConnectionsRef.current[senderId];
    }

    if (data.sdp) {
      await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
      if (data.sdp.type === "offer") {
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        if (socketRef.current) {
          socketRef.current.send(
            JSON.stringify({
              type: "signal",
              target_id: senderId,
              data: { sdp: answer },
            })
          );
        }
      }
    } else if (data.candidate) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
      } catch (err) {
        console.warn("Failed to add ICE candidate:", err);
      }
    }
  };

  // Send a chat message
  const sendChatMessage = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!chatInput.trim() || !socketRef.current) return;

    socketRef.current.send(
      JSON.stringify({
        type: "chat",
        text: chatInput.trim(),
      })
    );
    setChatInput("");
  };

  // Raise/Lower hand toggle
  const toggleHand = () => {
    if (!socketRef.current) return;
    const next = !handRaised;
    socketRef.current.send(
      JSON.stringify({
        type: "raise_hand",
        raised: next,
      })
    );
  };

  // Emoji Reaction helper
  const sendReaction = (emoji: string) => {
    setIsReactionOpen(false);
    if (!socketRef.current) return;
    socketRef.current.send(
      JSON.stringify({
        type: "reaction",
        emoji,
      })
    );
  };

  const triggerReactionAnimation = (peerId: string, emoji: string) => {
    const id = Date.now() + Math.random();
    const left = 20 + Math.random() * 60; // Random horizontal placement
    setReactions((prev) => [...prev, { id, emoji, left, peer_id: peerId }]);
    
    // Clear animation after 2.5 seconds
    setTimeout(() => {
      setReactions((prev) => prev.filter((r) => r.id !== id));
    }, 2500);
  };

  // Toggle Screen sharing
  const toggleScreenShare = async () => {
    if (!isJoined) return;

    if (isScreenSharing) {
      // Stop screen sharing
      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach(t => t.stop());
      }
      // Re-attach camera tracks to peer connections
      if (localStreamRef.current) {
        const videoTrack = localStreamRef.current.getVideoTracks()[0];
        if (videoTrack) {
          for (const pc of Object.values(peerConnectionsRef.current)) {
            const sender = pc.getSenders().find(s => s.track?.kind === "video");
            if (sender) sender.replaceTrack(videoTrack);
          }
        }
      }
      setIsScreenSharing(false);
    } else {
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        screenStreamRef.current = stream;
        setIsScreenSharing(true);

        const screenTrack = stream.getVideoTracks()[0];
        
        // Listen for screen sharing stop
        screenTrack.onended = () => {
          toggleScreenShare();
        };

        // Replace local video element source
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }

        // Replace track in all peer connections
        for (const pc of Object.values(peerConnectionsRef.current)) {
          const sender = pc.getSenders().find(s => s.track?.kind === "video");
          if (sender) sender.replaceTrack(screenTrack);
        }
      } catch (err) {
        console.warn("Screen share cancelled:", err);
      }
    }
  };

  // Host Privilege Control APIs
  const handleMute = (targetId: string) => {
    if (!socketRef.current) return;
    socketRef.current.send(
      JSON.stringify({
        type: "mute_participant",
        target_id: targetId,
      })
    );
  };

  const handleKick = (targetId: string) => {
    if (!socketRef.current) return;
    socketRef.current.send(
      JSON.stringify({
        type: "kick_participant",
        target_id: targetId,
      })
    );
  };

  const handlePromote = (targetId: string) => {
    if (!socketRef.current) return;
    socketRef.current.send(
      JSON.stringify({
        type: "promote_to_cohost",
        target_id: targetId,
      })
    );
  };

  const handleApprove = (targetId: string) => {
    if (!socketRef.current) return;
    socketRef.current.send(
      JSON.stringify({
        type: "approve_lobby_user",
        target_id: targetId,
      })
    );
  };

  const handleApproveAll = () => {
    if (!socketRef.current) return;
    socketRef.current.send(
      JSON.stringify({
        type: "approve_all_lobby_users",
      })
    );
  };

  const handleReject = (targetId: string) => {
    if (!socketRef.current) return;
    socketRef.current.send(
      JSON.stringify({
        type: "reject_lobby_user",
        target_id: targetId,
      })
    );
  };

  // Disconnect from websocket and close calls
  const handleDisconnect = () => {
    if (socketRef.current) {
      socketRef.current.close();
    }
    stopLocalMedia();
    for (const pc of Object.values(peerConnectionsRef.current)) {
      pc.close();
    }
    peerConnectionsRef.current = {};
    setIsJoined(false);
    navigate("/");
  };

  const copyMeetingLink = () => {
    navigator.clipboard.writeText(window.location.href);
    alert("Meeting link copied to clipboard!");
  };

  // Host checking logic
  const amIHost = myId === meetingOwner;
  const amICohost = peers.find(p => p.id === myId)?.is_cohost || false;
  const isHostPrivilege = amIHost || amICohost;

  // Render Waiting room screen
  if (isWaitingForApproval) {
    return (
      <div className="flex-center" style={{ minHeight: "100vh", padding: "20px" }}>
        <div className="glass-panel" style={{ width: "100%", maxWidth: "420px", padding: "40px", textAlign: "center" }}>
          {lobbyMessage === "rejected" ? (
            <>
              <div className="flex-center hover-scale" style={{
                width: "50px",
                height: "50px",
                background: "rgba(239, 68, 68, 0.15)",
                color: "var(--danger)",
                borderRadius: "50%",
                margin: "0 auto 20px"
              }}>
                <X size={26} />
              </div>
              <h2 style={{ fontFamily: "var(--font-display)", marginBottom: "12px" }}>Join request rejected</h2>
              <p style={{ color: "var(--text-secondary)", fontSize: "0.95rem", marginBottom: "24px" }}>
                The host did not approve your entry request.
              </p>
              <button onClick={() => navigate("/")} className="btn btn-secondary" style={{ width: "100%" }}>
                Go Home
              </button>
            </>
          ) : (
            <>
              <div className="flex-center" style={{
                width: "50px",
                height: "50px",
                border: "3px solid var(--primary-glow)",
                borderTopColor: "var(--primary)",
                borderRadius: "50%",
                margin: "0 auto 20px",
                animation: "spin 1s linear infinite"
              }}></div>
              <h2 style={{ fontFamily: "var(--font-display)", marginBottom: "12px" }}>Waiting for approval</h2>
              <p style={{ color: "var(--text-secondary)", fontSize: "0.95rem", marginBottom: "24px" }}>
                This meeting is restricted. The host has been notified of your request. Please wait...
              </p>
              <button onClick={handleDisconnect} className="btn btn-secondary" style={{ width: "100%" }}>
                Cancel Request
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  // Render Access Error Screen
  if (errorMsg) {
    return (
      <div className="flex-center" style={{ minHeight: "100vh", padding: "20px" }}>
        <div className="glass-panel" style={{ width: "100%", maxWidth: "420px", padding: "40px", textAlign: "center" }}>
          <AlertCircle size={44} color="var(--danger)" style={{ marginBottom: "16px" }} />
          <h2 style={{ fontFamily: "var(--font-display)", marginBottom: "10px" }}>Access Blocked</h2>
          <p style={{ color: "var(--text-secondary)", fontSize: "0.95rem", marginBottom: "24px" }}>
            {errorMsg}
          </p>
          <button onClick={() => navigate("/")} className="btn btn-primary" style={{ width: "100%" }}>
            Return to Home
          </button>
        </div>
      </div>
    );
  }

  // Render screening/preview screen
  if (showPreview) {
    return (
      <div className="flex-center" style={{ minHeight: "100vh", padding: "20px" }}>
        <div className="glass-panel" style={{
          width: "100%",
          maxWidth: "760px",
          padding: "35px",
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "35px",
          alignItems: "center"
        }}>
          
          {/* Left column: Video feed preview */}
          <div style={{ position: "relative" }}>
            <div className="video-tile" style={{ background: "#0a0c10", aspectRatio: "4/3", border: "1px solid var(--border-glass)" }}>
              {isCameraOn ? (
                <video ref={previewVideoRef} autoPlay playsInline muted style={{ transform: "scaleX(-1)" }} />
              ) : (
                <div className="avatar-fallback" style={{ width: "80px", height: "80px" }}>
                  {myName.slice(0, 2).toUpperCase()}
                </div>
              )}

              {/* Media Controls inside preview */}
              <div style={{ position: "absolute", bottom: "16px", display: "flex", gap: "10px" }}>
                <button onClick={toggleMic} className={`btn ${isMicOn ? "btn-secondary" : "btn-danger"}`} style={{ borderRadius: "50%", padding: "10px", width: "42px", height: "42px" }}>
                  {isMicOn ? <Mic size={18} /> : <MicOff size={18} />}
                </button>
                <button onClick={toggleCamera} className={`btn ${isCameraOn ? "btn-secondary" : "btn-danger"}`} style={{ borderRadius: "50%", padding: "10px", width: "42px", height: "42px" }}>
                  {isCameraOn ? <Video size={18} /> : <VideoOff size={18} />}
                </button>
              </div>
            </div>
          </div>

          {/* Right column: Form details */}
          <div>
            <h2 style={{ fontFamily: "var(--font-display)", fontSize: "1.6rem", fontWeight: "700", marginBottom: "8px" }}>
              Ready to Join?
            </h2>
            <p style={{ color: "var(--text-secondary)", fontSize: "0.88rem", marginBottom: "25px" }}>
              Meeting Code: <span style={{ fontWeight: "700", color: "var(--primary)" }}>{meetingId}</span>
            </p>

            {!user && (
              <div className="form-group" style={{ marginBottom: "20px" }}>
                <label className="form-label">Display Name</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="Enter your name"
                  value={guestName}
                  onChange={(e) => setGuestName(e.target.value)}
                />
              </div>
            )}

            <button onClick={handleJoin} className="btn btn-primary hover-scale" style={{ width: "100%", padding: "14px", fontSize: "1rem" }}>
              <span>Join Meeting</span>
            </button>
            
            <button onClick={() => navigate("/")} className="btn btn-secondary" style={{ width: "100%", padding: "14px", marginTop: "10px" }}>
              Cancel
            </button>
          </div>

        </div>
      </div>
    );
  }

  // Render Main Active Call Room
  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: "var(--bg-darker)", overflow: "hidden" }}>
      
      {/* Top HUD bar */}
      <header className="glass-panel" style={{
        margin: "12px",
        padding: "10px 20px",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        borderRadius: "var(--radius-md)",
        border: "1px solid var(--border-glass)",
        background: "rgba(10, 15, 30, 0.4)",
        zIndex: "10"
      }}>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <h4 style={{ fontFamily: "var(--font-display)", fontWeight: "600", fontSize: "1rem" }}>
            Converse Room
          </h4>
          <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>
            Code: {meetingId}
          </span>
        </div>

        <div style={{ display: "flex", gap: "10px" }}>
          <button onClick={copyMeetingLink} className="btn btn-secondary" style={{ padding: "8px 12px", fontSize: "0.8rem", gap: "6px" }}>
            <Copy size={14} />
            <span>Copy Link</span>
          </button>
        </div>
      </header>

      {/* Main viewport with Sidebar layout */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden", position: "relative", padding: "10px" }}>
        
        {/* Dynamic Video Grid Area */}
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "10px", minWidth: "0" }}>
          
          <div className={`video-grid grid-${Math.min(peers.length + 1, 9)}`}>
            
            {/* Local Video Tile */}
            <div className="video-tile" style={{ border: isMicOn ? "1px solid rgba(255,255,255,0.08)" : "1px solid rgba(239, 68, 68, 0.2)" }}>
              {isCameraOn ? (
                <video ref={localVideoRef} autoPlay playsInline muted style={{ transform: isScreenSharing ? "none" : "scaleX(-1)" }} />
              ) : (
                <div className="avatar-fallback">
                  {myName.slice(0, 2).toUpperCase()}
                </div>
              )}
              
              {/* Floating local reactions */}
              {reactions.filter((r) => r.peer_id === myId).map((r) => (
                <span key={r.id} className="floating-reaction" style={{ left: `${r.left}%` }}>{r.emoji}</span>
              ))}

              <div className="tile-info">
                <span>{myName} (You)</span>
                {!isMicOn && <MicOff size={14} color="#f87171" />}
                {handRaised && <Hand size={14} color="#fbbf24" fill="#fbbf24" />}
              </div>
            </div>

            {/* Remote Peer Video Tiles */}
            {peers.map((peer) => {
              const videoElementRef = (el: HTMLVideoElement | null) => {
                if (el && peer.stream) {
                  el.srcObject = peer.stream;
                }
              };

              return (
                <div key={peer.id} className="video-tile">
                  {peer.stream && peer.stream.getVideoTracks().length > 0 ? (
                    <video ref={videoElementRef} autoPlay playsInline />
                  ) : (
                    <div className="avatar-fallback">
                      {peer.display_name.slice(0, 2).toUpperCase()}
                    </div>
                  )}

                  {/* Floating reactions */}
                  {reactions.filter((r) => r.peer_id === peer.id).map((r) => (
                    <span key={r.id} className="floating-reaction" style={{ left: `${r.left}%` }}>{r.emoji}</span>
                  ))}

                  <div className="tile-info">
                    <span>{peer.display_name}</span>
                    {peer.is_host && <ShieldCheck size={14} color="var(--primary)" />}
                    {peer.is_cohost && <ShieldCheck size={14} color="var(--secondary)" />}
                    {peer.hand_raised && <Hand size={14} color="#fbbf24" fill="#fbbf24" />}
                  </div>
                </div>
              );
            })}

          </div>

        </div>

        {/* Sidebar panels (Chat or People) */}
        {activePanel && (
          <div className="glass-panel" style={{
            width: "340px",
            background: "rgba(10, 15, 30, 0.7)",
            border: "1px solid var(--border-glass)",
            borderRadius: "var(--radius-md)",
            display: "flex",
            flexDirection: "column",
            marginLeft: "10px",
            zIndex: "10"
          }}>
            
            {/* Panel Header */}
            <div style={{
              padding: "16px",
              borderBottom: "1px solid var(--border-glass)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center"
            }}>
              <h3 style={{ fontFamily: "var(--font-display)", fontWeight: "600", fontSize: "1.1rem" }}>
                {activePanel === "chat" ? "Text Chat" : "Participants"}
              </h3>
              <button onClick={() => setActivePanel(null)} className="btn btn-secondary" style={{ padding: "6px", borderRadius: "50%" }}>
                <X size={16} />
              </button>
            </div>

            {/* Panel Body - CHAT */}
            {activePanel === "chat" && (
              <>
                <div style={{ flex: 1, overflowY: "auto", padding: "16px", display: "flex", flexDirection: "column", gap: "12px" }}>
                  {chatMessages.length === 0 ? (
                    <div style={{ textAlign: "center", color: "var(--text-muted)", marginTop: "40px", fontSize: "0.9rem" }}>
                      No messages yet. Send a message to start!
                    </div>
                  ) : (
                    chatMessages.map((msg, idx) => (
                      <div key={idx} style={{
                        display: "flex",
                        flexDirection: "column",
                        alignSelf: msg.sender_id === myId ? "flex-end" : "flex-start",
                        maxWidth: "80%"
                      }}>
                        <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)", marginBottom: "4px" }}>
                          {msg.sender_name}
                        </span>
                        <div style={{
                          padding: "10px 14px",
                          borderRadius: "12px",
                          background: msg.sender_id === myId ? "var(--primary)" : "rgba(255,255,255,0.08)",
                          color: "white",
                          fontSize: "0.9rem",
                          wordBreak: "break-word"
                        }}>
                          {msg.text}
                        </div>
                      </div>
                    ))
                  )}
                </div>

                <form onSubmit={sendChatMessage} style={{ padding: "16px", borderTop: "1px solid var(--border-glass)", display: "flex", gap: "8px" }}>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Type message..."
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    style={{ flex: 1, padding: "10px 12px" }}
                  />
                  <button type="submit" className="btn btn-primary" style={{ padding: "10px" }}>
                    <Send size={16} />
                  </button>
                </form>
              </>
            )}

            {/* Panel Body - PEOPLE */}
            {activePanel === "people" && (
              <div style={{ flex: 1, overflowY: "auto", padding: "16px", display: "flex", flexDirection: "column", gap: "16px" }}>
                
                {/* Lobby request (Hosts only) */}
                {isHostPrivilege && waitingUsers.length > 0 && (
                  <div style={{ background: "rgba(251, 191, 36, 0.1)", border: "1px solid rgba(251, 191, 36, 0.2)", borderRadius: "8px", padding: "12px" }}>
                    <h4 style={{ fontSize: "0.85rem", fontWeight: "700", color: "#fbbf24", marginBottom: "8px" }}>
                      Lobby Join Requests ({waitingUsers.length})
                    </h4>
                    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                      {waitingUsers.map((w) => (
                        <div key={w.user_id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <span style={{ fontSize: "0.85rem" }}>{w.name}</span>
                          <div style={{ display: "flex", gap: "6px" }}>
                            <button onClick={() => handleApprove(w.user_id)} className="btn btn-primary" style={{ padding: "4px 8px", fontSize: "0.75rem", background: "var(--secondary)" }}>
                              <Check size={12} />
                            </button>
                            <button onClick={() => handleReject(w.user_id)} className="btn btn-danger" style={{ padding: "4px 8px", fontSize: "0.75rem" }}>
                              <X size={12} />
                            </button>
                          </div>
                        </div>
                      ))}
                      <button onClick={handleApproveAll} className="btn btn-secondary" style={{ width: "100%", fontSize: "0.75rem", marginTop: "6px" }}>
                        Approve All
                      </button>
                    </div>
                  </div>
                )}

                {/* Active users lists */}
                <div>
                  <h4 style={{ fontSize: "0.8rem", color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "10px" }}>
                    Connected ({peers.length + 1})
                  </h4>

                  <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                    
                    {/* Myself */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: "0.9rem", fontWeight: "600" }}>{myName} (You)</span>
                      {amIHost && <span style={{ fontSize: "0.7rem", color: "var(--primary)", background: "rgba(99,102,241,0.15)", padding: "2px 6px", borderRadius: "4px" }}>Host</span>}
                    </div>

                    {/* Remote peers */}
                    {peers.map((p) => (
                      <div key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div style={{ display: "flex", flexDirection: "column" }}>
                          <span style={{ fontSize: "0.9rem" }}>{p.display_name}</span>
                          <div style={{ display: "flex", gap: "4px" }}>
                            {p.is_host && <span style={{ fontSize: "0.65rem", color: "var(--primary)" }}>Host</span>}
                            {p.is_cohost && <span style={{ fontSize: "0.65rem", color: "var(--secondary)" }}>Co-Host</span>}
                          </div>
                        </div>

                        {/* Host action panel */}
                        {isHostPrivilege && p.id !== myId && (
                          <div style={{ display: "flex", gap: "6px" }}>
                            <button onClick={() => handleMute(p.id)} className="btn btn-secondary" style={{ padding: "6px" }} title="Force Mute">
                              <VolumeX size={14} />
                            </button>
                            {amIHost && !p.is_cohost && (
                              <button onClick={() => handlePromote(p.id)} className="btn btn-secondary" style={{ padding: "6px" }} title="Make Co-Host">
                                <ShieldCheck size={14} />
                              </button>
                            )}
                            <button onClick={() => handleKick(p.id)} className="btn btn-danger" style={{ padding: "6px" }} title="Kick User">
                              <UserX size={14} />
                            </button>
                          </div>
                        )}
                      </div>
                    ))}

                  </div>
                </div>

              </div>
            )}

          </div>
        )}

      </div>

      {/* Floating chimes / reactions triggers floating widget */}
      <div style={{ height: "90px", display: "flex", justifyContent: "center", alignItems: "center", position: "relative" }}>
        
        {/* Floating Toolbar controls */}
        <div className="glass-panel" style={{
          position: "absolute",
          bottom: "20px",
          display: "flex",
          alignItems: "center",
          gap: "14px",
          padding: "10px 24px",
          borderRadius: "var(--radius-lg)",
          border: "1px solid var(--border-glass)",
          background: "rgba(10, 15, 30, 0.8)",
          boxShadow: "0 10px 30px rgba(0,0,0,0.6)"
        }}>
          
          {/* Mute microphone */}
          <button onClick={toggleMic} className={`btn ${isMicOn ? "btn-secondary" : "btn-danger"} hover-scale`} style={{ borderRadius: "50%", padding: "12px", width: "46px", height: "46px" }}>
            {isMicOn ? <Mic size={20} /> : <MicOff size={20} />}
          </button>

          {/* Toggle camera */}
          <button onClick={toggleCamera} className={`btn ${isCameraOn ? "btn-secondary" : "btn-danger"} hover-scale`} style={{ borderRadius: "50%", padding: "12px", width: "46px", height: "46px" }}>
            {isCameraOn ? <Video size={20} /> : <VideoOff size={20} />}
          </button>

          {/* Screenshare */}
          <button onClick={toggleScreenShare} className={`btn ${isScreenSharing ? "btn-primary" : "btn-secondary"} hover-scale`} style={{ borderRadius: "50%", padding: "12px", width: "46px", height: "46px" }}>
            <Monitor size={20} />
          </button>

          {/* Hand toggle */}
          <button onClick={toggleHand} className={`btn ${handRaised ? "btn-primary" : "btn-secondary"} hover-scale`} style={{ borderRadius: "50%", padding: "12px", width: "46px", height: "46px" }}>
            <Hand size={20} fill={handRaised ? "white" : "none"} />
          </button>

          {/* Emoji reaction button and picker container */}
          <div style={{ position: "relative" }}>
            <button onClick={() => setIsReactionOpen(!isReactionOpen)} className={`btn ${isReactionOpen ? "btn-primary" : "btn-secondary"} hover-scale`} style={{ borderRadius: "50%", padding: "12px", width: "46px", height: "46px" }}>
              <Smile size={20} />
            </button>
            {isReactionOpen && (
              <div className="glass-panel" style={{
                position: "absolute",
                bottom: "60px",
                left: "50%",
                transform: "translateX(-50%)",
                display: "flex",
                gap: "10px",
                padding: "8px 12px",
                borderRadius: "var(--radius-md)"
              }}>
                {["👍", "❤️", "👏", "😂", "🎉", "😮"].map((emoji) => (
                  <button key={emoji} onClick={() => sendReaction(emoji)} style={{ background: "none", border: "none", fontSize: "1.6rem", cursor: "pointer", transition: "var(--transition-smooth)" }} className="hover-scale">
                    {emoji}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div style={{ height: "24px", borderLeft: "1px solid var(--border-glass)", margin: "0 4px" }} />

          {/* Chat Panel Trigger */}
          <button onClick={() => {
            setActivePanel(activePanel === "chat" ? null : "chat");
            setHasUnreadChat(false);
          }} className={`btn ${activePanel === "chat" ? "btn-primary" : "btn-secondary"} hover-scale`} style={{ borderRadius: "50%", padding: "12px", width: "46px", height: "46px", position: "relative" }}>
            <MessageSquare size={20} />
            {hasUnreadChat && (
              <span style={{ position: "absolute", top: "0", right: "0", width: "10px", height: "10px", background: "var(--primary)", borderRadius: "50%" }} />
            )}
          </button>

          {/* Participants Trigger */}
          <button onClick={() => setActivePanel(activePanel === "people" ? null : "people")} className={`btn ${activePanel === "people" ? "btn-primary" : "btn-secondary"} hover-scale`} style={{ borderRadius: "50%", padding: "12px", width: "46px", height: "46px" }}>
            <Users size={20} />
          </button>

          {/* Leave call */}
          <button onClick={handleDisconnect} className="btn btn-danger hover-scale" style={{ borderRadius: "50%", padding: "12px", width: "46px", height: "46px" }}>
            <PhoneOff size={20} />
          </button>

        </div>

      </div>

    </div>
  );
};

export default Meeting;

// Simple inline TS helper for typing hash maps
interface HashMap<V> {
  [key: string]: V;
}
// WebRTC Multi-Peer Mesh Connection Manager
// Text Chat sidebar and lobby moderator approvals panel
// Floating reactions overlays and toolbar actions
// Dynamic screensharing mirroring fixes
// WebRTC Multi-Peer Mesh Connection Manager
